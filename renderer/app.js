import { elements } from './dom.js';
import { addHistoryNote, clearHistory, getHistorySnapshot } from './history.js';
import {
  clearCurrentAction,
  clearTargetRect,
  fadeGuidance,
  getLastCuaSummary,
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
import { addChatMessage, clearChatLog, markLastActionCompleted } from './chat.js';
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

let speechSupported = Boolean(window.electronAPI?.startAudioCapture) && Boolean(window.electronAPI?.transcribeLocalSpeech);
let speechRecording = false;
let speechTranscribing = false;
let speechBaseText = '';
let speechInterimPending = false;
let speechInterimTimer = null;

function setStatus(message, tone = 'default') {
  elements.statusText.textContent = message;
  if (tone === 'error') {
    elements.statusText.style.color = '#fda4af';
  } else if (tone === 'success') {
    elements.statusText.style.color = '#6ee7b7';
  } else {
    elements.statusText.style.color = '#8fa1be';
  }
}

function setTaskButtonsEnabled(enabled) {
  if (elements.diffMethodButton) elements.diffMethodButton.disabled = !enabled;
  if (elements.pointElementButton) elements.pointElementButton.disabled = !enabled;
  if (elements.nextButton) elements.nextButton.disabled = !enabled;
}

async function logThoughtToTerminal(result) {
  const thought = typeof result?.thought === 'string' ? result.thought.trim() : '';
  if (!thought || !window.electronAPI?.logToTerminal) {
    return;
  }
  try {
    await window.electronAPI.logToTerminal(`[THOUGHT] ${thought}`);
  } catch (_) {
    // Terminal logging is best-effort only.
  }
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
  if (!markLastActionCompleted(action.type)) {
    addChatMessage(getLastCuaSummary() || 'Action completed.', 'assistant', {
      actionType: action.type,
      completed: true
    });
  }
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
  appState.actionMessageBubbles = [];
  elements.questionInput.value = '';
  setStatus('Task completed. Ready for a new question.', 'success');
  setGuideProcessActive(false);
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

function stopVoiceInput() {
  return stopVoiceInputInternal({ transcribe: true });
}

async function stopVoiceInputInternal({ transcribe }) {
  if (speechInterimTimer) { clearInterval(speechInterimTimer); speechInterimTimer = null; }
  if (!speechRecording && !speechTranscribing) return;
  if (speechTranscribing) return;

  speechRecording = false;
  updateMicButtonState();

  if (!transcribe) {
    window.electronAPI.stopAudioCapture().catch(() => {});
    setStatus('Voice input stopped.', 'default');
    return;
  }

  speechTranscribing = true;
  updateMicButtonState();
  setStatus('Transcribing...', 'default');
  try {
    const wavBase64 = await window.electronAPI.stopAudioCapture();
    if (!wavBase64) {
      setStatus('Did not catch that. Try again.', 'default');
      return;
    }
    const transcript = await window.electronAPI.transcribeLocalSpeech({ wavBase64, language: 'en' });
    const text = String(transcript || '').trim();
    if (!text) {
      setStatus('Did not catch that. Try again.', 'default');
      return;
    }
    const nextValue = [speechBaseText, text].filter(Boolean).join(' ').trim();
    if (elements.questionInput) elements.questionInput.value = nextValue;
    setStatus('Voice input captured.', 'success');
  } catch (error) {
    setStatus(error?.message || 'Voice transcription failed.', 'error');
  } finally {
    speechBaseText = '';
    speechTranscribing = false;
    updateMicButtonState();
  }
}

function updateMicButtonState() {
  if (!elements.micButton) {
    return;
  }
  elements.micButton.classList.toggle('listening', speechRecording);
  elements.micButton.disabled = speechTranscribing || !speechSupported;
  if (!speechSupported) {
    elements.micButton.title = 'Local voice input is unavailable';
  } else if (speechTranscribing) {
    elements.micButton.title = 'Transcribing...';
  } else {
    elements.micButton.title = speechRecording ? 'Stop voice input' : 'Start voice input';
  }
}

async function pollInterimTranscript() {
  if (speechInterimPending) return;
  speechInterimPending = true;
  try {
    const wavBase64 = await window.electronAPI.getInterimAudio();
    if (!wavBase64) return;
    const transcript = await window.electronAPI.transcribeLocalSpeech({ wavBase64, language: 'en' });
    const text = String(transcript || '').trim();
    // Only write if no final transcription is running yet
    if (text && !speechTranscribing && elements.questionInput) {
      elements.questionInput.value = [speechBaseText, text].filter(Boolean).join(' ').trim();
    }
  } catch (_) {
    // ignore interim errors silently
  } finally {
    speechInterimPending = false;
  }
}

async function startVoiceInput() {
  if (!speechSupported || speechRecording || speechTranscribing) return;
  try {
    speechBaseText = elements.questionInput?.value?.trim() || '';
    await window.electronAPI.startAudioCapture();
    speechRecording = true;
    setTimeout(pollInterimTranscript, 700);
    speechInterimTimer = setInterval(pollInterimTranscript, 2000);
    updateMicButtonState();
    setStatus('Listening...', 'default');
  } catch (error) {
    speechSupported = false;
    updateMicButtonState();
    setStatus(error?.message || 'Microphone unavailable.', 'error');
  }
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
    if (speechRecording) {
      await stopVoiceInputInternal({ transcribe: false });
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
      allowEmpty,
      ttsEnabled: appState.isTTSEnabled
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
      const primaryPlannedActionType = result.reasoner?.actions?.[0]?.action_type || null;
      const chatActionType = primaryPlannedActionType
        || (result.actionType && result.actionType !== 'callout' ? result.actionType : null);
      addChatMessage(result.answer, 'assistant', { actionType: chatActionType });
    }
    await logThoughtToTerminal(result);
    if (result && result.answer) {
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
    const typedQuestion = elements.questionInput?.value?.trim() || '';
    if (appState.appMode === APP_MODES.GUIDE && typedQuestion) {
      await handleAsk({ mode: APP_MODES.GUIDE });
    } else if (!typedQuestion) {
      setStatus('Screen sharing active. Ask a question to begin.', 'default');
    }
  } catch (error) {
    setStatus(error.message || 'Failed to share screen.', 'error');
  }
}

function bindEvents() {
  if (elements.askButton) {
    elements.askButton.addEventListener('click', handleAsk);
  }
  if (elements.micButton) {
    elements.micButton.addEventListener('click', async () => {
      try {
        if (!speechSupported) {
          setStatus('Local voice input is unavailable.', 'error');
          return;
        }
        if (speechRecording) {
          await stopVoiceInputInternal({ transcribe: true });
        } else {
          await startVoiceInput();
        }
      } catch (error) {
        speechRecording = false;
        speechTranscribing = false;
        updateMicButtonState();
        setStatus(error?.message || 'Voice input failed unexpectedly.', 'error');
      }
    });
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
  updateMicButtonState();
  registerSetStatus(setStatus);
  bindEvents();
  setAppMode(APP_MODES.GUIDE, { announce: false, triggerGuide: false });
  setStatus('Focus mode ready. Select a screen to begin.', 'default');
  setTaskButtonsEnabled(false);
  clearChatLog();
  setupResizeObserver();
}

init();
