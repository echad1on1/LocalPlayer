# Crate

A retro, folder-first music player for Android (made for a Nothing Phone (3a)).
Everything is local: no account, no streaming, no tracking.

<img width="1800" height="1298" alt="image" src="https://github.com/user-attachments/assets/4cb03cda-c402-44cf-adfa-c85f0f603685" />

## Install

1. Copy `Crate-1.0.apk` to the phone (or download it there) and tap it.
2. Allow your browser / Files app to "install unknown apps" when Android asks.
   If a Play Protect warning appears, tap **More details → Install anyway**.
3. Open Crate and tap **Allow access to music**.

## Put your music in folders

Crate reads the phone's `Music` folder and turns the folders into your library:

```
Music/
  Artist/
    Album/
      01 Song.mp3
      02 Song.flac
    Other Album/
      CD1/ ...        <- disc folders are merged into one album
  Artist - Album/     <- also works
```

- Album art: art inside the files, or a `cover.jpg` / `folder.jpg` in the album folder.
- Music somewhere else (e.g. `Download`)? Settings (slider icon) → **Music folders**.
- New files show up by themselves; there's also a **Rescan** button in Settings.

## Features

Home with shortcuts, "Jump back in", "Fresh in the crate", "On repeat" and random "Dig the crate" picks ·
Artists / Albums / Songs / Folders / Playlists · Liked Songs · your own playlists · search ·
shuffle and repeat (all / one) · queue with "Play next" and "Add to queue" · sleep timer ·
background playback with lock-screen, notification, headphone and Bluetooth controls ·
pauses when headphones are unplugged or a call comes in · remembers your queue and position ·
6 glow colours (Settings).

Tips: long-press any song for its menu; swipe the mini player left/right to skip, up to open the
player; swipe the big cover to skip; swipe the player down to close it.

## Make it yours

| Want to change… | Edit |
| --- | --- |
| Colours, fonts, spacing | `app/src/main/assets/web/app.css` (colours are at the top in `:root`) |
| Screens and features | `app/src/main/assets/web/app.js` |
| How folders become artists/albums | `app/src/main/java/app/crate/player/FolderRules.java` |
| Playback, notification, lock screen | `app/src/main/java/app/crate/player/PlaybackService.java` |
| App name | `app/src/main/res/values/strings.xml` |
| App icon | `app/src/main/res/drawable/ic_launcher_fg.xml` |

The UI is plain HTML/CSS/JS running in a WebView, so you can inspect and tweak it live:
connect the phone with USB debugging on and open `chrome://inspect` in Chrome on your computer.

## Build it yourself

**Android Studio:** File → Open → this folder → wait for Gradle sync → Run ▶ (phone connected with
USB debugging) or Build → Build APK(s). The project includes the same signing key (`crate.jks`,
password `cratecrate`) as the ready-made APK, so your builds install as updates without uninstalling.

**No computer?** Push this folder to a GitHub repository, open the **Actions** tab, run
**Build APK**, and download the `crate-apk` artifact on your phone.

Requires Android 11 or newer.

## Credits

Fonts: Doto and Space Mono, SIL Open Font License (see `app/src/main/assets/web/fonts`).
