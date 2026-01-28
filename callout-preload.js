const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('calloutAPI', {
  onUpdateCallout: (callback) => ipcRenderer.on('update-callout', callback),
  sendNext: () => ipcRenderer.send('overlay-next'),
  sendComplete: () => ipcRenderer.send('callout-complete'),
  sendResize: (size) => ipcRenderer.send('callout-resize', size)
});
