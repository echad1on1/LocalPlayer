'use strict';
/**
 * Turns folder paths into Artists and Albums (the Mac version of FolderRules.java).
 * Pure functions, no Electron — unit tested in test/folders.test.js.
 *
 * The album is the folder a song sits in and the artist is the folder above it:
 *
 *   Root/Artist/Album/song.mp3            -> artist "Artist", album "Album"
 *   Root/orginized/Artist/Album/song.mp3  -> same (extra folders above the artist don't matter)
 *   Root/Artist/Album/CD1/song.mp3        -> same album, "CD1" is a disc folder
 *   Root/Artist - Album/song.mp3          -> artist "Artist", album "Album"
 *   Root/Album/song.mp3                   -> album "Album", artist from the song tags
 *   Root/song.mp3                         -> artist and album from the song tags
 *
 * A folder that wraps the whole library (Music/orginized/…, or Apple Music's
 * Music/Media.localized/Music/…) is detected and treated as the root.
 */

const UNKNOWN_ARTIST = 'Unknown artist';
const LOOSE_ALBUM = 'Loose tracks';

/** CD1, CD 2, Disc 1, Disk2 (Bonus), Side A, Vinyl 1, 1, 02 … */
const DISC = /^(?:(?:cd|disc|disk|dvd|side|vinyl)[ ._-]*(?:\d{1,3}|[a-h])(?![a-z0-9]).*|\d{1,2})$/i;

function isDiscFolder(name) {
  return DISC.test(String(name == null ? '' : name).trim());
}

function known(tag) {
  if (tag == null) return false;
  const t = String(tag).trim();
  return t !== '' && t !== '<unknown>';
}

function split(p) {
  return String(p == null ? '' : p).split('/').filter(Boolean);
}

function join(parts, from, to) {
  return parts.slice(Math.max(0, from), Math.min(to, parts.length)).join('/');
}

const lower = s => String(s).toLowerCase();

/** Folder levels below the root, not counting a trailing disc folder. */
function effectiveDepth(parts, rootLen) {
  let n = Math.max(0, parts.length - rootLen);
  if (n > 0 && isDiscFolder(parts[parts.length - 1])) n--;
  return n;
}

/** Index (in parts) of the album folder, or -1 when the song lies directly in the root. */
function albumIndex(parts, rootLen) {
  if (parts.length - rootLen <= 0) return -1;
  let idx = parts.length - 1;
  if (idx - 1 >= rootLen && isDiscFolder(parts[idx])) idx--;
  return idx;
}

/** "Daft Punk - Discovery" inside a "Daft Punk" folder becomes "Discovery". */
function stripArtistPrefix(album, artist) {
  const p = artist + ' - ';
  if (album.length > p.length && album.slice(0, p.length).toLowerCase() === p.toLowerCase()) {
    const rest = album.slice(p.length).trim();
    if (rest) return rest;
  }
  return album;
}

/**
 * @param vol       volume prefix used in keys ("local")
 * @param parts     folder of the song, split into names
 * @param rootLen   how many leading names belong to the root
 * @param dominant  most common tag artist of the album folder (for album folders directly in the root)
 */
function derive(vol, parts, rootLen, tagArtist, tagAlbum, dominant) {
  const d = { artist: '', album: '', albumKey: '', sub: '' };
  const v = vol == null ? '' : vol;
  const idx = albumIndex(parts, rootLen);
  if (idx < 0) {
    d.artist = known(tagArtist) ? String(tagArtist).trim() : UNKNOWN_ARTIST;
    const folderName = parts.length ? parts[parts.length - 1] : '';
    const useTag = known(tagAlbum) && String(tagAlbum).trim().toLowerCase() !== folderName.toLowerCase();
    d.album = useTag ? String(tagAlbum).trim() : LOOSE_ALBUM;
    d.albumKey = lower(v + ':' + join(parts, 0, rootLen) + '|' + d.artist + '|' + d.album);
  } else {
    const albumName = parts[idx].trim();
    d.sub = join(parts, idx + 1, parts.length);
    d.albumKey = lower(v + ':' + join(parts, 0, idx + 1));
    if (idx - 1 >= rootLen) {
      d.artist = parts[idx - 1].trim();
      d.album = stripArtistPrefix(albumName, d.artist);
    } else {
      const dash = albumName.indexOf(' - ');
      if (dash > 0 && dash + 3 < albumName.length) {
        d.artist = albumName.slice(0, dash).trim();
        d.album = albumName.slice(dash + 3).trim();
      } else {
        d.album = albumName;
        d.artist = known(dominant) ? String(dominant).trim() : UNKNOWN_ARTIST;
      }
    }
  }
  if (!d.artist) d.artist = UNKNOWN_ARTIST;
  if (!d.album) d.album = 'Untitled';
  return d;
}

/**
 * Wrapper folders: when (nearly) all songs under the root sit inside one sub-folder that itself
 * holds Artist/Album folders, that sub-folder becomes the root. Repeats for nested wrappers.
 * @param folders  folder parts of every song under this root
 * @returns the new root length (>= rootLen)
 */
function wrapperRootLength(folders, rootLen) {
  let rl = rootLen;
  let members = folders;
  for (let step = 0; step < 4 && members.length; step++) {
    let only = null, multiple = false, loose = 0;
    for (const p of members) {
      if (p.length <= rl) { loose++; continue; }
      const child = p[rl].toLowerCase();
      if (only === null) only = child;
      else if (only !== child) { multiple = true; break; }
    }
    const total = members.length;
    if (multiple || only === null || loose * 20 > total) break;
    let deep = 0;
    for (const p of members) if (effectiveDepth(p, rl) >= 3) deep++;
    if (deep * 10 < total * 7) break;
    members = members.filter(p => p.length > rl);
    rl++;
  }
  return rl;
}

/** "Natural" order: "2 song" before "10 song", case-insensitive (same as FolderRules.natural). */
function natural(a, b) {
  a = a == null ? '' : String(a);
  b = b == null ? '' : String(b);
  let i = 0, j = 0;
  const na = a.length, nb = b.length;
  const dig = c => c >= 48 && c <= 57;
  while (i < na && j < nb) {
    const ca = a.charCodeAt(i), cb = b.charCodeAt(j);
    if (dig(ca) && dig(cb)) {
      let si = i, sj = j;
      while (si < na && a.charCodeAt(si) === 48) si++;
      while (sj < nb && b.charCodeAt(sj) === 48) sj++;
      let ei = si, ej = sj;
      while (ei < na && dig(a.charCodeAt(ei))) ei++;
      while (ej < nb && dig(b.charCodeAt(ej))) ej++;
      const la = ei - si, lb = ej - sj;
      if (la !== lb) return la - lb;
      for (let k = 0; k < la; k++) {
        const diff = a.charCodeAt(si + k) - b.charCodeAt(sj + k);
        if (diff !== 0) return diff;
      }
      i = ei;
      j = ej;
    } else {
      const diff = a[i].toLowerCase().charCodeAt(0) - b[j].toLowerCase().charCodeAt(0);
      if (diff !== 0) return diff;
      i++;
      j++;
    }
  }
  return (na - i) - (nb - j);
}

module.exports = {
  UNKNOWN_ARTIST, LOOSE_ALBUM, isDiscFolder, known, split, join, effectiveDepth, albumIndex,
  stripArtistPrefix, derive, wrapperRootLength, natural
};
