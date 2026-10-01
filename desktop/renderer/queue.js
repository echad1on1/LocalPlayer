/* The play queue — a straight port of PlayQueue.java so the Mac app behaves like the phone.
 * Works in the browser (window.CrateQueue) and in Node (module.exports) for the unit tests.
 *
 * Two lists:
 *   order   – what actually plays, in play order (shuffled or not)
 *   context – the original order of the album / playlist / folder you started
 * Songs added with "Add to queue" / "Play next" are "user" entries: they play right after the
 * current song and survive shuffle being turned on or off.
 */
(function (root) {
  'use strict';

  const RESTORE_FAILED = -1;
  const RESTORE_CURRENT_LOST = 0;
  const RESTORE_OK = 1;

  function shuffleInPlace(a, rnd) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  class PlayQueue {
    constructor(rnd) {
      this.rnd = rnd || Math.random;
      this.order = [];
      this.context = [];
      this.index = -1;
      this.shuffle = false;
      this.anchor = null;      // last context entry that was current (for un-shuffling)
      this.nextUid = 1;
      this.version = 0;        // bumps on every structural change
    }

    entry(id, user) {
      return { uid: this.nextUid++, id: id, user: !!user };
    }

    size() { return this.order.length; }

    current() {
      return this.index >= 0 && this.index < this.order.length ? this.order[this.index] : null;
    }

    isLast() { return this.index >= this.order.length - 1; }

    touch() {
      const e = this.current();
      if (e && !e.user) this.anchor = e;
    }

    /** Replace everything with a new context. start < 0 with shuffle means "random first song". */
    set(ids, start, shuffleOn) {
      this.order = [];
      this.context = ids.map(id => this.entry(id, false));
      this.anchor = null;
      this.shuffle = !!shuffleOn;
      if (!this.context.length) {
        this.index = -1;
        this.version++;
        return;
      }
      if (this.shuffle) {
        const rest = this.context.slice();
        const first = start >= 0 && start < rest.length ? rest.splice(start, 1)[0] : null;
        shuffleInPlace(rest, this.rnd);
        if (first) this.order.push(first);
        this.order.push(...rest);
        this.index = 0;
      } else {
        this.order = this.context.slice();
        this.index = Math.max(0, Math.min(start, this.order.length - 1));
      }
      this.touch();
      this.version++;
    }

    moveNext(wrap) {
      if (!this.order.length) return null;
      if (this.index + 1 < this.order.length) this.index++;
      else if (wrap) this.index = 0;
      else return null;
      this.touch();
      return this.current();
    }

    movePrev(wrap) {
      if (!this.order.length) return null;
      if (this.index > 0) this.index--;
      else if (wrap) this.index = this.order.length - 1;
      else return null;
      this.touch();
      return this.current();
    }

    first() {
      if (this.order.length) {
        this.index = 0;
        this.touch();
      }
    }

    jumpTo(uid) {
      const i = this.order.findIndex(e => e.uid === uid);
      if (i < 0) return false;
      this.index = i;
      this.touch();
      return true;
    }

    setShuffle(on) {
      on = !!on;
      if (on === this.shuffle) return;
      this.shuffle = on;
      const cur = this.current();
      if (!cur) {
        this.version++;
        return;
      }
      const pending = this.order.slice(this.index + 1).filter(e => e.user);
      const neu = [];
      let newIndex;
      if (on) {
        const rest = this.context.filter(e => e !== cur);
        shuffleInPlace(rest, this.rnd);
        neu.push(cur, ...pending, ...rest);
        newIndex = 0;
      } else {
        const a = cur.user ? this.anchor : cur;
        const ai = a ? this.context.indexOf(a) : -1;
        for (let i = 0; i <= ai; i++) neu.push(this.context[i]);
        if (cur.user) {
          neu.push(cur);
          newIndex = neu.length - 1;
        } else {
          newIndex = ai;
        }
        neu.push(...pending);
        for (let i = ai + 1; i < this.context.length; i++) neu.push(this.context[i]);
        if (newIndex < 0) newIndex = 0;
      }
      this.order = neu;
      this.index = newIndex;
      this.version++;
    }

    /** "Add to queue" (after other queued songs) or "Play next" (right after the current song). */
    add(ids, playNext) {
      if (!ids.length) return;
      if (!this.order.length) {
        for (const id of ids) {
          const e = this.entry(id, false);
          this.context.push(e);
          this.order.push(e);
        }
        this.index = 0;
        this.touch();
        this.version++;
        return;
      }
      let p = this.index + 1;
      if (!playNext) while (p < this.order.length && this.order[p].user) p++;
      this.order.splice(p, 0, ...ids.map(id => this.entry(id, true)));
      this.version++;
    }

    /** Removes an upcoming or past entry. The current song can't be removed. */
    remove(uid) {
      const i = this.order.findIndex(e => e.uid === uid);
      if (i < 0 || i === this.index) return false;
      const e = this.order[i];
      this.order.splice(i, 1);
      const ci = this.context.indexOf(e);
      if (ci >= 0) this.context.splice(ci, 1);
      if (this.anchor === e) this.anchor = null;
      if (i < this.index) this.index--;
      this.version++;
      return true;
    }

    /** Removes everything after the current song, or only the user-queued songs. */
    clearUpcoming(onlyUser) {
      if (this.index < 0) return;
      const gone = new Set();
      const keep = [];
      this.order.forEach((e, i) => {
        if (i > this.index && (!onlyUser || e.user)) gone.add(e);
        else keep.push(e);
      });
      if (!gone.size) return;
      this.order = keep;
      this.context = this.context.filter(e => !gone.has(e));
      if (this.anchor && gone.has(this.anchor)) this.anchor = null;
      this.version++;
    }

    upcomingUserCount() {
      let n = 0;
      for (let i = this.index + 1; i < this.order.length; i++) if (this.order[i].user) n++;
      return n;
    }

    // ------------------------------------------------------------ persistence

    /** Same format as the phone: v1;shuffle;anchorPos;id,id*,id...;ctxPos,ctxPos,... */
    serialize() {
      const pos = new Map();
      let anchorPos = -1;
      this.order.forEach((e, i) => {
        pos.set(e, i);
        if (e === this.anchor) anchorPos = i;
      });
      const ord = this.order.map(e => e.id + (e.user ? '*' : '')).join(',');
      const ctx = this.context.filter(e => pos.has(e)).map(e => pos.get(e)).join(',');
      return 'v1;' + (this.shuffle ? '1' : '0') + ';' + anchorPos + ';' + ord + ';' + ctx;
    }

    /** Replaces the contents with a serialized queue; ids missing from `valid` (a Set) are dropped. */
    restoreFrom(s, savedIndex, valid) {
      if (typeof s !== 'string') return RESTORE_FAILED;
      const parts = s.split(';');
      if (parts.length !== 5 || parts[0] !== 'v1') return RESTORE_FAILED;
      const ord = parts[3] ? parts[3].split(',') : [];
      const byPos = new Array(ord.length).fill(null);
      const newOrder = [];
      let curNew = -1, afterNew = -1;
      ord.forEach((tok, i) => {
        tok = tok.trim();
        const user = tok.endsWith('*');
        const id = Number(user ? tok.slice(0, -1) : tok);
        if (!tok || !Number.isFinite(id)) return;
        if (valid && !valid.has(id)) return;
        const e = this.entry(id, user);
        byPos[i] = e;
        newOrder.push(e);
        if (i === savedIndex) curNew = newOrder.length - 1;
        else if (i > savedIndex && afterNew < 0) afterNew = newOrder.length - 1;
      });
      if (!newOrder.length) return RESTORE_FAILED;
      const newContext = [];
      if (parts[4]) {
        for (const p of parts[4].split(',')) {
          const k = Number(p);
          if (Number.isInteger(k) && k >= 0 && k < byPos.length && byPos[k]) newContext.push(byPos[k]);
        }
      }
      const ap = Number(parts[2]);
      this.order = newOrder;
      this.context = newContext;
      this.shuffle = parts[1] === '1';
      this.anchor = Number.isInteger(ap) && ap >= 0 && ap < byPos.length ? byPos[ap] : null;
      let result;
      if (curNew >= 0) {
        this.index = curNew;
        result = RESTORE_OK;
      } else {
        this.index = afterNew >= 0 ? afterNew : this.order.length - 1;
        result = RESTORE_CURRENT_LOST;
      }
      this.touch();
      this.version++;
      return result;
    }

    /** {"qv":1,"idx":0,"items":[[uid,id,user],...]} — what the UI's queue sheet reads. */
    toJSON() {
      return { qv: this.version, idx: this.index, items: this.order.map(e => [e.uid, e.id, e.user ? 1 : 0]) };
    }
  }

  PlayQueue.RESTORE_FAILED = RESTORE_FAILED;
  PlayQueue.RESTORE_CURRENT_LOST = RESTORE_CURRENT_LOST;
  PlayQueue.RESTORE_OK = RESTORE_OK;

  if (typeof module !== 'undefined' && module.exports) module.exports = PlayQueue;
  else root.CrateQueue = PlayQueue;
})(typeof window !== 'undefined' ? window : globalThis);
