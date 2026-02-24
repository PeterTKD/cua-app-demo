const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('historyAPI', {
  onHistoryData: (callback) => ipcRenderer.on('set-history', callback),
  getModels: () => ipcRenderer.invoke('reasoner-get-models'),
  getModel: () => ipcRenderer.invoke('reasoner-get-model'),
  setModel: (modelId) => ipcRenderer.invoke('reasoner-set-model', modelId)
});
