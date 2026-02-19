import { elements } from './dom.js';
import { addHistoryNote, clearHistory, getHistorySnapshot } from './history.js';
import {
  clearCurrentAction,
  clearTargetRect,
  fadeGuidance,
  getCurrentAction,
  addConversationNote,
  handleActionCriteriaMet,
  handleActionCriteriaNotMet,
  hasPendingAction,
  resetCuaState,
  runCuaQuestion
} from './cua.js';
import { ensureVideoReady, selectScreen, stopShare } from './screen-share.js';
import { appState, APP_MODES } from './state.js';
import { requestWidgetResize, setupResizeObserver } from './resize.js';
import { stopCurrentAudio, speakText } from './tts.js';
import { addChatMessage, addSystemMessage, clearChatLog } from './chat.js';
import {
  setAppMode,
  setGuideProcessActive,
  getFollowupDelayMs,
  resolveAutoMode,
  inferModeFromQuestion,
  isGuidanceActionType,
  registerSetStatus
} from './mode.js';
import { bindOSInputHandlers } from './input.js';

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

function setTaskButtonsEnabled(enabled) {
  if (elements.diffMethodButton) elements.diffMethodButton.disabled = !enabled;
  if (elements.pointElementButton) elements.pointElementButton.disabled = !enabled;
  if (elements.historyButton) elements.historyButton.disabled = !enabled;
  if (elements.nextButton) elements.nextButton.disabled = !enabled;
}

async function startGuideKickoff(force = false) {
  if (appState.appMode !== APP_MODES.GUIDE || appState.isRunningCua) {
    return;
  }
  if (appState.hasGuideKickoffStarted && !force) {
    return;
  }
  const bounds = await window.electronAPI.getSharedDisplayBounds();
  if (!bounds || !bounds.bounds) {
    setGuideProcessActive(false);
    setStatus('Focus mode ready. Select a screen to begin.', 'default');
    return;
  }
  appState.hasGuideKickoffStarted = true;
  await handleAsk({
    auto: true,
    allowEmpty: true,
    emptyInput: true,
    mode: APP_MODES.GUIDE,
    delayMs: 0,
    captureDelayMs: 0,
    fastCapture: true
  });
}

function completeStep(message) {
  const now = Date.now();
  if (appState.isCompletingStep) {
    return;
  }
  if (now - (appState.lastStepCompletedAt || 0) < 400) {
    return;
  }
  const action = getCurrentAction();
  if (!action) {
    return;
  }

  appState.isCompletingStep = true;
  appState.lastStepCompletedAt = now;

  try {
  setStatus(message, 'success');
  clearTargetRect();
  clearCurrentAction();
  window.electronAPI.showCallout({ heading: '', body: '', x: -1, y: -1, showNext: false });
  window.electronAPI.hideElementHighlight();
  const { hasMore } = handleActionCriteriaMet();
  if (hasMore) {
    setStatus('Next highlight ready.', 'success');
    return;
  }
  if (action && action.type === 'pinpoint') {
    return;
  }
  addHistoryNote('User Completed The Action');
  addConversationNote('User Completed The Action');
  addSystemMessage('Action Completed');
  const followupDelayMs = appState.appMode === APP_MODES.GUIDE ? 250 : 2000;
  const settleDelayMs = appState.appMode === APP_MODES.GUIDE ? 250 : 1000;
  const stepEpoch = appState.guideProcessEpoch;
  setTimeout(() => {
    if (stepEpoch !== appState.guideProcessEpoch) {
      return;
    }
    handleAsk({
      delayMs: followupDelayMs,
      auto: true,
      userStatus: 'Action Criteria Met',
      allowEmpty: true,
      emptyInput: true,
      mode: appState.appMode,
      fastCapture: appState.appMode === APP_MODES.GUIDE
    });
  }, settleDelayMs);
  } finally {
    appState.isCompletingStep = false;
  }
}

function completeTaskAndReset() {
  stopCurrentAudio();
  clearTargetRect();
  clearCurrentAction();
  resetCuaState();
  clearHistory();
  appState.lastQuestion = '';
  elements.questionInput.value = '';
  setStatus('Task completed. Ready for a new question.', 'success');
  setGuideProcessActive(false);
  clearChatLog();
  window.electronAPI.showCallout({ heading: '', body: '', x: -1, y: -1, showNext: false });
  window.electronAPI.hideElementHighlight();
  setTaskButtonsEnabled(false);
}

function resolveQuestion(mode, forceLast = false) {
  const inputValue = elements.questionInput.value.trim();
  if (inputValue) {
    return inputValue;
  }
  const shouldReuseLast = forceLast || mode === 'diff_method' || mode === 'point';
  if (shouldReuseLast && appState.lastQuestion) {
    return appState.lastQuestion;
  }
  return '';
}

async function handleAsk(options = {}) {
  const question = options.emptyInput === true
    ? ''
    : resolveQuestion(options.mode, options.forceLast === true);
  const activeMode = resolveAutoMode(options, question);
  if (activeMode !== appState.appMode) {
    setAppMode(activeMode, { announce: false, triggerGuide: false });
  }
  const allowEmpty = options.allowEmpty === true || activeMode === APP_MODES.GUIDE;
  if (!question && !allowEmpty) {
    setStatus('Type a question before asking.', 'error');
    return;
  }

  try {
    if (appState.isRunningCua) {
      return;
    }
    stopCurrentAudio();
    if (elements.ttsToggleButton) elements.ttsToggleButton.disabled = true;
    if (hasPendingAction()) {
      fadeGuidance();
      handleActionCriteriaNotMet();
      options.userStatus = 'Action Criteria Was not met';
      if (question) {
        addHistoryNote(`User input: ${question}`);
      }
    }
    elements.questionInput.value = '';
    if (!options.auto && question) {
      addChatMessage(question, 'user');
    }
    const bounds = await window.electronAPI.getSharedDisplayBounds();
    if (!bounds || !bounds.bounds) {
      const selection = await selectScreen();
      if (!selection) {
        setStatus('Screen selection canceled.', 'default');
        addChatMessage('Screen selection canceled.', 'assistant');
        return;
      }
      await ensureVideoReady();
      await waitForDisplayBounds();
    }
    setStatus(activeMode === APP_MODES.GUIDE ? 'Analyzing screen...' : 'Sending question to CUA...', 'default');
    appState.isRunningCua = true;
    if (question) {
      appState.lastQuestion = question;
    }
    const runOptions = {
      ...options,
      mode: activeMode,
      allowEmpty
    };
    runOptions.onReasonerPlan = ({ isTaskCompleted, hasCuaCalls, primaryAction }) => {
      if (isTaskCompleted || !hasCuaCalls) {
        return;
      }
      // Enter focus early from reasoner intent, except pinpoint-only guidance.
      if (primaryAction && primaryAction !== 'pinpoint') {
        if (appState.appMode !== APP_MODES.GUIDE) {
          setAppMode(APP_MODES.GUIDE, { announce: false, triggerGuide: false });
        }
        setGuideProcessActive(true);
      }
    };
    runOptions.onSystemNote = (note) => {
      if (!note) {
        return;
      }
      addHistoryNote(note);
      addSystemMessage(note);
    };
    if (activeMode === APP_MODES.GUIDE) {
      if (!Number.isFinite(runOptions.delayMs)) {
        runOptions.delayMs = 0;
      }
      if (!Number.isFinite(runOptions.captureDelayMs)) {
        runOptions.captureDelayMs = 0;
      }
      runOptions.fastCapture = true;
    }
    const result = await runCuaQuestion(question, runOptions);
    if (result && result.answer) {
      addChatMessage(result.answer, 'assistant');
      speakText(result.answer);
    }
    if (result && isGuidanceActionType(result.actionType)) {
      if (appState.appMode !== APP_MODES.GUIDE) {
        setAppMode(APP_MODES.GUIDE, { announce: false, triggerGuide: false });
      }
      setGuideProcessActive(true);
    } else if (result && result.actionType === 'pinpoint') {
      setGuideProcessActive(false);
      setAppMode(APP_MODES.CHAT, { announce: false, triggerGuide: false });
    } else {
      setGuideProcessActive(false);
      if (question && !hasPendingAction()) {
        const inferredFromQuestion = inferModeFromQuestion(question);
        if (appState.appMode !== inferredFromQuestion) {
          setAppMode(inferredFromQuestion, { announce: false, triggerGuide: false });
        }
      }
    }
    if (result && result.actionType === 'wait') {
      setStatus('Waiting...', 'default');
      setTimeout(() => {
        completeStep('Wait complete.');
      }, appState.appMode === APP_MODES.GUIDE ? 300 : 2000);
      return;
    }
    if (result && result.actionType === 'callout') {
      setStatus('Callout shown.', 'default');
      return;
    }
    if (result && result.hasPointer === false) {
      if (activeMode === APP_MODES.GUIDE) {
        setStatus('No pointer yet. Continuing focus...', 'default');
      } else {
        setStatus('No pointer yet. Press Next to continue.', 'default');
      }
      if ((appState.lastQuestion || activeMode === APP_MODES.GUIDE) && !appState.isRunningCua) {
        const delayMs = activeMode === APP_MODES.GUIDE ? 500 : 2000;
        const followupEpoch = appState.guideProcessEpoch;
        setTimeout(() => {
          if (followupEpoch !== appState.guideProcessEpoch) {
            return;
          }
          if (!appState.isRunningCua) {
            handleAsk({
              delayMs: activeMode === APP_MODES.GUIDE ? 0 : 2000,
              auto: true,
              forceLast: activeMode !== APP_MODES.GUIDE,
              allowEmpty: activeMode === APP_MODES.GUIDE,
              emptyInput: activeMode === APP_MODES.GUIDE,
              mode: activeMode,
              fastCapture: activeMode === APP_MODES.GUIDE
            });
          }
        }, delayMs);
      }
    } else {
      setStatus('CUA returned a pointer. UIA highlight updated.', 'success');
    }
  } catch (error) {
    if (activeMode === APP_MODES.GUIDE) {
      setGuideProcessActive(false);
    }
    setStatus(error.message || 'Failed to run CUA.', 'error');
    addChatMessage(error.message || 'Failed to run CUA.', 'assistant');
  } finally {
    appState.isRunningCua = false;
    if (elements.ttsToggleButton) elements.ttsToggleButton.disabled = false;
    if (appState.lastQuestion) {
      setTaskButtonsEnabled(true);
    }
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
    await ensureVideoReady();
    await waitForDisplayBounds();
    setStatus('Screen sharing active.', 'success');
    if (appState.appMode === APP_MODES.GUIDE) {
      await startGuideKickoff(true);
    }
  } catch (error) {
    setStatus(error.message || 'Failed to share screen.', 'error');
  }
}

function bindEvents() {
  if (elements.askButton) {
    elements.askButton.addEventListener('click', handleAsk);
  }
  if (elements.questionInput) {
    elements.questionInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        handleAsk();
      }
    });
  }
  if (elements.selectScreenButton) {
    elements.selectScreenButton.addEventListener('click', handleSelectScreen);
  }
  if (elements.openChatButton) {
    elements.openChatButton.addEventListener('click', () => {
      fadeGuidance();
      handleActionCriteriaNotMet();
      setAppMode(APP_MODES.CHAT, { announce: false, triggerGuide: false });
      setGuideProcessActive(false);
      setStatus('Chat opened. Ask your question.', 'default');
      setTimeout(() => {
        elements.questionInput?.focus();
        requestWidgetResize();
      }, 50);
    });
  }
  if (elements.historyButton) {
    elements.historyButton.addEventListener('click', async () => {
      const snapshot = getHistorySnapshot();
      await window.electronAPI.openHistoryWindow(snapshot);
    });
  }
  if (elements.diffMethodButton) {
    elements.diffMethodButton.addEventListener('click', async () => {
    if (appState.isRunningCua) {
      return;
    }
    const question = resolveQuestion('diff_method');
    if (!question) {
      setStatus('Ask a question first so we can try a different method.', 'error');
      return;
    }
    elements.questionInput.value = question;
    await handleAsk({ delayMs: getFollowupDelayMs(), mode: 'diff_method' });
    });
  }
  if (elements.pointElementButton) {
    elements.pointElementButton.addEventListener('click', async () => {
    if (appState.isRunningCua) {
      return;
    }
    const question = resolveQuestion('point');
    if (!question) {
      setStatus('Ask a question first so we can point at the element.', 'error');
      return;
    }
    elements.questionInput.value = question;
    await handleAsk({ delayMs: getFollowupDelayMs(), mode: 'point' });
    });
  }
  if (elements.nextButton) {
    elements.nextButton.addEventListener('click', async () => {
    if (!appState.lastQuestion || appState.isRunningCua) {
      return;
    }
    const action = getCurrentAction();
    if (action && (!['click', 'double_click', 'drag'].includes(action.type) || action.type === 'pinpoint')) {
      completeStep('Step complete.');
      return;
    }
    elements.questionInput.value = appState.lastQuestion;
    await handleAsk({ delayMs: getFollowupDelayMs(), auto: true, forceLast: true, mode: appState.appMode });
    });
  }
  window.electronAPI.onOverlayNext(() => {
    if (!appState.lastQuestion || appState.isRunningCua) {
      return;
    }
    const action = getCurrentAction();
    if (action && (!['click', 'double_click', 'drag'].includes(action.type) || action.type === 'pinpoint')) {
      completeStep('Step complete.');
      return;
    }
    elements.questionInput.value = appState.lastQuestion;
    handleAsk({ delayMs: getFollowupDelayMs(), auto: true, forceLast: true, mode: appState.appMode });
  });
  window.electronAPI.onCalloutComplete(() => {
    completeTaskAndReset();
  });
  if (elements.ttsToggleButton) {
    elements.ttsToggleButton.addEventListener('click', () => {
      if (appState.currentAudio && !appState.currentAudio.paused) {
        stopCurrentAudio();
      }
      appState.isTTSEnabled = !appState.isTTSEnabled;
      elements.ttsToggleButton.classList.toggle('tts-active', appState.isTTSEnabled);
      elements.ttsToggleButton.title = appState.isTTSEnabled ? 'Mute audio' : 'Enable audio';
      if (!appState.isTTSEnabled) {
        stopCurrentAudio();
      }
    });
  }
  if (elements.closeButton) {
    elements.closeButton.addEventListener('click', () => {
      window.electronAPI.closeApp();
    });
  }

  window.addEventListener('keydown', (event) => {
    if (event.key === 'q' && (event.ctrlKey || event.metaKey)) {
      window.electronAPI.closeApp();
    }
  });

  bindOSInputHandlers({ completeStep, setStatus });

  window.electronAPI.onMainWindowClosing(() => {
    stopShare();
  });
}

function init() {
  registerSetStatus(setStatus);
  bindEvents();
  setAppMode(APP_MODES.GUIDE, { announce: false, triggerGuide: false });
  setStatus('Focus mode ready. Select a screen to begin.', 'default');
  setTaskButtonsEnabled(false);
  clearChatLog();
  setupResizeObserver();
}

init();
