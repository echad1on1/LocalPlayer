/* Crate UI. Talks to the Android side through window.Native (see WebBridge.java). */
'use strict';
(() => {

// ================================================================== helpers

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const cmp = (a, b) => coll.compare(a, b);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const plural = (n, one, many) => `${Number(n).toLocaleString()} ${n === 1 ? one : (many || one + 's')}`;

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
function hash(s) {
  let h = 2166136261;
  s = String(s);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const hue = s => hash(s) % 360;
function initial(s) {
  const m = String(s || '').replace(/^(the|a|an|die|der|das|le|la|les|el|los|il)\s+/i, '').match(/[\p{L}\p{N}]/u);
  return m ? m[0].toUpperCase() : '#';
}
function sortName(s) { return String(s || '').replace(/^the\s+/i, ''); }
function fmtTime(ms) {
  if (!(ms > 0)) return '0:00';
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, ss = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${m}:${String(ss).padStart(2, '0')}`;
}
function fmtLong(ms) {
  const min = Math.round(ms / 60000);
  if (min < 60) return `${Math.max(min, ms > 0 ? 1 : 0)} min`;
  const h = Math.floor(min / 60), m = min % 60;
  if (h >= 48) return `${Math.round(h / 24)} days`;
  return m ? `${h} h ${m} min` : `${h} h`;
}
function rng(seed) {
  let a = (seed * 4294967296) >>> 0;
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function shuffled(arr, rand) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }

// ================================================================== icons (original, 24px grid)

const ICONS = {
  home: '<path class="s" d="M4 10.4 12 4l8 6.4V20h-5.2v-5.6H9.2V20H4z"/>',
  search: '<circle class="s" cx="10.5" cy="10.5" r="6.3"/><path class="s" d="m15.3 15.3 4.7 4.7"/>',
  library: '<path class="s" d="M5 4v16M9.5 4v16"/><path class="s" d="m14 4.8 4.6 15.4"/>',
  play: '<path class="f" d="M8 5.14v13.72c0 .79.87 1.27 1.54.84l10.3-6.86a1 1 0 0 0 0-1.68L9.54 4.3C8.87 3.87 8 4.35 8 5.14z"/>',
  pause: '<rect class="f" x="6.5" y="5" width="4" height="14" rx="1"/><rect class="f" x="13.5" y="5" width="4" height="14" rx="1"/>',
  next: '<path class="f" d="M5.5 6.8v10.4c0 .8.9 1.3 1.5.8l7.4-5.2a1 1 0 0 0 0-1.6L7 6c-.6-.5-1.5 0-1.5.8z"/><rect class="f" x="15.5" y="6" width="3" height="12" rx="1"/>',
  prev: '<path class="f" d="M18.5 6.8v10.4c0 .8-.9 1.3-1.5.8l-7.4-5.2a1 1 0 0 1 0-1.6L17 6c.6-.5 1.5 0 1.5.8z"/><rect class="f" x="5.5" y="6" width="3" height="12" rx="1"/>',
  shuffle: '<path class="s" d="M3 7h3.2c1.5 0 2.9.75 3.7 2l4.2 6c.85 1.25 2.25 2 3.75 2H20M3 17h3.2c1.5 0 2.9-.75 3.7-2l.35-.5m3.5-5 .35-.5c.85-1.25 2.25-2 3.75-2H20M17 4l3 3-3 3M17 14l3 3-3 3"/>',
  repeat: '<path class="s" d="M4 11V9.5A3.5 3.5 0 0 1 7.5 6H19M16 3l3 3-3 3M20 13v1.5a3.5 3.5 0 0 1-3.5 3.5H5M8 21l-3-3 3-3"/>',
  repeat1: '<path class="s" d="M4 11V9.5A3.5 3.5 0 0 1 7.5 6H19M16 3l3 3-3 3M20 13v1.5a3.5 3.5 0 0 1-3.5 3.5H5M8 21l-3-3 3-3"/><path class="s thin" d="m11 10.6 1.5-1.1v5.2"/>',
  heart: '<path class="s" d="M12 20.2s-7.5-4.5-9.2-9.1C1.6 7.8 3.9 4.6 7.2 4.6c2 0 3.5 1.1 4.8 2.9 1.3-1.8 2.8-2.9 4.8-2.9 3.3 0 5.6 3.2 4.4 6.5-1.7 4.6-9.2 9.1-9.2 9.1z"/>',
  heartF: '<path class="f" d="M12 20.2s-7.5-4.5-9.2-9.1C1.6 7.8 3.9 4.6 7.2 4.6c2 0 3.5 1.1 4.8 2.9 1.3-1.8 2.8-2.9 4.8-2.9 3.3 0 5.6 3.2 4.4 6.5-1.7 4.6-9.2 9.1-9.2 9.1z"/>',
  more: '<circle class="f" cx="12" cy="5.5" r="1.7"/><circle class="f" cx="12" cy="12" r="1.7"/><circle class="f" cx="12" cy="18.5" r="1.7"/>',
  moreH: '<circle class="f" cx="5.5" cy="12" r="1.8"/><circle class="f" cx="12" cy="12" r="1.8"/><circle class="f" cx="18.5" cy="12" r="1.8"/>',
  down: '<path class="s" d="m6 9 6 6 6-6"/>',
  back: '<path class="s" d="M15 5 8 12l7 7"/>',
  right: '<path class="s" d="m9 5 7 7-7 7"/>',
  queue: '<path class="s" d="M4 6h13M4 11h13M4 16h7"/><path class="f" d="M15 14.2v6.6l5.3-3.3z"/>',
  playNext: '<path class="s" d="M4 6h12M4 11h8M4 16h8"/><path class="f" d="M15 11.2v8.6l6.5-4.3z"/>',
  addQueue: '<path class="s" d="M4 6h12M4 11h12M4 16h7M17.5 13v7M14 16.5h7"/>',
  moon: '<path class="s" d="M19.5 14.6A7.8 7.8 0 1 1 9.4 4.5a6.2 6.2 0 0 0 10.1 10.1z"/>',
  plus: '<path class="s" d="M12 5v14M5 12h14"/>',
  check: '<path class="s" d="m5 12.5 4.5 4.5L19 7.5"/>',
  close: '<path class="s" d="M6 6l12 12M18 6 6 18"/>',
  folder: '<path class="s" d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  sliders: '<path class="s" d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle class="s" cx="15" cy="7" r="2"/><circle class="s" cx="9" cy="17" r="2"/>',
  disc: '<circle class="s" cx="12" cy="12" r="8.5"/><circle class="s" cx="12" cy="12" r="2.4"/><path class="s thin" d="M7.5 9.5a5 5 0 0 1 2-2"/>',
  user: '<circle class="s" cx="12" cy="8.5" r="3.8"/><path class="s" d="M4.5 20c.8-3.8 3.9-6 7.5-6s6.7 2.2 7.5 6"/>',
  note: '<path class="s" d="M9 18V6.5l10-2V16"/><circle class="s" cx="6.5" cy="18" r="2.5"/><circle class="s" cx="16.5" cy="16" r="2.5"/>',
  list: '<path class="s" d="M4 6h16M4 11h16M4 16h9"/>',
  trash: '<path class="s" d="M5 7h14M10 7V5h4v2M7 7l1 12.5h8L17 7"/>',
  edit: '<path class="s" d="M4 20h4L19.2 8.8a2.8 2.8 0 0 0-4-4L4 16z"/>',
  info: '<circle class="s" cx="12" cy="12" r="8.5"/><path class="s" d="M12 11v5.5M12 7.8v.1"/>',
  dice: '<rect class="s" x="4" y="4" width="16" height="16" rx="3.5"/><circle class="f" cx="9" cy="9" r="1.4"/><circle class="f" cx="15" cy="15" r="1.4"/><circle class="f" cx="15" cy="9" r="1.4"/><circle class="f" cx="9" cy="15" r="1.4"/>',
  sort: '<path class="s" d="M7 5v14M4 16l3 3 3-3M17 19V5M14 8l3-3 3 3"/>',
  refresh: '<path class="s" d="M19 12a7 7 0 1 1-2.05-4.95M19 4.5V9h-4.5"/>',
  clock: '<circle class="s" cx="12" cy="12" r="8.5"/><path class="s" d="M12 7.5V12l3 2"/>',
  bolt: '<path class="s" d="M13 3 5 13.5h6L10 21l8-10.5h-6z"/>'
};
const ic = (name, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;
const EQ = '<span class="eq"><i></i><i></i><i></i></span>';

// ================================================================== native bridge

const N = window.Native || window.MockNative || null;
function nat(name, ...args) {
  if (!N || typeof N[name] !== 'function') return undefined;
  try { return N[name](...args); } catch (e) { console.error('Native.' + name, e); return undefined; }
}
function natJSON(name, ...args) {
  const s = nat(name, ...args);
  if (s == null || s === '' || s === 'null') return null;
  try { return typeof s === 'string' ? JSON.parse(s) : s; } catch (e) { return null; }
}
function kvGet(k, def) {
  const v = nat('kvGet', k);
  if (v == null || v === '') return def;
  try { return JSON.parse(v); } catch (e) { return def; }
}
function kvSet(k, v) { nat('kvSet', k, v == null ? null : JSON.stringify(v)); }
const haptic = (kind = 0) => nat('haptic', kind);

// ================================================================== state

const S = {
  lib: null,
  libError: false,
  st: null,
  curT: null,
  lastUid: -2,
  qv: -1,
  likes: [],
  likeSet: new Set(),
  pls: [],
  stats: { counts: {}, history: [] },
  tab: 'home',
  stacks: { home: [], search: [], library: [] },
  libFilter: 'playlists',
  sorts: { artists: 'az', albums: 'az', songs: 'az' },
  recent: [],
  accent: 'green',
  perm: 'granted',
  sheets: [],
  queueSheet: null,
  playerOpen: false,
  digSeed: Math.random(),
  colors: new Map(),
  seeking: false,
  seekRatio: 0,
  lastErr: '',
  searchQ: ''
};

function loadPrefs() {
  S.likes = kvGet('likes', []);
  if (!Array.isArray(S.likes)) S.likes = [];
  S.likeSet = new Set(S.likes.map(x => x[0]));
  S.pls = kvGet('playlists', []);
  if (!Array.isArray(S.pls)) S.pls = [];
  S.libFilter = kvGet('libFilter', 'playlists');
  S.sorts = Object.assign({ artists: 'az', albums: 'az', songs: 'az' }, kvGet('sorts', {}));
  S.recent = kvGet('recentSearches', []);
  S.accent = kvGet('accent', 'green');
  applyAccent();
}
function loadStats() {
  const s = natJSON('stats');
  S.stats = s && s.counts ? s : { counts: {}, history: [] };
}
function applyAccent() {
  if (S.accent && S.accent !== 'green') document.body.dataset.accent = S.accent;
  else delete document.body.dataset.accent;
}

// ================================================================== library

function volLabel(vol) { return vol === 'external_primary' ? 'Phone' : 'Storage ' + vol; }

function buildLib(raw) {
  const tracks = [], byId = new Map(), byKey = new Map();
  for (const r of raw.tracks || []) {
    const t = {
      id: r[0], title: r[1], artist: r[2], album: r[3], ak: r[4], dur: r[5] || 0, trk: r[6] || 0,
      year: r[7] || 0, added: r[8] || 0, folder: r[9], file: r[10], key: r[11], sub: r[12] || '',
      vis: r[13] === 1, tagArtist: r[14] || ''
    };
    t.rk = t.artist.toLowerCase();
    tracks.push(t); byId.set(t.id, t); byKey.set(t.key, t);
  }
  const vis = tracks.filter(t => t.vis);

  const albums = [], albumMap = new Map();
  for (const t of vis) {
    let a = albumMap.get(t.ak);
    if (!a) {
      a = { key: t.ak, name: t.album, artist: t.artist, rk: t.rk, tracks: [], year: 0, added: 0, dur: 0, art: t.id, folder: albumFolder(t) };
      albumMap.set(t.ak, a); albums.push(a);
    }
    a.tracks.push(t); a.dur += t.dur;
    if (t.year > a.year) a.year = t.year;
    if (t.added > a.added) a.added = t.added;
    t.al = a;
  }
  // Track numbers from the file tags that don't fit the album (like 37, 158, 200 in a 3-song album)
  // are ignored: those albums are sorted by file name and numbered 1, 2, 3…
  for (const a of albums) {
    const nums = a.tracks.map(t => t.trk % 1000);
    const seen = new Set();
    let ok = nums.every(n => n > 0) && Math.max(...nums) <= a.tracks.length + 3;
    for (const t of a.tracks) {
      const k = t.sub + '|' + Math.floor(t.trk / 1000) + '|' + (t.trk % 1000);
      if (seen.has(k)) ok = false;
      seen.add(k);
    }
    a.goodNums = ok;
    if (!ok) a.tracks.sort((x, y) => cmp(x.sub, y.sub) || cmp(x.file, y.file));
  }
  const artists = [], artistMap = new Map();
  for (const a of albums) {
    let ar = artistMap.get(a.rk);
    if (!ar) { ar = { key: a.rk, name: a.artist, albums: [], tracks: [], added: 0, art: a.art, dur: 0 }; artistMap.set(a.rk, ar); artists.push(ar); }
    ar.albums.push(a);
    if (a.added > ar.added) ar.added = a.added;
    a.ar = ar;
  }
  for (const ar of artists) {
    ar.albums.sort((x, y) => (y.year - x.year) || cmp(x.name, y.name));
    ar.tracks = ar.albums.flatMap(a => a.tracks);
    ar.art = ar.albums.length ? ar.albums[0].art : 0;
    ar.dur = ar.albums.reduce((s, a) => s + a.dur, 0);
  }

  // folder tree
  const froot = { name: '', label: '', path: '', kids: new Map(), tracks: [], parent: null };
  const fmap = new Map();
  const vols = new Set(vis.map(t => t.folder.slice(0, t.folder.indexOf(':'))));
  const multiVol = vols.size > 1;
  const kid = (node, name, label, path) => {
    let k = node.kids.get(name);
    if (!k) { k = { name, label, path, kids: new Map(), tracks: [], parent: node }; node.kids.set(name, k); fmap.set(path, k); }
    return k;
  };
  for (const t of vis) {
    const ci = t.folder.indexOf(':');
    const vol = t.folder.slice(0, ci), rel = t.folder.slice(ci + 1);
    let node = froot, path = vol + ':';
    if (multiVol) node = kid(node, vol, volLabel(vol), path);
    for (const p of rel.split('/').filter(Boolean)) { path += p + '/'; node = kid(node, p, p, path); }
    node.tracks.push(t);
  }
  const finish = node => {
    let count = node.tracks.length, dur = node.tracks.reduce((s, t) => s + t.dur, 0);
    node.kidList = Array.from(node.kids.values()).sort((a, b) => cmp(a.label, b.label));
    for (const k of node.kidList) { finish(k); count += k.count; dur += k.dur; }
    node.count = count; node.dur = dur;
  };
  finish(froot);

  // the folders that make up the library (Settings → Music folders)
  const roots = raw.roots || ['*'];
  const volNodes = multiVol ? froot.kidList.map(n => [n.name, n]) : [[vols.values().next().value || '', froot]];
  const rootNodes = [];
  for (const spec of roots) {
    if (spec === '*') { for (const [, vn] of volNodes) rootNodes.push(...vn.kidList); continue; }
    const c = spec.indexOf(':');
    const vol = c > 0 ? spec.slice(0, c) : '*';
    const parts = spec.slice(c + 1).split('/').filter(Boolean).map(p => p.toLowerCase());
    for (const [vname, vn] of volNodes) {
      if (vol !== '*' && vol.toLowerCase() !== String(vname).toLowerCase()) continue;
      let n = vn;
      for (const p of parts) { n = n && n.kidList.find(k => k.name.toLowerCase() === p); }
      if (n && n !== vn) rootNodes.push(n);
    }
  }
  const uniq = Array.from(new Set(rootNodes)).sort((a, b) => cmp(a.label, b.label));

  return {
    tracks, vis, byId, byKey, albums, albumMap, artists, artistMap,
    froot, fmap, rootNodes: uniq, roots, auto: !!raw.auto, folders: raw.folders || [], total: raw.total || tracks.length
  };
}

function albumFolder(t) {
  let f = t.folder;
  if (t.sub) { const suffix = t.sub + '/'; if (f.toLowerCase().endsWith(suffix.toLowerCase())) f = f.slice(0, -suffix.length); }
  return f;
}
function folderTracks(node) {
  if (node._all) return node._all;
  const out = node.tracks.slice();
  for (const k of node.kidList) out.push(...folderTracks(k));
  node._all = out;
  return out;
}
function displayPath(folder) {
  const ci = folder.indexOf(':');
  const vol = folder.slice(0, ci), rel = folder.slice(ci + 1);
  return (vol === 'external_primary' ? '' : `[${vol}] `) + rel;
}

async function loadLibrary(reason) {
  S.libError = false;
  try {
    const r = await fetch('/api/library', { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const raw = await r.json();
    S.lib = buildLib(raw);
  } catch (e) {
    console.error('library', e);
    S.libError = true;
    if (!S.lib) S.lib = buildLib({ tracks: [], roots: ['*'], auto: true });
  }
  loadStats();
  S.curT = null;
  rebuildAll();
  applyState(true);
  if (reason === 'changed') toast('Library updated');
}

// ================================================================== derived lists

function historyTracks() {
  const L = S.lib, out = [];
  if (!L) return out;
  for (const h of S.stats.history || []) { const t = L.byKey.get(h[0]); if (t && t.vis) out.push(t); }
  return out;
}
function recentAlbums(n) {
  const seen = new Set(), out = [];
  for (const t of historyTracks()) { if (t.al && !seen.has(t.al)) { seen.add(t.al); out.push(t.al); if (out.length >= n) break; } }
  return out;
}
function newestAlbums(n) { return S.lib.albums.slice().sort((a, b) => b.added - a.added || cmp(a.name, b.name)).slice(0, n); }
function playCount(t) { return (S.stats.counts && S.stats.counts[t.key]) || 0; }
function topTracks(list, n) {
  return list.filter(t => playCount(t) > 0).sort((a, b) => playCount(b) - playCount(a) || cmp(a.title, b.title)).slice(0, n);
}
function likedTracks() {
  const L = S.lib, out = [];
  if (!L) return out;
  for (const [k] of S.likes) { const t = L.byKey.get(k); if (t) out.push(t); }
  return out;
}
function plTracks(pl) {
  const L = S.lib, out = [];
  if (!L || !pl) return out;
  for (const k of pl.keys) { const t = L.byKey.get(k); if (t) out.push(t); }
  return out;
}
const findPl = id => S.pls.find(p => p.id === id);
const libShows = f => (S.libFilter === f ? ['library'] : []);
function savePls() { kvSet('playlists', S.pls); }

// ================================================================== html builders

function artHTML(id, seed, label, cls = '', size = 160) {
  const img = id ? `<img src="/art/${id}?s=${size}" loading="lazy" decoding="async" alt="">` : '';
  return `<div class="art ${cls}" style="--h:${hue(seed)}" data-i="${esc(initial(label))}">${img}</div>`;
}
const albumArt = (a, cls = '', size = 360) => artHTML(a.art, a.key, a.name, cls, size);
const artistArt = (ar, cls = '', size = 360) => artHTML(ar.art, ar.key, ar.name, 'round ' + cls, size);
const likedArt = (cls = '') => `<div class="art liked ${cls}">${ic('heartF')}</div>`;
const folderArt = (cls = '') => `<div class="art folder-art ${cls}">${ic('folder')}</div>`;
function mosaicArt(tracks, seed, label, cls = '') {
  const albums = [];
  for (const t of tracks) { if (t.al && !albums.includes(t.al)) albums.push(t.al); if (albums.length === 4) break; }
  if (albums.length < 4) return albums.length ? albumArt(albums[0], cls) : artHTML(0, seed, label, cls);
  return `<div class="art mosaic ${cls}">${albums.map(a => albumArt(a, '', 200)).join('')}</div>`;
}

function trackRow(t, i, o = {}) {
  const cur = S.curT && S.curT.id === t.id;
  const liked = S.likeSet.has(t.key);
  const lead = o.num != null
    ? `<div class="num"><span class="n">${esc(o.num)}</span>${EQ}</div>`
    : artHTML(t.al ? t.al.art : t.id, t.ak, t.album, '', 128);
  const sub = o.sub != null ? o.sub : esc(t.artist);
  return `<div class="row${cur ? ' cur' : ''}${liked ? ' is-liked' : ''}" data-i="${i}" data-id="${t.id}">${lead}` +
    `<div class="meta"><div class="t">${esc(t.title)}</div><div class="s"><span class="liked-dot">${ic('heartF', 'xs')}</span><span class="ell">${sub}</span></div></div>` +
    (o.dur ? `<span class="dur">${fmtTime(o.dur)}</span>` : '') +
    `<button class="more-btn" data-act="track-more" aria-label="More">${ic('more', 'sm')}</button></div>`;
}

/** A container that renders its items in chunks as you scroll (keeps huge libraries fast). */
function lazyBox(cls, items, render, first = 60, step = 150) {
  const box = document.createElement('div');
  box.className = cls;
  let n = 0;
  box._more = () => {
    if (n >= items.length) return;
    const end = Math.min(items.length, n + (n === 0 ? first : step));
    let html = '';
    for (let i = n; i < end; i++) html += render(items[i], i);
    box.insertAdjacentHTML('beforeend', html);
    n = end;
    box.toggleAttribute('data-more', n < items.length);
  };
  box._more();
  return box;
}
/** A list of songs. `list` = what plays when a row is tapped. */
function trackList(tracks, list, rowOpts) {
  const box = lazyBox('tl', tracks, (t, i) => trackRow(t, i, rowOpts ? rowOpts(t, i) : {}));
  box._list = list;
  return box;
}
function listOf(tracks, label, ref, extra) {
  return Object.assign({ ids: tracks.map(t => t.id), label, ref }, extra || {});
}

function albumCard(a, sub) {
  const s = sub != null ? sub : esc(a.artist);
  return `<button class="card" data-act="open-album" data-k="${esc(a.key)}">${albumArt(a)}<div class="t">${esc(a.name)}</div><div class="s">${s}</div></button>`;
}
function artistCard(ar) {
  return `<button class="card artist" data-act="open-artist" data-k="${esc(ar.key)}">${artistArt(ar)}<div class="t">${esc(ar.name)}</div><div class="s">Artist</div></button>`;
}
function section(title, body, more) {
  return `<section class="section"><div class="section-hd"><h2>${esc(title)}</h2>${more || ''}</div>${body}</section>`;
}
function playBtn(ref) {
  const on = S.st && S.st.ref === ref && S.st.playing;
  return `<button class="play-big" data-act="play-ctx" data-ref="${esc(ref)}" aria-label="Play">${ic(on ? 'pause' : 'play')}</button>`;
}
function shuffleBtn() {
  const on = !!(S.st && S.st.shuffle);
  return `<button class="ibtn tg-shuffle${on ? ' on' : ''}" data-act="shuffle" aria-label="Shuffle">${ic('shuffle')}</button>`;
}
function topbar(title) {
  return `<div class="topbar"><button class="ibtn" data-act="back" aria-label="Back">${ic('back')}</button><div class="tb-title">${esc(title)}</div></div>`;
}

// ================================================================== navigation

const RENDER = {};
function curStack() { return S.stacks[S.tab]; }
function curView() { const s = curStack(); return s[s.length - 1]; }

function makeView(v) {
  const root = document.createElement('div');
  root.className = 'view';
  root.dataset.type = v.type;
  root._v = v;
  root.addEventListener('scroll', onViewScroll, { passive: true });
  try {
    (RENDER[v.type] || RENDER.missing)(v, root);
    if (root.querySelector(':scope > .topbar, :scope > .sbox')) root.classList.add('has-topbar');
  } catch (e) {
    console.error('render ' + v.type, e);
    root.innerHTML = `<div class="empty"><div class="dot-title">Oops</div><p>Something went wrong showing this page.</p></div>`;
  }
  return root;
}
function restoreScroll(root, y) {
  if (!y) return;
  let guard = 200;
  while (guard-- > 0 && root.scrollHeight < y + root.clientHeight + 400) {
    const more = root.querySelector('[data-more]');
    if (!more) break;
    more._more();
  }
  root.scrollTop = y;
}
function show(animate) {
  const host = $('#views');
  const v = curView();
  for (const node of Array.from(host.children)) {
    if (node !== v.el && node.style.display !== 'none') { node._scroll = node.scrollTop; node.style.display = 'none'; }
  }
  if (!v.el) { v.el = makeView(v); host.appendChild(v.el); }
  v.el.style.display = '';
  if (v.el._scroll != null) restoreScroll(v.el, v.el._scroll);
  if (animate) { v.el.classList.remove('enter'); void v.el.offsetWidth; v.el.classList.add('enter'); }
  $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === S.tab));
  onViewScroll.call(v.el);
}
function push(type, arg) {
  closeAllSheets();
  if (S.playerOpen) closePlayer();
  const cv = curView();
  if (cv && cv.type === type && cv.arg === arg) return;
  curStack().push({ type, arg });
  show(true);
}
function pop() {
  const s = curStack();
  if (s.length <= 1) return false;
  const v = s.pop();
  if (v.el) v.el.remove();
  show(false);
  return true;
}
function switchTab(tab) {
  if (S.tab === tab) {
    const s = curStack();
    if (s.length > 1) { while (s.length > 1) { const v = s.pop(); if (v.el) v.el.remove(); } show(false); }
    else { const v = curView(); if (v.el) v.el.scrollTo({ top: 0, behavior: 'smooth' }); }
    if (tab === 'search') { const i = $('.view[data-type="search"] input'); if (i) i.focus(); }
    return;
  }
  S.tab = tab;
  show(false);
}
/** Re-render views. types = null → all. Keeps scroll positions. */
function refreshViews(types) {
  for (const tab of Object.keys(S.stacks)) {
    for (const v of S.stacks[tab]) {
      if (!v.el || (types && !types.includes(v.type))) continue;
      const scroll = v.el.style.display === 'none' ? v.el._scroll : v.el.scrollTop;
      const visible = v.el.style.display !== 'none';
      const old = v.el;
      v.el = makeView(v);
      v.el._scroll = scroll;
      if (!visible) v.el.style.display = 'none';
      old.replaceWith(v.el);
      if (visible) { restoreScroll(v.el, scroll || 0); onViewScroll.call(v.el); }
    }
  }
}
function viewValid(v) {
  const L = S.lib;
  if (!L) return true;
  switch (v.type) {
    case 'album': return L.albumMap.has(v.arg);
    case 'artist': return L.artistMap.has(v.arg);
    case 'folder': return L.fmap.has(v.arg);
    case 'playlist': return !!findPl(v.arg);
    default: return true;
  }
}
function rebuildAll() {
  for (const tab of Object.keys(S.stacks)) {
    const s = S.stacks[tab];
    for (const v of s) { if (v.el) v.el.remove(); v.el = null; }
    S.stacks[tab] = s.filter((v, i) => i === 0 || viewValid(v));
  }
  show(false);
}
function onViewScroll() {
  const root = this;
  if (!root || !root.classList) return;
  const tb = root.querySelector('.topbar');
  if (tb) {
    const hero = root.querySelector('.hero, .artist-hero');
    const lim = hero ? Math.max(80, hero.offsetHeight - 80) : 80;
    tb.style.setProperty('--tb', clamp(root.scrollTop / lim, 0, 1).toFixed(3));
  }
  if (root.scrollTop + root.clientHeight > root.scrollHeight - 1600) {
    const more = root.querySelector('[data-more]');
    if (more) more._more();
  }
}

// ================================================================== views

function loadingHTML() {
  return `<div class="loading"><div class="dot-title">Digging<span class="blink">_</span></div><p class="dim mono" style="font-size:12px;margin-top:14px">Reading your music folders</p></div>`;
}
function emptyLibraryHTML() {
  const L = S.lib;
  const hidden = L && L.total > 0;
  return `<div class="empty"><div class="dot-title">Empty crate</div>` +
    (hidden
      ? `<p>Found ${plural(L.total, 'song')} on your phone, but none in the folders Crate is looking at.</p><button class="btn" data-act="settings">${ic('folder', 'sm')} Choose music folders</button>`
      : `<p>No music found yet. Copy your music into the <code>Music</code> folder on your phone, like<br><code>Music/Artist/Album/01 Song.mp3</code></p><button class="btn ghost" data-act="rescan">${ic('refresh', 'sm')} Scan again</button>`) +
    `</div>`;
}

RENDER.missing = (v, root) => { root.innerHTML = topbar('') + `<div class="empty"><div class="dot-title">Gone</div><p>This isn't in your library anymore.</p></div>`; };

// ---------------------------------------------------------------- home
RENDER.home = (v, root) => {
  const L = S.lib;
  if (!L) { root.innerHTML = loadingHTML(); return; }
  const hr = new Date().getHours();
  const greet = hr < 5 ? 'Night owl' : hr < 12 ? 'Morning' : hr < 18 ? 'Afternoon' : 'Evening';
  let html = `<header class="home-hd"><h1 class="dot-title">Good<br><span class="acc">${greet}</span></h1>` +
    `<button class="ibtn" data-act="settings" aria-label="Settings">${ic('sliders')}</button></header>`;
  if (!L.vis.length) { root.innerHTML = html + emptyLibraryHTML(); return; }

  const recent = recentAlbums(12);
  const quickAlbums = (recent.length >= 5 ? recent : recent.concat(newestAlbums(8).filter(a => !recent.includes(a)))).slice(0, 5);
  html += `<div class="quick"><button class="qtile" data-act="open-liked">${likedArt()}<div class="t">Liked Songs</div></button>` +
    quickAlbums.map(a => `<button class="qtile" data-act="open-album" data-k="${esc(a.key)}">${albumArt(a, '', 128)}<div class="t">${esc(a.name)}</div></button>`).join('') + `</div>`;

  const total = L.vis.reduce((s, t) => s + t.dur, 0);
  html += `<button class="dig" data-act="shuffle-all"><div><div class="dig-t">Shuffle all</div><div class="dig-s">${plural(L.vis.length, 'song')} · ${fmtLong(total)}</div></div>` +
    `<span class="play-big">${ic('shuffle')}</span></button>`;

  if (recent.length) html += section('Jump back in', `<div class="hscroll">${recent.map(a => albumCard(a)).join('')}</div>`);
  html += section('Fresh in the crate', `<div class="hscroll">${newestAlbums(12).map(a => albumCard(a)).join('')}</div>`);
  const onRepeat = topTracks(L.vis, 5);
  if (onRepeat.length) html += `<section class="section"><div class="section-hd"><h2>On repeat</h2></div><div class="slot-repeat"></div></section>`;

  const r = rng(S.digSeed);
  const artistScore = ar => ar.tracks.reduce((s, t) => s + playCount(t), 0);
  const artists = shuffled(L.artists.filter(a => a.name !== 'Unknown artist'), r).sort((a, b) => artistScore(b) - artistScore(a)).slice(0, 12);
  if (artists.length) html += section('Your artists', `<div class="hscroll">${artists.map(artistCard).join('')}</div>`);
  const dig = shuffled(L.albums, rng(S.digSeed + 1)).slice(0, 10);
  html += section('Dig the crate', `<div class="hscroll">${dig.map(a => albumCard(a)).join('')}</div>`,
    `<button class="more" data-act="redig">${ic('dice', 'xs')}</button>`);
  root.innerHTML = html;
  if (onRepeat.length) root.querySelector('.slot-repeat').replaceWith(trackList(onRepeat, listOf(onRepeat, 'On repeat', 'onrepeat')));
};

// ---------------------------------------------------------------- search
RENDER.search = (v, root) => {
  root.innerHTML = `<div class="sbox"><label>${ic('search', 'sm')}<input type="search" placeholder="Songs, artists, albums, folders" enterkeyhint="search" autocomplete="off" autocapitalize="off" spellcheck="false"><button class="clear" data-act="search-clear" aria-label="Clear" hidden>${ic('close', 'sm')}</button></label></div><div class="sres"></div>`;
  const input = root.querySelector('input');
  input.value = S.searchQ;
  let timer = 0;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => { S.searchQ = input.value; renderSearchResults(root); }, 120);
  });
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { input.blur(); rememberSearch(input.value); } });
  renderSearchResults(root);
};
function rememberSearch(q) {
  q = String(q || '').trim();
  if (q.length < 2) return;
  S.recent = [q].concat(S.recent.filter(x => x.toLowerCase() !== q.toLowerCase())).slice(0, 8);
  kvSet('recentSearches', S.recent);
}
function renderSearchResults(root) {
  const box = root.querySelector('.sres');
  const L = S.lib;
  const q = norm(S.searchQ).trim();
  root.querySelector('.clear').hidden = !q;
  if (!L) { box.innerHTML = loadingHTML(); return; }
  if (!q) {
    let html = '';
    if (S.recent.length) {
      html += `<div class="section-hd" style="margin-top:12px"><h2>Recent</h2><button class="more" data-act="recent-clear">Clear</button></div>` +
        `<div class="recent-chips">${S.recent.map(s => `<button class="chip" data-act="recent" data-q="${esc(s)}">${esc(s)}</button>`).join('')}</div>`;
    }
    const tiles = [
      ['open-liked', 'Liked songs', 'heartF', 145], ['lib:albums', 'Albums', 'disc', 20], ['lib:artists', 'Artists', 'user', 280],
      ['lib:songs', 'Songs', 'note', 330], ['lib:folders', 'Folders', 'folder', 200], ['shuffle-all', 'Shuffle all', 'shuffle', 60]
    ];
    html += `<div class="section-hd" style="margin-top:22px"><h2>Browse</h2></div><div class="browse">` +
      tiles.map(([act, label, icon, h]) => `<button class="btile" style="--h:${h}" data-act="${act}">${esc(label)}${ic(icon)}</button>`).join('') + `</div>`;
    box.innerHTML = html;
    return;
  }
  const words = q.split(/\s+/).filter(Boolean);
  const match = s => words.every(w => s.includes(w));
  const score = (name, s) => { const n = norm(name); return n === q ? 0 : n.startsWith(q) ? 1 : n.includes(q) ? 2 : 3; };
  for (const t of L.vis) if (t._s == null) t._s = norm(`${t.title} ${t.artist} ${t.album} ${t.tagArtist} ${t.file}`);
  const songs = L.vis.filter(t => match(t._s)).sort((a, b) => score(a.title) - score(b.title) || cmp(a.title, b.title));
  const artists = L.artists.filter(a => match(norm(a.name))).sort((a, b) => score(a.name) - score(b.name) || cmp(a.name, b.name));
  const albums = L.albums.filter(a => match(norm(`${a.name} ${a.artist}`))).sort((a, b) => score(a.name) - score(b.name) || cmp(a.name, b.name));
  const folders = Array.from(L.fmap.values()).filter(f => f.count && match(norm(f.label))).slice(0, 8);
  box.innerHTML = '';
  if (!songs.length && !artists.length && !albums.length && !folders.length) {
    box.innerHTML = `<div class="empty"><div class="dot-title">No hits</div><p>Nothing matches “${esc(S.searchQ)}”.</p></div>`;
    return;
  }
  // top result
  const cands = [];
  if (artists[0]) cands.push({ s: score(artists[0].name), kind: 'artist', v: artists[0] });
  if (albums[0]) cands.push({ s: score(albums[0].name) + .1, kind: 'album', v: albums[0] });
  if (songs[0]) cands.push({ s: score(songs[0].title) + .2, kind: 'song', v: songs[0] });
  cands.sort((a, b) => a.s - b.s);
  const top = cands[0];
  let topHTML = '';
  if (top) {
    if (top.kind === 'artist') topHTML = `<button class="top-result" data-act="open-artist" data-k="${esc(top.v.key)}">${artistArt(top.v)}<div class="t">${esc(top.v.name)}</div><div class="s"><span class="tag">Artist</span>${plural(top.v.tracks.length, 'song')}</div></button>`;
    else if (top.kind === 'album') topHTML = `<button class="top-result" data-act="open-album" data-k="${esc(top.v.key)}">${albumArt(top.v)}<div class="t">${esc(top.v.name)}</div><div class="s"><span class="tag">Album</span>${esc(top.v.artist)}</div></button>`;
    else topHTML = `<div class="top-result tl-top">${artHTML(top.v.al ? top.v.al.art : top.v.id, top.v.ak, top.v.album)}<div class="t">${esc(top.v.title)}</div><div class="s"><span class="tag">Song</span>${esc(top.v.artist)}</div><button class="play-big" data-act="search-top-song" data-id="${top.v.id}">${ic('play')}</button></div>`;
  }
  box.insertAdjacentHTML('beforeend', `<section class="section" style="margin-top:6px"><div class="section-hd"><h2>Top result</h2></div>${topHTML}</section>`);
  if (songs.length) {
    const sec = el(`<section class="section"><div class="section-hd"><h2>Songs</h2><span class="more">${songs.length}</span></div></section>`);
    const shown = songs.slice(0, 60);
    sec.appendChild(trackList(shown, listOf(shown, `“${S.searchQ.trim()}”`, 'search')));
    box.appendChild(sec);
  }
  if (artists.length) box.insertAdjacentHTML('beforeend', section('Artists', `<div class="hscroll">${artists.slice(0, 12).map(artistCard).join('')}</div>`));
  if (albums.length) box.insertAdjacentHTML('beforeend', section('Albums', `<div class="hscroll">${albums.slice(0, 12).map(a => albumCard(a)).join('')}</div>`));
  if (folders.length) {
    box.insertAdjacentHTML('beforeend', section('Folders', folders.map(folderRow).join('')));
  }
}

// ---------------------------------------------------------------- library
const LIB_FILTERS = [['playlists', 'Playlists'], ['artists', 'Artists'], ['albums', 'Albums'], ['songs', 'Songs'], ['folders', 'Folders']];
RENDER.library = (v, root) => {
  root.innerHTML = `<div class="page-hd"><h1 class="dot-title">Your<br><span class="acc">crate</span></h1>` +
    `<button class="ibtn" data-act="new-playlist" aria-label="New playlist">${ic('plus')}</button>` +
    `<button class="ibtn" data-act="settings" aria-label="Settings">${ic('sliders')}</button></div>` +
    `<div class="chips">${LIB_FILTERS.map(([k, label]) => `<button class="chip${S.libFilter === k ? ' on' : ''}" data-act="lib-filter" data-f="${k}">${label}</button>`).join('')}</div>` +
    `<div class="lib-body"></div>`;
  renderLibBody(root);
};
function renderLibBody(root) {
  const body = root.querySelector('.lib-body');
  const L = S.lib;
  if (!L) { body.innerHTML = loadingHTML(); return; }
  if (!L.vis.length && S.libFilter !== 'playlists') { body.innerHTML = emptyLibraryHTML(); return; }
  const f = S.libFilter;
  const sortBar = (key, labels) => {
    const cur = S.sorts[key] || 'az';
    return `<div class="sortbar"><button data-act="lib-sort" data-k="${key}">${ic('sort', 'xs')} ${labels[cur]}</button></div>`;
  };
  if (f === 'playlists') {
    const liked = likedTracks();
    let html = `<div class="row" data-act="open-liked">${likedArt()}<div class="meta"><div class="t">Liked Songs</div><div class="s">Playlist · ${plural(liked.length, 'song')}</div></div></div>`;
    html += `<div class="row" data-act="new-playlist"><div class="art folder-art">${ic('plus')}</div><div class="meta"><div class="t">New playlist</div><div class="s">Make your own mix</div></div></div>`;
    for (const pl of S.pls) {
      const ts = plTracks(pl);
      html += `<div class="row" data-act="open-playlist" data-k="${esc(pl.id)}">${mosaicArt(ts, pl.id, pl.name)}<div class="meta"><div class="t">${esc(pl.name)}</div><div class="s">Playlist · ${plural(ts.length, 'song')}</div></div></div>`;
    }
    body.innerHTML = html;
  } else if (f === 'artists') {
    const list = L.artists.slice();
    if (S.sorts.artists === 'recent') list.sort((a, b) => b.added - a.added);
    else list.sort((a, b) => (a.name === 'Unknown artist') - (b.name === 'Unknown artist') || cmp(sortName(a.name), sortName(b.name)));
    body.innerHTML = sortBar('artists', { az: 'A–Z', recent: 'Recently added' });
    body.appendChild(lazyBox('rows', list, ar =>
      `<div class="row" data-act="open-artist" data-k="${esc(ar.key)}">${artistArt(ar, '', 128)}<div class="meta"><div class="t">${esc(ar.name)}</div><div class="s">${plural(ar.albums.length, 'album')} · ${plural(ar.tracks.length, 'song')}</div></div></div>`, 50, 120));
  } else if (f === 'albums') {
    const list = L.albums.slice();
    if (S.sorts.albums === 'recent') list.sort((a, b) => b.added - a.added);
    else if (S.sorts.albums === 'artist') list.sort((a, b) => cmp(sortName(a.artist), sortName(b.artist)) || (a.year - b.year) || cmp(a.name, b.name));
    else list.sort((a, b) => cmp(a.name, b.name));
    body.innerHTML = sortBar('albums', { az: 'A–Z', artist: 'Artist', recent: 'Recently added' });
    body.appendChild(lazyBox('grid', list, a => albumCard(a), 24, 48));
  } else if (f === 'songs') {
    const list = L.vis.slice();
    if (S.sorts.songs === 'recent') list.sort((a, b) => b.added - a.added || cmp(a.title, b.title));
    else if (S.sorts.songs === 'artist') list.sort((a, b) => cmp(sortName(a.artist), sortName(b.artist)) || cmp(a.album, b.album) || 0);
    else list.sort((a, b) => cmp(a.title, b.title));
    body.innerHTML = sortBar('songs', { az: 'A–Z', artist: 'Artist', recent: 'Recently added' }) +
      `<div class="actions" style="padding-top:0"><span class="dim mono" style="font-size:12px">${plural(list.length, 'song')}</span><span class="spacer"></span>${shuffleBtn()}${playBtn('songs')}</div>`;
    const l = listOf(list, 'All songs', 'songs');
    root._ctx = l;
    body.appendChild(trackList(list, l));
  } else if (f === 'folders') {
    const roots = L.rootNodes;
    if (roots.length === 1) {
      const n = roots[0];
      body.innerHTML = `<div class="sortbar"><span class="label">${esc(displayPath(n.path))}</span></div>`;
      renderFolderContents(body, n, root);
    } else if (roots.length) {
      body.innerHTML = '';
      body.appendChild(lazyBox('rows', roots, folderRow, 60, 120));
    } else {
      body.innerHTML = `<div class="empty"><p>No folders.</p></div>`;
    }
  }
}
function folderRow(n) {
  return `<div class="row folder" data-act="open-folder" data-k="${esc(n.path)}">${folderArt()}<div class="meta"><div class="t">${esc(n.label)}</div><div class="s">${n.kidList.length ? plural(n.kidList.length, 'folder') + ' · ' : ''}${plural(n.count, 'song')}</div></div>${ic('right', 'sm chev')}</div>`;
}
function renderFolderContents(box, n, root) {
  const items = n.kidList.map(k => ({ k })).concat(n.tracks.map((t, i) => ({ t, i })));
  const lb = lazyBox('tl', items, it => it.k ? folderRow(it.k)
    : trackRow(it.t, it.i, { num: it.i + 1, sub: esc(it.t.file), dur: it.t.dur }));
  lb._list = listOf(n.tracks, n.label, 'folder:' + n.path);
  box.appendChild(lb);
  if (!root._ctx) root._ctx = listOf(folderTracks(n), n.label, 'folderall:' + n.path);
}

// ---------------------------------------------------------------- album
RENDER.album = (v, root) => {
  const a = S.lib && S.lib.albumMap.get(v.arg);
  if (!a) return RENDER.missing(v, root);
  const multiDisc = new Set(a.tracks.map(t => t.sub)).size > 1;
  root.style.setProperty('--hc', `hsl(${hue(a.key)} 40% 26%)`);
  root.innerHTML = topbar(a.name) +
    `<div class="hero">${albumArt(a, 'hero-art', 720)}<h1>${esc(a.name)}</h1>` +
    `<button class="by" data-act="open-artist" data-k="${esc(a.rk)}">${artistArt(a.ar, '', 96)}<span>${esc(a.artist)}</span></button>` +
    `<div class="facts">ALBUM${a.year ? ' · ' + a.year : ''} · ${plural(a.tracks.length, 'song')} · ${fmtLong(a.dur)}</div></div>` +
    `<div class="actions"><button class="ibtn" data-act="album-more" aria-label="More">${ic('moreH')}</button><span class="spacer"></span>${shuffleBtn()}${playBtn('album:' + a.key)}</div>` +
    `<div class="slot-list"></div>`;
  const l = listOf(a.tracks, a.name, 'album:' + a.key);
  root._ctx = l;
  const box = document.createElement('div');
  box.className = 'tl';
  box._list = l;
  let html = '', lastSub = null;
  a.tracks.forEach((t, i) => {
    if (multiDisc && t.sub !== lastSub) { html += `<div class="disc-hd">${ic('disc', 'xs')}<span class="label">${esc(t.sub || 'Disc')}</span></div>`; lastSub = t.sub; }
    const n = i + 1;   // always 1, 2, 3 … in the order shown
    const showArtist = t.tagArtist && t.tagArtist.toLowerCase() !== a.artist.toLowerCase() && t.tagArtist !== '<unknown>';
    html += trackRow(t, i, { num: n, sub: esc(showArtist ? t.tagArtist : t.artist), dur: t.dur });
  });
  box.innerHTML = html;
  root.querySelector('.slot-list').replaceWith(box);
  const others = a.ar ? a.ar.albums.filter(x => x !== a) : [];
  root.insertAdjacentHTML('beforeend', `<div class="path-note">${ic('folder', 'xs')} <b>${esc(displayPath(a.folder))}</b></div>`);
  if (others.length) root.insertAdjacentHTML('beforeend', section('More by ' + a.artist, `<div class="hscroll">${others.map(x => albumCard(x, x.year ? String(x.year) : 'Album')).join('')}</div>`));
  hookHeroColor(root, a.art);
};

// ---------------------------------------------------------------- artist
RENDER.artist = (v, root) => {
  const ar = S.lib && S.lib.artistMap.get(v.arg);
  if (!ar) return RENDER.missing(v, root);
  root.style.setProperty('--hc', `hsl(${hue(ar.key)} 40% 22%)`);
  const top = topTracks(ar.tracks, 5);
  root.innerHTML = topbar(ar.name) +
    `<div class="artist-hero">${artHTML(ar.art, ar.key, ar.name, 'bgart', 720)}<div class="shade"></div><h1>${esc(ar.name)}</h1></div>` +
    `<div class="artist-facts">${plural(ar.albums.length, 'album')} · ${plural(ar.tracks.length, 'song')} · ${fmtLong(ar.dur)}</div>` +
    `<div class="actions"><button class="ibtn" data-act="artist-more" aria-label="More">${ic('moreH')}</button><span class="spacer"></span>${shuffleBtn()}${playBtn('artist:' + ar.key)}</div>` +
    (top.length ? `<section class="section" style="margin-top:8px"><div class="section-hd"><h2>Most played</h2></div><div class="slot-top"></div></section>` : '') +
    section(ar.albums.length === 1 ? 'Album' : 'Albums', `<div class="grid">${ar.albums.map(a => albumCard(a, `${a.year ? a.year + ' · ' : ''}${plural(a.tracks.length, 'song')}`)).join('')}</div>`) +
    `<section class="section"><div class="section-hd"><h2>All songs</h2><span class="more">${ar.tracks.length}</span></div><div class="slot-all"></div></section>`;
  const l = listOf(ar.tracks, ar.name, 'artist:' + ar.key);
  root._ctx = l;
  if (top.length) root.querySelector('.slot-top').replaceWith(trackList(top, listOf(top, ar.name, 'artist:' + ar.key), (t, i) => ({ num: i + 1, sub: `${esc(t.album)} · ${plural(playCount(t), 'play')}` })));
  root.querySelector('.slot-all').replaceWith(trackList(ar.tracks, l, t => ({ sub: esc(t.album) })));
  hookHeroColor(root, ar.art);
};

// ---------------------------------------------------------------- folder
RENDER.folder = (v, root) => {
  const n = S.lib && S.lib.fmap.get(v.arg);
  if (!n) return RENDER.missing(v, root);
  root.style.setProperty('--hc', 'var(--bg3)');
  root.innerHTML = topbar(n.label) +
    `<div class="hero" style="display:flex;gap:16px;align-items:center">${folderArt('')}` +
    `<div style="min-width:0"><h1 style="margin:0">${esc(n.label)}</h1><div class="facts">${esc(displayPath(n.path))}</div></div></div>` +
    `<div class="actions"><span class="dim mono" style="font-size:12px">${n.kidList.length ? plural(n.kidList.length, 'folder') + ' · ' : ''}${plural(n.count, 'song')} · ${fmtLong(n.dur)}</span><span class="spacer"></span>${shuffleBtn()}${playBtn('folderall:' + n.path)}</div>` +
    `<div class="fbody"></div>`;
  root.querySelector('.hero .art').style.cssText = 'width:64px;height:64px;border-radius:10px';
  root._ctx = listOf(folderTracks(n), n.label, 'folderall:' + n.path);
  renderFolderContents(root.querySelector('.fbody'), n, root);
};

// ---------------------------------------------------------------- playlists
RENDER.liked = (v, root) => {
  const ts = likedTracks();
  root.style.setProperty('--hc', 'rgba(var(--ac-rgb), .35)');
  root.innerHTML = topbar('Liked Songs') +
    `<div class="hero">${likedArt('hero-art')}<h1>Liked Songs</h1><div class="facts">PLAYLIST · ${plural(ts.length, 'song')}${ts.length ? ' · ' + fmtLong(ts.reduce((s, t) => s + t.dur, 0)) : ''}</div></div>` +
    `<div class="actions"><span class="spacer"></span>${shuffleBtn()}${playBtn('liked')}</div>`;
  if (!ts.length) {
    root.insertAdjacentHTML('beforeend', `<div class="empty" style="padding-top:20px"><p>Tap ${ic('heart', 'xs')} on any song to keep it here.</p></div>`);
    root.querySelector('.empty .ic').style.cssText = 'display:inline;vertical-align:-3px';
    return;
  }
  const l = listOf(ts, 'Liked Songs', 'liked');
  root._ctx = l;
  root.appendChild(trackList(ts, l));
};
RENDER.playlist = (v, root) => {
  const pl = findPl(v.arg);
  if (!pl) return RENDER.missing(v, root);
  const ts = plTracks(pl);
  root.style.setProperty('--hc', `hsl(${hue(pl.id)} 35% 24%)`);
  root.innerHTML = topbar(pl.name) +
    `<div class="hero">${mosaicArt(ts, pl.id, pl.name, 'hero-art')}<h1>${esc(pl.name)}</h1><div class="facts">PLAYLIST · ${plural(ts.length, 'song')}${ts.length ? ' · ' + fmtLong(ts.reduce((s, t) => s + t.dur, 0)) : ''}</div></div>` +
    `<div class="actions"><button class="ibtn" data-act="playlist-more" data-k="${esc(pl.id)}" aria-label="More">${ic('moreH')}</button><span class="spacer"></span>${shuffleBtn()}${playBtn('pl:' + pl.id)}</div>`;
  if (!ts.length) {
    root.insertAdjacentHTML('beforeend', `<div class="empty" style="padding-top:20px"><p>Empty for now. Use ⋮ → <b>Add to playlist</b> on any song or album.</p></div>`);
    return;
  }
  const l = listOf(ts, pl.name, 'pl:' + pl.id, { plId: pl.id });
  root._ctx = l;
  root.appendChild(trackList(ts, l));
};

// ---------------------------------------------------------------- settings
RENDER.settings = (v, root) => {
  const L = S.lib;
  const roots = L ? L.roots : ['*'];
  const mode = !L || L.auto ? 'auto' : (roots.length === 1 && roots[0] === '*') ? 'all' : 'custom';
  if (!S.rootDraft || S.rootDraft.fresh) S.rootDraft = { mode, sel: new Set(mode === 'custom' ? roots : []), fresh: false, orig: mode + '|' + roots.slice().sort().join(',') };
  const d = S.rootDraft;
  const musicCount = L ? L.folders.filter(f => f[1].toLowerCase() === 'music').reduce((s, f) => s + f[2], 0) : 0;
  let html = topbar('Settings') + `<div class="page-hd" style="padding-top:4px"><h1 class="dot-title">Settings</h1></div>`;

  html += `<div class="set-sec"><span class="label">Music folders</span><p class="set-help">Crate turns folders into your library: <code>Music/Artist/Album/song.mp3</code>. <code>Artist - Album</code> folders work too.</p><div class="set-card">` +
    radioRow('auto', d.mode, 'Music folder', musicCount ? plural(musicCount, 'song') : 'The standard Music folder') +
    radioRow('all', d.mode, 'Everything on the phone', L ? plural(L.total, 'song') : '') +
    radioRow('custom', d.mode, 'Choose folders…', 'Pick exactly where to look') + `</div>`;
  if (d.mode === 'custom' && L) {
    html += `<div class="set-card" style="margin-top:10px">`;
    const top = L.folders.filter(f => !f[1].includes('/'));
    for (const f of top) {
      const spec = `${f[0]}:${f[1]}`;
      html += checkRow(spec, d.sel.has(spec), (f[0] === 'external_primary' ? '' : `[${f[0]}] `) + f[1], plural(f[2], 'song'), false);
      if (d.sel.has(spec)) continue;
      for (const s of L.folders.filter(x => x[0] === f[0] && x[1].startsWith(f[1] + '/'))) {
        const sspec = `${s[0]}:${s[1]}`;
        html += checkRow(sspec, d.sel.has(sspec), s[1].slice(f[1].length + 1), plural(s[2], 'song'), true);
      }
    }
    if (!top.length) html += `<div class="set-row"><div class="meta"><div class="s">No music found on this phone yet.</div></div></div>`;
    html += `</div>`;
  }
  const changed = d.mode + '|' + (d.mode === 'custom' ? Array.from(d.sel).sort().join(',') : (d.mode === 'all' ? '*' : roots.slice().sort().join(','))) !== d.orig;
  html += `<div style="display:flex;gap:10px;margin-top:12px"><button class="btn" data-act="roots-apply"${changed ? '' : ' disabled style="opacity:.4"'}>Apply</button><button class="btn ghost" data-act="rescan">${ic('refresh', 'sm')} Rescan</button></div></div>`;

  const accents = [['green', '#35e07c'], ['amber', '#ffb020'], ['cyan', '#33d6ff'], ['pink', '#ff5cc8'], ['red', '#ff4032'], ['white', '#f2f2f2']];
  html += `<div class="set-sec"><span class="label">Glow colour</span><div class="set-card"><div class="swatches">` +
    accents.map(([k, c]) => `<button class="swatch${(S.accent || 'green') === k ? ' on' : ''}" style="background:${c}" data-act="accent" data-k="${k}" aria-label="${k}"></button>`).join('') + `</div></div></div>`;

  if (L) {
    const dur = L.vis.reduce((s, t) => s + t.dur, 0);
    const plays = Object.values(S.stats.counts || {}).reduce((s, n) => s + n, 0);
    html += `<div class="set-sec"><span class="label">Your crate</span><div class="set-card"><div class="stats-line">${plural(L.vis.length, 'song')} · ${plural(L.albums.length, 'album')} · ${plural(L.artists.length, 'artist')}<br>${fmtLong(dur)} of music · ${plural(plays, 'play')} counted</div>` +
      `<button class="set-row" data-act="clear-history"><div class="meta"><div class="t">Clear listening history</div><div class="s">Resets “Jump back in”, “On repeat” and play counts</div></div></button></div></div>`;
  }
  html += `<div class="set-sec" style="margin-bottom:10px"><span class="label">About</span><div class="set-card"><div class="stats-line">Crate ${esc(nat('version') || '')} — your music, straight from your folders.<br>No account, no cloud, no tracking.<br>Fonts: Doto &amp; Space Mono (SIL Open Font License).</div></div></div>`;
  root.innerHTML = html;
};
function radioRow(k, cur, t, s) {
  return `<button class="set-row${cur === k ? ' on' : ''}" data-act="roots-mode" data-k="${k}"><span class="radio"></span><div class="meta"><div class="t">${esc(t)}</div><div class="s">${esc(s)}</div></div></button>`;
}
function checkRow(spec, on, t, count, sub) {
  return `<button class="set-row${sub ? ' sub' : ''}${on ? ' on' : ''}" data-act="roots-toggle" data-k="${esc(spec)}"><span class="check-box">${on ? ic('check', 'xs') : ''}</span><div class="meta"><div class="t ell">${esc(t)}</div></div><span class="count">${esc(count)}</span></button>`;
}

// ================================================================== player state

function currentTrack() { return S.st && S.lib && S.st.id >= 0 ? S.lib.byId.get(S.st.id) || null : null; }
function livePos() {
  const st = S.st;
  if (!st) return 0;
  let p = st.pos;
  if (st.playing && !st.buffering) p += Date.now() - st.ts;
  return clamp(p, 0, st.dur || 0);
}

function applyState(force) {
  const st = S.st;
  const t = currentTrack();
  const body = document.body;
  body.classList.toggle('is-playing', !!(st && st.playing));
  body.classList.toggle('has-track', !!t);
  body.classList.toggle('buffering', !!(st && st.playing && st.buffering));
  if (t !== S.curT || force) {
    const changed = t !== S.curT;
    S.curT = t;
    renderNowPlaying(t);
    markCurrentRows();
    if (changed && S.playerOpen) fitTitle();
  }
  if (t) E.src.textContent = (st && st.ctx) || t.album;
  const playIcon = ic(st && st.playing ? 'pause' : 'play');
  $('#mini .mini-play').innerHTML = playIcon;
  $('#player .c-main').innerHTML = playIcon;
  const sh = !!(st && st.shuffle);
  $('#player .c-shuffle').classList.toggle('on', sh);
  $$('.tg-shuffle').forEach(b => b.classList.toggle('on', sh));
  const rp = st ? st.repeat : 0;
  const rb = $('#player .c-repeat');
  rb.classList.toggle('on', rp > 0);
  rb.innerHTML = ic(rp === 2 ? 'repeat1' : 'repeat');
  const sl = $('#player .c-sleep');
  sl.classList.toggle('on', !!(st && st.sleep !== -1));
  E.sleep.textContent = !st || st.sleep === -1 ? 'Sleep' : st.sleep === -2 ? 'End of song' : fmtTime(st.sleep + 999);
  S.sleepBase = st && st.sleep > 0 ? { left: st.sleep, at: Date.now() } : null;
  $$('[data-act="play-ctx"]').forEach(b => { b.innerHTML = ic(st && st.playing && st.ref === b.dataset.ref ? 'pause' : 'play'); });
  $$('.qtile').forEach(q => q.classList.toggle('cur', !!(t && t.al && q.dataset.k === t.al.key)));
  if (st && S.queueSheet && (st.qv !== S.qv || st.uid !== S.lastUid)) refreshQueue();
  if (st) { S.qv = st.qv; S.lastUid = st.uid; }
  if (st && st.err && st.err !== S.lastErr) toast(st.err);
  S.lastErr = st ? st.err : '';
  tick();
}

function renderNowPlaying(t) {
  const mini = $('#mini'), pl = $('#player');
  const L = S.lib;
  if (!t) return;
  const artId = t.al ? t.al.art : t.id;
  setArt($('.mini-art', mini), artId, t.ak, t.album, 128);
  setArt($('.np-art', pl), t.id, t.ak, t.album, 720, artId);
  $('.mini-title', mini).textContent = t.title;
  $('.mini-sub', mini).textContent = t.artist;
  $('.np-title span', pl).textContent = t.title;
  $('.np-artist', pl).textContent = t.artist;
  updateLikeButtons();
  const fallback = `hsl(${hue(t.ak)} 45% 32%)`;
  artColor(artId, c => {
    if (S.curT !== t) return;
    const col = c || fallback;
    mini.style.setProperty('--mc', col);
    pl.style.setProperty('--pc', col);
  });
  void L;
}
function setArt(box, id, seed, label, size, fallbackId) {
  box.style.setProperty('--h', hue(seed));
  box.dataset.i = initial(label);
  let img = box.querySelector('img');
  if (!img) { img = document.createElement('img'); img.alt = ''; box.appendChild(img); }
  const src = `/art/${id}?s=${size}`;
  if (img.getAttribute('src') === src) return;
  img.classList.remove('ok');
  img.style.display = '';
  img.onerror = () => {
    if (fallbackId && fallbackId !== id && !img.dataset.fb) { img.dataset.fb = '1'; img.src = `/art/${fallbackId}?s=${size}`; return; }
    img.style.display = 'none';
  };
  delete img.dataset.fb;
  img.src = src;
}
function updateLikeButtons() {
  const t = S.curT;
  const on = !!(t && S.likeSet.has(t.key));
  for (const b of $$('.mini-like, .np-like')) { b.classList.toggle('on', on); b.innerHTML = ic(on ? 'heartF' : 'heart'); }
}
function markCurrentRows() {
  $$('.row.cur').forEach(r => r.classList.remove('cur'));
  if (S.curT) $$(`.row[data-id="${S.curT.id}"]`).forEach(r => r.classList.add('cur'));
}
function artColor(id, cb) {
  if (S.colors.has(id)) return cb(S.colors.get(id));
  const img = new Image();
  img.onload = () => {
    let col = null;
    try {
      const c = document.createElement('canvas');
      c.width = c.height = 12;
      const x = c.getContext('2d', { willReadFrequently: true });
      x.drawImage(img, 0, 0, 12, 12);
      const d = x.getImageData(0, 0, 12, 12).data;
      let r = 0, g = 0, b = 0, w = 0;
      for (let i = 0; i < d.length; i += 4) {
        const R = d[i], G = d[i + 1], B = d[i + 2];
        const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
        const wt = (mx - mn + 12) * (mx > 30 ? 1 : 0.2);
        r += R * wt; g += G * wt; b += B * wt; w += wt;
      }
      if (w > 0) {
        r /= w; g /= w; b /= w;
        const [h, s, l] = rgbToHsl(r, g, b);
        col = `hsl(${Math.round(h)} ${Math.round(clamp(s, 0.15, 0.7) * 100)}% ${Math.round(clamp(l, 0.22, 0.38) * 100)}%)`;
      }
    } catch (e) { col = null; }
    S.colors.set(id, col);
    cb(col);
  };
  img.onerror = () => { S.colors.set(id, null); cb(null); };
  img.src = `/art/${id}?s=128`;
}
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (mx + mn) / 2;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}
function hookHeroColor(root, artId) {
  artColor(artId, c => { if (c) root.style.setProperty('--hc', c); });
}

const E = {};
function tick() {
  const st = S.st;
  if (!st || !S.curT || !E.bar) return;
  const dur = st.dur || S.curT.dur || 0;
  const pos = S.seeking ? S.seekRatio * dur : livePos();
  const pct = dur > 0 ? clamp(pos / dur, 0, 1) * 100 : 0;
  E.bar.style.width = pct + '%';
  if (S.playerOpen) {
    E.fill.style.width = pct + '%';
    E.knob.style.left = pct + '%';
    E.pos.textContent = fmtTime(pos);
    E.dur.textContent = fmtTime(dur);
    if (S.sleepBase) {
      const left = Math.max(0, S.sleepBase.left - (Date.now() - S.sleepBase.at));
      E.sleep.textContent = fmtTime(left + 999);
    }
  }
}

// ================================================================== full-screen player

function openPlayer() {
  if (!S.curT) return;
  S.playerOpen = true;
  const pl = $('#player');
  pl.classList.add('open');
  pl.setAttribute('aria-hidden', 'false');
  document.body.classList.add('player-open');
  tick();
  fitTitle();
}
function closePlayer() {
  S.playerOpen = false;
  const pl = $('#player');
  pl.classList.remove('open');
  pl.style.transform = '';
  pl.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('player-open');
}
function fitTitle() {
  const box = $('#player .np-title'), span = box.firstElementChild;
  box.classList.remove('marquee');
  requestAnimationFrame(() => {
    const over = span.scrollWidth - 40 - box.clientWidth;
    if (over > 4) {
      box.style.setProperty('--mqx', `-${over + 40}px`);
      box.style.setProperty('--mq', `${Math.max(8, (over + 40) / 28)}s`);
      box.classList.add('marquee');
    }
  });
}
function setupPlayerGestures() {
  const pl = $('#player');
  const seek = $('.seek', pl);
  const seekAt = e => {
    const r = seek.getBoundingClientRect();
    S.seekRatio = clamp((e.clientX - r.left) / r.width, 0, 1);
    tick();
  };
  seek.addEventListener('pointerdown', e => {
    if (!S.st) return;
    S.seeking = true;
    seek.classList.add('drag');
    try { seek.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    seekAt(e);
  });
  seek.addEventListener('pointermove', e => { if (S.seeking) seekAt(e); });
  const end = commit => e => {
    if (!S.seeking) return;
    S.seeking = false;
    seek.classList.remove('drag');
    if (commit && S.st) {
      const ms = Math.round(S.seekRatio * (S.st.dur || 0));
      nat('seek', ms);
      S.st.pos = ms; S.st.ts = Date.now();
    }
    tick();
  };
  seek.addEventListener('pointerup', end(true));
  seek.addEventListener('pointercancel', end(false));

  // swipe down to close, swipe the art sideways to skip
  let sx = 0, sy = 0, dx = 0, dy = 0, tracking = false, mode = '';
  pl.addEventListener('touchstart', e => {
    if (e.target.closest('.seek, .np-ctrls, .np-foot, .np-meta button')) { tracking = false; return; }
    const p = e.touches[0];
    sx = p.clientX; sy = p.clientY; dx = dy = 0; tracking = true; mode = '';
  }, { passive: true });
  pl.addEventListener('touchmove', e => {
    if (!tracking) return;
    const p = e.touches[0];
    dx = p.clientX - sx; dy = p.clientY - sy;
    if (!mode && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) mode = Math.abs(dy) > Math.abs(dx) ? 'y' : 'x';
    if (mode === 'y' && dy > 0) { pl.classList.add('dragging'); pl.style.transform = `translateY(${dy}px)`; }
    if (mode === 'x' && e.target.closest('.np-stage')) $('.np-art', pl).style.transform = `translateX(${dx * 0.5}px) rotate(${dx * 0.02}deg)`;
  }, { passive: true });
  pl.addEventListener('touchend', () => {
    if (!tracking) return;
    tracking = false;
    pl.classList.remove('dragging');
    $('.np-art', pl).style.transform = '';
    if (mode === 'y' && dy > 110) { closePlayer(); return; }
    pl.style.transform = '';
    if (mode === 'x' && Math.abs(dx) > 70) { haptic(); nat(dx < 0 ? 'next' : 'prev'); }
  });

  const mini = $('#mini');
  let mx = 0, my = 0, mdx = 0, mdy = 0;
  mini.addEventListener('touchstart', e => { const p = e.touches[0]; mx = p.clientX; my = p.clientY; mdx = mdy = 0; }, { passive: true });
  mini.addEventListener('touchmove', e => { const p = e.touches[0]; mdx = p.clientX - mx; mdy = p.clientY - my; }, { passive: true });
  mini.addEventListener('touchend', () => {
    if (Math.abs(mdx) > 60 && Math.abs(mdx) > Math.abs(mdy) * 1.5) { haptic(); nat(mdx < 0 ? 'next' : 'prev'); mini._swiped = Date.now(); }
    else if (mdy < -40 && Math.abs(mdy) > Math.abs(mdx)) { mini._swiped = Date.now(); openPlayer(); }
  });
}

// ================================================================== sheets

function openSheet(html, opts = {}) {
  const host = $('#sheets');
  const bg = el('<div class="sheet-bg"></div>');
  const sh = el(`<div class="sheet ${opts.cls || ''}"><div class="grab"></div>${html}</div>`);
  host.append(bg, sh);
  const entry = { bg, sh, onClose: opts.onClose };
  S.sheets.push(entry);
  bg.addEventListener('click', () => closeSheet(entry));
  void sh.offsetHeight;
  bg.classList.add('open');
  sh.classList.add('open');
  let sy = 0, dy = 0, drag = false;
  sh.addEventListener('touchstart', e => { drag = sh.scrollTop <= 0; sy = e.touches[0].clientY; dy = 0; }, { passive: true });
  sh.addEventListener('touchmove', e => {
    if (!drag) return;
    dy = e.touches[0].clientY - sy;
    if (dy > 0) { sh.style.transition = 'none'; sh.style.transform = `translateY(${dy}px)`; }
  }, { passive: true });
  sh.addEventListener('touchend', () => {
    if (!drag) return;
    sh.style.transition = ''; sh.style.transform = '';
    if (dy > 90) closeSheet(entry);
  });
  return sh;
}
function closeSheet(entry) {
  const e = entry || S.sheets[S.sheets.length - 1];
  if (!e) return;
  const i = S.sheets.indexOf(e);
  if (i < 0) return;
  S.sheets.splice(i, 1);
  e.bg.classList.remove('open');
  e.sh.classList.remove('open');
  e.sh.style.transform = '';
  if (document.activeElement && e.sh.contains(document.activeElement)) document.activeElement.blur();
  setTimeout(() => { e.bg.remove(); e.sh.remove(); }, 280);
  if (e.onClose) e.onClose();
}
function closeAllSheets() { while (S.sheets.length) closeSheet(); }

/** items: [{k, icon, label, on, danger}] */
function menu(headHTML, items, onPick) {
  const sh = openSheet(headHTML + items.filter(Boolean).map(it =>
    `<button class="item${it.on ? ' on' : ''}${it.danger ? ' danger' : ''}" data-m="${esc(it.k)}">${ic(it.icon)}<span>${esc(it.label)}</span></button>`).join(''));
  sh.addEventListener('click', e => {
    const b = e.target.closest('[data-m]');
    if (!b) return;
    const entry = S.sheets.find(x => x.sh === sh);
    closeSheet(entry);
    onPick(b.dataset.m);
  });
  return sh;
}
function trackHead(t) {
  return `<div class="sheet-hd">${artHTML(t.al ? t.al.art : t.id, t.ak, t.album, '', 128)}<div class="meta"><div class="t ell">${esc(t.title)}</div><div class="s ell">${esc(t.artist)} · ${esc(t.album)}</div></div></div>`;
}

function trackMenu(t, list) {
  const liked = S.likeSet.has(t.key);
  menu(trackHead(t), [
    { k: 'like', icon: liked ? 'heartF' : 'heart', label: liked ? 'Remove from Liked Songs' : 'Add to Liked Songs', on: liked },
    { k: 'addpl', icon: 'plus', label: 'Add to playlist' },
    { k: 'next', icon: 'playNext', label: 'Play next' },
    { k: 'queue', icon: 'addQueue', label: 'Add to queue' },
    t.al ? { k: 'album', icon: 'disc', label: 'Go to album' } : null,
    t.al && t.al.ar ? { k: 'artist', icon: 'user', label: 'Go to artist' } : null,
    list && list.plId ? { k: 'plremove', icon: 'close', label: 'Remove from this playlist', danger: true } : null,
    { k: 'info', icon: 'info', label: 'Song info' }
  ], m => {
    if (m === 'like') toggleLike(t);
    else if (m === 'addpl') pickPlaylist([t]);
    else if (m === 'next') { nat('add', JSON.stringify([t.id]), true); toast('Playing next'); }
    else if (m === 'queue') { nat('add', JSON.stringify([t.id]), false); toast('Added to queue'); }
    else if (m === 'album') push('album', t.al.key);
    else if (m === 'artist') push('artist', t.al.ar.key);
    else if (m === 'plremove') removeFromPlaylist(list.plId, t);
    else if (m === 'info') songInfo(t);
  });
}
function collectionMenu(title, sub, art, tracks, extra, onExtra) {
  const head = `<div class="sheet-hd">${art}<div class="meta"><div class="t ell">${esc(title)}</div><div class="s ell">${esc(sub)}</div></div></div>`;
  const ids = JSON.stringify(tracks.map(t => t.id));
  menu(head, [
    { k: 'next', icon: 'playNext', label: 'Play next' },
    { k: 'queue', icon: 'addQueue', label: 'Add to queue' },
    { k: 'addpl', icon: 'plus', label: 'Add to playlist' }
  ].concat(extra || []), m => {
    if (m === 'next') { nat('add', ids, true); toast(`${plural(tracks.length, 'song')} playing next`); }
    else if (m === 'queue') { nat('add', ids, false); toast(`${plural(tracks.length, 'song')} added to queue`); }
    else if (m === 'addpl') pickPlaylist(tracks);
    else if (onExtra) onExtra(m);
  });
}
function songInfo(t) {
  const rows = [
    ['Title', t.title], ['Artist', t.artist], t.tagArtist && t.tagArtist.toLowerCase() !== t.artist.toLowerCase() ? ['Tag artist', t.tagArtist] : null,
    ['Album', t.album], t.trk ? ['Track', String(t.trk % 1000)] : null, t.year ? ['Year', String(t.year)] : null,
    ['Length', fmtTime(t.dur)], ['Plays', String(playCount(t))], ['File', displayPath(t.folder) + t.file]
  ].filter(Boolean);
  openSheet(trackHead(t) + `<dl class="info-grid">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`);
}

function promptSheet(title, value, placeholder, ok, onOk) {
  const sh = openSheet(`<div class="sheet-hd"><h3>${esc(title)}</h3></div><div class="field"><input maxlength="80" placeholder="${esc(placeholder)}" value="${esc(value)}"></div>` +
    `<div class="btns"><button class="btn ghost" data-p="cancel">Cancel</button><button class="btn" data-p="ok">${esc(ok)}</button></div>`);
  const input = sh.querySelector('input');
  const entry = S.sheets.find(x => x.sh === sh);
  const done = () => { const v = input.value.trim(); if (!v) { input.focus(); return; } closeSheet(entry); onOk(v); };
  sh.addEventListener('click', e => {
    const b = e.target.closest('[data-p]');
    if (!b) return;
    if (b.dataset.p === 'ok') done(); else closeSheet(entry);
  });
  input.addEventListener('keydown', e => { if (e.key === 'Enter') done(); });
  setTimeout(() => { input.focus(); input.select(); }, 260);
}
function confirmSheet(title, text, ok, onOk) {
  const sh = openSheet(`<div class="sheet-hd"><h3>${esc(title)}</h3></div><p style="padding:6px var(--pad) 0;color:var(--fg2);line-height:1.5">${esc(text)}</p>` +
    `<div class="btns"><button class="btn ghost" data-p="cancel">Cancel</button><button class="btn" data-p="ok" style="background:var(--danger);color:#fff">${esc(ok)}</button></div>`);
  const entry = S.sheets.find(x => x.sh === sh);
  sh.addEventListener('click', e => {
    const b = e.target.closest('[data-p]');
    if (!b) return;
    closeSheet(entry);
    if (b.dataset.p === 'ok') onOk();
  });
}

// ---------------------------------------------------------------- playlists & likes
function toggleLike(t) {
  if (!t) return;
  if (S.likeSet.has(t.key)) {
    S.likes = S.likes.filter(x => x[0] !== t.key);
    S.likeSet.delete(t.key);
    toast('Removed from Liked Songs');
  } else {
    S.likes.unshift([t.key, Date.now()]);
    S.likeSet.add(t.key);
    haptic(2);
    toast('Added to Liked Songs');
  }
  kvSet('likes', S.likes);
  $$(`.row[data-id="${t.id}"]`).forEach(r => r.classList.toggle('is-liked', S.likeSet.has(t.key)));
  updateLikeButtons();
  refreshViews(['liked'].concat(libShows('playlists')));
}
function pickPlaylist(tracks) {
  const items = [{ k: '__new', icon: 'plus', label: 'New playlist' }]
    .concat(S.pls.map(p => ({ k: p.id, icon: 'list', label: `${p.name}` })));
  menu(`<div class="sheet-hd"><h3>Add to playlist</h3></div>`, items, k => {
    if (k === '__new') {
      promptSheet('New playlist', '', 'My playlist', 'Create', name => {
        const pl = createPlaylist(name);
        addToPlaylist(pl, tracks);
      });
    } else {
      addToPlaylist(findPl(k), tracks);
    }
  });
}
function createPlaylist(name) {
  const pl = { id: 'p' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36), name, keys: [], ts: Date.now() };
  S.pls.unshift(pl);
  savePls();
  refreshViews(['library']);
  return pl;
}
function addToPlaylist(pl, tracks) {
  if (!pl) return;
  const have = new Set(pl.keys);
  let added = 0;
  for (const t of tracks) if (!have.has(t.key)) { pl.keys.push(t.key); have.add(t.key); added++; }
  pl.ts = Date.now();
  savePls();
  toast(added ? `Added to ${pl.name}` : `Already in ${pl.name}`);
  refreshViews(['playlist'].concat(libShows('playlists')));
}
function removeFromPlaylist(id, t) {
  const pl = findPl(id);
  if (!pl) return;
  pl.keys = pl.keys.filter(k => k !== t.key);
  savePls();
  toast(`Removed from ${pl.name}`);
  refreshViews(['playlist'].concat(libShows('playlists')));
}

// ---------------------------------------------------------------- queue
function openQueue() {
  const sh = openSheet(`<div class="sheet-hd"><h3>Queue</h3><span style="flex:1"></span><button class="ibtn" data-act="sheet-close" aria-label="Close">${ic('close')}</button></div><div class="q-body"></div>`,
    { cls: 'full', onClose: () => { S.queueSheet = null; } });
  S.queueSheet = sh;
  refreshQueue();
}
function refreshQueue() {
  const sh = S.queueSheet;
  if (!sh) return;
  const body = sh.querySelector('.q-body');
  const q = natJSON('queue');
  const L = S.lib, st = S.st;
  if (!q || !L || !st || !q.items.length) { body.innerHTML = `<div class="empty"><p>Nothing queued. Pick something to play.</p></div>`; return; }
  const items = q.items;
  let cur = items.findIndex(x => x[0] === st.uid);
  if (cur < 0) cur = clamp(q.idx, 0, items.length - 1);
  const row = (it, cls) => {
    const t = L.byId.get(it[1]);
    if (!t) return '';
    return `<div class="row${cls || ''}"${cls ? '' : ` data-act="q-jump" data-u="${it[0]}"`} data-id="${t.id}">${artHTML(t.al ? t.al.art : t.id, t.ak, t.album, '', 128)}` +
      `<div class="meta"><div class="t">${esc(t.title)}</div><div class="s"><span class="ell">${esc(t.artist)}</span></div></div>` +
      (cls ? '' : `<button class="more-btn" data-act="q-remove" data-u="${it[0]}" aria-label="Remove">${ic('close', 'sm')}</button>`) + `</div>`;
  };
  let html = `<div class="q-sec"><span class="label">Now playing</span></div>` + row(items[cur], ' cur');
  const after = items.slice(cur + 1);
  const user = after.filter(x => x[2] === 1);
  const ctx = after.filter(x => x[2] === 0);
  if (user.length) html += `<div class="q-sec"><span class="label">Next in queue</span><button data-act="q-clear-user">Clear</button></div>` + user.slice(0, 100).map(x => row(x)).join('');
  if (ctx.length) {
    html += `<div class="q-sec"><span class="label ell">Next from: ${esc(st.ctx || 'your music')}</span><button data-act="q-clear-all">Clear</button></div>` + ctx.slice(0, 150).map(x => row(x)).join('');
    if (ctx.length > 150) html += `<div class="q-note">…and ${plural(ctx.length - 150, 'more song')}</div>`;
  }
  if (!user.length && !ctx.length) html += `<div class="q-note">${st.repeat === 1 ? 'Repeat is on — the queue starts over after this song.' : 'Nothing after this song.'}</div>`;
  body.innerHTML = html;
}

function sleepSheet() {
  const st = S.st;
  const cur = !st ? -1 : st.sleep;
  const opts = [[0, 'Off'], [5, '5 minutes'], [15, '15 minutes'], [30, '30 minutes'], [45, '45 minutes'], [60, '1 hour'], [-1, 'End of this song']];
  menu(`<div class="sheet-hd"><h3>Sleep timer</h3></div>`, opts.map(([m, label]) => ({
    k: String(m), icon: m === 0 ? 'close' : m === -1 ? 'note' : 'moon', label,
    on: (m === 0 && cur === -1) || (m === -1 && cur === -2)
  })), k => {
    const m = Number(k);
    nat('sleep', m);
    toast(m === 0 ? 'Sleep timer off' : m === -1 ? 'Stopping after this song' : `Stopping in ${m} min`);
  });
}

// ================================================================== actions

function playList(list, i) {
  if (!list || !list.ids.length) return;
  haptic();
  nat('playIds', JSON.stringify(list.ids), i, !!(S.st && S.st.shuffle), list.label || '', list.ref || '');
}
function playCtx(list) {
  if (!list || !list.ids.length) return;
  const st = S.st;
  if (st && st.ref === list.ref && st.len > 0) { haptic(); nat('toggle'); return; }
  const sh = !!(st && st.shuffle);
  haptic();
  nat('playIds', JSON.stringify(list.ids), sh ? -1 : 0, sh, list.label || '', list.ref || '');
}
function shuffleAll() {
  const L = S.lib;
  if (!L || !L.vis.length) return;
  haptic(2);
  nat('playIds', JSON.stringify(L.vis.map(t => t.id)), -1, true, 'All songs', 'all');
  toast(`Shuffling ${plural(L.vis.length, 'song')}`);
}
function gotoRef(ref) {
  if (!ref) return;
  const i = ref.indexOf(':');
  const kind = i < 0 ? ref : ref.slice(0, i), arg = i < 0 ? '' : ref.slice(i + 1);
  if (kind === 'album') push('album', arg);
  else if (kind === 'artist') push('artist', arg);
  else if (kind === 'pl') push('playlist', arg);
  else if (kind === 'liked') push('liked');
  else if (kind === 'folder' || kind === 'folderall') push('folder', arg);
  else if (kind === 'songs' || kind === 'all') { closePlayer(); openLibFilter('songs'); }
  else if (S.curT && S.curT.al) push('album', S.curT.al.key);
}
function openLibFilter(f) {
  S.libFilter = f;
  kvSet('libFilter', f);
  const s = S.stacks.library;
  while (s.length > 1) { const v = s.pop(); if (v.el) v.el.remove(); }
  if (s[0].el) { s[0].el.remove(); s[0].el = null; }
  if (S.tab === 'library') show(false); else switchTab('library');
}
function listFor(elm) {
  const tl = elm.closest('.tl');
  if (tl && tl._list) return tl._list;
  const v = elm.closest('.view');
  return v && v._ctx;
}

const ACTIONS = {
  back: () => { pop(); },
  'open-album': b => push('album', b.dataset.k),
  'open-artist': b => push('artist', b.dataset.k),
  'open-folder': b => push('folder', b.dataset.k),
  'open-playlist': b => push('playlist', b.dataset.k),
  'open-liked': () => push('liked'),
  settings: () => { S.rootDraft = null; push('settings'); },
  'play-ctx': b => playCtx(b.closest('.view')._ctx),
  'shuffle-all': () => shuffleAll(),
  shuffle: () => { haptic(); const on = !(S.st && S.st.shuffle); nat('shuffle', on); if (S.st) S.st.shuffle = on; applyState(); toast(on ? 'Shuffle on' : 'Shuffle off'); },
  repeat: () => { haptic(); const m = ((S.st ? S.st.repeat : 0) + 1) % 3; nat('repeat', m); if (S.st) S.st.repeat = m; applyState(); toast(['Repeat off', 'Repeat all', 'Repeat one'][m]); },
  toggle: () => { haptic(); nat('toggle'); },
  next: () => { haptic(); nat('next'); },
  prev: () => { haptic(); nat('prev'); },
  'like-current': () => toggleLike(S.curT),
  'close-player': () => closePlayer(),
  'player-artist': () => { const t = S.curT; if (t && t.al && t.al.ar) push('artist', t.al.ar.key); },
  'player-context': () => { if (S.st) gotoRef(S.st.ref); },
  'more-current': () => { if (S.curT) trackMenu(S.curT); },
  queue: () => openQueue(),
  sleep: () => sleepSheet(),
  'sheet-close': b => { const sh = b.closest('.sheet'); closeSheet(S.sheets.find(x => x.sh === sh)); },
  'track-more': b => {
    const row = b.closest('.row');
    const t = S.lib && S.lib.byId.get(Number(row.dataset.id));
    if (t) { haptic(1); trackMenu(t, listFor(row)); }
  },
  'q-jump': b => { haptic(); nat('jump', Number(b.dataset.u)); },
  'q-remove': b => { nat('remove', Number(b.dataset.u)); const r = b.closest('.row'); if (r) r.remove(); },
  'q-clear-user': () => nat('clearUpcoming', true),
  'q-clear-all': () => nat('clearUpcoming', false),
  'lib-filter': b => {
    S.libFilter = b.dataset.f;
    kvSet('libFilter', S.libFilter);
    const root = b.closest('.view');
    root._ctx = null;
    $$('.chip', root).forEach(c => c.classList.toggle('on', c.dataset.f === S.libFilter));
    renderLibBody(root);
    root.scrollTop = 0;
  },
  'lib-sort': b => {
    const k = b.dataset.k;
    const order = k === 'artists' ? ['az', 'recent'] : ['az', 'artist', 'recent'];
    S.sorts[k] = order[(order.indexOf(S.sorts[k] || 'az') + 1) % order.length];
    kvSet('sorts', S.sorts);
    const root = b.closest('.view');
    root._ctx = null;
    renderLibBody(root);
  },
  'new-playlist': () => promptSheet('New playlist', '', 'My playlist', 'Create', name => { const pl = createPlaylist(name); push('playlist', pl.id); }),
  'playlist-more': b => {
    const pl = findPl(b.dataset.k);
    if (!pl) return;
    const ts = plTracks(pl);
    collectionMenu(pl.name, `Playlist · ${plural(ts.length, 'song')}`, mosaicArt(ts, pl.id, pl.name), ts,
      [{ k: 'rename', icon: 'edit', label: 'Rename' }, { k: 'delete', icon: 'trash', label: 'Delete playlist', danger: true }], m => {
        if (m === 'rename') promptSheet('Rename playlist', pl.name, 'Name', 'Save', name => { pl.name = name; savePls(); refreshViews(['playlist', 'library']); });
        if (m === 'delete') confirmSheet('Delete playlist?', `“${pl.name}” will be deleted. Your music files stay where they are.`, 'Delete', () => {
          S.pls = S.pls.filter(x => x !== pl); savePls(); pop(); refreshViews(['library']); toast('Playlist deleted');
        });
      });
  },
  'album-more': b => {
    const a = S.lib.albumMap.get(b.closest('.view')._v.arg);
    if (!a) return;
    collectionMenu(a.name, a.artist, albumArt(a, '', 128), a.tracks,
      a.ar ? [{ k: 'artist', icon: 'user', label: 'Go to artist' }] : [], m => { if (m === 'artist') push('artist', a.ar.key); });
  },
  'artist-more': b => {
    const ar = S.lib.artistMap.get(b.closest('.view')._v.arg);
    if (ar) collectionMenu(ar.name, `Artist · ${plural(ar.tracks.length, 'song')}`, artistArt(ar, '', 128), ar.tracks);
  },
  'search-clear': () => { S.searchQ = ''; const v = $('.view[data-type="search"]'); const i = v && v.querySelector('input'); if (i) { i.value = ''; i.focus(); } if (v) renderSearchResults(v); },
  recent: b => { S.searchQ = b.dataset.q; const v = $('.view[data-type="search"]'); if (v) { v.querySelector('input').value = S.searchQ; renderSearchResults(v); } },
  'recent-clear': () => { S.recent = []; kvSet('recentSearches', []); const v = $('.view[data-type="search"]'); if (v) renderSearchResults(v); },
  'search-top-song': b => {
    const t = S.lib.byId.get(Number(b.dataset.id));
    if (t) { rememberSearch(S.searchQ); playList(listOf([t], t.title, 'search'), 0); }
  },
  redig: () => { S.digSeed = Math.random(); haptic(); refreshViews(['home']); },
  accent: b => { S.accent = b.dataset.k; kvSet('accent', S.accent); applyAccent(); $$('.swatch').forEach(s => s.classList.toggle('on', s.dataset.k === S.accent)); haptic(); },
  'roots-mode': b => { S.rootDraft.mode = b.dataset.k; refreshViews(['settings']); },
  'roots-toggle': b => {
    const k = b.dataset.k, d = S.rootDraft;
    if (d.sel.has(k)) d.sel.delete(k);
    else { for (const x of Array.from(d.sel)) if (x.startsWith(k + '/') || k.startsWith(x + '/')) d.sel.delete(x); d.sel.add(k); }
    refreshViews(['settings']);
  },
  'roots-apply': () => {
    const d = S.rootDraft;
    if (!d) return;
    let value = null;
    if (d.mode === 'all') value = ['*'];
    else if (d.mode === 'custom' && d.sel.size) value = Array.from(d.sel);
    kvSet('roots', value);
    nat('rescan');
    S.rootDraft = null;
    S.lib = null;
    rebuildAll();
    loadLibrary().then(() => toast('Music folders updated'));
  },
  rescan: () => { nat('rescan'); S.rootDraft = null; toast('Scanning…'); loadLibrary(); },
  'clear-history': () => confirmSheet('Clear history?', 'Play counts and recently played will be reset.', 'Clear', () => {
    nat('clearStats'); loadStats(); refreshViews(['home', 'settings', 'artist']); toast('History cleared');
  }),
  grant: () => nat('requestPermission'),
  'open-settings': () => nat('openSettings'),
  'lib:albums': () => openLibFilter('albums'),
  'lib:artists': () => openLibFilter('artists'),
  'lib:songs': () => openLibFilter('songs'),
  'lib:folders': () => openLibFilter('folders')
};

function onClick(e) {
  const tab = e.target.closest('#tabs button');
  if (tab) { haptic(); switchTab(tab.dataset.tab); return; }
  const actEl = e.target.closest('[data-act]');
  if (actEl && !actEl.disabled) {
    const fn = ACTIONS[actEl.dataset.act];
    if (fn) { e.preventDefault(); fn(actEl, e); return; }
  }
  const row = e.target.closest('.tl .row[data-i]');
  if (row) {
    const list = row.closest('.tl')._list;
    playList(list, Number(row.dataset.i));
    return;
  }
  const mini = e.target.closest('#mini');
  if (mini && !(mini._swiped && Date.now() - mini._swiped < 400)) openPlayer();
}
function onContextMenu(e) {
  const row = e.target.closest('.tl .row[data-id]');
  if (!row) return;
  e.preventDefault();
  const t = S.lib && S.lib.byId.get(Number(row.dataset.id));
  if (t) { haptic(1); trackMenu(t, listFor(row)); }
}

// ================================================================== permission gate

const LOGO = `<svg class="logo" viewBox="0 0 108 108" aria-hidden="true"><g class="spin">
<circle cx="54" cy="54" r="46" fill="#141714"/><circle cx="54" cy="54" r="45" fill="none" stroke="var(--ac)" stroke-width="2"/>
<circle cx="54" cy="54" r="39" fill="none" stroke="var(--ac)" stroke-opacity=".35" stroke-width="1"/>
<circle cx="54" cy="54" r="32" fill="none" stroke="var(--ac)" stroke-opacity=".25" stroke-width="1"/>
<circle cx="54" cy="54" r="25" fill="none" stroke="var(--ac)" stroke-opacity=".18" stroke-width="1"/>
<path d="M36 30a28 28 0 0 0-10 14" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="2" stroke-linecap="round"/>
<circle cx="54" cy="54" r="15" fill="var(--ac)"/><circle cx="54" cy="54" r="3" fill="#0a0b0a"/></g></svg>`;

function renderGate() {
  const g = $('#gate');
  if (S.perm === 'granted') { g.hidden = true; g.innerHTML = ''; return; }
  g.hidden = false;
  g.innerHTML = `${LOGO}<div class="dot-title">Crate</div><p>Your music, straight from your folders. To show your artists and albums, Crate needs access to the music on this phone.</p>` +
    (S.perm === 'blocked'
      ? `<button class="btn" data-act="open-settings">Open settings</button><div class="note">Permissions → Music and audio → Allow</div>`
      : `<button class="btn" data-act="grant">${ic('folder', 'sm')} Allow access to music</button>`) +
    `<div class="note">Nothing leaves your phone.</div>`;
}

// ================================================================== toast

let toastTimer = 0;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1900);
}

// ================================================================== insets & hooks for Android

function setInsets(i) {
  if (!i) return;
  const r = document.documentElement.style;
  r.setProperty('--sat', (i.t || 0) + 'px');
  r.setProperty('--sab', (i.b || 0) + 'px');
  r.setProperty('--sal', (i.l || 0) + 'px');
  r.setProperty('--sar', (i.r || 0) + 'px');
  const kb = Math.max(0, (i.k || 0) - (i.b || 0));
  r.setProperty('--kb', kb + 'px');
  document.body.classList.toggle('kb-open', kb > 80);
}

window.__crate = {
  onState(st) {
    if (!st) return;
    S.st = st;
    applyState();
  },
  onPermission(p) {
    const was = S.perm;
    S.perm = p;
    renderGate();
    if (p === 'granted' && was !== 'granted') { S.lib = null; rebuildAll(); loadLibrary(); }
  },
  back() {
    if (S.sheets.length) { closeSheet(); return true; }
    if (S.playerOpen) { closePlayer(); return true; }
    if (pop()) return true;
    if (S.tab !== 'home') { switchTab('home'); return true; }
    return false;
  },
  setInsets,
  openPlayer() { closeAllSheets(); openPlayer(); },
  libraryChanged() { loadLibrary('changed'); }
};

// ================================================================== boot

function buildChrome() {
  Object.assign(E, {
    bar: $('#mini .mini-bar i'), fill: $('#player .seek-track i'), knob: $('#player .seek-knob'),
    pos: $('#player .t-pos'), dur: $('#player .t-dur'), sleep: $('#player .c-sleep-t'), src: $('#player .np-src-v')
  });
  const tabs = { home: ['home', 'Home'], search: ['search', 'Search'], library: ['library', 'Library'] };
  $$('#tabs button').forEach(b => { const [icon, label] = tabs[b.dataset.tab]; b.innerHTML = ic(icon) + `<span>${label}</span>`; });
  $('#player [data-act="close-player"]').innerHTML = ic('down');
  $('#player [data-act="more-current"]').innerHTML = ic('more');
  $('#player .c-prev').innerHTML = ic('prev');
  $('#player .c-next').innerHTML = ic('next');
  $('#player .c-shuffle').innerHTML = ic('shuffle');
  $('#player .c-repeat').innerHTML = ic('repeat');
  $('#player .c-sleep-ic').innerHTML = ic('moon', 'sm');
  $('#player .c-queue-ic').innerHTML = ic('queue', 'sm');
  document.addEventListener('click', onClick);
  document.addEventListener('contextmenu', onContextMenu);
  document.addEventListener('load', e => {
    const t = e.target;
    if (t && t.tagName === 'IMG' && t.parentElement && t.parentElement.classList.contains('art')) t.classList.add('ok');
  }, true);
  document.addEventListener('error', e => {
    const t = e.target;
    if (t && t.tagName === 'IMG' && t.parentElement && t.parentElement.classList.contains('art') && !t.onerror) t.remove();
  }, true);
  setupPlayerGestures();
  window.addEventListener('resize', () => { if (S.playerOpen) fitTitle(); });
}

function boot() {
  buildChrome();
  setInsets(natJSON('insets'));
  loadPrefs();
  S.stacks = { home: [{ type: 'home' }], search: [{ type: 'search' }], library: [{ type: 'library' }] };
  S.perm = nat('permission') || 'granted';
  renderGate();
  const st = natJSON('state');
  if (st) S.st = st;
  show(false);
  applyState(true);
  if (S.perm === 'granted') loadLibrary();
  if (nat('consumeOpenPlayer') === true) setTimeout(openPlayer, 350);
  setInterval(tick, 250);
}

boot();
})();
