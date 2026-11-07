const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('moosUsage', {
  summary: () => ipcRenderer.invoke('moos:pi-usage', null),
  latest: sessionId => ipcRenderer.invoke('moos:pi-usage', sessionId),
});
contextBridge.exposeInMainWorld('moosTurn', (sessionId, startSeq) => ipcRenderer.invoke('moos:pi-turn', sessionId, startSeq));

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
