'use strict';
/**
 * Crate for Mac — the app shell.
 *
 * The UI is the same HTML/CSS/JS as the Android app (app/src/main/assets/web). This file:
 *  - serves it from a private app://crate origin, together with
 *      /api/library   the scanned music library (JSON)
 *      /art/{id}      album art (embedded, or cover.jpg next to the songs)
 *      /media/{id}    the audio file itself (with seeking support)
 *  - keeps likes, playlists, settings and play counts in ~/Library/Application Support/Crate
 *  - adds the Mac menus, the Dock menu and the music-folder picker.
 * Nothing goes online.
 */
const { app, BrowserWindow, protocol, ipcMain, Menu, dialog, shell, nativeImage, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const { Readable } = require('stream');
const { Scanner, readPicture, findFolderImage, normalizeRoots, isAudio } = require('./lib/scanner');
const { JsonStore } = require('./lib/store');

const isMac = process.platform === 'darwin';
// Tests on Linux can ask for the Mac look (traffic-light padding) with CRATE_FAKE_MAC=1.
const looksMac = isMac || process.env.CRATE_FAKE_MAC === '1';
const HOST = 'crate';
const ORIGIN = 'app://' + HOST;
const BG = '#0a0b0a';

protocol.registerSchemesAsPrivileged([{
  scheme: 'app',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true }
}]);

// Let tests run several copies side by side with their own data folder.
if (process.env.CRATE_USER_DATA) app.setPath('userData', process.env.CRATE_USER_DATA);
if (process.env.CRATE_TEST_AUDIO === 'fake') app.commandLine.appendSwitch('disable-audio-output');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
}

let win = null;
let quitting = false;
let kv, stats, prefs, scanner;
let library = null;          // last scan result {json, signature, byId, roots}
let scanPromise = null;
let needRescan = true;
let lastPlaying = false, lastTitle = '';

// ------------------------------------------------------------------ paths & settings

function webRoot() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'web')
    : path.join(__dirname, '..', 'app', 'src', 'main', 'assets', 'web');
}

function musicFolders() {
  const f = prefs.get('folders');
  if (Array.isArray(f)) return f;
  return [path.join(os.homedir(), 'Music')];
}

// ------------------------------------------------------------------ the library

function sendToPage(channel, ...args) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
}

let lastProgress = 0;
function onScanProgress(p) {
  const now = Date.now();
  if (p.done !== p.total && now - lastProgress < 120) return;
  lastProgress = now;
  sendToPage('scan-progress', p);
}

function getLibrary() {
  if (scanPromise) return needRescan ? scanPromise.then(() => getLibrary()) : scanPromise;
  if (library && !needRescan) return Promise.resolve(library);
  needRescan = false;
  scanPromise = scanner.scan(musicFolders(), onScanProgress).then(res => {
    library = res;
    scanPromise = null;
    artCache.clear();
    artMisses.clear();
    folderImages.clear();
    watch(res.roots);
    return res;
  }, err => {
    scanPromise = null;
    throw err;
  });
  return scanPromise;
}

// New, moved or deleted songs show up by themselves.
let watchers = [];
let watchTimer = null;
function watch(roots) {
  for (const w of watchers) {
    try {
      w.close();
    } catch (e) {
      // already closed
    }
  }
  watchers = [];
  for (const root of roots) {
    try {
      const w = fs.watch(root, { recursive: true }, (event, filename) => {
        const name = filename ? String(filename) : '';
        const base = path.basename(name);
        if (base.startsWith('.')) return;
        if (name && path.extname(name) && !isAudio(name) && !/\.(jpe?g|png|webp)$/i.test(name)) return;
        clearTimeout(watchTimer);
        watchTimer = setTimeout(rescanFromWatch, 2500);
      });
      w.on('error', () => {});
      watchers.push(w);
    } catch (e) {
      // folder can't be watched (network drive …): Rescan still works
    }
  }
}

async function rescanFromWatch() {
  const before = library ? library.signature : '';
  needRescan = true;
  try {
    const lib = await getLibrary();
    if (lib.signature !== before) sendToPage('library-changed');
  } catch (e) {
    // try again on the next change
  }
}

// ------------------------------------------------------------------ app:// protocol

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.txt': 'text/plain; charset=utf-8',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.m4b': 'audio/mp4', '.aac': 'audio/aac', '.flac': 'audio/flac',
  '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/ogg', '.wav': 'audio/wav', '.wave': 'audio/wav',
  '.webm': 'audio/webm', '.weba': 'audio/webm'
};

const notFound = () => new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });

async function serveFile(base, rel) {
  const file = path.resolve(base, rel);
  if (file !== base && !file.startsWith(base + path.sep)) return notFound();
  let data;
  try {
    data = await fsp.readFile(file);
  } catch (e) {
    return notFound();
  }
  return new Response(data, {
    headers: { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-cache' }
  });
}

async function serveIndex() {
  let html;
  try {
    html = await fsp.readFile(path.join(webRoot(), 'index.html'), 'utf8');
  } catch (e) {
    return notFound();
  }
  // The desktop player engine provides window.Native before the UI starts.
  const inject = '<script src="/desktop/queue.js"></script><script src="/desktop/engine.js"></script>\n';
  html = html.replace('<script src="app.js">', inject + '<script src="app.js">');
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' } });
}

async function serveMedia(id, req) {
  const lib = library;
  const t = lib && lib.byId.get(id);
  if (!t) return notFound();
  let size;
  try {
    size = (await fsp.stat(t.path)).size;
  } catch (e) {
    return notFound();
  }
  const type = MIME[path.extname(t.path).toLowerCase()] || 'application/octet-stream';
  const range = req.headers.get('range');
  if (range) {
    const m = /^bytes=(\d*)-(\d*)/.exec(range.trim());
    let start = 0, end = size - 1;
    if (m && m[1] === '' && m[2] !== '') {
      start = Math.max(0, size - parseInt(m[2], 10));
    } else if (m) {
      if (m[1] !== '') start = parseInt(m[1], 10);
      if (m[2] !== '') end = Math.min(parseInt(m[2], 10), size - 1);
    }
    if (start >= size || end < start) {
      return new Response(null, { status: 416, headers: { 'content-range': 'bytes */' + size } });
    }
    const stream = fs.createReadStream(t.path, { start, end });
    return new Response(Readable.toWeb(stream), {
      status: 206,
      headers: {
        'content-type': type, 'content-length': String(end - start + 1), 'content-range': `bytes ${start}-${end}/${size}`,
        'accept-ranges': 'bytes', 'cache-control': 'no-store'
      }
    });
  }
  return new Response(Readable.toWeb(fs.createReadStream(t.path)), {
    status: 200,
    headers: { 'content-type': type, 'content-length': String(size), 'accept-ranges': 'bytes', 'cache-control': 'no-store' }
  });
}

// Album art, resized and cached in memory.
const artCache = new Map();
const artMisses = new Set();
const folderImages = new Map();
let artBytes = 0;
const ART_BUDGET = 80 * 1024 * 1024;

async function serveArt(id, size) {
  const t = library && library.byId.get(id);
  if (!t) return notFound();
  size = Math.max(32, Math.min(1024, size || 300));
  const key = t.path + '@' + size;
  let jpg = artCache.get(key);
  if (!jpg) {
    if (artMisses.has(t.path)) return notFound();
    let buf = await readPicture(t.path);
    if (!buf) {
      const img = await findFolderImage(path.dirname(t.path), folderImages);
      if (img) {
        try {
          buf = await fsp.readFile(img);
        } catch (e) {
          buf = null;
        }
      }
    }
    let image = buf ? nativeImage.createFromBuffer(buf) : null;
    if (!image || image.isEmpty()) {
      artMisses.add(t.path);
      return notFound();
    }
    const s = image.getSize();
    if (Math.max(s.width, s.height) > size) {
      image = image.resize(s.width >= s.height ? { width: size, quality: 'good' } : { height: size, quality: 'good' });
    }
    jpg = image.toJPEG(88);
    artCache.set(key, jpg);
    artBytes += jpg.length;
    while (artBytes > ART_BUDGET && artCache.size) {
      const oldest = artCache.keys().next().value;
      artBytes -= artCache.get(oldest).length;
      artCache.delete(oldest);
    }
  } else {
    artCache.delete(key);   // keep recently used ones
    artCache.set(key, jpg);
  }
  return new Response(jpg, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'max-age=3600' } });
}

async function handle(req) {
  const url = new URL(req.url);
  if (url.host !== HOST) return notFound();
  let p = decodeURIComponent(url.pathname);
  if (p === '/' || p === '') p = '/index.html';
  try {
    if (p === '/api/library') {
      const lib = await getLibrary();
      return new Response(lib.json, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
    }
    if (p.startsWith('/media/')) return await serveMedia(Number(p.slice(7)), req);
    if (p.startsWith('/art/')) return await serveArt(Number(p.slice(5)), Number(url.searchParams.get('s')));
    if (p === '/index.html') return await serveIndex();
    if (p.startsWith('/desktop/')) return await serveFile(path.join(__dirname, 'renderer'), p.slice('/desktop/'.length));
    return await serveFile(webRoot(), p.slice(1));
  } catch (e) {
    console.error('app:// error', p, e);
    return new Response('Error', { status: 500 });
  }
}

// ------------------------------------------------------------------ messages from the page

function fromApp(e) {
  // (URL.origin is "null" for custom schemes, so compare the text)
  const url = e && e.senderFrame ? String(e.senderFrame.url || '') : '';
  return url === ORIGIN || url.startsWith(ORIGIN + '/');
}

function setupIpc() {
  ipcMain.on('sync', (e, what) => {
    if (!fromApp(e)) {
      e.returnValue = null;
      return;
    }
    switch (what) {
      case 'version': e.returnValue = app.getVersion(); break;
      case 'platform': e.returnValue = looksMac ? 'darwin' : process.platform; break;
      case 'insets': e.returnValue = { t: looksMac ? 28 : 0, b: 0, l: 0, r: 0, k: 0 }; break;
      case 'home': e.returnValue = os.homedir(); break;
      case 'folders': e.returnValue = musicFolders(); break;
      case 'stats': e.returnValue = JSON.stringify({ counts: stats.get('counts'), history: stats.get('history') }); break;
      case 'rescan': needRescan = true; e.returnValue = true; break;
      default: e.returnValue = null;
    }
  });
  ipcMain.on('kv-get', (e, key) => {
    const v = fromApp(e) ? kv.get(key) : null;
    e.returnValue = typeof v === 'string' ? v : null;
  });
  ipcMain.on('kv-set', (e, key, value) => {
    if (fromApp(e)) kv.set(key, value);
  });
  ipcMain.on('kv-set-sync', (e, key, value) => {
    if (fromApp(e)) {
      kv.set(key, value);
      kv.flush();
    }
    e.returnValue = true;
  });
  ipcMain.on('stats-count', (e, key) => {
    if (!fromApp(e) || !key) return;
    const counts = stats.get('counts');
    counts[key] = (counts[key] || 0) + 1;
    stats.touch();
  });
  ipcMain.on('stats-history', (e, key) => {
    if (!fromApp(e) || !key) return;
    const h = stats.get('history');
    h.unshift([key, Date.now()]);
    if (h.length > 300) h.length = 300;
    stats.touch();
  });
  ipcMain.on('stats-clear', e => {
    if (!fromApp(e)) return;
    stats.set('counts', {});
    stats.set('history', []);
  });
  ipcMain.handle('set-folders', async (e, list) => {
    if (!fromApp(e)) return musicFolders();
    const roots = await normalizeRoots(list);
    prefs.set('folders', roots);
    prefs.flush();
    needRescan = true;
    return roots;
  });
  ipcMain.handle('choose-folder', async e => {
    if (!fromApp(e)) return null;
    const r = await dialog.showOpenDialog(win, {
      title: 'Choose your music folder',
      buttonLabel: 'Use This Folder',
      message: 'Choose the folder with your music (like Music, or a folder of Artist/Album folders).',
      defaultPath: musicFolders()[0] || os.homedir(),
      properties: ['openDirectory', 'createDirectory']
    });
    return r.canceled || !r.filePaths.length ? null : r.filePaths[0];
  });
  ipcMain.on('reveal', (e, id) => {
    const t = fromApp(e) && library && library.byId.get(Number(id));
    if (t) shell.showItemInFolder(t.path);
  });
  ipcMain.on('playing', (e, on, title) => {
    if (!fromApp(e)) return;
    lastPlaying = !!on;
    lastTitle = String(title || '');
    updateDockMenu();
  });
}

// ------------------------------------------------------------------ menus

function command(name) {
  return () => {
    if (!['toggle', 'next', 'prev', 'vol-up', 'vol-down', 'shuffle', 'repeat'].includes(name)) showWindow();
    sendToPage('cmd', name);
  };
}

function buildMenu() {
  const template = [];
  if (isMac) {
    template.push({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: command('settings') },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    });
  }
  template.push(
    {
      label: 'File',
      submenu: [
        { label: 'New Playlist', accelerator: 'CmdOrCtrl+N', click: command('new-playlist') },
        { type: 'separator' },
        { label: 'Add Music Folder…', accelerator: 'CmdOrCtrl+O', click: command('add-folder') },
        { label: 'Rescan Library', accelerator: 'CmdOrCtrl+Shift+R', click: command('rescan') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Home', accelerator: 'CmdOrCtrl+1', click: command('tab-home') },
        { label: 'Search', accelerator: 'CmdOrCtrl+F', click: command('search') },
        { label: 'Your Library', accelerator: 'CmdOrCtrl+3', click: command('tab-library') },
        { label: 'Back', accelerator: 'CmdOrCtrl+[', click: command('back') },
        { type: 'separator' },
        { label: 'Now Playing', click: command('now-playing') },
        { label: 'Queue', click: command('queue') },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        ...(app.isPackaged ? [] : [{ type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' }])
      ]
    },
    {
      label: 'Controls',
      submenu: [
        // Space, ⌘← ⌘→ and ⌘↑ ⌘↓ are handled in the page, so typing in the search box still works
        { label: 'Play / Pause  (Space)', click: command('toggle') },
        { label: 'Next Song  (⌘→)', click: command('next') },
        { label: 'Previous Song  (⌘←)', click: command('prev') },
        { type: 'separator' },
        { label: 'Shuffle', accelerator: 'CmdOrCtrl+S', click: command('shuffle') },
        { label: 'Repeat', accelerator: 'CmdOrCtrl+R', click: command('repeat') },
        { type: 'separator' },
        { label: 'Volume Up  (⌘↑)', click: command('vol-up') },
        { label: 'Volume Down  (⌘↓)', click: command('vol-down') },
        { type: 'separator' },
        { label: 'Like Song', accelerator: 'CmdOrCtrl+L', click: command('like') },
        { label: 'Sleep Timer…', click: command('sleep') }
      ]
    },
    { role: 'windowMenu' }
  );
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function updateDockMenu() {
  if (!isMac || !app.dock) return;
  const items = [];
  if (lastTitle) items.push({ label: lastTitle, enabled: false }, { type: 'separator' });
  items.push(
    { label: lastPlaying ? 'Pause' : 'Play', click: command('toggle') },
    { label: 'Next', click: command('next') },
    { label: 'Previous', click: command('prev') }
  );
  app.dock.setMenu(Menu.buildFromTemplate(items));
}

// ------------------------------------------------------------------ the window

function boundsVisible(b) {
  return screen.getAllDisplays().some(d => {
    const a = d.workArea;
    return b.x < a.x + a.width - 80 && b.x + b.width > a.x + 80 && b.y >= a.y - 20 && b.y < a.y + a.height - 80;
  });
}

function createWindow() {
  const opts = {
    width: 1180,
    height: 780,
    minWidth: 360,
    minHeight: 560,
    show: false,
    backgroundColor: BG,
    title: 'Crate',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      spellcheck: false,
      autoplayPolicy: 'no-user-gesture-required',
      devTools: !app.isPackaged || !!process.env.CRATE_DEVTOOLS
    }
  };
  if (isMac) opts.titleBarStyle = 'hiddenInset';
  const b = prefs.get('bounds');
  if (b && Number.isFinite(b.width) && boundsVisible(b)) Object.assign(opts, b);
  win = new BrowserWindow(opts);
  win.loadURL(ORIGIN + '/index.html');
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(ORIGIN + '/')) e.preventDefault();
  });
  win.webContents.on('render-process-gone', () => {
    if (!quitting && win && !win.isDestroyed()) win.reload();
  });
  const saveBounds = () => {
    if (win && !win.isDestroyed() && !win.isFullScreen() && !win.isMinimized()) prefs.set('bounds', win.getBounds());
  };
  win.on('resize', saveBounds);
  win.on('move', saveBounds);
  win.on('close', e => {
    saveBounds();
    // Closing the window keeps the music playing; ⌘Q quits.
    if (isMac && !quitting) {
      e.preventDefault();
      if (win.isFullScreen()) {
        win.once('leave-full-screen', () => win.hide());
        win.setFullScreen(false);
      } else {
        win.hide();
      }
    }
  });
  win.on('closed', () => {
    win = null;
  });
}

function showWindow() {
  if (!win) {
    if (app.isReady()) createWindow();
    return;
  }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// ------------------------------------------------------------------ start / quit

app.whenReady().then(() => {
  const dir = app.getPath('userData');
  kv = new JsonStore(path.join(dir, 'kv.json'), {});
  stats = new JsonStore(path.join(dir, 'stats.json'), { counts: {}, history: [] });
  prefs = new JsonStore(path.join(dir, 'prefs.json'), {});
  if (!stats.get('counts') || typeof stats.get('counts') !== 'object') stats.set('counts', {});
  if (!Array.isArray(stats.get('history'))) stats.set('history', []);
  scanner = new Scanner(path.join(dir, 'library-cache.json'));
  if (process.env.CRATE_MUSIC) prefs.set('folders', process.env.CRATE_MUSIC.split(path.delimiter));

  app.setAboutPanelOptions({
    applicationName: 'Crate',
    applicationVersion: app.getVersion(),
    copyright: 'Your music, straight from your folders.',
    credits: 'Fonts: Doto and Space Mono (SIL Open Font License).'
  });
  protocol.handle('app', handle);
  setupIpc();
  buildMenu();
  updateDockMenu();
  createWindow();
  getLibrary().catch(() => {});   // start reading the library right away
});

app.on('activate', () => showWindow());
app.on('before-quit', () => {
  quitting = true;
});
app.on('window-all-closed', () => {
  if (!isMac || quitting) app.quit();
});
app.on('will-quit', () => {
  for (const s of [kv, stats, prefs]) if (s) s.flush();
  if (scanner) scanner.saveCache();
});
