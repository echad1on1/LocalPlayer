'use strict';
/** A small JSON file that is kept in memory and written to disk shortly after it changes. */
const fs = require('fs');
const path = require('path');

class JsonStore {
  constructor(file, defaults) {
    this.file = file;
    this.timer = null;
    let data = null;
    try {
      data = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      data = null;
    }
    this.data = data && typeof data === 'object' ? Object.assign({}, defaults, data) : Object.assign({}, defaults);
  }

  get(key) {
    return this.data[key];
  }

  set(key, value) {
    if (value === null || value === undefined) delete this.data[key];
    else this.data[key] = value;
    this.touch();
  }

  touch() {
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), 400);
  }

  flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data));
      fs.renameSync(tmp, this.file);
    } catch (e) {
      // disk full or read-only: keep going with what's in memory
    }
  }
}

module.exports = { JsonStore };
