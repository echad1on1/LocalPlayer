'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../lib/folders.js');

const V = 'local';
const P = s => F.split(s);
// root = /Users/ed/Music  -> 3 names
const ROOT = 3;
const d = (path, tagArtist, tagAlbum, dominant, rootLen = ROOT) => F.derive(V, P(path), rootLen, tagArtist, tagAlbum, dominant);

test('Artist/Album folders', () => {
  let r = d('Users/ed/Music/Daft Punk/Discovery');
  assert.equal(r.artist, 'Daft Punk'); assert.equal(r.album, 'Discovery'); assert.equal(r.sub, '');
  r = d('Users/ed/Music/orginized/Neon Harbor/Night Ferry');
  assert.equal(r.artist, 'Neon Harbor'); assert.equal(r.album, 'Night Ferry');
  r = d('Users/ed/Music/Rock/Lowfield/Grain');
  assert.equal(r.artist, 'Lowfield'); assert.equal(r.album, 'Grain');
});

test('disc folders join one album', () => {
  const a = d('Users/ed/Music/Pink Floyd/The Wall/CD1');
  const b = d('Users/ed/Music/orginized/Pink Floyd/The Wall/CD2', null, null, null, ROOT + 1);
  assert.equal(a.artist, 'Pink Floyd'); assert.equal(a.album, 'The Wall'); assert.equal(a.sub, 'CD1');
  assert.equal(b.artist, 'Pink Floyd'); assert.equal(b.album, 'The Wall'); assert.equal(b.sub, 'CD2');
  assert.equal(d('Users/ed/Music/Pink Floyd/The Wall/CD1').albumKey, d('Users/ed/Music/Pink Floyd/The Wall/CD2').albumKey);
  const c = d('Users/ed/Music/Kaito/Pastel/Disc 1 (Remastered)');
  assert.equal(c.album, 'Pastel'); assert.equal(c.sub, 'Disc 1 (Remastered)');
  const e = d('Users/ed/Music/Greenhouse/CD1', 'Moss & Mercury', null, 'Moss & Mercury');
  assert.equal(e.album, 'Greenhouse'); assert.equal(e.artist, 'Moss & Mercury'); assert.equal(e.sub, 'CD1');
});

test('album folders directly in the root', () => {
  let r = d('Users/ed/Music/Daft Punk - Homework', 'x', 'y', 'Someone');
  assert.equal(r.artist, 'Daft Punk'); assert.equal(r.album, 'Homework');
  r = d('Users/ed/Music/Random Access Memories', 'Daft Punk', 'RAM', 'Daft Punk');
  assert.equal(r.artist, 'Daft Punk'); assert.equal(r.album, 'Random Access Memories');
  r = d('Users/ed/Music/Old Demos', '<unknown>', 'x', null);
  assert.equal(r.artist, 'Unknown artist');
});

test('songs lying in the root use their tags', () => {
  let r = d('Users/ed/Music', 'Muse', 'Absolution');
  assert.equal(r.artist, 'Muse'); assert.equal(r.album, 'Absolution');
  r = d('Users/ed/Music', '<unknown>', 'Music');
  assert.equal(r.album, 'Loose tracks'); assert.equal(r.artist, 'Unknown artist');
});

test('"Artist - Album" inside the artist folder and same album names', () => {
  const r = d('Users/ed/Music/Daft Punk/Daft Punk - Discovery');
  assert.equal(r.artist, 'Daft Punk'); assert.equal(r.album, 'Discovery');
  assert.notEqual(d('Users/ed/Music/A/Greatest Hits').albumKey, d('Users/ed/Music/B/Greatest Hits').albumKey);
});

test('disc folder names', () => {
  for (const yes of ['CD1', 'cd 2', 'CD01', 'Disc 1', 'Disk2', 'Disc 1 (Remastered)', 'Side A', 'side b', 'Vinyl 2', '1', '02']) {
    assert.ok(F.isDiscFolder(yes), yes);
  }
  for (const no of ['Discovery', 'Sideshow', '2001', 'Album', 'CDs', 'Diskette', 'Vinyl Rip', 'DVD', 'Disco Inferno']) {
    assert.ok(!F.isDiscFolder(no), no);
  }
});

const wrap = (paths, rootLen = ROOT) => F.wrapperRootLength(paths.map(P), rootLen);

test('wrapper folders become the root', () => {
  const lib = [];
  for (let a = 0; a < 6; a++) for (let al = 0; al < 3; al++) for (let s = 0; s < 8; s++) lib.push(`Users/ed/Music/orginized/Artist ${a}/Album ${al}`);
  assert.equal(wrap(lib), ROOT + 1);
  // a few loose songs in artist folders don't change that
  assert.equal(wrap(lib.concat(['Users/ed/Music/orginized/Artist 1', 'Users/ed/Music/orginized/Artist 2'])), ROOT + 1);
  // one loose song next to the wrapper is fine, many are not
  assert.equal(wrap(lib.concat(['Users/ed/Music'])), ROOT + 1);
  assert.equal(wrap(lib.concat(Array(20).fill('Users/ed/Music'))), ROOT);
  // Apple Music's media folder
  const am = lib.map(p => p.replace('/orginized/', '/Music/Media.localized/Music/'));
  assert.equal(wrap(am), ROOT + 3);
  // a single artist is not a wrapper, nor is one multi-disc album
  assert.equal(wrap(['Users/ed/Music/Daft Punk/Discovery', 'Users/ed/Music/Daft Punk/Homework']), ROOT);
  assert.equal(wrap(['Users/ed/Music/Pink Floyd/The Wall/CD1', 'Users/ed/Music/Pink Floyd/The Wall/CD2']), ROOT);
  // genre folders: no wrapper
  assert.equal(wrap(['Users/ed/Music/Rock/A/X', 'Users/ed/Music/Pop/B/Y']), ROOT);
  // the wrapper holds just one artist
  assert.equal(wrap(['Users/ed/Music/orginized/Daft Punk/Discovery', 'Users/ed/Music/orginized/Daft Punk/Homework']), ROOT + 1);
  assert.equal(wrap([]), ROOT);
});

test('loose songs in an artist folder inside a wrapper', () => {
  const r = d('Users/ed/Music/orginized/Kaito Sunset', 'Kaito Sunset', null, 'Kaito Sunset', ROOT + 1);
  assert.equal(r.artist, 'Kaito Sunset'); assert.equal(r.album, 'Kaito Sunset');
});

test('natural sort', () => {
  assert.ok(F.natural('2 - b.mp3', '10 - a.mp3') < 0);
  assert.equal(F.natural('01 x', '1 x'), 0);
  assert.ok(F.natural('Track 9', 'track 10') < 0);
  assert.ok(F.natural('a', 'ab') < 0);
  assert.ok(F.natural('CD1', 'CD2') < 0);
  const files = ['10 Ten.mp3', '1 One.mp3', '02 Two.mp3', 'b.mp3', 'A.mp3'].sort(F.natural);
  assert.deepEqual(files, ['1 One.mp3', '02 Two.mp3', '10 Ten.mp3', 'A.mp3', 'b.mp3']);
});
