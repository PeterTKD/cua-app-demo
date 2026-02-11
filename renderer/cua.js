import { elements } from './dom.js';
import { captureFrame } from './screen-share.js';
import { addHistoryItem } from './history.js';
import { extractCuaAction, hasScreenshotOnlyAction, mapImageCoordsToDisplay } from './utils.js';

const ACTION_COLORS = {
  click: '#1f2937',
  double_click: '#22c55e',
  scroll: '#a855f7',
  scroll_up: '#a855f7',
  scroll_down: '#a855f7',
  keypress: '#0f766e',
  type: '#3b82f6',
  wait: '#a16207',
  drag: '#facc15',
  pinpoint: '#7dd3fc',
  callout: '#ef4444',
  completed: '#16a34a'
};

const CALLOUT_TYPE_COLORS = {
  info: '#38bdf8',
  hint: '#a78bfa',
  warning: '#f59e0b',
  'error-solving': '#ef4444'
};

let currentTargetRect = null;
let currentAction = null;
let lastCuaSummary = null;
let pendingAction = false;
let queuedActions = [];
let queuedFrame = null;
let conversationHistory = [];
let lastCalloutPayload = null;

function pushConversation(role, text) {
  if (!text) return;
  conversationHistory.push({ role, content: text });
  // Unlimited conversation history (no cap).
}

export function addConversationNote(text) {
  pushConversation('system', text);
}

function buildCalloutText(summary) {
  if (!summary) {
    return 'Follow the on-screen guidance.';
  }
  return summary.replace(/\s+/g, ' ').trim();
}

function getDurationMs(response) {
  if (!response || !response.created_at || !response.completed_at) return null;
  return (response.completed_at - response.created_at) * 1000;
}

function extractReasonerJson(response) {
  if (!response) {
    throw new Error('Empty reasoner response');
  }
  let text = response.output_text;
  if (!text && Array.isArray(response.output)) {
    const message = response.output.find((item) => item.type === 'message');
    const content = message?.content?.find((entry) => entry.type === 'output_text');
    if (content?.text) {
      text = content.text;
    }
  }
  if (!text) {
    throw new Error('Reasoner returned no output text');
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Reasoner returned invalid JSON: ${error.message}`);
  }
}

export function getTargetRect() {
  return currentTargetRect;
}

export function clearTargetRect() {
  currentTargetRect = null;
}

export function getCurrentAction() {
  return currentAction;
}

export function clearCurrentAction() {
  currentAction = null;
}

export function resetCuaState() {
  conversationHistory = [];
  lastCuaSummary = null;
  pendingAction = false;
  queuedActions = [];
  queuedFrame = null;
  lastCalloutPayload = null;
  clearTargetRect();
  clearCurrentAction();
}

export function getLastCuaSummary() {
  return lastCuaSummary;
}

export function hasPendingAction() {
  return pendingAction;
}

export function fadeGuidance() {
  if (lastCalloutPayload) {
    window.electronAPI.showCallout({ ...lastCalloutPayload, fadeOut: true });
    setTimeout(() => {
      window.electronAPI.showCallout({ heading: '', body: '', x: -1, y: -1, showNext: false });
    }, 220);
  } else {
    window.electronAPI.showCallout({ heading: '', body: '', x: -1, y: -1, showNext: false });
  }
  window.electronAPI.hideElementHighlight();
  clearTargetRect();
  clearCurrentAction();
  lastCalloutPayload = null;
}

export function handleActionCriteriaMet() {
  const summary = lastCuaSummary;
  pendingAction = false;
  if (queuedActions.length > 0 && queuedFrame) {
    const next = queuedActions.shift();
    presentCuaAction({
      action: next.action,
      summary: next.summary,
      frame: queuedFrame,
      actionTypeOverride: next.actionTypeOverride,
      calloutText: next.calloutText,
      calloutType: next.calloutType
    });
    return { summary, hasMore: true };
  }
  return { summary, hasMore: false };
}

export function handleActionCriteriaNotMet() {
  pendingAction = false;
  queuedActions = [];
  queuedFrame = null;
}

async function waitForFreshVideoFrame(timeoutMs = 600) {
  if (elements.video && typeof elements.video.requestVideoFrameCallback === 'function') {
    await Promise.race([
      new Promise((resolve) => {
        elements.video.requestVideoFrameCallback(() => resolve());
      }),
      new Promise((resolve) => setTimeout(resolve, timeoutMs))
    ]);
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, Math.min(200, timeoutMs)));
}

async function runCuaInstruction({ call, frame, strict }) {
  const promptQuestion = `Action: ${call.action}\nInstruction: ${call.target_description}`;
  const response = await window.electronAPI.runCuaQuestion({
    question: promptQuestion,
    imageDataUrl: frame.dataUrl,
    displayWidth: frame.width,
    displayHeight: frame.height,
    strict
  });
  const { action, summary } = extractCuaAction(response);
  if (hasScreenshotOnlyAction(action) && !strict) {
    return runCuaInstruction({ call, frame, strict: true });
  }
  return { response, action, summary };
}

function resolveCalloutColor(calloutType, actionType) {
  if (actionType === 'pinpoint') {
    return '#7dd3fc';
  }
  if (calloutType && CALLOUT_TYPE_COLORS[calloutType]) {
    return CALLOUT_TYPE_COLORS[calloutType];
  }
  if (actionType && ACTION_COLORS[actionType]) {
    return ACTION_COLORS[actionType];
  }
  return ACTION_COLORS.callout;
}

async function presentCuaAction({ action, summary, frame, actionTypeOverride, calloutText, calloutType }) {
  const actionTypeName = actionTypeOverride || (action && action.type ? action.type : null);
  const requiresPointer = ['click', 'double_click', 'drag', 'pinpoint'].includes(actionTypeName);
  const hasDragPath = actionTypeName === 'drag' && Array.isArray(action?.path) && action.path.length > 1;

  let startPoint = { x: action?.x, y: action?.y };
  let endPoint = { x: action?.x2 ?? action?.end_x ?? action?.endX, y: action?.y2 ?? action?.end_y ?? action?.endY };
  if (hasDragPath) {
    startPoint = action.path[0];
    endPoint = action.path[action.path.length - 1];
  }

  if (!action || (requiresPointer && !hasDragPath && (typeof startPoint.x !== 'number' || typeof startPoint.y !== 'number'))) {
    const fallbackText = calloutText || buildCalloutText(summary);
    await window.electronAPI.showCallout({
      heading: 'Call Out',
      body: fallbackText,
      borderColor: ACTION_COLORS.callout,
      headingColor: ACTION_COLORS.callout,
      x: -1,
      y: -1,
      showNext: true,
      allowClickThrough: true
    });
    lastCalloutPayload = {
      heading: 'Call Out',
      body: fallbackText,
      borderColor: ACTION_COLORS.callout,
      headingColor: ACTION_COLORS.callout,
      x: -1,
      y: -1,
      showNext: true,
      allowClickThrough: true
    };
    pendingAction = false;
    return { action: null, summary, hasPointer: false, actionType: 'callout' };
  }

  const displayInfo = await window.electronAPI.getSharedDisplayBounds();
  if (!displayInfo || !displayInfo.bounds) {
    throw new Error('Select a screen before running CUA.');
  }
  const scaleFactor = displayInfo.scaleFactor || 1;
  const physicalBounds = displayInfo.physicalBounds || {
    x: displayInfo.bounds.x * scaleFactor,
    y: displayInfo.bounds.y * scaleFactor
  };

  const mapped = mapImageCoordsToDisplay(
    { x: startPoint.x, y: startPoint.y },
    { width: frame.width, height: frame.height },
    displayInfo
  );

  const absX = mapped.absX;
  const absY = mapped.absY;
  const dipX = Math.round((absX - physicalBounds.x) / scaleFactor + displayInfo.bounds.x);
  const dipY = Math.round((absY - physicalBounds.y) / scaleFactor + displayInfo.bounds.y);
  const localX = Math.round(dipX - displayInfo.bounds.x);
  const localY = Math.round(dipY - displayInfo.bounds.y);

  const normalizedActionType = actionTypeName || 'click';
  const heading = normalizedActionType === 'double_click' ? 'Double click'
    : normalizedActionType === 'keypress' ? 'Key press'
    : normalizedActionType === 'scroll' || normalizedActionType === 'scroll_up' || normalizedActionType === 'scroll_down' ? 'Scroll'
    : normalizedActionType === 'type' ? 'Type'
    : normalizedActionType === 'wait' ? 'Wait'
    : normalizedActionType === 'drag' ? 'Drag'
    : normalizedActionType === 'pinpoint' ? 'Pinpoint'
    : 'Click';

  const borderColor = resolveCalloutColor(calloutType, normalizedActionType);
  const headingColor = normalizedActionType === 'click' ? '#ffffff' : borderColor;

  const keys = [];
  if (normalizedActionType === 'keypress') {
    if (Array.isArray(action.keys)) {
      action.keys.forEach((key) => keys.push(String(key)));
    } else if (action.key) {
      keys.push(String(action.key));
    }
  }

  let endDipX = -1;
  let endDipY = -1;
  let endLocalX = -1;
  let endLocalY = -1;
  if (normalizedActionType === 'drag') {
    if (typeof endPoint?.x === 'number' && typeof endPoint?.y === 'number') {
      const { absX: endAbsX, absY: endAbsY } = mapImageCoordsToDisplay(
        { x: endPoint.x, y: endPoint.y },
        { width: frame.width, height: frame.height },
        displayInfo
      );
      endDipX = Math.round((endAbsX - physicalBounds.x) / scaleFactor + displayInfo.bounds.x);
      endDipY = Math.round((endAbsY - physicalBounds.y) / scaleFactor + displayInfo.bounds.y);
      endLocalX = Math.round(endDipX - displayInfo.bounds.x);
      endLocalY = Math.round(endDipY - displayInfo.bounds.y);
    }
  }

  const showNext = ['scroll', 'scroll_up', 'scroll_down', 'keypress', 'type', 'wait', 'pinpoint'].includes(normalizedActionType);
  const resolvedBody = calloutText || buildCalloutText(summary);

  const calloutPromise = window.electronAPI.showCallout({
    heading,
    body: resolvedBody,
    borderColor,
    headingColor,
    x: localX,
    y: localY,
    endX: endLocalX,
    endY: endLocalY,
    keys,
    showNext,
    allowClickThrough: true
  });
  lastCalloutPayload = {
    heading,
    body: resolvedBody,
    borderColor,
    headingColor,
    x: localX,
    y: localY,
    endX: endLocalX,
    endY: endLocalY,
    keys,
    showNext,
    allowClickThrough: true
  };

  const physicalX = Math.round(absX);
  const physicalY = Math.round(absY);

  // Start element detection immediately in parallel (optimization #9)
  let elementDetectionPromise = null;
  if (requiresPointer && physicalX !== null && physicalY !== null) {
    elementDetectionPromise = window.electronAPI.detectElementAtPoint(physicalX, physicalY);
  }

  currentAction = {
    type: normalizedActionType,
    x: physicalX,
    y: physicalY,
    dipX,
    dipY,
    x2: typeof endDipX === 'number' && endDipX >= 0 ? Math.round((endDipX - displayInfo.bounds.x) * scaleFactor + physicalBounds.x) : null,
    y2: typeof endDipY === 'number' && endDipY >= 0 ? Math.round((endDipY - displayInfo.bounds.y) * scaleFactor + physicalBounds.y) : null,
    dipX2: endDipX,
    dipY2: endDipY,
    keys
  };

  lastCuaSummary = summary || lastCuaSummary;
  pendingAction = normalizedActionType !== 'callout';

  let highlightPromise = null;
  if (elementDetectionPromise) {
    highlightPromise = (async () => {
      const element = await elementDetectionPromise;
      if (element && element.BoundingRect) {
        currentTargetRect = {
          x: element.BoundingRect.X,
          y: element.BoundingRect.Y,
          width: element.BoundingRect.Width,
          height: element.BoundingRect.Height
        };
        await window.electronAPI.showElementHighlight(
          element.BoundingRect.X,
          element.BoundingRect.Y,
          element.BoundingRect.Width,
          element.BoundingRect.Height,
          '#f59e0b'
        );
      }
    })();
  }

  if (highlightPromise) {
    await Promise.allSettled([calloutPromise, highlightPromise]);
  } else {
    await calloutPromise;
  }

  const hasPointer = ['click', 'double_click', 'drag', 'pinpoint'].includes(normalizedActionType);
  return { action, summary, element: null, hasPointer, actionType: normalizedActionType };
}

export async function runCuaQuestion(question, options = {}) {
  if (!question && !options.allowEmpty) {
    throw new Error('Enter a question first.');
  }

  const delayMs = Number.isFinite(options.delayMs) ? options.delayMs : 0;
  const captureDelayMs = Number.isFinite(options.captureDelayMs) ? options.captureDelayMs : 200;
  await window.electronAPI.setLoadingState(true);
  try {
    await window.electronAPI.setWidgetVisible(true);
    await window.electronAPI.showCallout({ heading: '', body: '', x: -1, y: -1, showNext: false });
    await window.electronAPI.hideElementHighlight();
    clearTargetRect();
    clearCurrentAction();

    let frame;
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    if (captureDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, captureDelayMs));
    }
    await waitForFreshVideoFrame();
    await waitForFreshVideoFrame();
    frame = captureFrame();

    if (!frame) {
      throw new Error('Failed to capture screen frame.');
    }

    if (question) {
      pushConversation('user', question);
    }
    const reasonerContext = {
      user_message: question || '',
      conversation_history: conversationHistory,
      allow_parallel_pinpoint: true,
      last_cua_suggestion: lastCuaSummary || null
    };
    if (options.mode) {
      reasonerContext.mode = options.mode;
    }
    if (options.userStatus) {
      reasonerContext.user_status = options.userStatus;
    }

    const reasonerStart = Date.now();
    const reasonerImage = frame.reasonerDataUrl || frame.dataUrl;
    const reasonerResponse = await window.electronAPI.runReasonerQuestion({
      context: reasonerContext,
      imageDataUrl: reasonerImage
    });
    const reasonerDurationMs = Date.now() - reasonerStart;
    const reasonerJson = extractReasonerJson(reasonerResponse);
    const suppressCallout = typeof reasonerJson.answer === 'string'
      && reasonerJson.answer.includes('<<TASK_COMPLETED>>');

    if (reasonerJson.answer) {
      pushConversation('assistant', reasonerJson.answer);
    }

    const cuaCalls = Array.isArray(reasonerJson.cua_calls) ? reasonerJson.cua_calls : [];
    const calloutOnly = cuaCalls.length === 0;

    let result = { action: null, summary: null, hasPointer: false, actionType: 'callout' };
    const cuaResponses = [];

    if (calloutOnly) {
      if (suppressCallout) {
        pendingAction = false;
      } else {
      if (reasonerJson.callout && reasonerJson.callout.text && reasonerJson.callout.text !== 'none') {
        const calloutColor = resolveCalloutColor(reasonerJson.callout.type, null);
        const payload = {
          heading: 'Call Out',
          body: reasonerJson.callout.text,
          borderColor: calloutColor,
          headingColor: calloutColor,
          x: -1,
          y: -1,
          showNext: true,
          allowClickThrough: true
        };
        await window.electronAPI.showCallout(payload);
        lastCalloutPayload = payload;
      }
      pendingAction = false;
      }
    } else {
      const filteredCalls = cuaCalls.length > 1
        ? cuaCalls.filter((call) => call.action === 'pinpoint')
        : cuaCalls;

      const cuaResults = await Promise.all(
        filteredCalls.map((call) => runCuaInstruction({ call, frame, strict: false }))
      );

      cuaResults.forEach((item) => {
        cuaResponses.push({ response: item.response, durationMs: getDurationMs(item.response) });
      });

      const primary = cuaResults[0];
      const primaryCall = filteredCalls[0];
      if (primary) {
        const actionCalloutText = primaryCall['action-callout'] || (reasonerJson.callout ? reasonerJson.callout.text : null);
        result = await presentCuaAction({
          action: primary.action,
          summary: primary.summary,
          frame,
          actionTypeOverride: primaryCall.action,
          calloutText: actionCalloutText,
          calloutType: reasonerJson.callout ? reasonerJson.callout.type : null
        });
      }

      if (cuaResults.length > 1) {
        queuedActions = cuaResults.slice(1).map((item, index) => ({
          action: item.action,
          summary: item.summary,
          actionTypeOverride: filteredCalls[index + 1].action,
          calloutText: filteredCalls[index + 1]['action-callout'] || (reasonerJson.callout ? reasonerJson.callout.text : null),
          calloutType: reasonerJson.callout ? reasonerJson.callout.type : null
        }));
        queuedFrame = frame;
      } else {
        queuedActions = [];
        queuedFrame = null;
      }
    }

    const historyQuestion = question || '(auto)';
    addHistoryItem({
      question: historyQuestion,
      screenshot: frame.dataUrl,
      answer: reasonerJson.answer || null,
      actionType: result.actionType || null,
      actionSummary: result.summary || null,
      reasonerResponse: reasonerResponse,
      reasonerDurationMs,
      cuaResponses
    });

    return {
      answer: reasonerJson.answer || null,
      action: result.action,
      summary: result.summary,
      hasPointer: result.hasPointer,
      actionType: result.actionType,
      reasoner: reasonerJson
    };
  } finally {
    await window.electronAPI.setLoadingState(false);
  }
}
