import { elements } from './dom.js';
import { appState, CHAT_WIDTH, FOCUS_WIDTH } from './state.js';

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
    const height = Math.ceil(elements.widget.scrollHeight + padding);
    window.electronAPI.resizeWidget({ width, height });
  });
}

export function setupResizeObserver() {
  requestWidgetResize();
}
