const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('scrcpyDesktop', {
  detectPaths: () => ipcRenderer.invoke('paths:detect'),
  setPaths: (paths) => ipcRenderer.invoke('paths:set', paths),
  listDevices: () => ipcRenderer.invoke('devices:list'),
  start: (serial) => ipcRenderer.invoke('scrcpy:start', serial),
  stop: (serial) => ipcRenderer.invoke('scrcpy:stop', serial),
  running: () => ipcRenderer.invoke('scrcpy:running'),
  selectInstallFile: () => ipcRenderer.invoke('install:select'),
  installApp: (serial, filePath) => ipcRenderer.invoke('install:app', serial, filePath),
  onInstallProgress: (cb) => ipcRenderer.on('install:progress', (_e, payload) => cb(payload)),
  onInstallDone: (cb) => ipcRenderer.on('install:done', (_e, payload) => cb(payload)),
  onLog: (cb) => ipcRenderer.on('scrcpy:log', (_e, payload) => cb(payload)),
  onExit: (cb) => ipcRenderer.on('scrcpy:exit', (_e, payload) => cb(payload)),
});
