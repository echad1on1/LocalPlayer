/* Crate for Mac — the player engine.
 *
 * Plays music with an <audio> element and gives the UI (app.js) the same window.Native interface the
 * Android app provides, so the phone UI runs unchanged. The logic mirrors PlaybackService.java:
 * queue, shuffle, repeat, play counts, history, sleep timer and a saved queue.
 * Media keys, Control Center and the Touch Bar work through the Media Session API.
 */
(function () {
  'use strict';
  const host = window.CrateHost;
  const Queue = window.CrateQueue;
  if (!host || !Queue) return;

  const REPEAT_OFF = 0, REPEAT_ALL = 1, REPEAT_ONE = 2;

  const audio = new Audio();
  audio.preload = 'auto';

  const queue = new Queue(Math.random);
  let lib = new Map();          // id -> {id, title, artist, album, dur, key}
  let valid = new Set();
  let current = null;           // the loaded song
  let loadedUid = -1;
  let repeat = REPEAT_OFF;
  let ctxLabel = '', ctxRef = '';
  let want = false;             // should be playing
  let playing = false;          // audio is actually running
  let buffering = false;
  let pendingSeek = -1;
  let restored = false, userActed = false;
  const afterRestore = [];
  let errorsInARow = 0, lastError = '';
  let sleepAt = 0, sleepTimer = 0, sleepEndOfTrack = false;
  let volume = 1, muted = false;
  let listened = 0, lastTime = -1, counted = false, historyAdded = false;
  let seq = 0, stateJson = 'null', queueJson = 'null', queueJsonVersion = -1;
  let lastPlayingSent = null, lastTitleSent = '';

  // ------------------------------------------------------------------ helpers

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function parseIds(json) {
    try {
      const a = typeof json === 'string' ? JSON.parse(json) : json;
      return Array.isArray(a) ? a.map(Number).filter(Number.isFinite) : [];
    } catch (e) {
      return [];
    }
  }
  function whenRestored(fn) {
    if (restored) return true;
    afterRestore.push(fn);
    return false;
  }
  function position() {
    if (!current) return 0;
    if (pendingSeek >= 0) return pendingSeek;
    const t = audio.currentTime;
    return Number.isFinite(t) ? Math.round(t * 1000) : 0;
  }
  function duration() {
    const d = audio.duration;
    if (current && Number.isFinite(d) && d > 0 && audio.src) return Math.round(d * 1000);
    return current ? current.dur || 0 : 0;
  }
  function applyVolume() {
    // a gentle curve so the slider feels even
    audio.volume = muted ? 0 : clamp(volume * volume, 0, 1);
  }

  // ------------------------------------------------------------------ loading & playing

  function loadCurrent(play, startAt) {
    finishCounting(false);
    const e = queue.current();
    if (!e) {
      unload();
      return;
    }
    const t = lib.get(e.id);
    current = t || null;
    loadedUid = e.uid;
    want = !!play;
    playing = false;
    listened = 0;
    lastTime = -1;
    counted = false;
    historyAdded = false;
    if (!t) {
      onError('Song not found');
      return;
    }
    pendingSeek = startAt > 0 ? startAt : -1;
    buffering = true;
    audio.src = '/media/' + t.id;
    if (want) start();
    else audio.load();
    updateMediaSession();
    publish();
  }

  function unload() {
    audio.removeAttribute('src');
    audio.load();
    current = null;
    loadedUid = -1;
    want = playing = buffering = false;
    pendingSeek = -1;
    updateMediaSession();
    publish();
  }

  function start() {
    if (!current) return;
    want = true;
    if (!audio.src) {
      loadCurrent(true, pendingSeek > 0 ? pendingSeek : 0);
      return;
    }
    const p = audio.play();
    if (p && p.catch) {
      p.catch(err => {
        if (err && err.name === 'AbortError') return;      // a newer song was loaded
        if (err && err.name === 'NotAllowedError') {
          want = false;
          publish();
        }
      });
    }
    publish();
  }

  function play() {
    if (!whenRestored(play)) return;
    userActed = true;
    if (!current) {
      if (queue.current()) loadCurrent(true, 0);
      return;
    }
    start();
  }

  function pause() {
    if (!want && !playing) return;
    want = false;
    audio.pause();
    finishCounting(false);
    publish();
    save();
  }

  function toggle() {
    if (!restored) {
      whenRestored(toggle);
      return;
    }
    if (want) pause();
    else play();
  }

  function next() {
    if (!whenRestored(next)) return;
    if (!queue.size()) return;
    userActed = true;
    let p = want;
    const wrapped = queue.isLast();
    if (!queue.moveNext(true)) return;
    if (wrapped && repeat === REPEAT_OFF) p = false;
    loadCurrent(p, 0);
    save();
  }

  function prev() {
    if (!whenRestored(prev)) return;
    if (!current && !queue.size()) return;
    userActed = true;
    if (position() > 3000) {
      seek(0);
      return;
    }
    const p = want;
    if (!queue.movePrev(repeat === REPEAT_ALL)) {
      seek(0);
      return;
    }
    loadCurrent(p, 0);
    save();
  }

  function seek(ms) {
    if (!current) return;
    const d = duration();
    ms = Math.max(0, Number(ms) || 0);
    if (d > 0) ms = Math.min(ms, d);
    if (audio.readyState >= 1) {
      pendingSeek = -1;
      audio.currentTime = ms / 1000;
    } else {
      pendingSeek = ms;
    }
    lastTime = ms / 1000;
    publish();
  }

  function stopped() {
    want = false;
    audio.pause();
    publish();
    save();
  }

  function onEnded() {
    finishCounting(true);
    playing = false;
    if (repeat === REPEAT_ONE && !sleepEndOfTrack) {
      counted = false;
      historyAdded = false;
      listened = 0;
      lastTime = 0;
      audio.currentTime = 0;
      start();
      return;
    }
    const stopAfter = sleepEndOfTrack;
    sleepEndOfTrack = false;
    if (queue.isLast() && repeat !== REPEAT_ALL) {
      // end of the album / playlist: back to the first song, stopped
      queue.first();
      loadCurrent(false, 0);
      stopped();
      return;
    }
    queue.moveNext(true);
    loadCurrent(!stopAfter, 0);
    if (stopAfter) stopped();
    save();
  }

  function onError(msg) {
    lastError = msg;
    errorsInARow++;
    playing = false;
    buffering = false;
    const p = want;
    const limit = Math.min(Math.max(queue.size(), 1), 10);
    if (errorsInARow >= limit || queue.size() <= 1) {
      errorsInARow = 0;
      stopped();
      return;
    }
    queue.moveNext(true);
    loadCurrent(p, 0);
  }

  // ------------------------------------------------------------------ audio events

  audio.addEventListener('playing', () => {
    playing = true;
    buffering = false;
    errorsInARow = 0;
    lastError = '';
    if (!historyAdded && current) {
      historyAdded = true;
      host.addHistory(current.key);
    }
    publish();
  });
  audio.addEventListener('pause', () => {
    playing = false;
    publish();
  });
  audio.addEventListener('waiting', () => {
    buffering = true;
    publish();
  });
  audio.addEventListener('canplay', () => {
    if (buffering) {
      buffering = false;
      publish();
    }
  });
  audio.addEventListener('loadedmetadata', () => {
    if (pendingSeek > 0) {
      const ms = pendingSeek;
      pendingSeek = -1;
      try {
        audio.currentTime = ms / 1000;
      } catch (e) {
        // ignore
      }
    } else {
      pendingSeek = -1;
    }
    publish();
  });
  audio.addEventListener('seeked', publish);
  audio.addEventListener('durationchange', () => {
    if (current && Number.isFinite(audio.duration) && audio.duration > 0) current.dur = Math.round(audio.duration * 1000);
    updatePositionState();
  });
  audio.addEventListener('timeupdate', () => {
    const t = audio.currentTime;
    if (playing && lastTime >= 0) {
      const dt = t - lastTime;
      if (dt > 0 && dt < 1.5) listened += dt;
    }
    lastTime = t;
    if (!counted) finishCounting(false);
  });
  audio.addEventListener('ended', onEnded);
  audio.addEventListener('error', () => {
    if (!audio.src || !current) return;
    const code = audio.error ? audio.error.code : 0;
    onError(code === 4 ? "Can't play this file format" : "Can't play this file");
  });

  /** A play counts after 30 s (or half the song if shorter), or when it finished. */
  function finishCounting(completed) {
    if (!current || counted) return;
    const d = current.dur > 0 ? current.dur : duration();
    const threshold = d > 0 ? Math.min(30000, d / 2) : 30000;
    if (completed || listened * 1000 >= threshold) {
      counted = true;
      host.countPlay(current.key);
    }
  }

  // ------------------------------------------------------------------ queue commands

  function playIds(idsJson, start, shuffle, label, ref) {
    if (!whenRestored(() => playIds(idsJson, start, shuffle, label, ref))) return;
    userActed = true;
    const ids = parseIds(idsJson).filter(id => lib.has(id));
    if (!ids.length) return;
    queue.set(ids, Number(start), !!shuffle);
    ctxLabel = label || '';
    ctxRef = ref || '';
    errorsInARow = 0;
    loadCurrent(true, 0);
    save();
  }

  function setShuffle(on) {
    if (!whenRestored(() => setShuffle(on))) return;
    userActed = true;
    queue.setShuffle(!!on);
    publish();
    save();
  }

  function setRepeat(mode) {
    repeat = ((Number(mode) % 3) + 3) % 3;
    publish();
    save();
  }

  function jumpTo(uid) {
    userActed = true;
    if (queue.jumpTo(Number(uid))) {
      loadCurrent(true, 0);
      save();
    }
  }

  function addIds(ids, playNext) {
    if (!whenRestored(() => addIds(ids, playNext))) return;
    ids = ids.filter(id => lib.has(id));
    if (!ids.length) return;
    userActed = true;
    const wasEmpty = queue.size() === 0;
    queue.add(ids, !!playNext);
    if (wasEmpty) {
      ctxLabel = 'Your queue';
      ctxRef = 'queue';
      loadCurrent(true, 0);
    } else {
      publish();
    }
    save();
  }

  function setSleep(minutes) {
    clearTimeout(sleepTimer);
    sleepAt = 0;
    sleepEndOfTrack = false;
    minutes = Number(minutes) || 0;
    if (minutes > 0) {
      sleepAt = Date.now() + minutes * 60000;
      sleepTimer = setTimeout(() => {
        sleepAt = 0;
        pause();
      }, minutes * 60000);
    } else if (minutes < 0) {
      sleepEndOfTrack = true;
    }
    publish();
  }

  function setVolume(v) {
    volume = clamp(Number(v), 0, 1);
    if (!Number.isFinite(volume)) volume = 1;
    muted = false;
    applyVolume();
    publish();
    saveSoon();
  }

  // ------------------------------------------------------------------ library & restore

  function setLibrary(raw) {
    const m = new Map();
    for (const r of (raw && raw.tracks) || []) {
      m.set(r[0], { id: r[0], title: r[1], artist: r[2], album: r[3], dur: r[5] || 0, key: r[11] });
    }
    lib = m;
    valid = new Set(m.keys());
    if (!restored) {
      restore();
      return;
    }
    if (current && m.has(current.id)) {
      current = m.get(current.id);
      updateMediaSession();
    }
  }

  function restore() {
    if (!userActed) {
      const saved = readSaved();
      if (saved && typeof saved.q === 'string') {
        const res = queue.restoreFrom(saved.q, saved.i | 0, valid);
        if (res !== Queue.RESTORE_FAILED) {
          ctxLabel = saved.c || '';
          ctxRef = saved.f || '';
          loadCurrent(false, res === Queue.RESTORE_OK ? saved.p | 0 : 0);
        }
      }
    }
    restored = true;
    const pending = afterRestore.splice(0);
    for (const fn of pending) fn();
    publish();
  }

  function readSaved() {
    try {
      const s = host.kvGet('player');
      return s ? JSON.parse(s) : null;
    } catch (e) {
      return null;
    }
  }

  let saveTimer = 0;
  function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => save(), 800);
  }
  function save(sync) {
    if (!restored && !userActed) return;
    const data = {
      q: queue.size() ? queue.serialize() : '',
      i: queue.index,
      p: Math.round(position()),
      r: repeat,
      c: ctxLabel,
      f: ctxRef,
      v: Math.round(volume * 1000) / 1000
    };
    host.kvSet('player', JSON.stringify(data), !!sync);
  }

  // ------------------------------------------------------------------ state for the UI

  function publish() {
    const e = queue.current();
    const sleep = sleepEndOfTrack ? -2 : sleepAt > 0 ? Math.max(0, sleepAt - Date.now()) : -1;
    const st = {
      seq: ++seq,
      id: current ? current.id : (e ? e.id : -1),
      uid: e ? e.uid : -1,
      idx: queue.index,
      len: queue.size(),
      qv: queue.version,
      up: queue.upcomingUserCount(),
      playing: !!(want && current),
      buffering: !!(want && current && (buffering || (!playing && audio.readyState < 3))),
      pos: position(),
      dur: duration(),
      ts: Date.now(),
      shuffle: queue.shuffle,
      repeat: repeat,
      sleep: sleep,
      ctx: ctxLabel,
      ref: ctxRef,
      err: lastError,
      vol: volume,
      muted: muted
    };
    stateJson = JSON.stringify(st);
    const ui = window.__crate;
    if (ui && typeof ui.onState === 'function') ui.onState(st);
    const title = current ? current.title + ' — ' + current.artist : '';
    if (st.playing !== lastPlayingSent || title !== lastTitleSent) {
      lastPlayingSent = st.playing;
      lastTitleSent = title;
      host.setPlaying(st.playing, title);
      document.title = current ? title : 'Crate';
    }
    if (ms) {
      try {
        ms.playbackState = current ? (st.playing ? 'playing' : 'paused') : 'none';
      } catch (err) {
        // ignore
      }
      updatePositionState();
    }
  }

  // keep the UI's clock honest while playing, save the position now and then
  setInterval(() => {
    if (playing) publish();
  }, 5000);
  setInterval(() => {
    if (playing) save();
  }, 10000);
  window.addEventListener('pagehide', () => save(true));
  window.addEventListener('beforeunload', () => save(true));

  // ------------------------------------------------------------------ media keys & Now Playing

  const ms = 'mediaSession' in navigator ? navigator.mediaSession : null;
  let artUrl = '', artFor = -1;
  function setMetadata(artwork) {
    if (!current) return;
    ms.metadata = new MediaMetadata({ title: current.title, artist: current.artist, album: current.album, artwork: artwork });
  }
  function updateMediaSession() {
    if (!ms) return;
    try {
      if (!current) {
        ms.metadata = null;
        return;
      }
      const id = current.id;
      setMetadata(artFor === id && artUrl ? [{ src: artUrl, sizes: '512x512', type: 'image/jpeg' }] : []);
      if (artFor === id) return;
      // Now Playing only accepts http/data/blob images, so hand it a blob of our album art
      fetch('/art/' + id + '?s=512').then(r => (r.ok ? r.blob() : null)).then(blob => {
        if (!current || current.id !== id) return;
        if (artUrl) URL.revokeObjectURL(artUrl);
        artUrl = blob ? URL.createObjectURL(blob) : '';
        artFor = id;
        setMetadata(artUrl ? [{ src: artUrl, sizes: '512x512', type: 'image/jpeg' }] : []);
      }).catch(() => {});
    } catch (e) {
      // ignore
    }
  }
  function updatePositionState() {
    if (!ms || !ms.setPositionState) return;
    try {
      const d = duration() / 1000;
      if (current && d > 0) ms.setPositionState({ duration: d, playbackRate: 1, position: clamp(position() / 1000, 0, d) });
    } catch (e) {
      // ignore
    }
  }
  if (ms) {
    const on = (name, fn) => {
      try {
        ms.setActionHandler(name, fn);
      } catch (e) {
        // not supported
      }
    };
    on('play', () => play());
    on('pause', () => pause());
    on('stop', () => pause());
    on('previoustrack', () => prev());
    on('nexttrack', () => next());
    on('seekto', d => seek((d && d.seekTime ? d.seekTime : 0) * 1000));
  }

  // ------------------------------------------------------------------ menu & dock commands

  const ENGINE_COMMANDS = {
    toggle: toggle,
    play: play,
    pause: pause,
    next: next,
    prev: prev,
    shuffle: () => setShuffle(!queue.shuffle),
    repeat: () => setRepeat(repeat + 1),
    'vol-up': () => setVolume(volume + 0.1),
    'vol-down': () => setVolume(volume - 0.1)
  };
  host.onCommand(name => {
    const fn = ENGINE_COMMANDS[name];
    if (fn) {
      fn();
      const ui = window.__crate;
      if (ui && ui.command && (name === 'shuffle' || name === 'repeat')) ui.command('toast-' + name);
      return;
    }
    const ui = window.__crate;
    if (ui && typeof ui.command === 'function') ui.command(name);
  });
  host.onScanProgress(p => {
    const ui = window.__crate;
    if (ui && typeof ui.scanProgress === 'function') ui.scanProgress(p);
  });
  host.onLibraryChanged(() => {
    const ui = window.__crate;
    if (ui && typeof ui.libraryChanged === 'function') ui.libraryChanged();
  });

  // ------------------------------------------------------------------ the interface app.js uses

  (function initSaved() {
    const saved = readSaved();
    if (saved) {
      repeat = ((saved.r | 0) % 3 + 3) % 3;
      if (typeof saved.v === 'number' && Number.isFinite(saved.v)) volume = clamp(saved.v, 0, 1);
    }
    applyVolume();
  })();

  window.Native = {
    state: () => stateJson,
    queue: () => {
      if (queueJsonVersion !== queue.version) {
        queueJson = JSON.stringify(queue.toJSON());
        queueJsonVersion = queue.version;
      }
      return queueJson;
    },
    playIds: (idsJson, startIdx, shuffle, label, ref) => playIds(idsJson, startIdx, shuffle, label, ref),
    toggle: () => toggle(),
    play: () => play(),
    pause: () => pause(),
    next: () => next(),
    prev: () => prev(),
    seek: ms2 => seek(ms2),
    shuffle: on => setShuffle(on),
    repeat: m => setRepeat(m),
    jump: uid => jumpTo(uid),
    add: (idsJson, playNext) => addIds(parseIds(idsJson), playNext),
    remove: uid => {
      if (queue.remove(Number(uid))) {
        publish();
        save();
      }
    },
    clearUpcoming: onlyUser => {
      queue.clearUpcoming(!!onlyUser);
      publish();
      save();
    },
    sleep: minutes => setSleep(minutes),
    permission: () => 'granted',
    requestPermission: () => {},
    openSettings: () => {},
    kvGet: k => host.kvGet(k),
    kvSet: (k, v) => host.kvSet(k, v),
    stats: () => host.stats(),
    clearStats: () => host.clearStats(),
    rescan: () => host.rescan(),
    insets: () => JSON.stringify(host.insets()),
    consumeOpenPlayer: () => false,
    haptic: () => {},
    version: () => host.version(),
    // desktop only
    platform: () => host.platform(),
    setLibrary: raw => setLibrary(raw),
    volume: v => setVolume(v),
    getVolume: () => volume,
    mute: on => {
      muted = !!on;
      applyVolume();
      publish();
    },
    folders: () => host.folders(),
    setFolders: list => host.setFolders(list),
    chooseFolder: () => host.chooseFolder(),
    reveal: id => host.reveal(id),
    home: () => host.home()
  };

  publish();
})();
