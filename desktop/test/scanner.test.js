'use strict';
// Scans the generated test library (testdata/home/Music) with the real tag reader.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Scanner, findFolderImage, normalizeRoots } = require('../lib/scanner.js');

const MUSIC = path.resolve(__dirname, '../../testdata/home/Music');
const have = fs.existsSync(MUSIC);

function albumsOf(json) {
  const lib = JSON.parse(json);
  const albums = new Map();
  for (const r of lib.tracks) {
    const [id, title, artist, album, ak, dur, trk, year, added, folder, file, key, sub] = r;
    if (!albums.has(ak)) albums.set(ak, { artist, album, songs: [] });
    albums.get(ak).songs.push({ id, title, dur, trk, year, added, folder, file, key, sub, tagArtist: r[14] });
  }
  return { lib, albums: [...albums.values()] };
}
const find = (albums, artist, album) => albums.find(a => a.artist === artist && a.album === album);

test('scans the test library into artists and albums', { skip: !have && 'no test library' }, async () => {
  const cacheFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'crate-')), 'cache.json');
  const progress = [];
  const s = new Scanner(cacheFile);
  const res = await s.scan([MUSIC], p => progress.push(p));
  const { lib, albums } = albumsOf(res.json);

  // junk is ignored: .trash, notes.txt, GarageBand project
  assert.equal(lib.total, 33, 'song count');
  assert.ok(!lib.tracks.some(t => /deleted|take\.wav/i.test(t[10])));

  // wrapper "orginized" is the root, artists/albums from folders
  assert.deepEqual(find(albums, 'Neon Harbor', 'Night Ferry').songs.map(s => s.title),
    ['Harbor Lights', 'Night Ferry', 'Static Bloom', 'Ocean Wires', 'Last Ferry Home']);
  assert.equal(find(albums, 'Neon Harbor', 'Tidal Static').songs.length, 3);
  assert.equal(find(albums, 'Lowfield', 'Grain').songs.length, 3);
  // CD1 + CD2 = one album, in disc order
  const live = find(albums, 'Lowfield', 'Live at the Lighthouse');
  assert.deepEqual(live.songs.map(s => s.sub + ':' + s.title),
    ['CD1:Intro', 'CD1:Grain (Live)', 'CD1:Fog', 'CD2:Longwave (Live)', 'CD2:Encore']);
  // "Artist - Album" folder
  assert.equal(find(albums, 'Glass Tigers', 'Stripes').songs.length, 2);
  // loose song in an artist folder -> album named after the folder, artist from tags
  assert.equal(find(albums, 'Kaito Sunset', 'Kaito Sunset').songs[0].title, 'Demo');
  // untagged wav files: titles from file names, artist from the folder
  assert.deepEqual(find(albums, 'Moss & Mercury', 'Greenhouse').songs.map(s => s.title), ['01 Greenhouse', '02 Fern']);
  // compilation keeps the tag artist per song
  assert.deepEqual(find(albums, 'Various Artists', 'Night Drive Vol. 1').songs.map(s => s.tagArtist),
    ['Neon Harbor', 'Amber Motel', 'Dune Radio']);
  // odd tag numbers are kept as data (the UI renumbers 1, 2, 3)
  assert.deepEqual(find(albums, 'Hexagon Kids', 'Sugar Circuit').songs.map(s => s.trk), [37, 158, 200]);
  // durations, including a CBR mp3 without a Xing header
  assert.ok(find(albums, 'Dune Radio', 'FM Mirage').songs[0].dur > 5500);
  for (const t of lib.tracks) assert.ok(t[5] > 900, 'duration for ' + t[10]);
  // years, keys, folders
  assert.equal(find(albums, 'Neon Harbor', 'Night Ferry').songs[0].year, 2019);
  const nf = find(albums, 'Neon Harbor', 'Night Ferry').songs[0];
  assert.ok(nf.folder.startsWith('local:') && nf.folder.endsWith('/Neon Harbor/Night Ferry/'));
  assert.equal(nf.key, nf.folder + nf.file);
  assert.deepEqual(lib.desktop.folders, [MUSIC]);
  assert.ok(progress.some(p => p.phase === 'read' && p.total === 33));

  // second scan: everything comes from the cache, ids stay the same
  let reads = 0;
  const s2 = new Scanner(cacheFile, async f => { reads++; return require('../lib/scanner.js').readTags(f); });
  const res2 = await s2.scan([MUSIC]);
  assert.equal(reads, 0, 'no tags re-read');
  assert.equal(res2.signature, res.signature);
  assert.deepEqual(JSON.parse(res2.json).tracks.map(t => t[0]), lib.tracks.map(t => t[0]));
  assert.ok(res2.byId.get(lib.tracks[0][0]).path.startsWith(MUSIC));
});

test('folder images and roots', { skip: !have && 'no test library' }, async () => {
  const kaito = path.join(MUSIC, 'orginized/Kaito Sunset/Pastel Drive');
  assert.equal(path.basename(await findFolderImage(kaito, new Map())), 'cover.jpg');
  const cd2 = path.join(MUSIC, 'orginized/Lowfield/Live at the Lighthouse/CD2');
  assert.equal(await findFolderImage(cd2, new Map()), path.join(MUSIC, 'orginized/Lowfield/Live at the Lighthouse/cover.jpg'));
  assert.equal(await findFolderImage(path.join(MUSIC, 'orginized/Amber Motel/Vacancy'), new Map()), null);
  // nested and missing folders are dropped
  const roots = await normalizeRoots([MUSIC, path.join(MUSIC, 'orginized'), '/nope/nothing']);
  assert.deepEqual(roots, [MUSIC]);
});
