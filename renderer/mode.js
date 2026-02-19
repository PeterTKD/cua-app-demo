import { elements } from './dom.js';
import { appState, APP_MODES } from './state.js';
import { requestWidgetResize } from './resize.js';
import { addSystemMessage } from './chat.js';
import { hasPendingAction, getCurrentAction } from './cua.js';

let _setStatusFn = null;

export function registerSetStatus(fn) {
  _setStatusFn = fn;
}

export const GUIDE_INTENT_PATTERNS = [
  /\b(click|double click|tap|press|select|choose|open|go to|navigate|scroll|drag|type|fill|enter)\b/i,
  /\b(where is|show me|point to|highlight|walk me through|step by step|guide me|help me do)\b/i,
  /\b(on this screen|in this app|next step|what should i do next)\b/i
];

export const CHAT_INTENT_PATTERNS = [
  /\b(explain|why|what is|how does|difference between|compare|summarize|definition)\b/i,
  /\b(brainstorm|ideas|pros and cons|best practice|recommend)\b/i,
  /\?/
];

export function inferModeFromQuestion(question) {
  const text = String(question || '').trim();
  if (!text) {
    return appState.appMode;
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
  return appState.appMode;
}

export function resolveAutoMode(options, question) {
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

export function isGuidanceActionType(actionType) {
  return ['click', 'double_click', 'drag', 'scroll', 'scroll_up', 'scroll_down', 'keypress', 'type', 'wait'].includes(actionType);
}

export function updateModeUI() {
  const isGuide = appState.appMode === APP_MODES.GUIDE;
  if (elements.modeBadge) {
    elements.modeBadge.textContent = isGuide ? 'Focus' : 'Chat';
  }
  if (elements.askButton) {
    elements.askButton.textContent = 'Send';
  }
  if (elements.questionInput) {
    elements.questionInput.placeholder = isGuide
      ? 'Ask a question.'
      : 'Ask anything about this screen';
  }
}

export function getFollowupDelayMs() {
  return appState.appMode === APP_MODES.GUIDE ? 250 : 2000;
}

export function setGuideProcessActive(active) {
  const wasActive = appState.isGuideProcessActive;
  appState.isGuideProcessActive = Boolean(active);
  if (!appState.isGuideProcessActive) {
    appState.guideProcessEpoch += 1;
  }
  if (elements.widget) {
    elements.widget.classList.toggle('guide-process-active', appState.isGuideProcessActive);

    if (appState.isGuideProcessActive && !wasActive) {
      elements.widget.classList.remove('chat-entering');
      elements.widget.classList.add('focus-entering');
      elements.widget.addEventListener('animationend', () => {
        elements.widget.classList.remove('focus-entering');
      }, { once: true });
    } else if (!appState.isGuideProcessActive && wasActive) {
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

export function setAppMode(mode, options = {}) {
  const { announce = true, triggerGuide = true, onGuideKickoff } = options;
  if (!Object.values(APP_MODES).includes(mode)) {
    return;
  }
  if (mode === appState.appMode) {
    updateModeUI();
    if (mode === APP_MODES.GUIDE && triggerGuide) {
      onGuideKickoff?.();
    }
    return;
  }
  appState.appMode = mode;
  appState.hasGuideKickoffStarted = false;
  if (mode !== APP_MODES.GUIDE) {
    setGuideProcessActive(false);
  }
  updateModeUI();
  if (mode === APP_MODES.GUIDE) {
    if (announce) {
      addSystemMessage('Focus mode active.');
    }
    if (triggerGuide) {
      onGuideKickoff?.();
    }
  } else {
    if (announce) {
      addSystemMessage('Chat mode active.');
    }
    if (_setStatusFn) {
      _setStatusFn('Chat mode active. Ask your question.', 'default');
    }
  }
  requestWidgetResize();
}
