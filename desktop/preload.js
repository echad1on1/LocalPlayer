'use strict';
/* The only bridge between the page and the rest of the app. Everything the page can ask for is listed here. */
const { contextBridge, ipcRenderer } = require('electron');

const str = v => (v === null || v === undefined ? null : String(v));

contextBridge.exposeInMainWorld('CrateHost', {
  platform: () => ipcRenderer.sendSync('sync', 'platform'),
  version: () => ipcRenderer.sendSync('sync', 'version'),
  insets: () => ipcRenderer.sendSync('sync', 'insets'),
  home: () => ipcRenderer.sendSync('sync', 'home'),
  folders: () => ipcRenderer.sendSync('sync', 'folders'),
  rescan: () => ipcRenderer.sendSync('sync', 'rescan'),
  stats: () => ipcRenderer.sendSync('sync', 'stats'),

  kvGet: key => ipcRenderer.sendSync('kv-get', String(key)),
  kvSet: (key, value, sync) => {
    if (sync) return ipcRenderer.sendSync('kv-set-sync', String(key), str(value));
    ipcRenderer.send('kv-set', String(key), str(value));
    return true;
  },

  countPlay: key => ipcRenderer.send('stats-count', String(key)),
  addHistory: key => ipcRenderer.send('stats-history', String(key)),
  clearStats: () => ipcRenderer.send('stats-clear'),

  setFolders: list => ipcRenderer.invoke('set-folders', Array.from(list || [], String)),
  chooseFolder: () => ipcRenderer.invoke('choose-folder'),
  reveal: id => ipcRenderer.send('reveal', Number(id)),
  setPlaying: (on, title) => ipcRenderer.send('playing', !!on, String(title || '')),

  onCommand: cb => ipcRenderer.on('cmd', (e, name) => cb(String(name))),
  onScanProgress: cb => ipcRenderer.on('scan-progress', (e, p) => cb(p)),
  onLibraryChanged: cb => ipcRenderer.on('library-changed', () => cb())
});
