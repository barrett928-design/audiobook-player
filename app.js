"use strict";
const $ = (id) => document.getElementById(id);
const audio = $("audio");
const KEY = "audiobook-state-v1";

let tracks = [];      // [{file, name}]
let index = 0;
let sleepDeadline = 0;     // ms timestamp, 0 = off
let sleepAtChapterEnd = false;
let sleepTick = null;
let bookId = "";

const fmt = (s) => {
  if (!isFinite(s)) return "0:00";
  s = Math.floor(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(sec).padStart(2, "0");
};

const loadState = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
const saveState = () => {
  if (!bookId) return;
  const all = loadState();
  all[bookId] = { index, time: audio.currentTime, speed: audio.playbackRate };
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch {}
};

function renderPlaylist() {
  const ol = $("playlist");
  ol.innerHTML = "";
  tracks.forEach((t, i) => {
    const li = document.createElement("li");
    li.textContent = t.name;
    li.className = i === index ? "active" : "";
    li.onclick = () => loadTrack(i, 0, true);
    ol.appendChild(li);
  });
}

function loadTrack(i, time = 0, autoplay = false) {
  if (!tracks[i]) return;
  index = i;
  if (audio.src) URL.revokeObjectURL(audio.src);
  audio.src = URL.createObjectURL(tracks[i].file);
  audio.addEventListener("loadedmetadata", function once() {
    audio.currentTime = time;
    audio.removeEventListener("loadedmetadata", once);
    if (autoplay) audio.play().catch(() => {});
  });
  $("trackTitle").textContent = tracks[i].name;
  renderPlaylist();
  updateMediaSession();
}

$("filePicker").addEventListener("change", (e) => {
  tracks = [...e.target.files]
    .filter((f) => /\.mp3$/i.test(f.name) || f.type === "audio/mpeg")
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    .map((f) => ({ file: f, name: f.name.replace(/\.mp3$/i, "") }));
  if (!tracks.length) return;
  bookId = tracks.length + ":" + tracks.map((t) => t.file.size).reduce((a, b) => a + b, 0);
  $("bookTitle").textContent = tracks[0].name.split(/[-_–]/)[0].trim() || "Audiobook";
  const saved = loadState()[bookId];
  if (saved) {
    setSpeed(saved.speed || 1);
    $("speed").value = String(audio.playbackRate);
    loadTrack(saved.index || 0, saved.time || 0, false);
  } else {
    loadTrack(0, 0, false);
  }
});

// Setting audio.src resets playbackRate to defaultPlaybackRate, so set both.
const setSpeed = (r) => { audio.defaultPlaybackRate = r; audio.playbackRate = r; };

const toggle = () => (audio.paused ? audio.play() : audio.pause());
const skip = (d) => { audio.currentTime = Math.max(0, Math.min(audio.duration || 0, audio.currentTime + d)); };
const next = () => { if (index < tracks.length - 1) loadTrack(index + 1, 0, true); };
const onEnded = () => {
  if (sleepAtChapterEnd) { clearSleep(); return; }
  next();
};
const prev = () => {
  if (audio.currentTime > 5 || index === 0) audio.currentTime = 0;
  else loadTrack(index - 1, 0, true);
};

$("play").onclick = toggle;
$("back").onclick = () => skip(-15);
$("fwd").onclick = () => skip(30);
$("next").onclick = next;
$("prev").onclick = prev;
$("seek").oninput = (e) => { audio.currentTime = Number(e.target.value); };
$("speed").onchange = (e) => { setSpeed(Number(e.target.value)); saveState(); };

// Sleep timer. Uses a wall-clock deadline checked every second and on timeupdate,
// because setTimeout is throttled/suspended when a phone screen is locked.
function clearSleep() {
  sleepDeadline = 0;
  sleepAtChapterEnd = false;
  clearInterval(sleepTick);
  sleepTick = null;
  $("sleep").value = "0";
  $("sleepLeft").textContent = "";
}
function sleepNow() {
  clearSleep();
  audio.pause();
}
function checkSleep() {
  if (!sleepDeadline) return;
  const left = sleepDeadline - Date.now();
  if (left <= 0) return sleepNow();
  $("sleepLeft").textContent = fmt(left / 1000) + " left";
}
$("sleep").onchange = (e) => {
  clearSleep();
  const v = e.target.value;
  $("sleep").value = v;
  if (v === "chapter") {
    sleepAtChapterEnd = true;
    $("sleepLeft").textContent = "end of chapter";
  } else if (Number(v)) {
    sleepDeadline = Date.now() + Number(v) * 60000;
    sleepTick = setInterval(checkSleep, 1000);
    checkSleep();
  }
};

audio.addEventListener("play", () => ($("play").textContent = "⏸"));
audio.addEventListener("pause", () => { $("play").textContent = "▶"; saveState(); });
audio.addEventListener("ended", onEnded);
audio.addEventListener("loadedmetadata", () => { $("seek").max = audio.duration; $("dur").textContent = fmt(audio.duration); });
let lastSave = 0;
audio.addEventListener("timeupdate", () => {
  $("seek").value = audio.currentTime;
  $("cur").textContent = fmt(audio.currentTime);
  checkSleep();
  if (Date.now() - lastSave > 5000) { lastSave = Date.now(); saveState(); }
});
window.addEventListener("pagehide", saveState);

function updateMediaSession() {
  if (!("mediaSession" in navigator) || !tracks[index]) return;
  navigator.mediaSession.metadata = new MediaMetadata({ title: tracks[index].name, artist: $("bookTitle").textContent });
  const h = navigator.mediaSession.setActionHandler.bind(navigator.mediaSession);
  h("play", () => audio.play());
  h("pause", () => audio.pause());
  h("seekbackward", () => skip(-15));
  h("seekforward", () => skip(30));
  h("previoustrack", prev);
  h("nexttrack", next);
}

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
