const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('moosUsage', {
  summary: () => ipcRenderer.invoke('moos:pi-usage', null),
  latest: sessionId => ipcRenderer.invoke('moos:pi-usage', sessionId),
});
contextBridge.exposeInMainWorld('moosTurn', (sessionId, startSeq) => ipcRenderer.invoke('moos:pi-turn', sessionId, startSeq));
contextBridge.exposeInMainWorld('moosActiveTasks', () => ipcRenderer.invoke('moos:pi-active'));
contextBridge.exposeInMainWorld('moosModelSettings', {
  list: () => ipcRenderer.invoke('moos:models:list'),
  save: input => ipcRenderer.invoke('moos:models:save', input),
  remove: id => ipcRenderer.invoke('moos:models:remove', id),
  discover: input => ipcRenderer.invoke('moos:models:discover', input),
  test: input => ipcRenderer.invoke('moos:models:test', input),
  onOpen(callback) {
    const listener = () => callback();
    ipcRenderer.on('moos:open-model-settings', listener);
    return () => ipcRenderer.removeListener('moos:open-model-settings', listener);
  },
});
contextBridge.exposeInMainWorld('moosImageGen', {
  status: () => ipcRenderer.invoke('moos:image-gen:status'),
  save: input => ipcRenderer.invoke('moos:image-gen:save', input),
  test: input => ipcRenderer.invoke('moos:image-gen:test', input),
});
contextBridge.exposeInMainWorld('moosExecutionPolicy', {
  status: () => ipcRenderer.invoke('moos:execution-policy:status'),
  save: input => ipcRenderer.invoke('moos:execution-policy:save', input),
});

let fullscreen = false;
function syncLayout() {
  const root = document.documentElement;
  if (!root) return;
  root.dataset.moosWindow = 'darwin';
  if (fullscreen) root.dataset.fullscreen = 'true';
  else delete root.dataset.fullscreen;
}

ipcRenderer.on('moos:window-fullscreen', (_event, value) => {
  fullscreen = value === true;
  syncLayout();
});
if (document.documentElement) syncLayout();
else window.addEventListener('DOMContentLoaded', syncLayout, { once: true });
