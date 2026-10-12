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

// --- Persistence: the chosen book's MP3s are stored in IndexedDB so they survive restarts.
const dbp = new Promise((res, rej) => {
  const r = indexedDB.open("audiobook", 1);
  r.onupgradeneeded = () => { r.result.createObjectStore("book"); r.result.createObjectStore("files"); };
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});
const tx = async (stores, mode, fn) => {
  const db = await dbp;
  return new Promise((res, rej) => {
    const t = db.transaction(stores, mode);
    const out = fn(t);
    t.oncomplete = () => res(out ? out.result : undefined);
    t.onerror = t.onabort = () => rej(t.error);
  });
};
async function saveBook(list) {
  await tx(["book", "files"], "readwrite", (t) => {
    t.objectStore("book").clear();
    t.objectStore("files").clear();
    t.objectStore("book").put({ bookId, names: list.map((x) => x.name) }, "current");
    list.forEach((x, i) => t.objectStore("files").put(x.file, i));
  });
}
async function restoreBook() {
  const meta = await tx(["book"], "readonly", (t) => t.objectStore("book").get("current"));
  if (!meta) return null;
  const files = await tx(["files"], "readonly", (t) => t.objectStore("files").getAll());
  if (files.length !== meta.names.length) return null;
  return { bookId: meta.bookId, list: meta.names.map((name, i) => ({ name, file: files[i] })) };
}

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

function openBook(list, id, fresh) {
  tracks = list;
  bookId = id;
  $("bookTitle").textContent = tracks[0].name.split(/[-_–]/)[0].trim() || "Audiobook";
  $("pickText").textContent = "Replace book (choose new MP3 files)";
  const saved = loadState()[bookId];
  if (saved) {
    setSpeed(saved.speed || 1);
    $("speed").value = String(audio.playbackRate);
    loadTrack(saved.index || 0, saved.time || 0, false);
  } else {
    loadTrack(0, 0, false);
  }
}

$("filePicker").addEventListener("change", async (e) => {
  const list = [...e.target.files]
    .filter((f) => /\.mp3$/i.test(f.name) || f.type === "audio/mpeg")
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    .map((f) => ({ file: f, name: f.name.replace(/\.mp3$/i, "") }));
  e.target.value = "";
  if (!list.length) return;
  const id = list.length + ":" + list.reduce((a, t) => a + t.file.size, 0);
  openBook(list, id);
  $("trackTitle").textContent = "Saving to this device…";
  try {
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
    await saveBook(list);
    $("trackTitle").textContent = tracks[index].name;
  } catch (err) {
    $("trackTitle").textContent = "Couldn't save for next time (storage full?). Playing anyway.";
  }
});

const restored = restoreBook().then((b) => { if (b && !tracks.length) openBook(b.list, b.bookId); }).catch((e) => console.error("restore failed", e));

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
  navigator.mediaSession.metadata = new MediaMetadata({
    title: tracks[index].name,
    artist: $("bookTitle").textContent,
    artwork: [{ src: "icons/icon-512.png", sizes: "512x512", type: "image/png" }],
  });
}

// Start playback from the lock screen / AirPods, even if iOS suspended the page or
// dropped the loaded audio while paused: wait for the saved book, reload the chapter
// at the remembered position if the element isn't usable, then play.
async function resumePlayback() {
  if (!tracks.length) await restored;
  if (!tracks.length) return;
  if (!audio.src || audio.error || audio.readyState === 0) {
    loadTrack(index, audio.currentTime || (loadState()[bookId] || {}).time || 0, true);
    return;
  }
  try { await audio.play(); }
  catch { loadTrack(index, audio.currentTime, true); }
}

// Handlers are registered once at startup so they exist before any chapter loads.
function setupMediaSession() {
  if (!("mediaSession" in navigator)) return;
  const h = (a, f) => { try { navigator.mediaSession.setActionHandler(a, f); } catch {} };
  h("play", resumePlayback);
  h("pause", () => audio.pause());
  h("stop", () => audio.pause());
  h("seekbackward", () => skip(-15));
  h("seekforward", () => skip(30));
  h("previoustrack", prev);
  h("nexttrack", next);
  h("seekto", (d) => { if (d.seekTime != null) audio.currentTime = d.seekTime; });
}
setupMediaSession();

let lastPos = 0;
function updatePositionState() {
  if (!("mediaSession" in navigator) || !navigator.mediaSession.setPositionState || !isFinite(audio.duration)) return;
  try {
    navigator.mediaSession.setPositionState({ duration: audio.duration, playbackRate: audio.playbackRate, position: Math.min(audio.currentTime, audio.duration) });
  } catch {}
}
audio.addEventListener("play", () => { if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing"; updatePositionState(); });
audio.addEventListener("pause", () => { if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused"; updatePositionState(); });
audio.addEventListener("seeked", updatePositionState);
audio.addEventListener("loadedmetadata", updatePositionState);
audio.addEventListener("timeupdate", () => { if (Date.now() - lastPos > 10000) { lastPos = Date.now(); updatePositionState(); } });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") saveState(); });

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
