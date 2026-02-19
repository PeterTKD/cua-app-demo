import { elements } from './dom.js';
import { appState } from './state.js';
import { requestWidgetResize } from './resize.js';

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

export function updateChatLayout() {
  if (!elements.chatLog) return;
  const hasMessages = elements.chatLog.children.length > 0;
  elements.chatLog.classList.toggle('has-messages', hasMessages);
}

export function streamTextIntoBubble(bubble, message, onDone) {
  const chars = Array.from(message);
  let index = 0;
  const chunkSize = 2;
  const intervalMs = 12;
  let resizeTick = 0;

  bubble.classList.add('streaming');
  bubble.innerHTML = '';

  appState.activeStreamInterval = setInterval(() => {
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
      clearInterval(appState.activeStreamInterval);
      appState.activeStreamInterval = null;
      bubble.classList.remove('streaming');
      if (onDone) onDone();
    }
  }, intervalMs);
}

export function finishActiveStream() {
  if (appState.activeStreamInterval) {
    clearInterval(appState.activeStreamInterval);
    appState.activeStreamInterval = null;
    const streaming = elements.chatLog?.querySelector('.chat-bubble.streaming');
    if (streaming) {
      streaming.classList.remove('streaming');
    }
  }
}

export function addChatMessage(message, role) {
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

export function addSystemMessage(text) {
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

export function clearChatLog() {
  if (!elements.chatLog) return;
  elements.chatLog.innerHTML = '';
  updateChatLayout();
}
