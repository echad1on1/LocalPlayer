'use strict';
// Same checks as the phone's UnitTests.java, against the JavaScript queue.
const test = require('node:test');
const assert = require('node:assert/strict');
const PlayQueue = require('../renderer/queue.js');

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const ids = q => q.order.map(e => e.id);

test('basic next / prev / wrap', () => {
  const q = new PlayQueue(seeded(42));
  q.set([1, 2, 3, 4, 5], 2, false);
  assert.deepEqual(ids(q), [1, 2, 3, 4, 5]);
  assert.equal(q.current().id, 3);
  q.moveNext(false); assert.equal(q.current().id, 4);
  q.moveNext(false); assert.equal(q.current().id, 5);
  assert.equal(q.moveNext(false), null);
  assert.equal(q.current().id, 5);
  q.moveNext(true); assert.equal(q.current().id, 1);
  assert.equal(q.movePrev(false), null);
  q.movePrev(true); assert.equal(q.current().id, 5);
});

test('shuffle keeps the current song and unshuffle restores album order', () => {
  const q = new PlayQueue(seeded(1));
  q.set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3, false);
  q.setShuffle(true);
  assert.equal(q.current().id, 4);
  assert.equal(q.index, 0);
  assert.equal(new Set(ids(q)).size, 10);
  q.moveNext(false);
  const after = q.current().id;
  q.setShuffle(false);
  assert.deepEqual(ids(q), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(q.current().id, after);
  assert.equal(q.index, after - 1);
  q.set([1, 2, 3, 4, 5], -1, true);
  assert.equal(q.index, 0);
  assert.equal(new Set(ids(q)).size, 5);
});

test('user queue: play next, add to queue, survives shuffle', () => {
  const q = new PlayQueue(seeded(2));
  q.set([10, 20, 30, 40], 0, false);
  q.add([100], false);
  q.add([200], false);
  q.add([300], true);
  assert.deepEqual(ids(q), [10, 300, 100, 200, 20, 30, 40]);
  assert.equal(q.upcomingUserCount(), 3);
  q.setShuffle(true);
  assert.deepEqual(ids(q).slice(0, 4), [10, 300, 100, 200]);
  q.setShuffle(false);
  assert.deepEqual(ids(q), [10, 300, 100, 200, 20, 30, 40]);
  q.moveNext(false);
  assert.equal(q.current().id, 300);
  q.setShuffle(true); q.setShuffle(false);
  assert.deepEqual(ids(q), [10, 300, 100, 200, 20, 30, 40]);
  assert.equal(q.current().id, 300);
  const uid200 = q.order[3].uid;
  assert.ok(q.remove(uid200));
  assert.deepEqual(ids(q), [10, 300, 100, 20, 30, 40]);
  assert.ok(!q.remove(q.current().uid));
  q.clearUpcoming(true);
  assert.deepEqual(ids(q), [10, 300, 20, 30, 40]);
  q.clearUpcoming(false);
  assert.deepEqual(ids(q), [10, 300]);
  const e = new PlayQueue(seeded(3));
  e.add([7, 8], false);
  assert.deepEqual(ids(e), [7, 8]);
  assert.equal(e.current().id, 7);
});

test('save and restore', () => {
  const q = new PlayQueue(seeded(4));
  q.set([1, 2, 3, 4, 5, 6], 0, false);
  q.add([99], true);
  q.setShuffle(true);
  q.moveNext(false); q.moveNext(false);
  const cur = q.current().id;
  const r = new PlayQueue(seeded(5));
  assert.equal(r.restoreFrom(q.serialize(), q.index, null), PlayQueue.RESTORE_OK);
  assert.deepEqual(ids(r), ids(q));
  assert.equal(r.current().id, cur);
  assert.equal(r.shuffle, true);
  r.setShuffle(false); q.setShuffle(false);
  assert.deepEqual(ids(r), ids(q));
  assert.equal(r.current().id, q.current().id);

  q.set([1, 2, 3, 4, 5, 6], 2, false);
  const r2 = new PlayQueue(seeded(6));
  assert.equal(r2.restoreFrom(q.serialize(), q.index, new Set([1, 2, 4, 5, 6, 99])), PlayQueue.RESTORE_CURRENT_LOST);
  assert.deepEqual(ids(r2), [1, 2, 4, 5, 6]);
  assert.equal(r2.current().id, 4);
  assert.equal(new PlayQueue().restoreFrom('garbage', 0, null), PlayQueue.RESTORE_FAILED);
  assert.equal(new PlayQueue().restoreFrom(null, 0, null), PlayQueue.RESTORE_FAILED);
  assert.equal(new PlayQueue().restoreFrom(q.serialize(), 0, new Set()), PlayQueue.RESTORE_FAILED);
  // the phone's format restores here too
  const phone = new PlayQueue();
  assert.equal(phone.restoreFrom('v1;0;0;5,6*,7;0,2', 0, null), PlayQueue.RESTORE_OK);
  assert.deepEqual(ids(phone), [5, 6, 7]);
  assert.ok(phone.order[1].user);
  const j = q.toJSON();
  assert.equal(j.items.length, 6);
  assert.equal(typeof j.qv, 'number');
});

test('3000 random operation sequences keep the queue consistent', () => {
  const r4 = seeded(7);
  const ri = n => Math.floor(r4() * n);
  for (let iter = 0; iter < 3000; iter++) {
    const z = new PlayQueue(r4);
    const n = 1 + ri(12);
    z.set(Array.from({ length: n }, (_, i) => i + 1), ri(n), r4() < 0.5);
    for (let step = 0; step < 40; step++) {
      const op = ri(9);
      switch (op) {
        case 0: z.moveNext(r4() < 0.5); break;
        case 1: z.movePrev(r4() < 0.5); break;
        case 2: z.setShuffle(!z.shuffle); break;
        case 3: z.add([100 + ri(5)], r4() < 0.5); break;
        case 4: if (z.size()) z.remove(z.order[ri(z.size())].uid); break;
        case 5: if (z.size()) z.jumpTo(z.order[ri(z.size())].uid); break;
        case 6: if (ri(5) === 0) z.clearUpcoming(r4() < 0.5); break;
        case 7: {
          const y = new PlayQueue(r4);
          if (y.restoreFrom(z.serialize(), z.index, null) !== PlayQueue.RESTORE_FAILED) {
            assert.deepEqual(ids(y), ids(z));
            assert.equal(y.index, z.index);
          }
          break;
        }
        default: z.first();
      }
      if (z.size()) {
        assert.ok(z.index >= 0 && z.index < z.size(), 'index in range after op ' + op);
        assert.ok(z.current());
      }
      assert.equal(new Set(z.order.map(e => e.uid)).size, z.size(), 'no duplicate entries');
    }
  }
});
