const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('moosModels', {
  list: () => ipcRenderer.invoke('moos:models:list'),
  save: profile => ipcRenderer.invoke('moos:models:save', profile),
  test: profile => ipcRenderer.invoke('moos:models:test', profile),
});
