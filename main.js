const { app, BrowserWindow, desktopCapturer, ipcMain, screen, globalShortcut, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');

const { uIOhook } = require('uiohook-napi');
let UIAutomationDetector;
let uiAutomationBackend = 'edge';
const capturedFrameCache = new Map();
try {
  UIAutomationDetector = require('./ui-automation-edge');
} catch (error) {
  uiAutomationBackend = 'powershell';
  console.warn('Falling back to legacy UI Automation backend:', error.message);
  UIAutomationDetector = require('./ui-automation');
}
const { runCuaQuestion } = require('./cua-client');
const { runCua54Question } = require('./cua_5.4');
const { runReasonerQuestion, getAvailableModels, getCurrentModel, setCurrentModel } = require('./reasoner-client');
const { runTreeLocator } = require('./tree-locator-client');
const { synthesizeSpeech } = require('./tts-client');
const { transcribeAudio } = require('./stt-api');
const { pruneUITree } = require('./tree-utils');

let portAudio = null;
try {
  // Stub segfault-handler BEFORE loading naudiodon.
  // segfault-handler installs a VEH that calls _exit(1) on ANY native exception —
  // including benign ones from PortAudio/MME cleanup — killing the whole process.
  const Module = require('module');
  const _origLoad = Module._load.bind(Module);
  Module._load = function (request, parent, isMain) {
    if (request === 'segfault-handler') return { registerHandler: () => {} };
    return _origLoad(request, parent, isMain);
  };
  portAudio = require('naudiodon');
  Module._load = _origLoad; // restore after naudiodon is loaded
} catch (e) {
  console.warn('[Audio] naudiodon not available:', e.message);
}

let mainWindow;
let overlayWindow = null;
let highlightWindow = null;
let calloutWindow = null;
let screenPickerWindow = null;
let screenPickerResolver = null;
let historyWindow = null;
let audioCapture = null;
let audioCaptureChunks = [];
let isCapturingOSClicks = false;
let currentDisplayScaleFactor = 1;
let currentDisplayPhysicalBounds = null;
let currentDisplayOriginScaleFactor = 1;
let isOverlayClickable = false;
let currentDisplayId = null;
let currentDisplayBounds = null;
const pendingTreePrefetches = new Map();
const captureExcludedWindows = new WeakSet();
const PROMPTS_DIR = process.env.CUA_PROMPTS_DIR || path.join(__dirname, 'prompts');
const PROMPT_VERSION = process.env.CUA_PROMPT_VERSION || null;

function safeSendToMain(channel, payload) {
  if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.webContents || mainWindow.webContents.isDestroyed()) {
    return false;
  }
  if (typeof mainWindow.webContents.isCrashed === 'function' && mainWindow.webContents.isCrashed()) {
    return false;
  }
  let frame = null;
  try {
    frame = mainWindow.webContents.mainFrame || null;
  } catch (_) {
    return false;
  }
  if (!frame) {
    return false;
  }
  try {
    if (typeof frame.isDestroyed === 'function' && frame.isDestroyed()) {
      return false;
    }
  } catch (_) {
    return false;
  }
  try {
    mainWindow.webContents.send(channel, payload);
    return true;
  } catch (_) {
    return false;
  }
}

function promoteWidgetWindow(win, { visibleOnAllWorkspaces = true } = {}) {
  if (!win || win.isDestroyed()) {
    return;
  }

  try {
    win.setAlwaysOnTop(true, 'screen-saver');
  } catch (_) {
    win.setAlwaysOnTop(true);
  }

  if (visibleOnAllWorkspaces && typeof win.setVisibleOnAllWorkspaces === 'function') {
    try {
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    } catch (_) {
      // Best-effort only. Some platforms/window types may not support this.
    }
  }

  if (typeof win.setFullScreenable === 'function') {
    try {
      win.setFullScreenable(false);
    } catch (_) {
      // Ignore unsupported window types.
    }
  }

  if (typeof win.moveTop === 'function') {
    try {
      win.moveTop();
    } catch (_) {
      // Ignore if the platform does not expose z-order changes.
    }
  }
}

function promoteMainWindow({ force = false } = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  if (typeof mainWindow.isVisible === 'function' && !mainWindow.isVisible()) {
    return;
  }

  const focusedWindow = BrowserWindow.getFocusedWindow();
  if (!force && focusedWindow && focusedWindow !== mainWindow) {
    return;
  }

  promoteWidgetWindow(mainWindow);
}

async function applyWindowCaptureExclusion(win, label = 'Window') {
  if (!win || win.isDestroyed() || typeof uiAutomation?.setWindowExcludeFromCapture !== 'function') {
    return false;
  }
  try {
    const hwndBuffer = win.getNativeWindowHandle();
    const hwnd = Number(hwndBuffer.readBigInt64LE ? hwndBuffer.readBigInt64LE(0) : hwndBuffer.readInt32LE(0));
    await uiAutomation.setWindowExcludeFromCapture(hwnd);
    captureExcludedWindows.add(win);
    console.log(`[${label}] SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE) applied, hwnd:`, hwnd);
    return true;
  } catch (error) {
    captureExcludedWindows.delete(win);
    console.warn(`[${label}] Could not set WDA_EXCLUDEFROMCAPTURE:`, error.message);
    return false;
  }
}

function isWindowCaptureExcluded(win) {
  return Boolean(win) && captureExcludedWindows.has(win);
}

function getScaleFactorSafe(display) {
  return display?.scaleFactor || 1;
}

function dipToScreenPointSafe(point, scaleFactor = 1) {
  if (screen && typeof screen.dipToScreenPoint === 'function') {
    return screen.dipToScreenPoint(point);
  }
  return {
    x: Math.round(point.x * scaleFactor),
    y: Math.round(point.y * scaleFactor)
  };
}

function screenToDipPointSafe(point, scaleFactor = 1) {
  if (screen && typeof screen.screenToDipPoint === 'function') {
    return screen.screenToDipPoint(point);
  }
  return {
    x: Math.round(point.x / scaleFactor),
    y: Math.round(point.y / scaleFactor)
  };
}

function computePhysicalBoundsFromDip(dipBounds, scaleFactor = 1) {
  if (screen && typeof screen.dipToScreenRect === 'function') {
    const rect = screen.dipToScreenRect(null, dipBounds);
    if (rect?.width > 0 && rect?.height > 0) {
      return rect;
    }
  }

  const topLeft = dipToScreenPointSafe({ x: dipBounds.x, y: dipBounds.y }, scaleFactor);
  return {
    x: topLeft.x,
    y: topLeft.y,
    width: Math.max(1, Math.round(dipBounds.width * scaleFactor)),
    height: Math.max(1, Math.round(dipBounds.height * scaleFactor))
  };
}

function resolvePromptFile(name) {
  if (name === 'system' && process.env.CUA_PROMPT_PATH) {
    return process.env.CUA_PROMPT_PATH;
  }
  let version = PROMPT_VERSION;
  if (!version) {
    const currentPath = path.join(PROMPTS_DIR, 'current.txt');
    if (fs.existsSync(currentPath)) {
      version = fs.readFileSync(currentPath, 'utf8').trim();
    }
  }
  if (!version) {
    throw new Error('Missing prompt version. Set CUA_PROMPT_PATH or prompts/current.txt.');
  }
  const fileName = name === 'followup'
    ? 'followup.txt'
    : name === 'diff_method'
      ? 'diff_method.txt'
      : name === 'point'
        ? 'point.txt'
        : 'system.txt';
  return path.join(PROMPTS_DIR, version, fileName);
}

function encodeWavBuffer(pcmBuffer, sampleRate) {
  const numChannels = 1;
  const bitsPerSample = 16;
  const dataSize = pcmBuffer.length;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * numChannels * bitsPerSample / 8, 28);
  header.writeUInt16LE(numChannels * bitsPerSample / 8, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcmBuffer]);
}

// Initialize UI Automation detector
const uiAutomation = new UIAutomationDetector();

console.log(`UI Automation detector initialized (${uiAutomationBackend})`);

async function resolveActiveProcessIdForTree() {
  const selectedBounds = currentDisplayPhysicalBounds || currentDisplayBounds;
  if (!selectedBounds) {
    return null;
  }

  try {
    const foregroundWindow = await uiAutomation.getForegroundWindow(
      selectedBounds,
      process.pid
    );
    if (foregroundWindow?.ProcessId && foregroundWindow.ProcessId !== process.pid) {
      return Number(foregroundWindow.ProcessId);
    }
  } catch (error) {
    console.warn('Unable to read foreground window for tree locator:', error.message);
  }

  const isRectOnSelectedDisplay = (rect) => {
    if (!rect) return false;
    const x = Number(rect.X ?? rect.x ?? 0);
    const y = Number(rect.Y ?? rect.y ?? 0);
    const width = Number(rect.Width ?? rect.width ?? 0);
    const height = Number(rect.Height ?? rect.height ?? 0);
    return x + width > selectedBounds.x
      && y + height > selectedBounds.y
      && x < selectedBounds.x + selectedBounds.width
      && y < selectedBounds.y + selectedBounds.height;
  };

  try {
    const focused = await uiAutomation.getFocusedElement();
    if (focused?.ProcessId && focused.ProcessId !== process.pid && isRectOnSelectedDisplay(focused.BoundingRect)) {
      return Number(focused.ProcessId);
    }
  } catch (error) {
    console.warn('Unable to read focused element for tree locator:', error.message);
  }

  try {
    const cursorPoint = screen.getCursorScreenPoint();
    const cursorOnSelectedDisplay = cursorPoint
      && cursorPoint.x >= selectedBounds.x
      && cursorPoint.y >= selectedBounds.y
      && cursorPoint.x < selectedBounds.x + selectedBounds.width
      && cursorPoint.y < selectedBounds.y + selectedBounds.height;
    if (cursorOnSelectedDisplay) {
      const elementAtCursor = await uiAutomation.getElementAtPoint(cursorPoint.x, cursorPoint.y);
      if (elementAtCursor?.ProcessId && elementAtCursor.ProcessId !== process.pid) {
        return Number(elementAtCursor.ProcessId);
      }
    }
  } catch (error) {
    console.warn('Unable to read cursor element for tree locator:', error.message);
  }

  return null;
}

function countPrunedTreeNodes(nodes) {
  if (!Array.isArray(nodes)) {
    return 0;
  }
  return nodes.reduce((total, node) => total + 1 + countPrunedTreeNodes(node?.h), 0);
}

async function loadPrunedTreeForProcess(processId) {
  const numericProcessId = Number(processId);
  if (!Number.isFinite(numericProcessId) || numericProcessId <= 0 || numericProcessId === process.pid) {
    return null;
  }

  const rawTree = await uiAutomation.getWindowElements(
    numericProcessId,
    currentDisplayPhysicalBounds || currentDisplayBounds || null
  );
  console.log(`[TreeDebug] rawTree type=${Array.isArray(rawTree) ? 'array' : typeof rawTree}, length=${Array.isArray(rawTree) ? rawTree.length : 'N/A'}`);
  const prunedTree = pruneUITree(rawTree);
  const nodeCount = countPrunedTreeNodes(prunedTree);
  console.log(`[TreeDebug] prunedTree length=${Array.isArray(prunedTree) ? prunedTree.length : 'N/A'}, nodeCount=${nodeCount}`);
  if (!Array.isArray(prunedTree) || prunedTree.length === 0 || nodeCount === 0) {
    return null;
  }

  return {
    processId: numericProcessId,
    processIds: [numericProcessId],
    nodeCount,
    tree: prunedTree
  };
}

async function resolveTreeForSelectedDisplay() {
  const preferredProcessId = await resolveActiveProcessIdForTree();
  if (preferredProcessId) {
    try {
      const preferredTree = await loadPrunedTreeForProcess(preferredProcessId);
      if (preferredTree) {
        return { ...preferredTree, source: 'preferred-process' };
      }
    } catch (error) {
      console.warn(`Unable to load preferred process tree for ${preferredProcessId}:`, error.message);
    }
  }
  return null;
}

function startTreePrefetch() {
  const prefetchId = randomUUID();
  const startedAt = Date.now();
  const promise = (async () => {
    try {
      const resolvedTree = await resolveTreeForSelectedDisplay();
      return {
        resolvedTree,
        treeResolveDurationMs: Date.now() - startedAt
      };
    } catch (error) {
      console.warn('Background tree prefetch failed:', error.message);
      return {
        resolvedTree: null,
        treeResolveDurationMs: Date.now() - startedAt
      };
    }
  })();

  pendingTreePrefetches.set(prefetchId, {
    promise,
    createdAt: Date.now()
  });

  promise.finally(() => {
    setTimeout(() => {
      const entry = pendingTreePrefetches.get(prefetchId);
      if (entry?.promise === promise) {
        pendingTreePrefetches.delete(prefetchId);
      }
    }, 10000);
  });

  return prefetchId;
}

async function resolveTreeFromPrefetch(prefetchId) {
  if (!prefetchId) {
    return null;
  }
  const entry = pendingTreePrefetches.get(String(prefetchId));
  if (!entry?.promise) {
    return null;
  }
  return entry.promise;
}

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
  const originScaleFactor = getScaleFactorSafe(screen.getPrimaryDisplay());
  const scaleFactor = getScaleFactorSafe(target);
  const physicalBounds = computePhysicalBoundsFromDip(target.bounds, scaleFactor);
  return {
    id: target.id,
    bounds: target.bounds,
    scaleFactor,
    virtualScaleFactor: originScaleFactor,
    size: target.size,
    physicalSize: {
      width: physicalBounds.width,
      height: physicalBounds.height
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

  const parentBounds = mainWindow && !mainWindow.isDestroyed()
    ? mainWindow.getBounds()
    : screen.getPrimaryDisplay().bounds;
  const targetDisplay = screen.getDisplayMatching(parentBounds);
  const workAreaWidth = targetDisplay?.workAreaSize?.width || targetDisplay?.bounds?.width || 1280;
  const workAreaHeight = targetDisplay?.workAreaSize?.height || targetDisplay?.bounds?.height || 900;
  const historyWindowWidth = Math.max(720, Math.min(960, Math.round(workAreaWidth * 0.55)));
  const historyWindowHeight = Math.max(520, Math.min(760, Math.round(workAreaHeight * 0.65)));

  historyWindow = new BrowserWindow({
    width: historyWindowWidth,
    height: historyWindowHeight,
    parent: mainWindow,
    resizable: true,
    minimizable: false,
    maximizable: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'history-window-preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });
  historyWindow.setMinimumSize(720, 420);

  historyWindow.loadFile('history-window.html');

  historyWindow.webContents.once('did-finish-load', () => {
    historyWindow.webContents.send('set-history', history || []);
  });

  historyWindow.on('closed', () => {
    historyWindow = null;
  });

  return true;
});

ipcMain.handle('get-prompt-text', async (event, name) => {
  const allowed = new Set(['system', 'followup', 'diff_method', 'point']);
  if (!allowed.has(name)) {
    throw new Error('Unknown prompt name.');
  }
  const promptPath = resolvePromptFile(name);
  if (!fs.existsSync(promptPath)) {
    throw new Error(`Prompt file not found: ${promptPath}`);
  }
  return fs.readFileSync(promptPath, 'utf8');
});

// Handle IPC request to show border overlay
ipcMain.handle('show-border-overlay', async (event, displayId) => {
  const displays = screen.getAllDisplays();
  const targetDisplay = displays.find(d => d.id.toString() === displayId) || displays[0];
  const overlayBounds = {
    x: targetDisplay.bounds.x,
    y: targetDisplay.bounds.y,
    width: targetDisplay.bounds.width,
    height: targetDisplay.bounds.height
  };
  
  currentDisplayId = displayId; // Store current display ID
  currentDisplayBounds = targetDisplay.bounds; // Store display bounds for coordinate calculation
  currentDisplayScaleFactor = getScaleFactorSafe(targetDisplay);
  currentDisplayOriginScaleFactor = getScaleFactorSafe(screen.getPrimaryDisplay());
  currentDisplayPhysicalBounds = computePhysicalBoundsFromDip(targetDisplay.bounds, currentDisplayScaleFactor);
  
  if (overlayWindow) {
    overlayWindow.close();
  }

  overlayWindow = new BrowserWindow({
    ...overlayBounds,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    focusable: false,
    fullscreenable: false,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'overlay-preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });
  await applyWindowCaptureExclusion(overlayWindow, 'Overlay');

  promoteWidgetWindow(overlayWindow);
  overlayWindow.setBounds(overlayBounds, false);
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  overlayWindow.once('ready-to-show', () => {
    if (!overlayWindow || overlayWindow.isDestroyed()) {
      return;
    }
    promoteWidgetWindow(overlayWindow);
    overlayWindow.setBounds(overlayBounds, false);
    overlayWindow.showInactive();
  });
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
  overlayWindow.webContents.send('update-callout', { ...payload, hideCallout: true });
  const hasText = payload && (payload.heading || payload.body);
  if (hasText && (!calloutWindow || calloutWindow.isDestroyed())) {
    calloutWindow = new BrowserWindow({
      width: 460,
      height: 180,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: true,
      focusable: true,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'callout-preload.js'),
        nodeIntegration: false,
        contextIsolation: true
      }
    });
    await applyWindowCaptureExclusion(calloutWindow, 'Callout');
    promoteWidgetWindow(calloutWindow);
    calloutWindow.loadFile('callout-window.html');
    calloutWindow.on('closed', () => {
      calloutWindow = null;
    });
  }
  if (hasText) {
    const displayBounds = currentDisplayBounds || { x: 0, y: 0, width: 1920, height: 1080 };
    const baseX = displayBounds.x || 0;
    const baseY = displayBounds.y || 0;
    const startX = typeof payload.x === 'number' && payload.x >= 0 ? payload.x : Math.round(displayBounds.width * 0.5);
    const startY = typeof payload.y === 'number' && payload.y >= 0 ? payload.y : Math.round(displayBounds.height * 0.35);
    const windowWidth = calloutWindow.getBounds().width || 460;
    const windowHeight = calloutWindow.getBounds().height || 180;
    const maxX = baseX + displayBounds.width - windowWidth - 12;
    const maxY = baseY + displayBounds.height - windowHeight - 12;

    let targetX = startX;
    let targetY = startY;

    // For drag actions, position the callout away from both start and end points
    const hasEndPoint = typeof payload.endX === 'number' && payload.endX >= 0
      && typeof payload.endY === 'number' && payload.endY >= 0;
    if (hasEndPoint) {
      const endX = payload.endX;
      const endY = payload.endY;
      const midX = Math.round((startX + endX) / 2);
      const midY = Math.round((startY + endY) / 2);
      // Place callout above or below the drag midpoint, whichever has more room
      const spaceAbove = midY;
      const spaceBelow = displayBounds.height - midY;
      if (spaceAbove > spaceBelow) {
        targetX = midX;
        targetY = Math.max(0, Math.min(startY, endY) - windowHeight - 30);
      } else {
        targetX = midX;
        targetY = Math.max(startY, endY) + 30;
      }
    }

    const x = Math.max(baseX + 12, Math.min(maxX, baseX + targetX + 18));
    const y = Math.max(baseY + 12, Math.min(maxY, baseY + targetY + 18));
    calloutWindow.setPosition(Math.round(x), Math.round(y), false);
    promoteWidgetWindow(calloutWindow);
    calloutWindow.show();
  } else if (calloutWindow && !calloutWindow.isDestroyed()) {
    calloutWindow.hide();
  }
  if (calloutWindow && !calloutWindow.isDestroyed()) {
    calloutWindow.webContents.send('update-callout', payload);
  }
  const allowClickThrough = payload?.allowClickThrough !== false;
  if (allowClickThrough) {
    isOverlayClickable = false;
    overlayWindow.webContents.send('toggle-clickable', false);
    overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  } else {
    overlayWindow.setIgnoreMouseEvents(false);
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
    promoteMainWindow({ force: true });
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

ipcMain.on('callout-complete', () => {
  if (mainWindow) {
    mainWindow.webContents.send('callout-complete');
  }
  if (calloutWindow && !calloutWindow.isDestroyed()) {
    calloutWindow.hide();
  }
});

ipcMain.on('callout-resize', (event, size) => {
  if (!calloutWindow || calloutWindow.isDestroyed() || !size) {
    return;
  }
  const displayHeight = currentDisplayBounds?.height || screen.getPrimaryDisplay().workAreaSize.height || 1080;
  const maxHeight = Math.max(160, Math.round(displayHeight * 0.4));
  const width = Math.max(320, Math.min(560, Math.round(size.width || 420)));
  const height = Math.max(120, Math.min(maxHeight, Math.round(size.height || 180)));
  calloutWindow.setSize(width, height, false);
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
    safeSendToMain('os-click', {
      absoluteX: event.x,
      absoluteY: event.y
    });
  });

  uIOhook.on('mousedown', (event) => {
    safeSendToMain('os-mousedown', {
      absoluteX: event.x,
      absoluteY: event.y,
      button: event.button
    });
  });

  uIOhook.on('mouseup', (event) => {
    safeSendToMain('os-mouseup', {
      absoluteX: event.x,
      absoluteY: event.y,
      button: event.button
    });
  });

  uIOhook.on('mousemove', (event) => {
    safeSendToMain('os-mousemove', {
      absoluteX: event.x,
      absoluteY: event.y
    });
  });

  uIOhook.on('wheel', (event) => {
    safeSendToMain('os-wheel', {
      amount: event.amount,
      rotation: event.rotation
    });
  });

  uIOhook.on('keydown', (event) => {
    safeSendToMain('os-keydown', {
      keycode: event.keycode,
      rawcode: event.rawcode,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      shiftKey: event.shiftKey,
      metaKey: event.metaKey
    });
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
    const shouldHideOverlayForCapture = !isWindowCaptureExcluded(overlayWindow);
    try {
      if (shouldHideOverlayForCapture) {
        // Fallback for environments where capture exclusion is unavailable.
        overlayWindow.hide();
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
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
      
      if (shouldHideOverlayForCapture && overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.showInactive();
      }
    } catch (err) {
      console.error('Error capturing screenshot:', err);
      if (shouldHideOverlayForCapture && overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.showInactive();
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
    width: 680,
    height: 220,
    icon: path.join(__dirname, 'Icon.png'),
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
  void applyWindowCaptureExclusion(mainWindow, 'Main');
  promoteMainWindow({ force: true });

  // Enable screen sharing and microphone access
  mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media' || permission === 'microphone') {
      callback(true);
    } else {
      callback(false);
    }
  });

  mainWindow.loadFile('index.html');

  mainWindow.webContents.on('did-finish-load', () => {
    setupOSClickCapture();

  });

  mainWindow.webContents.on('render-process-gone', (event, details) => {
    console.error('[CRASH] Renderer process gone:', details.reason, details.exitCode);
    stopOSClickCapture();
    // Reload renderer so the window doesn't go blank
    mainWindow.webContents.reload();
  });

  mainWindow.on('close', function (e) {
    // Notify renderer to clean up streams
    safeSendToMain('main-window-closing');
  });

  mainWindow.on('show', () => {
    promoteMainWindow({ force: true });
  });

  mainWindow.on('focus', () => {
    promoteMainWindow({ force: true });
  });

  mainWindow.on('blur', () => {
    setTimeout(() => {
      promoteMainWindow();
    }, 120);
  });

  mainWindow.on('closed', function () {
    stopOSClickCapture();
    // Close overlay window if it exists
    if (overlayWindow) {
      overlayWindow.destroy();
      overlayWindow = null;
    }
    if (calloutWindow) {
      calloutWindow.destroy();
      calloutWindow = null;
    }
    mainWindow = null;
  });
}

// Disable Windows.Graphics.Capture API so Chromium uses DXGI duplication instead.
// This removes the green recording-indicator border Windows adds around the captured display.
// Both WgcScreenCapturer (full display) and WgcWindowCapturer (individual windows) must be
// disabled together, otherwise WGC is still used for screen-type sources in newer Chromium.
app.commandLine.appendSwitch('disable-features', 'WgcScreenCapturer,WgcWindowCapturer');

app.whenReady().then(() => {
  createWindow();


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
  pendingTreePrefetches.clear();
});

ipcMain.handle('resize-widget', async (event, size) => {
  if (!mainWindow || mainWindow.isDestroyed() || !size) {
    return false;
  }
  const minWidth = 160;
  const minHeight = 100;

  const width = Math.max(minWidth, Math.round(size.width || 0));
  const height = Math.max(minHeight, Math.round(size.height || 0));
  const display = screen.getDisplayMatching(mainWindow.getBounds());
  const maxWidth = Math.max(minWidth, display.workArea.width - 8);
  const maxHeight = Math.max(
    minHeight,
    Math.min(display.workArea.height - 8, Math.round(display.workArea.height * 0.4))
  );
  const nextWidth = Math.min(width, maxWidth);
  const nextHeight = Math.min(height, maxHeight);

  const bounds = mainWindow.getBounds();
  const bottom = bounds.y + bounds.height;
  let nextX = bounds.x;
  let nextY = bottom - nextHeight;

  const workArea = display.workArea;
  const minX = workArea.x;
  const maxX = workArea.x + workArea.width - nextWidth;
  const minY = workArea.y;
  const maxY = workArea.y + workArea.height - nextHeight;

  if (nextX < minX) nextX = minX;
  if (nextX > maxX) nextX = maxX;
  if (nextY < minY) nextY = minY;
  if (nextY > maxY) nextY = maxY;

  mainWindow.setBounds({ x: nextX, y: nextY, width: nextWidth, height: nextHeight }, false);
  promoteMainWindow({ force: true });
  return true;
});

app.on('before-quit', () => {
  // Ensure overlay is closed before quitting
  if (overlayWindow) {
    overlayWindow.destroy();
    overlayWindow = null;
  }
  if (calloutWindow) {
    calloutWindow.destroy();
    calloutWindow = null;
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

function buildJpegDataUrl(image, quality = 82) {
  if (!image || image.isEmpty()) {
    return null;
  }
  return `data:image/jpeg;base64,${image.toJPEG(quality).toString('base64')}`;
}

function pruneCapturedFrameCache(maxAgeMs = 5 * 60 * 1000, maxEntries = 12) {
  const now = Date.now();
  for (const [frameId, entry] of capturedFrameCache.entries()) {
    if (!entry || now - entry.createdAt > maxAgeMs) {
      capturedFrameCache.delete(frameId);
    }
  }
  while (capturedFrameCache.size > maxEntries) {
    const oldestKey = capturedFrameCache.keys().next().value;
    if (!oldestKey) break;
    capturedFrameCache.delete(oldestKey);
  }
}

function getCachedCapturedFrame(frameId) {
  pruneCapturedFrameCache();
  if (!frameId) return null;
  return capturedFrameCache.get(frameId)?.capture || null;
}

function getCapturedFrameDataUrl(capture, quality = 82) {
  if (!capture) return null;
  if (capture.dataUrl) return capture.dataUrl;
  return buildJpegDataUrl(capture.image, quality);
}

function getScaledCaptureSize(width, height, maxDimension = 1280) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { width: 0, height: 0 };
  }
  if (!Number.isFinite(maxDimension) || maxDimension <= 0) {
    return { width, height };
  }
  const scale = Math.min(1, maxDimension / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
}

// Computer Use (CUA) handler
async function captureNativeScreenshot() {
  const appWindows = [mainWindow, overlayWindow, calloutWindow, highlightWindow]
    .filter(w => w && !w.isDestroyed());
  const requiresOpacityFallback = appWindows.some((win) => !isWindowCaptureExcluded(win));

  try {
    if (requiresOpacityFallback) {
      appWindows.forEach((win) => win.setOpacity(0));
      await new Promise((resolve) => setTimeout(resolve, 16));
    }

    const parsedDisplayId = currentDisplayId ? parseInt(currentDisplayId, 10) : NaN;
    const displayId = Number.isFinite(parsedDisplayId) ? parsedDisplayId : undefined;

    if (typeof screen.captureDisplay === 'function') {
      try {
        const image = await screen.captureDisplay(displayId);
        if (image && !image.isEmpty()) {
          const size = image.getSize();
          return { image, width: size.width, height: size.height, source: 'screen.captureDisplay' };
        }
        console.warn('[Screenshot] screen.captureDisplay returned an empty image.');
      } catch (error) {
        console.warn('[Screenshot] screen.captureDisplay failed:', error.message);
      }
    }

    const bounds = currentDisplayPhysicalBounds;
    if (bounds?.width > 0 && bounds?.height > 0 && typeof uiAutomation.captureScreenNative === 'function') {
      const base64 = await uiAutomation.captureScreenNative(bounds.x, bounds.y, bounds.width, bounds.height, 90);
      if (base64) {
        return {
          dataUrl: `data:image/jpeg;base64,${base64}`,
          width: bounds.width,
          height: bounds.height,
          source: 'uiAutomation.captureScreenNative'
        };
      }
    }

    return null;
  } catch (e) {
    console.warn('[Screenshot] Capture failed:', e.message);
    return null;
  } finally {
    if (requiresOpacityFallback) {
      appWindows.forEach((win) => {
        try {
          win.setOpacity(1);
        } catch (_) {
          // Ignore windows that were destroyed during capture.
        }
      });
    }
    promoteMainWindow({ force: true });
  }
}

async function captureRunFrame(options = {}) {
  const includeFull = options?.includeFull !== false;
  const cacheFull = options?.cacheFull !== false;
  const maxDimension = Number.isFinite(options?.maxDimension) ? Number(options.maxDimension) : 1280;
  const fullQuality = Number.isFinite(options?.fullQuality) ? Number(options.fullQuality) : 82;
  const reasonerQuality = Number.isFinite(options?.reasonerQuality) ? Number(options.reasonerQuality) : 72;
  const capture = await captureNativeScreenshot();
  if (!capture) {
    return null;
  }

  let image = capture.image || null;
  if ((!image || image.isEmpty()) && capture.dataUrl) {
    try {
      image = nativeImage.createFromDataURL(capture.dataUrl);
    } catch (_) {
      image = null;
    }
  }

  const width = Number(capture.width) || image?.getSize()?.width || 0;
  const height = Number(capture.height) || image?.getSize()?.height || 0;
  if (!width || !height) {
    return null;
  }

  let frameId = null;
  if (cacheFull) {
    pruneCapturedFrameCache();
    frameId = randomUUID();
    capturedFrameCache.set(frameId, {
      capture,
      createdAt: Date.now()
    });
  }

  const scaledSize = getScaledCaptureSize(width, height, maxDimension);
  let reasonerDataUrl = capture.dataUrl || null;
  if (image && !image.isEmpty()) {
    const shouldResize = scaledSize.width !== width || scaledSize.height !== height;
    const reasonerImage = shouldResize
      ? image.resize({ width: scaledSize.width, height: scaledSize.height, quality: 'good' })
      : image;
    reasonerDataUrl = buildJpegDataUrl(reasonerImage, reasonerQuality) || reasonerDataUrl;
  }

  let dataUrl = null;
  if (includeFull) {
    dataUrl = getCapturedFrameDataUrl(capture, fullQuality);
  }

  return {
    frameId,
    dataUrl,
    width,
    height,
    reasonerDataUrl: reasonerDataUrl || dataUrl,
    reasonerWidth: scaledSize.width || width,
    reasonerHeight: scaledSize.height || height,
    captureSource: capture.source || 'unknown'
  };
}

ipcMain.handle('cua-run', async (event, payload) => {
  try {
    if (!payload?.imageDataUrl || !payload?.displayWidth || !payload?.displayHeight) {
      const cachedCapture = getCachedCapturedFrame(payload?.frameId);
      const cachedDataUrl = getCapturedFrameDataUrl(cachedCapture);
      if (cachedDataUrl && payload?.displayWidth && payload?.displayHeight) {
        payload = {
          ...payload,
          imageDataUrl: cachedDataUrl
        };
      } else {
        const native = await captureRunFrame({ includeFull: true, maxDimension: 0 });
        if (native) {
          payload = {
            ...payload,
            imageDataUrl: native.dataUrl || native.reasonerDataUrl,
            displayWidth: native.width,
            displayHeight: native.height
          };
        }
      }
    }
    const response = await runCuaQuestion(payload);
    return response;
  } catch (error) {
    console.error('CUA error:', error);
    throw error;
  }
});

ipcMain.handle('reasoner-run', async (event, payload) => {
  try {
    if (!payload?.imageDataUrl) {
      const cachedDataUrl = getCapturedFrameDataUrl(getCachedCapturedFrame(payload?.frameId), 72);
      if (cachedDataUrl) {
        payload = {
          ...payload,
          imageDataUrl: cachedDataUrl
        };
      } else {
        const native = await captureRunFrame({ includeFull: false, maxDimension: 0 });
        if (native?.reasonerDataUrl) {
          payload = { ...payload, imageDataUrl: native.reasonerDataUrl };
        }
      }
    }
    const response = await runReasonerQuestion(payload);
    return response;
  } catch (error) {
    console.error('Reasoner error:', error);
    throw error;
  }
});

ipcMain.handle('cua54-run', async (event, payload) => {
  try {
    if (!payload?.imageDataUrl) {
      const cachedDataUrl = getCapturedFrameDataUrl(getCachedCapturedFrame(payload?.frameId), 72);
      if (cachedDataUrl) {
        payload = {
          ...payload,
          imageDataUrl: cachedDataUrl
        };
      } else {
        const native = await captureRunFrame({ includeFull: false, maxDimension: 0 });
        if (native?.reasonerDataUrl) {
          payload = { ...payload, imageDataUrl: native.reasonerDataUrl };
        }
      }
    }
    const response = await runCua54Question(payload);
    return response;
  } catch (error) {
    console.error('CUA 5.4 error:', error);
    throw error;
  }
});

ipcMain.handle('log-to-terminal', async (event, message) => {
  const text = typeof message === 'string' ? message.trim() : '';
  if (text) {
    console.log(text);
  }
  return true;
});

ipcMain.handle('capture-run-frame', async (event, options) => {
  try {
    return await captureRunFrame(options);
  } catch (error) {
    console.error('Capture frame error:', error);
    throw error;
  }
});

ipcMain.handle('capture-frame-data-url', async (event, payload) => {
  try {
    const quality = Number.isFinite(payload?.quality) ? Number(payload.quality) : 82;
    return getCapturedFrameDataUrl(getCachedCapturedFrame(payload?.frameId), quality);
  } catch (error) {
    console.error('Capture frame data url error:', error);
    throw error;
  }
});

ipcMain.handle('start-tree-prefetch', async () => {
  return startTreePrefetch();
});

ipcMain.handle('tree-locator-run', async (event, payload) => {
  try {
    const action = payload?.action || null;
    if (!action?.uia_target) {
      throw new Error('Tree locator requires action.uia_target');
    }

    const prefetched = await resolveTreeFromPrefetch(payload?.prefetchId);
    let resolvedTree = prefetched?.resolvedTree || null;
    let treeResolveDurationMs = Number(prefetched?.treeResolveDurationMs) || 0;

    if (!resolvedTree?.tree || !Array.isArray(resolvedTree.tree) || resolvedTree.tree.length === 0) {
      const treeResolveStartedAt = Date.now();
      resolvedTree = await resolveTreeForSelectedDisplay();
      treeResolveDurationMs = Date.now() - treeResolveStartedAt;
    }
    if (!resolvedTree?.tree || !Array.isArray(resolvedTree.tree) || resolvedTree.tree.length === 0) {
      console.warn('Tree locator disabled for this action: unable to resolve a non-empty UI tree from the selected screen. Falling back to CUA.');
      return {
        output_text: JSON.stringify({ notFound: true, confidence: 'low' }),
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          total_tokens: 0
        },
        _meta: {
          modelId: null,
          label: 'Grok Tree Locator',
          pricing: { input: 0.2, output: 0.5 },
          skipped: 'missing_ui_tree'
        },
        _tree: null,
        _timings: {
          treeResolveDurationMs,
          treeNodeCount: 0
        }
      };
    }

    const response = await runTreeLocator({
      description: action.target_description || action.action_callout || action.action_type || '',
      uiaTarget: action.uia_target,
      uiTree: resolvedTree.tree
    });

    return {
      ...response,
      _tree: {
        source: resolvedTree.source,
        processId: resolvedTree.processId,
        processIds: resolvedTree.processIds,
        nodeCount: resolvedTree.nodeCount
      },
      _timings: {
        treeResolveDurationMs,
        treeNodeCount: resolvedTree.nodeCount
      }
    };
  } catch (error) {
    const message = error?.message || String(error);
    if (
      message.includes('Missing TREE_LOCATOR_API_KEY')
      || message.includes('Missing GROK_API_KEY')
      || message.includes('Missing XAI_API_KEY')
    ) {
      console.warn('Tree locator disabled: missing TREE_LOCATOR_API_KEY, GROK_API_KEY, or XAI_API_KEY. Falling back to CUA.');
      return {
        output_text: JSON.stringify({ notFound: true, confidence: 'low' }),
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          total_tokens: 0
        },
        _meta: {
          modelId: null,
          label: 'Grok Tree Locator',
          pricing: { input: 0.2, output: 0.5 },
          skipped: 'missing_api_key'
        },
        _tree: null,
        _timings: {
          treeResolveDurationMs: 0,
          treeNodeCount: 0
        }
      };
    }
    console.error('Tree locator error:', error);
    throw error;
  }
});

ipcMain.handle('reasoner-get-models', async () => {
  return getAvailableModels();
});

ipcMain.handle('reasoner-get-model', async () => {
  return getCurrentModel();
});

ipcMain.handle('reasoner-set-model', async (event, modelId) => {
  setCurrentModel(modelId);
  return { success: true, modelId };
});

ipcMain.handle('tts-synthesize', async (event, payload) => {
  try {
    const buffer = await synthesizeSpeech(payload);
    if (!buffer) return null;
    return buffer.toString('base64');
  } catch (error) {
    console.error('TTS error:', error);
    throw error;
  }
});

ipcMain.handle('stt-transcribe-local', async (event, payload) => {
  try {
    const result = await transcribeAudio(payload || {});
    return result;
  } catch (error) {
    throw error;
  }
});

// Audio capture IPC handlers — uses naudiodon (PortAudio) in the main process
// to avoid Chromium WASAPI crashes (STATUS_ACCESS_VIOLATION).
ipcMain.handle('audio-start-capture', async () => {
  if (!portAudio) {
    throw new Error('naudiodon is not installed. Run: npm install naudiodon');
  }

  // Stop any previous capture
  if (audioCapture) {
    try { audioCapture.quit(); } catch (_) {}
    audioCapture = null;
  }
  audioCaptureChunks = [];

  // Prefer MME or DirectSound over WASAPI — WASAPI crashes on some Windows systems
  let deviceId = -1;
  try {
    const devices = portAudio.getDevices();
    const inputs = devices.filter(d => d.maxInputChannels > 0);
    console.log('[Audio] Input devices:', inputs.map(d => `${d.id}:${d.name}(${d.hostAPIName})`).join(', '));
    const chosen = inputs.find(d => d.hostAPIName === 'MME')
                || inputs.find(d => d.hostAPIName === 'Windows DirectSound');
    if (chosen) {
      deviceId = chosen.id;
      console.log('[Audio] Using device:', chosen.name, chosen.hostAPIName, 'id:', deviceId);
    } else {
      console.warn('[Audio] No MME/DirectSound device found, using default (WASAPI)');
    }
  } catch (devErr) {
    console.warn('[Audio] Device enumeration failed:', devErr.message);
  }

  return new Promise((resolve, reject) => {
    try {
      audioCapture = new portAudio.AudioIO({
        inOptions: {
          channelCount: 1,
          sampleFormat: portAudio.SampleFormat16Bit,
          sampleRate: 16000,
          deviceId,
          closeOnError: false
        }
      });

      audioCapture.on('data', (chunk) => {
        audioCaptureChunks.push(Buffer.from(chunk));
      });

      audioCapture.on('error', (err) => {
        console.error('[Audio] Capture error:', err.message);
      });

      audioCapture.start();
      resolve();
    } catch (err) {
      audioCapture = null;
      audioCaptureChunks = [];
      reject(new Error(err.message || 'Failed to open microphone'));
    }
  });
});

ipcMain.handle('audio-stop-capture', async () => {
  if (!audioCapture) {
    throw new Error('Audio capture not active.');
  }

  const capture = audioCapture;
  audioCapture = null;
  const chunks = audioCaptureChunks;
  audioCaptureChunks = [];

  // Wait for stream to fully close before returning, so PortAudio threads
  // finish cleanup before anything else runs (prevents post-quit SIGSEGV).
  await new Promise((resolve) => {
    const done = () => { clearTimeout(timer); resolve(); };
    const timer = setTimeout(done, 800);
    capture.once('close', done);
    capture.once('finish', done);
    try { capture.quit(); } catch (_) { done(); }
  });

  if (!chunks.length) return '';
  const pcm = Buffer.concat(chunks);
  return encodeWavBuffer(pcm, 16000).toString('base64');
});

ipcMain.handle('audio-interim', async () => {
  if (!audioCapture || !audioCaptureChunks.length) return '';
  // Send only the last 4 seconds of audio for faster API response
  const maxBytes = 16000 * 2 * 4; // 16kHz × 16-bit × 4s
  const pcmFull = Buffer.concat(audioCaptureChunks.map(c => Buffer.from(c)));
  const pcm = pcmFull.length > maxBytes ? pcmFull.slice(pcmFull.length - maxBytes) : pcmFull;
  return encodeWavBuffer(pcm, 16000).toString('base64');
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
    const startDip = screenToDipPointSafe({ x: Math.round(x), y: Math.round(y) }, scaleFactor);
    const endDip = screenToDipPointSafe(
      { x: Math.round(x + width), y: Math.round(y + height) },
      scaleFactor
    );
    const dipWidth = Math.max(1, endDip.x - startDip.x);
    const dipHeight = Math.max(1, endDip.y - startDip.y);
    const highlightX = Math.round(startDip.x - padding);
    const highlightY = Math.round(startDip.y - padding);
    const highlightWidth = Math.round(dipWidth + padding * 2);
    const highlightHeight = Math.round(dipHeight + padding * 2);
    
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
    await applyWindowCaptureExclusion(highlightWindow, 'Highlight');

    promoteWidgetWindow(highlightWindow);
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
