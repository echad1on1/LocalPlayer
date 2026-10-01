# Crate for Mac

The same Crate app, on your laptop. It uses the exact same UI files as the phone
(`../app/src/main/assets/web`), so a change there shows up in both apps.

## How it fits together

| File | What it does |
| --- | --- |
| `main.js` | The app: window, Mac menus, Dock menu, music-folder picker, saving likes/playlists/settings |
| `preload.js` | The (small) bridge between the page and the app |
| `renderer/engine.js` | The player: queue, shuffle, repeat, play counts, sleep timer, media keys and Now Playing |
| `renderer/queue.js` | The play queue (same logic as `PlayQueue.java`) |
| `lib/scanner.js` | Finds your music, reads the tags (cached), builds the library |
| `lib/folders.js` | How folders become artists and albums |

Your data lives in `~/Library/Application Support/Crate`. Nothing goes online.

### How folders become artists and albums

The album is the folder a song sits in and the artist is the folder above it:

```
Music/Artist/Album/song.mp3            -> artist "Artist", album "Album"
Music/orginized/Artist/Album/song.mp3  -> same (a folder wrapping everything is skipped)
Music/Artist/Album/CD1/song.mp3        -> same album, CD1 is a disc folder
Music/Artist - Album/song.mp3          -> artist "Artist", album "Album"
```

## Build it

The easy way is GitHub: the workflow `.github/workflows/build-mac.yml` builds the app
for Apple Silicon and Intel Macs whenever this folder or the web UI changes (or when you
press **Run workflow** in the Actions tab). Download **Crate-Mac-AppleSilicon** or
**Crate-Mac-Intel** from the finished run; each has a `.dmg` and a `.zip` of the same app.

On a Mac with [Node.js](https://nodejs.org) installed:

```
cd desktop
npm install
npm start            # run it
npm test             # the queue and folder tests
npm run dist:mac     # build dist/*.dmg and dist/*.zip
```

## Opening it the first time

The app is signed "ad-hoc" (not with a paid Apple developer account), so macOS asks once:

1. Open Crate. macOS says it can't verify the app: click **Done**.
2. Open **System Settings → Privacy & Security**, scroll down to *"Crate" was blocked…* and
   click **Open Anyway**, then confirm.

If macOS ever says the app is *damaged*, run this once in Terminal:
`xattr -cr /Applications/Crate.app`

## Keyboard

Space play/pause · ⌘→ / ⌘← next/previous · ⌘↑ / ⌘↓ volume · ⌘S shuffle · ⌘R repeat ·
⌘L like · ⌘F search · ⌘[ back · Esc close · ⌘, settings · ⌘O add a music folder
