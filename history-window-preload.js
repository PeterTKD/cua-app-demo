const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('historyAPI', {
  onHistoryData: (callback) => ipcRenderer.on('set-history', callback)
});
