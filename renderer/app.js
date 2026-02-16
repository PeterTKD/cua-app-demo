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

function updateChatLayout() {
  if (!elements.chatLog) return;
  const hasMessages = elements.chatLog.children.length > 0;
  elements.chatLog.classList.toggle('has-messages', hasMessages);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderMarkdown(value) {
  const text = escapeHtml(value || '');
  const lines = text.split(/\r?\n/);
  let html = '';
  let inCode = false;
  let listOpen = false;
  let codeBuffer = [];

  const flushList = () => {
    if (listOpen) {
      html += '</ul>';
      listOpen = false;
    }
  };

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      if (inCode) {
        html += `<pre><code>${codeBuffer.join('\n')}</code></pre>`;
        codeBuffer = [];
        inCode = false;
      } else {
        flushList();
        inCode = true;
      }
      return;
    }
    if (inCode) {
      codeBuffer.push(line);
      return;
    }
    const listMatch = trimmed.match(/^[-*]\s+(.+)$/);
    if (listMatch) {
      if (!listOpen) {
        html += '<ul>';
        listOpen = true;
      }
      html += `<li>${listMatch[1]}</li>`;
      return;
    }
    flushList();
    if (!trimmed) {
      html += '<br />';
      return;
    }
    html += `<p>${trimmed}</p>`;
  });

  flushList();
  if (inCode && codeBuffer.length) {
    html += `<pre><code>${codeBuffer.join('\n')}</code></pre>`;
  }

  html = html
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*(?!\s)([^*]+?)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');

  return html;
}

let activeStreamInterval = null;

function streamTextIntoBubble(bubble, message, onDone) {
  const chars = Array.from(message);
  let index = 0;
  const chunkSize = 2;
  const intervalMs = 12;
  let resizeTick = 0;

  bubble.classList.add('streaming');
  bubble.innerHTML = '';

  activeStreamInterval = setInterval(() => {
    const end = Math.min(index + chunkSize, chars.length);
    const partial = chars.slice(0, end).join('');
    bubble.innerHTML = renderMarkdown(partial);
    index = end;
    elements.chatLog.scrollTop = elements.chatLog.scrollHeight;

    resizeTick += 1;
    if (resizeTick % 5 === 0) {
      requestWidgetResize();
    }

    if (index >= chars.length) {
      clearInterval(activeStreamInterval);
      activeStreamInterval = null;
      bubble.classList.remove('streaming');
      if (onDone) onDone();
    }
  }, intervalMs);
}

function finishActiveStream() {
  if (activeStreamInterval) {
    clearInterval(activeStreamInterval);
    activeStreamInterval = null;
    const streaming = elements.chatLog?.querySelector('.chat-bubble.streaming');
    if (streaming) {
      streaming.classList.remove('streaming');
    }
  }
}

function addChatMessage(message, role) {
  if (!elements.chatLog) return;
  finishActiveStream();
  if (role === 'assistant' && typeof message === 'string' && message.includes('<<TASK_COMPLETED>>')) {
    addSystemMessage('<<TASK_COMPLETED>> Task Completed');
    const cleaned = message.replace('<<TASK_COMPLETED>>', '').replace(/^\s+/, '').trim();
    if (!cleaned) {
      return;
    }
    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble assistant';
    elements.chatLog.appendChild(bubble);
    updateChatLayout();
    requestWidgetResize();
    streamTextIntoBubble(bubble, cleaned, () => requestWidgetResize());
    return;
  }
  const bubble = document.createElement('div');
  bubble.className = `chat-bubble ${role === 'user' ? 'user' : 'assistant'}`;

  if (role === 'assistant') {
    elements.chatLog.appendChild(bubble);
    elements.chatLog.scrollTop = elements.chatLog.scrollHeight;
    updateChatLayout();
    requestWidgetResize();
    streamTextIntoBubble(bubble, message, () => requestWidgetResize());
  } else {
    bubble.innerHTML = renderMarkdown(message);
    elements.chatLog.appendChild(bubble);
    elements.chatLog.scrollTop = elements.chatLog.scrollHeight;
    updateChatLayout();
    requestWidgetResize();
  }
}

function addSystemMessage(text) {
  if (!elements.chatLog) return;
  const bubble = document.createElement('div');
  const isTaskCompleted = typeof text === 'string' && text.includes('<<TASK_COMPLETED>>');
  bubble.className = isTaskCompleted ? 'chat-bubble system task-completed' : 'chat-bubble system';
  const cleaned = isTaskCompleted
    ? text.replace('<<TASK_COMPLETED>>', '').replace(/^\s+/, '').trim()
    : text;
  bubble.textContent = cleaned || (isTaskCompleted ? 'Task Completed' : '');
  elements.chatLog.appendChild(bubble);
  elements.chatLog.scrollTop = elements.chatLog.scrollHeight;
  updateChatLayout();
  requestWidgetResize();
}

function clearChatLog() {
  if (!elements.chatLog) return;
  elements.chatLog.innerHTML = '';
  updateChatLayout();
}

function setTaskButtonsEnabled(enabled) {
  if (elements.diffMethodButton) elements.diffMethodButton.disabled = !enabled;
  if (elements.pointElementButton) elements.pointElementButton.disabled = !enabled;
  if (elements.historyButton) elements.historyButton.disabled = !enabled;
  if (elements.nextButton) elements.nextButton.disabled = !enabled;
}

function getFollowupDelayMs() {
  return appMode === APP_MODES.GUIDE ? 250 : 2000;
}

function setGuideProcessActive(active) {
  const wasActive = isGuideProcessActive;
  isGuideProcessActive = Boolean(active);
  if (!isGuideProcessActive) {
    guideProcessEpoch += 1;
  }
  if (elements.widget) {
    elements.widget.classList.toggle('guide-process-active', isGuideProcessActive);

    if (isGuideProcessActive && !wasActive) {
      elements.widget.classList.remove('chat-entering');
      elements.widget.classList.add('focus-entering');
      elements.widget.addEventListener('animationend', () => {
        elements.widget.classList.remove('focus-entering');
      }, { once: true });
    } else if (!isGuideProcessActive && wasActive) {
      elements.widget.classList.remove('focus-entering');
      elements.widget.classList.add('chat-entering');
      elements.widget.addEventListener('animationend', () => {
        elements.widget.classList.remove('chat-entering');
      }, { once: true });
    }
  }
  requestWidgetResize();
  setTimeout(() => requestWidgetResize(), 50);
  setTimeout(() => requestWidgetResize(), 200);
  setTimeout(() => requestWidgetResize(), 450);
}

function updateModeUI() {
  const isGuide = appMode === APP_MODES.GUIDE;
  if (elements.modeBadge) {
    elements.modeBadge.textContent = isGuide ? 'Focus' : 'Chat';
  }
  if (elements.askButton) {
    elements.askButton.textContent = 'Send';
  }
  if (elements.questionInput) {
    elements.questionInput.placeholder = isGuide
      ? 'Optional goal (automatic focus when task is active)'
      : 'Ask anything about this screen';
  }
}

const GUIDE_INTENT_PATTERNS = [
  /\b(click|double click|tap|press|select|choose|open|go to|navigate|scroll|drag|type|fill|enter)\b/i,
  /\b(where is|show me|point to|highlight|walk me through|step by step|guide me|help me do)\b/i,
  /\b(on this screen|in this app|next step|what should i do next)\b/i
];

const CHAT_INTENT_PATTERNS = [
  /\b(explain|why|what is|how does|difference between|compare|summarize|definition)\b/i,
  /\b(brainstorm|ideas|pros and cons|best practice|recommend)\b/i,
  /\?/
];

function inferModeFromQuestion(question) {
  const text = String(question || '').trim();
  if (!text) {
    return appMode;
  }

  let guideScore = 0;
  let chatScore = 0;

  GUIDE_INTENT_PATTERNS.forEach((pattern) => {
    if (pattern.test(text)) {
      guideScore += 1;
    }
  });
  CHAT_INTENT_PATTERNS.forEach((pattern) => {
    if (pattern.test(text)) {
      chatScore += 1;
    }
  });

  if (guideScore > chatScore) return APP_MODES.GUIDE;
  if (chatScore > guideScore) return APP_MODES.CHAT;
  return appMode;
}

function resolveAutoMode(options, question) {
  if (options.mode === APP_MODES.GUIDE || options.mode === APP_MODES.CHAT) {
    return options.mode;
  }
  if (options.mode === 'diff_method' || options.mode === 'point') {
    return APP_MODES.GUIDE;
  }
  if (options.auto === true || hasPendingAction() || getCurrentAction()) {
    return APP_MODES.GUIDE;
  }
  return inferModeFromQuestion(question);
}

function isGuidanceActionType(actionType) {
  return ['click', 'double_click', 'drag', 'scroll', 'scroll_up', 'scroll_down', 'keypress', 'type', 'wait'].includes(actionType);
}

async function startGuideKickoff(force = false) {
  if (appMode !== APP_MODES.GUIDE || isRunningCua) {
    return;
  }
  if (hasGuideKickoffStarted && !force) {
    return;
  }
  const bounds = await window.electronAPI.getSharedDisplayBounds();
  if (!bounds || !bounds.bounds) {
    setGuideProcessActive(false);
    setStatus('Focus mode ready. Select a screen to begin.', 'default');
    return;
  }
  hasGuideKickoffStarted = true;
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

function setAppMode(mode, options = {}) {
  const { announce = true, triggerGuide = true } = options;
  if (!Object.values(APP_MODES).includes(mode)) {
    return;
  }
  if (mode === appMode) {
    updateModeUI();
    if (mode === APP_MODES.GUIDE && triggerGuide) {
      startGuideKickoff(true).catch((error) => {
        setStatus(error.message || 'Failed to start focus mode.', 'error');
      });
    }
    return;
  }
  appMode = mode;
  hasGuideKickoffStarted = false;
  if (mode !== APP_MODES.GUIDE) {
    setGuideProcessActive(false);
  }
  updateModeUI();
  if (mode === APP_MODES.GUIDE) {
    if (announce) {
      addSystemMessage('Focus mode active.');
    }
    if (triggerGuide) {
      startGuideKickoff(true).catch((error) => {
        setStatus(error.message || 'Failed to start focus mode.', 'error');
      });
    }
  } else {
    if (announce) {
      addSystemMessage('Chat mode active.');
    }
    setStatus('Chat mode active. Ask your question.', 'default');
  }
  requestWidgetResize();
}

let lastQuestion = '';
let isRunningCua = false;
let lastClickTime = 0;
let lastClickPoint = null;
let dragArmed = false;
let lastKeydownAt = 0;
let resizeRaf = null;
let appMode = 'guide';
let hasGuideKickoffStarted = false;
let isGuideProcessActive = false;
let guideProcessEpoch = 0;

const POSITION_TOLERANCE = 20;
const DOUBLE_CLICK_WINDOW_MS = 550;
const APP_MODES = {
  GUIDE: 'guide',
  CHAT: 'chat'
};

const CHAT_WIDTH = 420;
const FOCUS_WIDTH = 350;

function requestWidgetResize() {
  if (!elements.widget || !window.electronAPI?.resizeWidget) {
    return;
  }
  if (resizeRaf) {
    cancelAnimationFrame(resizeRaf);
  }
  resizeRaf = requestAnimationFrame(() => {
    resizeRaf = null;
    const padding = 48;
    const isFocus = elements.widget.classList.contains('guide-process-active');
    const targetWidth = isFocus ? FOCUS_WIDTH : CHAT_WIDTH;
    const width = Math.max(targetWidth, Math.ceil(elements.widget.scrollWidth + padding));
    const height = Math.ceil(elements.widget.scrollHeight + padding);
    window.electronAPI.resizeWidget({ width, height });
  });
}

function setupResizeObserver() {
  requestWidgetResize();
}

function withinTolerance(x, y, targetX, targetY) {
  const dx = x - targetX;
  const dy = y - targetY;
  return Math.hypot(dx, dy) <= POSITION_TOLERANCE;
}

function completeStep(message) {
  const action = getCurrentAction();
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
  const followupDelayMs = appMode === APP_MODES.GUIDE ? 250 : 2000;
  const settleDelayMs = appMode === APP_MODES.GUIDE ? 250 : 1000;
  const stepEpoch = guideProcessEpoch;
  setTimeout(() => {
    if (stepEpoch !== guideProcessEpoch) {
      return;
    }
    handleAsk({
      delayMs: followupDelayMs,
      auto: true,
      userStatus: 'Action Criteria Met',
      allowEmpty: true,
      emptyInput: true,
      mode: appMode,
      fastCapture: appMode === APP_MODES.GUIDE
    });
  }, settleDelayMs);
}

function normalizeKeyName(value) {
  return String(value || '').trim().toLowerCase();
}

function matchesKeyCombo(actionKeys, eventData) {
  const expanded = actionKeys
    .flatMap((key) => String(key || '').split('+'))
    .map(normalizeKeyName)
    .filter(Boolean);
  const required = expanded.map((key) => {
    if (key === 'control') return 'ctrl';
    if (key === 'command') return 'cmd';
    return key;
  });
  if (required.length === 0) return true;

  const needsCtrl = required.includes('ctrl') || required.includes('control');
  const needsAlt = required.includes('alt');
  const needsShift = required.includes('shift');
  const needsMeta = required.includes('meta') || required.includes('cmd') || required.includes('command') || required.includes('win');

  if (needsCtrl && !eventData.ctrlKey) return false;
  if (needsAlt && !eventData.altKey) return false;
  if (needsShift && !eventData.shiftKey) return false;
  if (needsMeta && !eventData.metaKey) return false;

  const nonModifier = required.filter((key) => !['ctrl', 'alt', 'shift', 'meta', 'cmd', 'win'].includes(key));
  if (nonModifier.length === 0) {
    return true;
  }

  const rawcode = eventData.rawcode || eventData.keycode;
  const isModifierEvent = [16, 17, 18, 91, 92].includes(rawcode);
  const keyMatches = nonModifier.some((key) => {
    if (key.length === 1) {
      const upper = key.toUpperCase();
      const code = upper.charCodeAt(0);
      return rawcode === code;
    }
    if (key === 'enter') return rawcode === 13;
    if (key === 'escape' || key === 'esc') return rawcode === 27;
    if (key === 'tab') return rawcode === 9;
    if (key === 'space' || key === 'spacebar') return rawcode === 32;
    if (key === 'backspace') return rawcode === 8;
    if (key === 'delete' || key === 'del') return rawcode === 46;
    if (key === 'home') return rawcode === 36;
    if (key === 'end') return rawcode === 35;
    if (key === 'pageup' || key === 'page_up') return rawcode === 33;
    if (key === 'pagedown' || key === 'page_down') return rawcode === 34;
    if (key === 'insert') return rawcode === 45;
    if (key === 'left') return rawcode === 37;
    if (key === 'up') return rawcode === 38;
    if (key === 'right') return rawcode === 39;
    if (key === 'down') return rawcode === 40;
    if (key.startsWith('f')) {
      const n = Number.parseInt(key.slice(1), 10);
      if (Number.isFinite(n) && n >= 1 && n <= 24) {
        return rawcode === 111 + n;
      }
    }
    return false;
  });

  if (keyMatches) {
    return true;
  }
  if (nonModifier.length === 1 && !isModifierEvent) {
    return true;
  }
  return false;
}

function completeTaskAndReset() {
  clearTargetRect();
  clearCurrentAction();
  resetCuaState();
  clearHistory();
  lastQuestion = '';
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
  if (shouldReuseLast && lastQuestion) {
    return lastQuestion;
  }
  return '';
}

async function handleAsk(options = {}) {
  const question = options.emptyInput === true
    ? ''
    : resolveQuestion(options.mode, options.forceLast === true);
  const activeMode = resolveAutoMode(options, question);
  if (activeMode !== appMode) {
    setAppMode(activeMode, { announce: false, triggerGuide: false });
  }
  const allowEmpty = options.allowEmpty === true || activeMode === APP_MODES.GUIDE;
  if (!question && !allowEmpty) {
    setStatus('Type a question before asking.', 'error');
    return;
  }

  try {
    if (isRunningCua) {
      return;
    }
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
    isRunningCua = true;
    if (question) {
      lastQuestion = question;
    }
    const runOptions = {
      ...options,
      mode: activeMode,
      allowEmpty
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
    }
    if (result && isGuidanceActionType(result.actionType)) {
      if (appMode !== APP_MODES.GUIDE) {
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
        if (appMode !== inferredFromQuestion) {
          setAppMode(inferredFromQuestion, { announce: false, triggerGuide: false });
        }
      }
    }
    if (result && result.actionType === 'wait') {
      setStatus('Waiting...', 'default');
      setTimeout(() => {
        completeStep('Wait complete.');
      }, appMode === APP_MODES.GUIDE ? 300 : 2000);
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
      if ((lastQuestion || activeMode === APP_MODES.GUIDE) && !isRunningCua) {
        const delayMs = activeMode === APP_MODES.GUIDE ? 500 : 2000;
        const followupEpoch = guideProcessEpoch;
        setTimeout(() => {
          if (followupEpoch !== guideProcessEpoch) {
            return;
          }
          if (!isRunningCua) {
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
    isRunningCua = false;
    if (lastQuestion) {
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
    if (appMode === APP_MODES.GUIDE) {
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
    if (isRunningCua) {
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
    if (isRunningCua) {
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
    if (!lastQuestion || isRunningCua) {
      return;
    }
    const action = getCurrentAction();
    if (action && (!['click', 'double_click', 'drag'].includes(action.type) || action.type === 'pinpoint')) {
      completeStep('Step complete.');
      return;
    }
    elements.questionInput.value = lastQuestion;
    await handleAsk({ delayMs: getFollowupDelayMs(), auto: true, forceLast: true, mode: appMode });
    });
  }
  window.electronAPI.onOverlayNext(() => {
    if (!lastQuestion || isRunningCua) {
      return;
    }
    const action = getCurrentAction();
    if (action && (!['click', 'double_click', 'drag'].includes(action.type) || action.type === 'pinpoint')) {
      completeStep('Step complete.');
      return;
    }
    elements.questionInput.value = lastQuestion;
    handleAsk({ delayMs: getFollowupDelayMs(), auto: true, forceLast: true, mode: appMode });
  });
  window.electronAPI.onCalloutComplete(() => {
    completeTaskAndReset();
  });
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
    if (!action) {
      return;
    }
    if (action.type === 'pinpoint') {
      if (withinTolerance(data.absoluteX, data.absoluteY, action.x, action.y)) {
        completeStep('Pinpoint acknowledged.');
      }
      return;
    }
    if (action.type !== 'drag' || !dragArmed) {
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

  window.electronAPI.onOSKeyDown((event, data) => {
    const action = getCurrentAction();
    if (!action) return;
    if (action.type === 'keypress') {
      if (Array.isArray(action.keys) && action.keys.length > 1) {
        const now = Date.now();
        if (matchesKeyCombo(action.keys, data)) {
          completeStep('Input complete.');
          return;
        }
        lastKeydownAt = now;
        return;
      }
      completeStep('Input complete.');
    }
  });

  window.electronAPI.onMainWindowClosing(() => {
    stopShare();
  });
}

function init() {
  bindEvents();
  setAppMode(APP_MODES.GUIDE, { announce: false, triggerGuide: false });
  setStatus('Focus mode ready. Select a screen to begin.', 'default');
  setTaskButtonsEnabled(false);
  clearChatLog();
  setupResizeObserver();
}

init();
