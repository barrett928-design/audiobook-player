# Audiobook Player

A tiny offline-capable web app (PWA) for playing MP3 audiobooks that don't come in a standard app format, e.g. a folder of `01 - Chapter.mp3` files.

## Features
- Pick a folder's worth of MP3s; chapters are sorted naturally (1, 2, 10)
- Resumes where you left off (chapter, position, speed) when you re-pick the same files
- Skip −15s / +30s, previous/next chapter, speed 0.75–2×, sleep timer
- Lock-screen / headphone controls via the Media Session API
- Files never leave your device; nothing is uploaded

## Run locally
```
python3 -m http.server 8000
```
Open http://localhost:8000. To use on a phone, host the folder on any static host (GitHub Pages works) and use "Add to Home Screen".

## Roadmap
- Remember files across sessions (IndexedDB)
- Bookmarks and per-chapter progress
- App icons
- Optional wrap with Capacitor for a native app

## Editing
No build step. Edit `index.html`, `styles.css`, and `app.js` directly, then refresh the browser. If changes don't appear, the service worker is serving cached files: bump `CACHE` in `sw.js` (e.g. `audiobook-shell-v2`) or use DevTools > Application > Unregister.

## Hosting on your phone
Make the repo public, then Settings > Pages > Deploy from branch `main` / root. Open the Pages URL on your phone and use "Add to Home Screen".
