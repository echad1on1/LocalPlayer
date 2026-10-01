'use strict';
/**
 * Finds the music in the chosen folders, reads the tags and builds the library JSON the UI reads
 * (the same format as Library.java on the phone). Tags are cached, so after the first scan only
 * new or changed files are read again.
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const F = require('./folders');

const VOL = 'local';
const AUDIO_EXT = new Set(['.mp3', '.m4a', '.m4b', '.aac', '.flac', '.ogg', '.oga', '.opus', '.wav', '.wave', '.webm', '.weba']);
// macOS "package" folders (apps, GarageBand projects, Photos/Music libraries …) are never music folders
const SKIP_DIR_EXT = new Set(['.app', '.band', '.logicx', '.musiclibrary', '.photoslibrary', '.tvlibrary', '.bundle',
  '.framework', '.imovielibrary', '.fcpbundle', '.lrdata', '.photolibrary', '.musicxml']);
const SKIP_DIRS = new Set(['node_modules', '$recycle.bin', 'system volume information']);
const MAX_DEPTH = 16;
const CACHE_VERSION = 1;

function toParts(absDir) {
  return absDir.split(/[\\/]+/).filter(Boolean);
}

function isAudio(name) {
  return AUDIO_EXT.has(path.extname(name).toLowerCase());
}

function stripExtension(name) {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

/** Drops folders that sit inside another chosen folder, and ones that don't exist. */
async function normalizeRoots(roots) {
  const out = [];
  for (const r of roots || []) {
    if (!r) continue;
    const abs = path.resolve(String(r));
    try {
      if (!(await fsp.stat(abs)).isDirectory()) continue;
    } catch (e) {
      continue;
    }
    out.push(abs);
  }
  const inside = (a, b) => a !== b && (a + path.sep).toLowerCase().startsWith((b.endsWith(path.sep) ? b : b + path.sep).toLowerCase());
  return out.filter((a, i) => out.indexOf(a) === i && !out.some(b => inside(a, b)));
}

/** Calls onFile(absPath) for every audio file below root. */
async function walk(root, onFile, shouldStop) {
  const stack = [[root, 0]];
  const seenDirs = new Set();
  try {
    seenDirs.add(await fsp.realpath(root));
  } catch (e) {
    return;
  }
  while (stack.length) {
    if (shouldStop && shouldStop()) return;
    const [dir, depth] = stack.pop();
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch (e) {
      continue;
    }
    for (const ent of entries) {
      const name = ent.name;
      if (name.startsWith('.')) continue;
      const full = path.join(dir, name);
      let isDir = ent.isDirectory();
      let isFile = ent.isFile();
      if (ent.isSymbolicLink()) {
        try {
          const st = await fsp.stat(full);
          isDir = st.isDirectory();
          isFile = st.isFile();
        } catch (e) {
          continue;
        }
      }
      if (isDir) {
        const lname = name.toLowerCase();
        if (depth >= MAX_DEPTH || SKIP_DIRS.has(lname) || SKIP_DIR_EXT.has(path.extname(lname))) continue;
        let real = full;
        try {
          real = await fsp.realpath(full);
        } catch (e) {
          continue;
        }
        if (seenDirs.has(real)) continue;   // symlink loops
        seenDirs.add(real);
        stack.push([full, depth + 1]);
      } else if (isFile && isAudio(name)) {
        onFile(full);
      }
    }
  }
}

/** Runs fn over items with at most `limit` running at once. */
async function pool(items, limit, fn) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  });
  await Promise.all(workers);
}

let mmPromise = null;
function musicMetadata() {
  if (!mmPromise) mmPromise = import('music-metadata');
  return mmPromise;
}

/** Reads the tags we need. Never throws: unreadable files get empty tags. */
async function readTags(file) {
  try {
    const mm = await musicMetadata();
    const m = await mm.parseFile(file, { duration: false, skipCovers: true, skipPostHeaders: true });
    const c = m.common || {};
    return {
      t: c.title || '',
      a: c.artist || (c.artists && c.artists[0]) || '',
      al: c.album || '',
      tr: (c.track && c.track.no) || 0,
      dn: (c.disk && c.disk.no) || 0,
      y: c.year || 0,
      d: m.format && m.format.duration ? Math.round(m.format.duration * 1000) : 0
    };
  } catch (e) {
    return { t: '', a: '', al: '', tr: 0, dn: 0, y: 0, d: 0, err: 1 };
  }
}

/** The song's embedded cover (prefers the front cover), or null. */
async function readPicture(file) {
  try {
    const mm = await musicMetadata();
    const m = await mm.parseFile(file, { duration: false, skipCovers: false, skipPostHeaders: true });
    const pics = (m.common && m.common.picture) || [];
    const p = pics.find(x => /front/i.test(x.type || '')) || pics[0];
    return p && p.data && p.data.length ? Buffer.from(p.data) : null;
  } catch (e) {
    return null;
  }
}

const COVER_NAMES = ['cover', 'folder', 'front', 'album', 'albumart', 'albumartlarge', 'artwork', 'albumartsmall', 'thumb'];
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp']);

/** cover.jpg / folder.jpg … next to the song (or in the album folder above a disc folder). */
async function findFolderImage(dir, cache) {
  if (cache && cache.has(dir)) return cache.get(dir);
  let found = null;
  for (const d of [dir, F.isDiscFolder(path.basename(dir)) ? path.dirname(dir) : null]) {
    if (!d) continue;
    let names;
    try {
      names = await fsp.readdir(d);
    } catch (e) {
      continue;
    }
    const images = names.filter(n => !n.startsWith('.') && IMAGE_EXT.has(path.extname(n).toLowerCase()));
    if (!images.length) continue;
    const byBase = new Map(images.map(n => [stripExtension(n).toLowerCase(), n]));
    let pick = null;
    for (const c of COVER_NAMES) if (byBase.has(c)) { pick = byBase.get(c); break; }
    if (!pick) pick = images.find(n => /cover|front|folder/i.test(n)) || images.sort(F.natural)[0];
    found = path.join(d, pick);
    break;
  }
  if (cache) cache.set(dir, found);
  return found;
}

function trackOrder(a, b) {
  if (a.albumKey !== b.albumKey) return a.albumKey < b.albumKey ? -1 : 1;
  let c = F.natural(a.sub, b.sub);
  if (c) return c;
  const da = Math.floor(a.trk / 1000), db = Math.floor(b.trk / 1000);
  if (da !== db) return da - db;
  let ta = a.trk % 1000, tb = b.trk % 1000;
  if (ta <= 0) ta = 100000;
  if (tb <= 0) tb = 100000;
  if (ta !== tb) return ta - tb;
  c = F.natural(a.file, b.file);
  if (c) return c;
  return a.id - b.id;
}

class Scanner {
  /**
   * @param cacheFile  where tags and song ids are remembered between runs
   * @param tagReader  (file) => tags, replaceable in tests
   */
  constructor(cacheFile, tagReader) {
    this.cacheFile = cacheFile;
    this.readTags = tagReader || readTags;
    this.cache = null;
    this.cacheDirty = false;
  }

  loadCache() {
    if (this.cache) return this.cache;
    let c = null;
    try {
      c = JSON.parse(fs.readFileSync(this.cacheFile, 'utf8'));
    } catch (e) {
      c = null;
    }
    if (!c || c.v !== CACHE_VERSION || typeof c.files !== 'object') c = { v: CACHE_VERSION, nextId: 1, ids: {}, files: {} };
    if (!c.ids) c.ids = {};
    this.cache = c;
    return c;
  }

  saveCache() {
    if (!this.cacheDirty || !this.cacheFile) return;
    try {
      fs.mkdirSync(path.dirname(this.cacheFile), { recursive: true });
      const tmp = this.cacheFile + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.cache));
      fs.renameSync(tmp, this.cacheFile);
      this.cacheDirty = false;
    } catch (e) {
      // not fatal: we just read the tags again next time
    }
  }

  idFor(file) {
    const c = this.cache;
    let id = c.ids[file];
    if (!id) {
      id = c.nextId++;
      c.ids[file] = id;
      this.cacheDirty = true;
    }
    return id;
  }

  /**
   * @param roots       chosen music folders (absolute paths)
   * @param onProgress  ({phase, done, total}) => void
   * @returns {{json: string, signature: string, byId: Map<number, object>, roots: string[], count: number}}
   */
  async scan(roots, onProgress, shouldStop) {
    const cache = this.loadCache();
    const progress = onProgress || (() => {});
    const rootList = await normalizeRoots(roots);

    // 1) find the files
    const found = [];          // {file, root}
    const seen = new Set();
    for (let r = 0; r < rootList.length; r++) {
      await walk(rootList[r], file => {
        if (seen.has(file)) return;
        seen.add(file);
        found.push({ file, root: r });
        if (found.length % 500 === 0) progress({ phase: 'find', done: found.length, total: 0 });
      }, shouldStop);
    }
    progress({ phase: 'find', done: found.length, total: found.length });

    // 2) stat them, read tags of new / changed files
    const stats = new Array(found.length);
    await pool(found, 32, async (f, i) => {
      try {
        stats[i] = await fsp.stat(f.file);
      } catch (e) {
        stats[i] = null;
      }
    });
    const todo = [];
    found.forEach((f, i) => {
      const st = stats[i];
      if (!st) return;
      const e = cache.files[f.file];
      if (!e || e.size !== st.size || e.mtime !== Math.floor(st.mtimeMs)) todo.push(i);
    });
    let done = 0;
    const tick = () => progress({ phase: 'read', done, total: todo.length });
    tick();
    let lastTick = Date.now();
    await pool(todo, 8, async i => {
      if (shouldStop && shouldStop()) return;
      const f = found[i], st = stats[i];
      const tags = await this.readTags(f.file);
      cache.files[f.file] = Object.assign(tags, {
        size: st.size,
        mtime: Math.floor(st.mtimeMs),
        born: Math.floor((st.birthtimeMs && st.birthtimeMs > 0 ? st.birthtimeMs : st.mtimeMs) / 1000)
      });
      this.cacheDirty = true;
      done++;
      if (Date.now() - lastTick > 150) {
        lastTick = Date.now();
        tick();
      }
    });
    tick();

    // forget files that are gone (their ids stay reserved)
    const present = new Set(found.map(f => f.file));
    for (const k of Object.keys(cache.files)) {
      if (!present.has(k)) {
        delete cache.files[k];
        this.cacheDirty = true;
      }
    }

    // 3) folders -> artists / albums
    const items = [];
    found.forEach((f, i) => {
      if (!stats[i] || !cache.files[f.file]) return;
      const dir = path.dirname(f.file);
      items.push({ file: f.file, root: f.root, dir, parts: toParts(dir), name: path.basename(f.file), tags: cache.files[f.file] });
    });
    const rootLens = rootList.map(r => toParts(r).length);
    // wrapper folders, per chosen folder
    const chains = rootList.map((r, ri) => {
      const members = items.filter(it => it.root === ri).map(it => it.parts);
      const rl = F.wrapperRootLength(members, rootLens[ri]);
      if (rl === rootLens[ri]) return [];
      const sample = members.find(p => p.length >= rl);
      return sample ? sample.slice(rootLens[ri], rl).map(s => s.toLowerCase()) : [];
    });
    for (const it of items) {
      let rl = rootLens[it.root];
      for (const name of chains[it.root]) {
        if (it.parts.length > rl && it.parts[rl].toLowerCase() === name) rl++;
        else break;
      }
      it.rootLen = rl;
    }
    // most common tag artist of album folders that sit directly in a root
    const counts = new Map();
    for (const it of items) {
      const idx = F.albumIndex(it.parts, it.rootLen);
      if (idx < 0 || idx !== it.rootLen) continue;
      it.albumFolder = F.join(it.parts, 0, idx + 1).toLowerCase();
      if (!F.known(it.tags.a)) {
        counts.set(it.albumFolder, counts.get(it.albumFolder) || new Map());
        continue;
      }
      const m = counts.get(it.albumFolder) || new Map();
      const a = it.tags.a.trim();
      const k = a.toLowerCase();
      const cur = m.get(k) || { name: a, n: 0 };
      cur.n++;
      m.set(k, cur);
      counts.set(it.albumFolder, m);
    }
    const totals = new Map();
    for (const it of items) if (it.albumFolder) totals.set(it.albumFolder, (totals.get(it.albumFolder) || 0) + 1);
    const dominant = new Map();
    for (const [folder, m] of counts) {
      let best = null;
      for (const v of m.values()) if (!best || v.n > best.n) best = v;
      if (best && best.n * 2 >= totals.get(folder)) dominant.set(folder, best.name);
    }

    // 4) tracks
    const tracks = [];
    const byId = new Map();
    for (const it of items) {
      const t = it.tags;
      const d = F.derive(VOL, it.parts, it.rootLen, t.a, t.al, it.albumFolder ? dominant.get(it.albumFolder) : null);
      const folder = VOL + ':' + it.parts.join('/') + '/';
      const tr = {
        id: this.idFor(it.file),
        title: (t.t && String(t.t).trim()) || stripExtension(it.name),
        artist: d.artist,
        album: d.album,
        albumKey: d.albumKey,
        dur: t.d || 0,
        trk: (t.dn > 0 ? t.dn * 1000 : 0) + (t.tr > 0 && t.tr < 1000 ? t.tr : 0),
        year: t.y > 0 && t.y < 10000 ? t.y : 0,
        added: t.born || 0,
        folder,
        file: it.name,
        key: folder + it.name,
        sub: d.sub,
        tagArtist: F.known(t.a) ? String(t.a).trim() : '',
        path: it.file
      };
      tracks.push(tr);
      byId.set(tr.id, tr);
    }
    tracks.sort(trackOrder);

    const h = crypto.createHash('sha1');
    for (const t of tracks) h.update(t.id + '\u0000' + t.key + '\u0000' + t.title + '\u0000' + t.tagArtist + '\u0000' + t.dur + '\n');
    const signature = h.digest('hex');

    const json = JSON.stringify({
      v: 1,
      total: tracks.length,
      auto: false,
      roots: rootList.map(r => VOL + ':' + toParts(r).join('/')),
      folders: [],
      desktop: { folders: rootList },
      tracks: tracks.map(t => [t.id, t.title, t.artist, t.album, t.albumKey, t.dur, t.trk, t.year, t.added, t.folder,
        t.file, t.key, t.sub, 1, t.tagArtist])
    });
    this.saveCache();
    return { json, signature, byId, roots: rootList, count: tracks.length };
  }
}

module.exports = { Scanner, readTags, readPicture, findFolderImage, normalizeRoots, walk, isAudio, toParts, AUDIO_EXT };
