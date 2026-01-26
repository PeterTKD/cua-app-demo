const { app, BrowserWindow, desktopCapturer, ipcMain, screen, globalShortcut } = require('electron');
const path = require('path');
const { uIOhook } = require('uiohook-napi');
const UIAutomationDetector = require('./ui-automation');
const { runCuaQuestion } = require('./cua-client');

let mainWindow;
let overlayWindow = null;
let highlightWindow = null;
let screenPickerWindow = null;
let screenPickerResolver = null;
let historyWindow = null;
let isCapturingOSClicks = false;
let currentDisplayScaleFactor = 1;
let currentDisplayPhysicalBounds = null;
let currentDisplayOriginScaleFactor = 1;
let isOverlayClickable = false;
let currentDisplayId = null;
let currentDisplayBounds = null;

// Initialize UI Automation detector
const uiAutomation = new UIAutomationDetector();

console.log('UI Automation detector initialized');

// Handle IPC request for desktop sources
ipcMain.handle('get-desktop-sources', async () => {
  const sources = await desktopCapturer.getSources({ 
    types: ['screen'],
    thumbnailSize: { width: 300, height: 200 },
    fetchWindowIcons: true
  });
  return sources;
});

ipcMain.handle('get-display-info', async (event, displayId) => {
  const displays = screen.getAllDisplays();
  const target = displays.find(d => d.id.toString() === String(displayId));
  if (!target) {
    return null;
  }
  const originScaleFactor = screen.getPrimaryDisplay().scaleFactor || 1;
  const scaleFactor = target.scaleFactor || 1;
  return {
    id: target.id,
    bounds: target.bounds,
    scaleFactor,
    virtualScaleFactor: originScaleFactor,
    size: target.size,
    physicalSize: {
      width: Math.round(target.size.width * scaleFactor),
      height: Math.round(target.size.height * scaleFactor)
    }
  };
});

ipcMain.handle('open-screen-picker', async () => {
  if (screenPickerWindow && !screenPickerWindow.isDestroyed()) {
    screenPickerWindow.focus();
    return new Promise((resolve) => {
      screenPickerResolver = resolve;
    });
  }

  return new Promise((resolve) => {
    screenPickerResolver = resolve;

    screenPickerWindow = new BrowserWindow({
      width: 720,
      height: 520,
      parent: mainWindow,
      modal: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      webPreferences: {
        preload: path.join(__dirname, 'screen-picker-preload.js'),
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    screenPickerWindow.loadFile('screen-picker.html');

    screenPickerWindow.on('closed', () => {
      screenPickerWindow = null;
      if (screenPickerResolver) {
        screenPickerResolver(null);
        screenPickerResolver = null;
      }
    });
  });
});

ipcMain.on('screen-picker-selected', (event, payload) => {
  if (screenPickerResolver) {
    screenPickerResolver(payload);
    screenPickerResolver = null;
  }
  if (screenPickerWindow) {
    screenPickerWindow.close();
  }
});

ipcMain.on('screen-picker-cancel', () => {
  if (screenPickerResolver) {
    screenPickerResolver(null);
    screenPickerResolver = null;
  }
  if (screenPickerWindow) {
    screenPickerWindow.close();
  }
});

ipcMain.handle('open-history-window', async (event, history) => {
  if (historyWindow && !historyWindow.isDestroyed()) {
    historyWindow.focus();
    historyWindow.webContents.send('set-history', history || []);
    return true;
  }

  historyWindow = new BrowserWindow({
    width: 520,
    height: 600,
    parent: mainWindow,
    resizable: true,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'history-window-preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  historyWindow.loadFile('history-window.html');

  historyWindow.webContents.once('did-finish-load', () => {
    historyWindow.webContents.send('set-history', history || []);
  });

  historyWindow.on('closed', () => {
    historyWindow = null;
  });

  return true;
});

// Handle IPC request to show border overlay
ipcMain.handle('show-border-overlay', async (event, displayId) => {
  const displays = screen.getAllDisplays();
  const targetDisplay = displays.find(d => d.id.toString() === displayId) || displays[0];
  
  currentDisplayId = displayId; // Store current display ID
  currentDisplayBounds = targetDisplay.bounds; // Store display bounds for coordinate calculation
  currentDisplayScaleFactor = targetDisplay.scaleFactor || 1;
  currentDisplayOriginScaleFactor = screen.getPrimaryDisplay().scaleFactor || 1;
  currentDisplayPhysicalBounds = {
    x: Math.round(targetDisplay.bounds.x * currentDisplayOriginScaleFactor),
    y: Math.round(targetDisplay.bounds.y * currentDisplayOriginScaleFactor),
    width: targetDisplay.bounds.width * currentDisplayScaleFactor,
    height: targetDisplay.bounds.height * currentDisplayScaleFactor
  };
  
  if (overlayWindow) {
    overlayWindow.close();
  }

  overlayWindow = new BrowserWindow({
    x: targetDisplay.bounds.x,
    y: targetDisplay.bounds.y,
    width: targetDisplay.bounds.width,
    height: targetDisplay.bounds.height,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    focusable: false,
    webPreferences: {
      preload: path.join(__dirname, 'overlay-preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  overlayWindow.loadFile('overlay.html');
  
  return true;
});

// Handle IPC request to hide border overlay
ipcMain.handle('hide-border-overlay', async () => {
  if (overlayWindow) {
    overlayWindow.destroy();
    overlayWindow = null;
  }
  return true;
});

// Handle IPC request to show text on overlay
ipcMain.handle('show-text-on-overlay', async (event, text, x, y) => {
  if (overlayWindow) {
    overlayWindow.webContents.send('update-text', { text, x, y });
    return true;
  }
  return false;
});

ipcMain.handle('show-callout', async (event, payload) => {
  if (!overlayWindow) {
    return false;
  }
  overlayWindow.webContents.send('update-callout', payload);
  if (payload && payload.showNext) {
    overlayWindow.setIgnoreMouseEvents(false);
  } else {
    overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  }
  return true;
});

// Handle loading indicator toggle for overlay glow
ipcMain.handle('set-loading-state', async (event, isLoading) => {
  if (overlayWindow) {
    overlayWindow.webContents.send('set-loading', Boolean(isLoading));
    return true;
  }
  return false;
});

ipcMain.handle('set-widget-visible', async (event, isVisible) => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return false;
  }
  if (isVisible) {
    mainWindow.show();
  } else {
    mainWindow.hide();
  }
  return true;
});

ipcMain.handle('close-app', async () => {
  app.quit();
  return true;
});

// Handle click coordinates from overlay
ipcMain.on('overlay-click', (event, coords) => {
  if (mainWindow) {
    mainWindow.webContents.send('overlay-clicked', coords);
  }
});

ipcMain.on('overlay-next', () => {
  if (mainWindow) {
    mainWindow.webContents.send('overlay-next');
  }
});

// Handle mouse down from overlay
ipcMain.on('overlay-mouse-down', (event, coords) => {
  if (mainWindow) {
    mainWindow.webContents.send('overlay-mouse-down', coords);
  }
});

// Handle mouse move
ipcMain.on('overlay-mouse-position', (event, coords) => {
  if (mainWindow) {
    mainWindow.webContents.send('overlay-mouse-moved', coords);
  }
});

// Handle screenshot from overlay
ipcMain.on('overlay-screenshot', (event, dataUrl) => {
  if (mainWindow) {
    mainWindow.webContents.send('show-screenshot', dataUrl);
  }
});

// OS-level click capture for completion checks.
function setupOSClickCapture() {
  if (isCapturingOSClicks) return;

  uIOhook.on('click', (event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('os-click', {
        absoluteX: event.x,
        absoluteY: event.y
      });
    }
  });

  uIOhook.on('mousedown', (event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('os-mousedown', {
        absoluteX: event.x,
        absoluteY: event.y,
        button: event.button
      });
    }
  });

  uIOhook.on('mouseup', (event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('os-mouseup', {
        absoluteX: event.x,
        absoluteY: event.y,
        button: event.button
      });
    }
  });

  uIOhook.on('mousemove', (event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('os-mousemove', {
        absoluteX: event.x,
        absoluteY: event.y
      });
    }
  });

  uIOhook.on('wheel', (event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('os-wheel', {
        amount: event.amount,
        rotation: event.rotation
      });
    }
  });

  uIOhook.on('keydown', (event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('os-keydown', {
        keycode: event.keycode,
        rawcode: event.rawcode,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        shiftKey: event.shiftKey,
        metaKey: event.metaKey
      });
    }
  });

  uIOhook.start();
  isCapturingOSClicks = true;
}

function stopOSClickCapture() {
  if (!isCapturingOSClicks) return;
  uIOhook.stop();
  isCapturingOSClicks = false;
}

// Toggle overlay clickability
async function toggleOverlayClickable() {
  if (!overlayWindow) return;
  
  isOverlayClickable = !isOverlayClickable;
  
  if (isOverlayClickable) {
    // Make overlay clickable - disable mouse event forwarding
    overlayWindow.setIgnoreMouseEvents(false);
    // Send message to overlay to change appearance
    overlayWindow.webContents.send('toggle-clickable', true);
  } else {
    // Make overlay transparent to mouse - enable forwarding
    // First, capture screenshot of the screen with drawings
    try {
      // Hide the overlay temporarily to avoid capturing it
      overlayWindow.hide();
      
      // Wait a bit for the overlay to be hidden
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Find the screen source for the current display
      const sources = await desktopCapturer.getSources({ 
        types: ['screen'],
        thumbnailSize: { width: 1920, height: 1080 },
        fetchWindowIcons: true
      });
      
      // Find the source matching current display
      const source = sources.find(s => s.display_id === currentDisplayId) || sources[0];
      
      if (source) {
        // Send screen capture and drawing data to overlay
        await overlayWindow.webContents.executeJavaScript(`window.captureCompositeScreenshot('${source.id}')`);
      }
      
      // Show the overlay again
      overlayWindow.show();
    } catch (err) {
      console.error('Error capturing screenshot:', err);
      if (overlayWindow) {
        overlayWindow.show();
      }
    }
    
    overlayWindow.setIgnoreMouseEvents(true, { forward: true });
    overlayWindow.webContents.send('toggle-clickable', false);
  }
  
  // Notify main window about the state
  if (mainWindow) {
    mainWindow.webContents.send('overlay-clickable-changed', isOverlayClickable);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 760,
    height: 180,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // Enable screen sharing
  mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media') {
      callback(true);
    } else {
      callback(false);
    }
  });

  mainWindow.loadFile('index.html');

  // Uncomment to open DevTools
  // mainWindow.webContents.openDevTools();

  mainWindow.on('close', function (e) {
    // Notify renderer to clean up streams
    mainWindow.webContents.send('main-window-closing');
  });

  mainWindow.on('closed', function () {
    // Close overlay window if it exists
    if (overlayWindow) {
      overlayWindow.destroy();
      overlayWindow = null;
    }
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();
  
  setupOSClickCapture();


  // Register global shortcut for toggling overlay clickability
  const ret = globalShortcut.register('CommandOrControl+Alt+D', () => {
    toggleOverlayClickable();
  });

  if (!ret) {
    console.log('Registration failed');
  }

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  // Unregister all shortcuts
  globalShortcut.unregisterAll();
  stopOSClickCapture();
});

app.on('before-quit', () => {
  // Ensure overlay is closed before quitting
  if (overlayWindow) {
    overlayWindow.destroy();
    overlayWindow = null;
  }
  
});

// UI Automation IPC handlers
ipcMain.handle('ui-automation-detect-point', async (event, { x, y }) => {
  try {
    const element = await uiAutomation.getElementAtPoint(x, y);
    return element;
  } catch (error) {
    console.error('UI Automation error:', error);
    throw error;
  }
});

// Computer Use (CUA) handler
ipcMain.handle('cua-run', async (event, payload) => {
  try {
    const response = await runCuaQuestion(payload);
    return response;
  } catch (error) {
    console.error('CUA error:', error);
    throw error;
  }
});

// Get current shared display bounds
ipcMain.handle('get-shared-display-bounds', async () => {
  return currentDisplayBounds
    ? {
        bounds: currentDisplayBounds,
        scaleFactor: currentDisplayScaleFactor,
        physicalBounds: currentDisplayPhysicalBounds,
        virtualScaleFactor: currentDisplayOriginScaleFactor
      }
    : null;
});

// Show element highlight
ipcMain.handle('show-element-highlight', async (event, { x, y, width, height, color }) => {
  try {
    // Close existing highlight window
    if (highlightWindow) {
      highlightWindow.close();
      highlightWindow = null;
    }

    // Add padding around the element (5px on each side)
    const padding = 5;
    const scaleFactor = currentDisplayScaleFactor || 1;
    const physicalBounds = currentDisplayPhysicalBounds || { x: 0, y: 0 };
    const dipOriginX = currentDisplayBounds ? currentDisplayBounds.x : 0;
    const dipOriginY = currentDisplayBounds ? currentDisplayBounds.y : 0;

    const dipX = (x - physicalBounds.x) / scaleFactor + dipOriginX;
    const dipY = (y - physicalBounds.y) / scaleFactor + dipOriginY;
    const highlightX = Math.round(dipX - padding);
    const highlightY = Math.round(dipY - padding);
    const highlightWidth = Math.round(width / scaleFactor + padding * 2);
    const highlightHeight = Math.round(height / scaleFactor + padding * 2);
    
    // Use custom color or default red
    const borderColor = color || '#f44336';

    // Create a transparent window to show the red box
    highlightWindow = new BrowserWindow({
      x: highlightX,
      y: highlightY,
      width: highlightWidth,
      height: highlightHeight,
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      focusable: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    highlightWindow.setIgnoreMouseEvents(true, { forward: true });
    
    // Load HTML with colored border
    highlightWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body {
              margin: 0;
              padding: 0;
              width: 100vw;
              height: 100vh;
              border: 3px solid ${borderColor};
              box-sizing: border-box;
              background: ${borderColor}19;
            }
          </style>
        </head>
        <body></body>
      </html>
    `)}`);

    return true;
  } catch (error) {
    console.error('Error showing highlight:', error);
    return false;
  }
});

// Hide element highlight
ipcMain.handle('hide-element-highlight', async () => {
  if (highlightWindow) {
    highlightWindow.close();
    highlightWindow = null;
  }
  return true;
});


