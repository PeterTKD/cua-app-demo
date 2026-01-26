const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getDesktopSources: () => ipcRenderer.invoke('get-desktop-sources'),
  showBorderOverlay: (displayId) => ipcRenderer.invoke('show-border-overlay', displayId),
  hideBorderOverlay: () => ipcRenderer.invoke('hide-border-overlay'),
  showTextOnOverlay: (text, x, y) => ipcRenderer.invoke('show-text-on-overlay', text, x, y),
  showCallout: (payload) => ipcRenderer.invoke('show-callout', payload),
  setLoadingState: (isLoading) => ipcRenderer.invoke('set-loading-state', isLoading),
  setWidgetVisible: (isVisible) => ipcRenderer.invoke('set-widget-visible', isVisible),
  getSharedDisplayBounds: () => ipcRenderer.invoke('get-shared-display-bounds'),
  getDisplayInfo: (displayId) => ipcRenderer.invoke('get-display-info', displayId),
  getPromptText: (name) => ipcRenderer.invoke('get-prompt-text', name),
  openScreenPicker: () => ipcRenderer.invoke('open-screen-picker'),
  openHistoryWindow: (history) => ipcRenderer.invoke('open-history-window', history),
  detectElementAtPoint: (x, y) => ipcRenderer.invoke('ui-automation-detect-point', { x, y }),
  showElementHighlight: (x, y, width, height, color) => ipcRenderer.invoke('show-element-highlight', { x, y, width, height, color }),
  hideElementHighlight: () => ipcRenderer.invoke('hide-element-highlight'),
  runCuaQuestion: (payload) => ipcRenderer.invoke('cua-run', payload),
  closeApp: () => ipcRenderer.invoke('close-app'),
  onOSClick: (callback) => ipcRenderer.on('os-click', callback),
  onOSMouseDown: (callback) => ipcRenderer.on('os-mousedown', callback),
  onOSMouseUp: (callback) => ipcRenderer.on('os-mouseup', callback),
  onOSMouseMove: (callback) => ipcRenderer.on('os-mousemove', callback),
  onOSWheel: (callback) => ipcRenderer.on('os-wheel', callback),
  onOSKeyDown: (callback) => ipcRenderer.on('os-keydown', callback),
  onOverlayNext: (callback) => ipcRenderer.on('overlay-next', callback),
  onMainWindowClosing: (callback) => ipcRenderer.on('main-window-closing', callback)
});
