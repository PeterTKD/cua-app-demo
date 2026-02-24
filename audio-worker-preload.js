const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('audioWorkerAPI', {
  onStartCapture: (cb) => ipcRenderer.on('audio-worker-start', () => cb()),
  onStopCapture: (cb) => ipcRenderer.on('audio-worker-stop', () => cb()),
  sendReady: () => ipcRenderer.send('audio-worker-ready'),
  sendError: (msg) => ipcRenderer.send('audio-worker-error', msg),
  sendData: (wavBase64) => ipcRenderer.send('audio-worker-data', wavBase64),
});
