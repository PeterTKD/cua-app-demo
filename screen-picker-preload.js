const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pickerAPI', {
  getDesktopSources: () => ipcRenderer.invoke('get-desktop-sources'),
  selectSource: (payload) => ipcRenderer.send('screen-picker-selected', payload),
  cancel: () => ipcRenderer.send('screen-picker-cancel')
});
