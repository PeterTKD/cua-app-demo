import { elements } from './dom.js';
import { getHistorySnapshot } from './history.js';
import { clearCurrentAction, clearTargetRect, getCurrentAction, runCuaQuestion } from './cua.js';
import { ensureVideoReady, selectScreen, stopShare } from './screen-share.js';

function setStatus(message, tone = 'default') {
  elements.statusText.textContent = message;
  if (tone === 'error') {
    elements.statusText.style.color = '#b42318';
  } else if (tone === 'success') {
    elements.statusText.style.color = '#0f766e';
  } else {
    elements.statusText.style.color = '#44536c';
  }
}

let lastQuestion = '';
let isRunningCua = false;
let lastClickTime = 0;
let lastClickPoint = null;
let dragArmed = false;

const POSITION_TOLERANCE = 20;
const DOUBLE_CLICK_WINDOW_MS = 550;

function withinTolerance(x, y, targetX, targetY) {
  const dx = x - targetX;
  const dy = y - targetY;
  return Math.hypot(dx, dy) <= POSITION_TOLERANCE;
}

function completeStep(message) {
  setStatus(message, 'success');
  clearTargetRect();
  clearCurrentAction();
  window.electronAPI.showCallout({ heading: '', body: '', x: -1, y: -1, showNext: false });
  window.electronAPI.hideElementHighlight();
  if (lastQuestion && !isRunningCua) {
    setTimeout(() => {
      handleAsk({ delayMs: 2000 });
    }, 1000);
  }
}

async function handleAsk(options = {}) {
  const question = elements.questionInput.value.trim();
  if (!question) {
    setStatus('Type a question before asking.', 'error');
    return;
  }

  try {
    if (isRunningCua) {
      return;
    }
    const bounds = await window.electronAPI.getSharedDisplayBounds();
    if (!bounds || !bounds.bounds) {
      const selection = await selectScreen();
      if (!selection) {
        setStatus('Screen selection canceled.', 'default');
        return;
      }
      await ensureVideoReady();
      await waitForDisplayBounds();
    }
    setStatus('Sending question to CUA...', 'default');
    isRunningCua = true;
    lastQuestion = question;
    const result = await runCuaQuestion(question, options);
    if (result && result.actionType === 'wait') {
      setStatus('Waiting...', 'default');
      setTimeout(() => {
        completeStep('Wait complete.');
      }, 2000);
      return;
    }
    if (result && result.hasPointer === false) {
      setStatus('No pointer yet. Press Next to continue.', 'default');
      if (lastQuestion && !isRunningCua) {
        setTimeout(() => {
          if (!isRunningCua) {
            handleAsk({ delayMs: 2000 });
          }
        }, 2000);
      }
    } else {
      setStatus('CUA returned a pointer. UIA highlight updated.', 'success');
    }
  } catch (error) {
    setStatus(error.message || 'Failed to run CUA.', 'error');
  } finally {
    isRunningCua = false;
  }
}

async function waitForDisplayBounds() {
  for (let i = 0; i < 20; i += 1) {
    const bounds = await window.electronAPI.getSharedDisplayBounds();
    if (bounds && bounds.bounds) {
      return bounds;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Shared display not ready yet. Try again.');
}

async function handleSelectScreen() {
  try {
    setStatus('Select a screen to share.', 'default');
    const selection = await selectScreen();
    if (!selection) {
      setStatus('Screen selection canceled.', 'default');
      return;
    }
    setStatus('Screen sharing active.', 'success');
  } catch (error) {
    setStatus(error.message || 'Failed to share screen.', 'error');
  }
}

function bindEvents() {
  elements.askButton.addEventListener('click', handleAsk);
  elements.questionInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      handleAsk();
    }
  });

  elements.selectScreenButton.addEventListener('click', handleSelectScreen);
  elements.historyButton.addEventListener('click', async () => {
    const snapshot = getHistorySnapshot();
    await window.electronAPI.openHistoryWindow(snapshot);
  });
  elements.nextButton.addEventListener('click', async () => {
    if (!lastQuestion || isRunningCua) {
      return;
    }
    const action = getCurrentAction();
    if (action && !['click', 'double_click', 'drag'].includes(action.type)) {
      completeStep('Step complete.');
      return;
    }
    elements.questionInput.value = lastQuestion;
    await handleAsk({ delayMs: 2000 });
  });
  window.electronAPI.onOverlayNext(() => {
    if (!lastQuestion || isRunningCua) {
      return;
    }
    const action = getCurrentAction();
    if (action && !['click', 'double_click', 'drag'].includes(action.type)) {
      completeStep('Step complete.');
      return;
    }
    elements.questionInput.value = lastQuestion;
    handleAsk({ delayMs: 2000 });
  });
  elements.closeButton.addEventListener('click', () => {
    window.electronAPI.closeApp();
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'q' && (event.ctrlKey || event.metaKey)) {
      window.electronAPI.closeApp();
    }
  });

  window.electronAPI.onOSClick((event, data) => {
    const action = getCurrentAction();
    if (!action) {
      setStatus('Click received, but no active target yet.', 'default');
      return;
    }

    if (action.type === 'click') {
      if (withinTolerance(data.absoluteX, data.absoluteY, action.x, action.y)) {
        completeStep('Click complete.');
      } else {
        setStatus('Not quite there. Try clicking the pointer.', 'default');
      }
      return;
    }

    if (action.type === 'double_click') {
      if (!withinTolerance(data.absoluteX, data.absoluteY, action.x, action.y)) {
        setStatus('Double click near the pointer.', 'default');
        return;
      }
      const now = Date.now();
      if (lastClickTime && lastClickPoint && now - lastClickTime <= DOUBLE_CLICK_WINDOW_MS) {
        if (withinTolerance(data.absoluteX, data.absoluteY, lastClickPoint.x, lastClickPoint.y)) {
          window.electronAPI.showCallout({
            heading: 'Double click',
            body: 'Double click detected.',
            borderColor: '#22c55e',
            headingColor: '#22c55e',
            x: action.dipX,
            y: action.dipY,
            showNext: false
          });
          completeStep('Double click complete.');
          lastClickTime = 0;
          lastClickPoint = null;
          return;
        }
      }
      lastClickTime = now;
      lastClickPoint = { x: data.absoluteX, y: data.absoluteY };
      setStatus('Double click again to complete.', 'default');
    }
  });

  window.electronAPI.onOSMouseDown((event, data) => {
    const action = getCurrentAction();
    if (!action || action.type !== 'drag') {
      return;
    }
    if (withinTolerance(data.absoluteX, data.absoluteY, action.x, action.y)) {
      dragArmed = true;
    }
  });

  window.electronAPI.onOSMouseMove((event, data) => {
    const action = getCurrentAction();
    if (!action || action.type !== 'drag' || !dragArmed) {
      return;
    }
    if (action.x2 && action.y2 && withinTolerance(data.absoluteX, data.absoluteY, action.x2, action.y2)) {
      dragArmed = false;
      completeStep('Drag complete.');
    }
  });

  window.electronAPI.onOSMouseUp(() => {
    dragArmed = false;
  });

  window.electronAPI.onOSWheel(() => {
    const action = getCurrentAction();
    if (!action) return;
    if (['scroll', 'scroll_up', 'scroll_down'].includes(action.type)) {
      completeStep('Scroll complete.');
    }
  });

  window.electronAPI.onOSKeyDown(() => {
    const action = getCurrentAction();
    if (!action) return;
    if (['keypress', 'type'].includes(action.type)) {
      completeStep('Input complete.');
    }
  });

  window.electronAPI.onMainWindowClosing(() => {
    stopShare();
  });
}

function init() {
  bindEvents();
  setStatus('Ask a question and let CUA find the target.', 'default');
}

init();
