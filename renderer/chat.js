import { elements } from './dom.js';
import { appState } from './state.js';
import { requestWidgetResize } from './resize.js';

const ACTION_LABELS = {
  click: 'Click',
  double_click: 'Double Click',
  drag: 'Drag',
  scroll: 'Scroll',
  scroll_up: 'Scroll Up',
  scroll_down: 'Scroll Down',
  keypress: 'Key Press',
  type: 'Type',
  wait: 'Wait',
  pinpoint: 'Pinpoint',
  callout: 'Callout',
  completed: 'Completed'
};

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderMarkdown(value) {
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

function normalizeActionType(actionType) {
  return String(actionType || '').trim().toLowerCase();
}

function getActionLabel(actionType) {
  const normalized = normalizeActionType(actionType);
  return ACTION_LABELS[normalized] || 'Action';
}

function getActionIconMarkup(actionType) {
  const normalized = normalizeActionType(actionType);
  switch (normalized) {
    case 'click':
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 11V5.8a1.8 1.8 0 0 1 3.3-.98l1.1 1.76a1.8 1.8 0 0 0 1.52.84h1.05A1.8 1.8 0 0 1 16.8 9.2V12"></path><path d="M8.5 12.5h8.2a1.8 1.8 0 0 1 1.74 2.25l-1 3.9A2.6 2.6 0 0 1 14.92 21H10.4a2.6 2.6 0 0 1-2.5-1.94l-1-3.9a2.2 2.2 0 0 1 1.6-2.66Z"></path></svg>';
    case 'double_click':
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 4v8l6-4-6-4Z"></path><path d="M12 4v8l6-4-6-4Z"></path><path d="M7 18h10"></path></svg>';
    case 'drag':
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2v5"></path><path d="m9 5 3-3 3 3"></path><path d="M12 22v-5"></path><path d="m9 19 3 3 3-3"></path><path d="M2 12h5"></path><path d="m5 9-3 3 3 3"></path><path d="M22 12h-5"></path><path d="m19 9 3 3-3 3"></path><path d="M12 8.5v7"></path><path d="M9.5 11.5 12 9l2.5 2.5"></path></svg>';
    case 'scroll':
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v16"></path><path d="m9 7 3-3 3 3"></path><path d="m9 17 3 3 3-3"></path><circle cx="12" cy="12" r="1.6"></circle></svg>';
    case 'scroll_up':
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m7 15 5-5 5 5"></path><path d="m7 20 5-5 5 5"></path></svg>';
    case 'scroll_down':
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m7 4 5 5 5-5"></path><path d="m7 9 5 5 5-5"></path></svg>';
    case 'keypress':
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="3"></rect><path d="M7 10h.01"></path><path d="M11 10h.01"></path><path d="M15 10h.01"></path><path d="M7 14h10"></path></svg>';
    case 'type':
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16"></path><path d="M8 7v10"></path><path d="M16 7v10"></path><path d="M12 7v10"></path><path d="M9 17h6"></path></svg>';
    case 'wait':
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 6v6l4 2"></path><circle cx="12" cy="12" r="8"></circle></svg>';
    case 'pinpoint':
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="6"></circle><circle cx="12" cy="12" r="2"></circle><path d="M12 2v3"></path><path d="M12 19v3"></path><path d="M2 12h3"></path><path d="M19 12h3"></path></svg>';
    case 'callout':
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"></path></svg>';
    default:
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8"></circle><path d="M12 8v4"></path><path d="M12 16h.01"></path></svg>';
  }
}

function getCheckIconMarkup() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 12.5l4 4 8-9"></path></svg>';
}

function createIconToken(actionType, className = 'action-icon-token') {
  const token = document.createElement('span');
  token.className = className;
  token.innerHTML = getActionIconMarkup(actionType);
  return token;
}

function createCheckToken(className) {
  const token = document.createElement('span');
  token.className = className;
  token.innerHTML = getCheckIconMarkup();
  return token;
}

function createMessageStream() {
  const stream = document.createElement('div');
  stream.className = 'message-stream';
  return stream;
}

function createAssistantBubble(meta = {}) {
  const normalizedActionType = normalizeActionType(meta.actionType);
  if (!normalizedActionType || normalizedActionType === 'error') {
    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble assistant regular-assistant';
    const stream = createMessageStream();
    bubble.appendChild(stream);
    return { bubble, streamTarget: stream };
  }

  const bubble = document.createElement('div');
  bubble.className = `chat-bubble assistant action-card action-${normalizedActionType.replace(/[^a-z0-9]+/g, '-')}`;

  const ribbon = document.createElement('div');
  ribbon.className = 'action-card-ribbon';

  const title = document.createElement('div');
  title.className = 'action-card-title';
  title.appendChild(createIconToken(normalizedActionType));

  const label = document.createElement('span');
  label.className = 'action-card-label';
  label.textContent = getActionLabel(normalizedActionType);
  title.appendChild(label);
  ribbon.appendChild(title);

  const status = document.createElement('div');
  status.className = 'action-card-status';
  if (meta.completed) {
    status.appendChild(createCheckToken('action-complete-badge'));
  }
  ribbon.appendChild(status);

  const body = document.createElement('div');
  body.className = 'action-card-body';
  const stream = createMessageStream();
  body.appendChild(stream);

  bubble.dataset.actionType = normalizedActionType;
  if (meta.completed) {
    bubble.dataset.completed = 'true';
    bubble.classList.add('completed');
  }

  const inner = document.createElement('div');
  inner.className = 'action-card-inner';
  inner.appendChild(ribbon);
  inner.appendChild(body);
  bubble.appendChild(inner);

  return { bubble, streamTarget: stream };
}

function trackActionBubble(bubble) {
  if (!bubble) {
    return;
  }
  appState.actionMessageBubbles = (appState.actionMessageBubbles || []).filter((item) => item && item.isConnected);
  appState.actionMessageBubbles.push(bubble);
}

function createSystemPill(text) {
  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble system default-system';

  const pill = document.createElement('div');
  pill.className = 'system-pill';
  pill.textContent = text;
  bubble.appendChild(pill);

  return bubble;
}

function createActionStatusBubble(actionType) {
  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble system action-status';

  const ribbon = document.createElement('div');
  ribbon.className = 'action-status-ribbon';

  const main = document.createElement('div');
  main.className = 'action-status-main';
  main.appendChild(createIconToken(actionType, 'action-status-icon'));

  const label = document.createElement('span');
  label.className = 'action-status-label';
  label.textContent = getActionLabel(actionType);
  main.appendChild(label);

  ribbon.appendChild(main);
  ribbon.appendChild(createCheckToken('action-status-check'));
  bubble.appendChild(ribbon);

  return bubble;
}

function createTaskCompletedBubble(text) {
  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble system task-completed';

  const card = document.createElement('div');
  card.className = 'task-completed-card';

  const title = document.createElement('div');
  title.className = 'task-completed-title';
  title.textContent = text || 'Task Completed';

  card.appendChild(title);
  card.appendChild(createCheckToken('task-completed-icon'));
  bubble.appendChild(card);

  return bubble;
}

export function updateChatLayout() {
  if (!elements.chatLog) return;
  const hasMessages = elements.chatLog.children.length > 0;
  elements.chatLog.classList.toggle('has-messages', hasMessages);
}

export function streamTextIntoBubble(target, message, onDone) {
  const chars = Array.from(message);
  let index = 0;
  const chunkSize = 2;
  const intervalMs = 12;
  let resizeTick = 0;

  appState.activeStreamTarget = target;
  appState.activeStreamMessage = String(message || '');
  appState.activeStreamOnDone = typeof onDone === 'function' ? onDone : null;
  target.classList.add('streaming');
  target.innerHTML = '';

  appState.activeStreamInterval = setInterval(() => {
    const end = Math.min(index + chunkSize, chars.length);
    const partial = chars.slice(0, end).join('');
    target.innerHTML = renderMarkdown(partial);
    index = end;
    elements.chatLog.scrollTop = elements.chatLog.scrollHeight;

    resizeTick += 1;
    if (resizeTick % 5 === 0) {
      requestWidgetResize();
    }

    if (index >= chars.length) {
      clearInterval(appState.activeStreamInterval);
      appState.activeStreamInterval = null;
      target.classList.remove('streaming');
      const done = appState.activeStreamOnDone;
      appState.activeStreamTarget = null;
      appState.activeStreamMessage = '';
      appState.activeStreamOnDone = null;
      if (done) done();
    }
  }, intervalMs);
}

export function finishActiveStream() {
  if (appState.activeStreamInterval) {
    clearInterval(appState.activeStreamInterval);
    appState.activeStreamInterval = null;
    const target = appState.activeStreamTarget
      || elements.chatLog?.querySelector('.message-stream.streaming, .chat-bubble.streaming');
    if (target) {
      if (typeof appState.activeStreamMessage === 'string') {
        target.innerHTML = renderMarkdown(appState.activeStreamMessage);
      }
      target.classList.remove('streaming');
    }
    const done = appState.activeStreamOnDone;
    appState.activeStreamTarget = null;
    appState.activeStreamMessage = '';
    appState.activeStreamOnDone = null;
    if (done) done();
  }
}

export function addChatMessage(message, role, meta = {}) {
  if (!elements.chatLog) return;
  finishActiveStream();

  if (role === 'assistant' && typeof message === 'string' && message.includes('<<TASK_COMPLETED>>')) {
    addSystemMessage('<<TASK_COMPLETED>> Task Completed');
    const cleaned = message.replace('<<TASK_COMPLETED>>', '').replace(/^\s+/, '').trim();
    if (!cleaned) {
      return;
    }
    const { bubble, streamTarget } = createAssistantBubble(meta);
    if (bubble.classList.contains('action-card')) {
      trackActionBubble(bubble);
    }
    elements.chatLog.appendChild(bubble);
    updateChatLayout();
    requestWidgetResize();
    streamTextIntoBubble(streamTarget, cleaned, () => requestWidgetResize());
    return;
  }

  if (role === 'assistant') {
    const { bubble, streamTarget } = createAssistantBubble(meta);
    if (bubble.classList.contains('action-card')) {
      trackActionBubble(bubble);
    }
    elements.chatLog.appendChild(bubble);
    elements.chatLog.scrollTop = elements.chatLog.scrollHeight;
    updateChatLayout();
    requestWidgetResize();
    streamTextIntoBubble(streamTarget, message, () => requestWidgetResize());
    return;
  }

  const bubble = document.createElement('div');
  bubble.className = `chat-bubble ${role === 'user' ? 'user' : 'assistant regular-assistant'}`;
  if (role === 'user') {
    const stream = createMessageStream();
    stream.textContent = message;
    bubble.appendChild(stream);
  } else {
    bubble.innerHTML = renderMarkdown(message);
  }
  elements.chatLog.appendChild(bubble);
  elements.chatLog.scrollTop = elements.chatLog.scrollHeight;
  updateChatLayout();
  requestWidgetResize();
}

export function addSystemMessage(text, options = {}) {
  if (!elements.chatLog) return;

  const rawText = typeof text === 'string' ? text : '';
  const isTaskCompleted = options.kind === 'task-completed' || rawText.includes('<<TASK_COMPLETED>>');
  const cleaned = isTaskCompleted
    ? rawText.replace('<<TASK_COMPLETED>>', '').replace(/^\s+/, '').trim()
    : rawText.trim();

  let bubble;
  if (options.kind === 'action-completed') {
    bubble = createActionStatusBubble(options.actionType);
  } else if (isTaskCompleted) {
    bubble = createTaskCompletedBubble(cleaned || 'Task Completed');
  } else {
    bubble = createSystemPill(cleaned || 'Status');
  }

  elements.chatLog.appendChild(bubble);
  elements.chatLog.scrollTop = elements.chatLog.scrollHeight;
  updateChatLayout();
  requestWidgetResize();
}

export function markLastActionCompleted(actionType) {
  if (!elements.chatLog) return false;

  const normalizedActionType = normalizeActionType(actionType);
  appState.actionMessageBubbles = (appState.actionMessageBubbles || []).filter((bubble) => bubble && bubble.isConnected);
  let target = [...appState.actionMessageBubbles].reverse().find((bubble) => {
    if (bubble.dataset.completed === 'true') {
      return false;
    }
    if (!normalizedActionType) {
      return true;
    }
    return bubble.dataset.actionType === normalizedActionType;
  });

  if (!target) {
    const bubbles = Array.from(elements.chatLog.querySelectorAll('.chat-bubble.assistant.action-card'));
    target = bubbles.reverse().find((bubble) => {
      if (bubble.dataset.completed === 'true') {
        return false;
      }
      if (!normalizedActionType) {
        return true;
      }
      return bubble.dataset.actionType === normalizedActionType;
    });
  }

  if (!target) {
    return false;
  }

  const status = target.querySelector('.action-card-status');
  if (!status) {
    return false;
  }

  status.innerHTML = '';
  status.appendChild(createCheckToken('action-complete-badge'));
  target.dataset.completed = 'true';
  target.classList.add('completed');
  requestWidgetResize();
  return true;
}

export function clearChatLog() {
  if (!elements.chatLog) return;
  elements.chatLog.innerHTML = '';
  appState.actionMessageBubbles = [];
  updateChatLayout();
}
