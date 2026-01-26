const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlayAPI', {
  onUpdateText: (callback) => ipcRenderer.on('update-text', callback),
  onUpdateCallout: (callback) => ipcRenderer.on('update-callout', callback),
  onLoadingChanged: (callback) => ipcRenderer.on('set-loading', callback),
  sendClick: (coords) => ipcRenderer.send('overlay-click', coords),
  sendNext: () => ipcRenderer.send('overlay-next'),
  sendMouseDown: (coords) => ipcRenderer.send('overlay-mouse-down', coords),
  sendMousePosition: (coords) => ipcRenderer.send('overlay-mouse-position', coords),
  onToggleClickable: (callback) => ipcRenderer.on('toggle-clickable', callback),
  sendScreenshot: (dataUrl) => ipcRenderer.send('overlay-screenshot', dataUrl)
});
