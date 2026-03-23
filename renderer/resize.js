import { elements } from './dom.js';
import { appState, CHAT_WIDTH, FOCUS_WIDTH } from './state.js';

let widgetResizeObserver = null;
let chatMutationObserver = null;

function getElementMaxHeight(element) {
  if (!element) return Infinity;
  const raw = window.getComputedStyle(element).maxHeight;
  if (!raw || raw === 'none') return Infinity;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : Infinity;
}

function measureVisibleWidgetHeight() {
  if (!elements.widget) {
    return 0;
  }

  let total = 0;
  for (const child of Array.from(elements.widget.children)) {
    if (!(child instanceof HTMLElement)) {
      continue;
    }
    const style = window.getComputedStyle(child);
    if (style.display === 'none' || style.visibility === 'hidden') {
      continue;
    }

    let childHeight = Math.ceil(child.offsetHeight || child.scrollHeight || 0);
    if (child === elements.chatLog) {
      const maxHeight = getElementMaxHeight(child);
      childHeight = Math.ceil(Math.min(child.scrollHeight || child.offsetHeight || 0, maxHeight));
    }

    const marginTop = Number.parseFloat(style.marginTop) || 0;
    const marginBottom = Number.parseFloat(style.marginBottom) || 0;
    total += childHeight + marginTop + marginBottom;
  }

  return total;
}

export function requestWidgetResize() {
  if (!elements.widget || !window.electronAPI?.resizeWidget) {
    return;
  }
  if (appState.resizeRaf) {
    cancelAnimationFrame(appState.resizeRaf);
  }
  appState.resizeRaf = requestAnimationFrame(() => {
    appState.resizeRaf = null;
    const padding = 48;
    const isFocus = elements.widget.classList.contains('guide-process-active');
    const targetWidth = isFocus ? FOCUS_WIDTH : CHAT_WIDTH;
    const contentWidth = Math.max(targetWidth, Math.ceil(elements.widget.scrollWidth + padding));
    const currentWidth = Math.ceil(elements.widget.getBoundingClientRect().width || 0);
    const width = isFocus ? Math.max(contentWidth, currentWidth) : contentWidth;
    const contentHeight = Math.max(
      measureVisibleWidgetHeight(),
      elements.widget.scrollHeight,
      elements.widget.offsetHeight
    );
    const height = Math.ceil(contentHeight + padding);
    window.electronAPI.resizeWidget({ width, height });
  });
}

export function setupResizeObserver() {
  requestWidgetResize();

  if (typeof ResizeObserver === 'function' && elements.widget) {
    if (widgetResizeObserver) {
      widgetResizeObserver.disconnect();
    }
    widgetResizeObserver = new ResizeObserver(() => {
      requestWidgetResize();
    });
    widgetResizeObserver.observe(elements.widget);
    if (elements.chatLog) {
      widgetResizeObserver.observe(elements.chatLog);
    }
  }

  if (typeof MutationObserver === 'function' && elements.chatLog) {
    if (chatMutationObserver) {
      chatMutationObserver.disconnect();
    }
    chatMutationObserver = new MutationObserver(() => {
      requestWidgetResize();
    });
    chatMutationObserver.observe(elements.chatLog, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }
}
