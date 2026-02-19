import { appState, POSITION_TOLERANCE, DOUBLE_CLICK_WINDOW_MS } from './state.js';
import { getCurrentAction } from './cua.js';

// uIOhook keycodes — these differ from DOM keycodes
export const UIOHOOK_KEYCODES = {
  // Letters
  a: 30, b: 48, c: 46, d: 32, e: 18, f: 33, g: 34, h: 35, i: 23,
  j: 36, k: 37, l: 38, m: 50, n: 49, o: 24, p: 25, q: 16, r: 19,
  s: 31, t: 20, u: 22, v: 47, w: 17, x: 45, y: 21, z: 44,
  // Numbers
  '0': 11, '1': 2, '2': 3, '3': 4, '4': 5, '5': 6, '6': 7, '7': 8, '8': 9, '9': 10,
  // F-keys
  f1: 59, f2: 60, f3: 61, f4: 62, f5: 63, f6: 64, f7: 65, f8: 66,
  f9: 67, f10: 68, f11: 87, f12: 88,
  // Special keys
  enter: 28, return: 28,
  space: 57, spacebar: 57,
  tab: 15,
  escape: 1, esc: 1,
  backspace: 14,
  delete: 111, del: 111,
  // Navigation
  home: 57415, end: 57423,
  pageup: 57417, page_up: 57417,
  pagedown: 57425, page_down: 57425,
  insert: 57426,
  // Arrows
  up: 57416, down: 57424, left: 57419, right: 57421,
  // Punctuation / symbols
  minus: 12, '-': 12,
  equals: 13, '=': 13,
  '[': 26, ']': 27,
  ';': 39, "'": 40,
  ',': 51, '.': 52, '/': 53,
  '\\': 43, '`': 41
};

// uIOhook keycodes for modifier keys (used to detect modifier-only events)
export const UIOHOOK_MODIFIER_KEYCODES = new Set([
  29, 3613,   // Left Ctrl, Right Ctrl
  42, 54,     // Left Shift, Right Shift
  56, 3640,   // Left Alt, Right Alt
  3675, 3676  // Left Meta, Right Meta
]);

export function normalizeKeyName(value) {
  return String(value || '').trim().toLowerCase();
}

export function matchesKeyCombo(actionKeys, eventData) {
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

  const modifierNames = ['ctrl', 'control', 'alt', 'shift', 'meta', 'cmd', 'command', 'win'];
  const nonModifier = required.filter((key) => !modifierNames.includes(key));

  // If the combo is only modifiers (e.g. just "ctrl"), require only the modifier flags
  if (nonModifier.length === 0) {
    return true;
  }

  // This is a modifier-only keydown (e.g. user pressed just Ctrl) — cannot match a
  // combo that requires a non-modifier key, so reject immediately
  if (UIOHOOK_MODIFIER_KEYCODES.has(eventData.keycode)) {
    return false;
  }

  const eventKeycode = eventData.keycode;

  // Check that the event's keycode matches one of the required non-modifier keys
  return nonModifier.some((key) => {
    const expectedKeycode = UIOHOOK_KEYCODES[key];
    if (expectedKeycode !== undefined) {
      return eventKeycode === expectedKeycode;
    }
    // For single-character keys not in the map, try matching via rawcode as fallback
    if (key.length === 1 && eventData.rawcode) {
      return eventData.rawcode === key.toUpperCase().charCodeAt(0);
    }
    return false;
  });
}

export function withinTolerance(x, y, targetX, targetY) {
  const dx = x - targetX;
  const dy = y - targetY;
  return Math.hypot(dx, dy) <= POSITION_TOLERANCE;
}

export function bindOSInputHandlers({ completeStep, setStatus }) {
  window.electronAPI.onOSClick((event, data) => {
    const action = getCurrentAction();
    if (!action) {
      const justCompletedMs = Date.now() - (appState.lastStepCompletedAt || 0);
      if (justCompletedMs > 900) {
        setStatus('Click received, but no active target yet.', 'default');
      }
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
      if (appState.lastClickTime && appState.lastClickPoint && now - appState.lastClickTime <= DOUBLE_CLICK_WINDOW_MS) {
        if (withinTolerance(data.absoluteX, data.absoluteY, appState.lastClickPoint.x, appState.lastClickPoint.y)) {
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
          appState.lastClickTime = 0;
          appState.lastClickPoint = null;
          return;
        }
      }
      appState.lastClickTime = now;
      appState.lastClickPoint = { x: data.absoluteX, y: data.absoluteY };
      setStatus('Double click again to complete.', 'default');
    }
  });

  window.electronAPI.onOSMouseDown((event, data) => {
    const action = getCurrentAction();
    if (!action || action.type !== 'drag') {
      return;
    }
    if (withinTolerance(data.absoluteX, data.absoluteY, action.x, action.y)) {
      appState.dragArmed = true;
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
    if (action.type !== 'drag' || !appState.dragArmed) {
      return;
    }
    if (action.x2 && action.y2 && withinTolerance(data.absoluteX, data.absoluteY, action.x2, action.y2)) {
      appState.dragArmed = false;
      completeStep('Drag complete.');
    }
  });

  window.electronAPI.onOSMouseUp(() => {
    appState.dragArmed = false;
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
      if (Array.isArray(action.keys) && action.keys.length > 0) {
        if (matchesKeyCombo(action.keys, data)) {
          completeStep('Input complete.');
          return;
        }
        return;
      }
      // No keys array or empty — complete on any keydown as fallback
      completeStep('Input complete.');
    }
  });
}
