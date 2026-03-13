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

//To delete if we decide not to use different callout types
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
const DISCREPANCY_RETRY_LIMIT = 1;
const UIA_SUPPORTED_ACTIONS = new Set(['click', 'double_click', 'pinpoint', 'type']);

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

function isPointerAction(actionType) {
  return ['click', 'double_click', 'drag', 'pinpoint'].includes(actionType);
}

function hasPointerCoordinates(action) {
  if (!action || typeof action !== 'object') return false;
  if (Array.isArray(action.path) && action.path.length > 0) {
    const first = action.path[0];
    return first && typeof first.x === 'number' && typeof first.y === 'number';
  }
  return typeof action.x === 'number' && typeof action.y === 'number';
}

function actionsAreCompatible(expectedAction, actualAction) {
  if (!expectedAction || !actualAction) return false;
  if (expectedAction === actualAction) return true;

  if (expectedAction === 'pinpoint') {
    return actualAction === 'click' || actualAction === 'pinpoint';
  }
  if (expectedAction === 'scroll') {
    return ['scroll', 'scroll_up', 'scroll_down'].includes(actualAction);
  }
  if (expectedAction === 'scroll_up') {
    return actualAction === 'scroll_up' || actualAction === 'scroll';
  }
  if (expectedAction === 'scroll_down') {
    return actualAction === 'scroll_down' || actualAction === 'scroll';
  }

  return false;
}

function hasDiscrepancy(expectedAction, actualActionPayload) {
  const actualActionType = actualActionPayload?.type || null;
  if (!actionsAreCompatible(expectedAction, actualActionType)) {
    return true;
  }
  if (isPointerAction(expectedAction) && !hasPointerCoordinates(actualActionPayload)) {
    return true;
  }
  return false;
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

function normalizeReasonerAction(action) {
  if (!action || typeof action !== 'object') return null;
  const actionType = action.action_type || action.action || null;
  if (!actionType) return null;
  const rawUiaTarget = UIA_SUPPORTED_ACTIONS.has(actionType) && Object.prototype.hasOwnProperty.call(action, 'uia_target')
    ? action.uia_target
    : null;
  return {
    ...action,
    action: actionType,
    action_type: actionType,
    action_callout: action.action_callout || action['action-callout'] || null,
    target_description: action.target_description || '',
    uia_target: normalizeUiaTarget(rawUiaTarget)
  };
}

function normalizeUiaTarget(target) {
  if (!target || typeof target !== 'object') return null;

  const name = typeof target.name === 'string' ? target.name.trim() : '';
  const controlType = typeof target.control_type === 'string' ? target.control_type.trim() : '';
  const mustIncludeTokens = Array.isArray(target.must_include_tokens)
    ? target.must_include_tokens.map((token) => String(token).trim()).filter(Boolean)
    : Array.isArray(target.name_variations)
      ? target.name_variations.map((token) => String(token).trim()).filter(Boolean)
      : [];
  const mustExcludeTokens = Array.isArray(target.must_exclude_tokens)
    ? target.must_exclude_tokens.map((token) => String(token).trim()).filter(Boolean)
    : [];
  const positionHint = typeof target.position_hint === 'string'
    ? target.position_hint.trim()
    : typeof target.visual_region === 'string'
      ? target.visual_region.trim()
      : '';
  const positionIndex = Number.isFinite(target.position_index) ? Number(target.position_index) : null;
  const ancestorHint = typeof target.ancestor_hint === 'string' && target.ancestor_hint.trim()
    ? target.ancestor_hint.trim()
    : null;
  const siblingsHint = typeof target.siblings_hint === 'string' && target.siblings_hint.trim()
    ? target.siblings_hint.trim()
    : null;
  const approxX = Number.isFinite(target.approx_x) ? Number(target.approx_x) : null;
  const approxY = Number.isFinite(target.approx_y) ? Number(target.approx_y) : null;

  if (!name && !controlType && mustIncludeTokens.length === 0) {
    return null;
  }

  return {
    name,
    control_type: controlType,
    interactivity: target.interactivity !== false,
    must_include_tokens: mustIncludeTokens.length > 0 ? mustIncludeTokens : (name ? [name] : []),
    must_exclude_tokens: mustExcludeTokens,
    position_hint: positionHint,
    position_index: positionIndex,
    ancestor_hint: ancestorHint,
    siblings_hint: siblingsHint,
    approx_x: approxX,
    approx_y: approxY
  };
}

async function buildTreeLocatorAction(call, frame) {
  if (!call?.uia_target) {
    return call;
  }

  const normalizedTarget = {
    ...call.uia_target
  };
  const hasApproxCoords = Number.isFinite(normalizedTarget.approx_x) && Number.isFinite(normalizedTarget.approx_y);

  if (hasApproxCoords) {
    const displayInfo = await window.electronAPI.getSharedDisplayBounds();
    if (displayInfo?.bounds) {
      const scaleFactor = displayInfo.scaleFactor || 1;
      const physicalBounds = displayInfo.physicalBounds || {
        x: displayInfo.bounds.x * scaleFactor,
        y: displayInfo.bounds.y * scaleFactor,
        width: displayInfo.bounds.width * scaleFactor,
        height: displayInfo.bounds.height * scaleFactor
      };
      const seenWidth = frame?.reasonerWidth || frame?.width || physicalBounds.width;
      const seenHeight = frame?.reasonerHeight || frame?.height || physicalBounds.height;
      if (seenWidth > 0 && seenHeight > 0) {
        normalizedTarget.approx_x = Math.round(physicalBounds.x + (normalizedTarget.approx_x / seenWidth) * physicalBounds.width);
        normalizedTarget.approx_y = Math.round(physicalBounds.y + (normalizedTarget.approx_y / seenHeight) * physicalBounds.height);
      }
    }
  }

  return {
    ...call,
    uia_target: normalizedTarget
  };
}

function normalizeReasonerOutput(reasonerJson) {
  if (!reasonerJson || typeof reasonerJson !== 'object') {
    return { answer: '', actions: [] };
  }
  const rawActions = Array.isArray(reasonerJson.actions)
    ? reasonerJson.actions
    : Array.isArray(reasonerJson.cua_calls)
      ? reasonerJson.cua_calls
      : [];
  return {
    ...reasonerJson,
    answer: typeof reasonerJson.answer === 'string' ? reasonerJson.answer : '',
    actions: rawActions.map(normalizeReasonerAction).filter(Boolean)
  };
}

function normalizeLocatorBounds(bounds) {
  if (!bounds || typeof bounds !== 'object') return null;
  const normalized = {
    x: Number(bounds.x ?? bounds.X ?? 0),
    y: Number(bounds.y ?? bounds.Y ?? 0),
    width: Number(bounds.width ?? bounds.Width ?? bounds.w ?? 0),
    height: Number(bounds.height ?? bounds.Height ?? bounds.h ?? 0)
  };
  if (!Number.isFinite(normalized.x) || !Number.isFinite(normalized.y)) return null;
  if (!Number.isFinite(normalized.width) || !Number.isFinite(normalized.height)) return null;
  if (normalized.width <= 0) normalized.width = 100;
  if (normalized.height <= 0) normalized.height = 40;
  return normalized;
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
    if (next.kind === 'tree') {
      presentTreeAction({
        match: next.match,
        summary: next.summary,
        actionTypeOverride: next.actionTypeOverride,
        calloutText: next.calloutText,
        calloutType: next.calloutType
      });
    } else {
      presentCuaAction({
        action: next.action,
        summary: next.summary,
        frame: queuedFrame,
        actionTypeOverride: next.actionTypeOverride,
        calloutText: next.calloutText,
        calloutType: next.calloutType
      });
    }
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
  const cuaAction = call.action_type === 'pinpoint' ? 'click' : call.action_type;
  const promptQuestion = `Action: ${cuaAction}\nInstruction: ${call.target_description}`;
  const startedAt = Date.now();
  const cuaResponse = await window.electronAPI.runCuaQuestion({
    question: promptQuestion,
    imageDataUrl: frame.dataUrl,
    displayWidth: frame.width,
    displayHeight: frame.height,
    strict
  });
  const cuaDurationMs = Date.now() - startedAt;
  const { action, summary } = extractCuaAction(cuaResponse);
  if (hasScreenshotOnlyAction(action) && !strict) {
    return runCuaInstruction({ call, frame, strict: true });
  }
  return { cuaResponse, action, summary, cuaDurationMs };
}

async function runTreeInstruction({ call, frame }) {
  const locatorAction = await buildTreeLocatorAction(call, frame);
  const startedAt = Date.now();
  const treeResponse = await window.electronAPI.runTreeLocator({ action: locatorAction });
  const treeDurationMs = Date.now() - startedAt;
  const treeResolveDurationMs = Number(treeResponse?._timings?.treeResolveDurationMs) || 0;
  const match = extractReasonerJson(treeResponse);
  if (!match || match.notFound) {
    return {
      treeResponse,
      treeDurationMs,
      treeResolveDurationMs,
      treeMeta: treeResponse?._tree || null,
      match: null,
      action: null,
      summary: null,
      failureReason: treeResponse?._meta?.skipped || 'not_found'
    };
  }
  const bounds = normalizeLocatorBounds(match);
  if (!bounds) {
    return {
      treeResponse,
      treeDurationMs,
      treeResolveDurationMs,
      treeMeta: treeResponse?._tree || null,
      match: null,
      action: null,
      summary: null,
      failureReason: 'invalid_bounds'
    };
  }
  const action = {
    type: call.action_type,
    x: Math.round(bounds.x + bounds.width / 2),
    y: Math.round(bounds.y + bounds.height / 2)
  };
  return {
    treeResponse,
    treeDurationMs,
    treeResolveDurationMs,
    treeMeta: treeResponse?._tree || null,
    match: { ...match, ...bounds },
    action,
    summary: call.action_callout || null,
    failureReason: null
  };
}

async function runGuidanceInstruction({ call, frame }) {
  if (call?.uia_target && UIA_SUPPORTED_ACTIONS.has(call.action_type)) {
    const uiaStartedAt = Date.now();
    try {
      const treeResult = await runTreeInstruction({ call, frame });
      if (treeResult?.match) {
        return {
          ...treeResult,
          kind: 'tree',
          uiaAttempted: true,
          uiaSucceeded: true,
          uiaFailureReason: null,
          uiaElapsedMs: Date.now() - uiaStartedAt
        };
      }
      const cuaResult = await runCuaInstruction({ call, frame, strict: false });
      return {
        ...treeResult,
        ...cuaResult,
        kind: 'cua',
        uiaAttempted: true,
        uiaSucceeded: false,
        uiaFailureReason: treeResult?.failureReason || 'not_found',
        uiaElapsedMs: Date.now() - uiaStartedAt
      };
    } catch (error) {
      console.warn('Tree locator fallback to CUA:', error?.message || error);
      const cuaResult = await runCuaInstruction({ call, frame, strict: false });
      return {
        ...cuaResult,
        kind: 'cua',
        uiaAttempted: true,
        uiaSucceeded: false,
        uiaFailureReason: error?.message || String(error),
        uiaElapsedMs: Date.now() - uiaStartedAt,
        treeDurationMs: 0,
        treeResolveDurationMs: 0,
        treeMeta: null,
        treeResponse: null
      };
    }
  }

  const cuaResult = await runCuaInstruction({ call, frame, strict: false });
  return {
    ...cuaResult,
    kind: 'cua',
    uiaAttempted: false,
    uiaSucceeded: false,
    uiaFailureReason: null,
    uiaElapsedMs: 0,
    treeResolveDurationMs: 0
  };
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
    return { action: null, summary, hasPointer: false, actionType: 'callout', executor: 'cua' };
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
    source: 'cua',
    x: physicalX,
    y: physicalY,
    dipX,
    dipY,
    targetRect: currentTargetRect,
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
  return { action, summary, element: null, hasPointer, actionType: normalizedActionType, executor: 'cua' };
}

async function presentTreeAction({ match, summary, actionTypeOverride, calloutText, calloutType }) {
  const bounds = normalizeLocatorBounds(match);
  const normalizedActionType = actionTypeOverride || 'click';
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
  const resolvedBody = calloutText || buildCalloutText(summary);

  if (!bounds) {
    await window.electronAPI.showCallout({
      heading: 'Call Out',
      body: resolvedBody,
      borderColor: ACTION_COLORS.callout,
      headingColor: ACTION_COLORS.callout,
      x: -1,
      y: -1,
      showNext: true,
      allowClickThrough: true
    });
    lastCalloutPayload = {
      heading: 'Call Out',
      body: resolvedBody,
      borderColor: ACTION_COLORS.callout,
      headingColor: ACTION_COLORS.callout,
      x: -1,
      y: -1,
      showNext: true,
      allowClickThrough: true
    };
    pendingAction = false;
    return { action: null, summary, hasPointer: false, actionType: 'callout', executor: 'cua' };
  }

  const displayInfo = await window.electronAPI.getSharedDisplayBounds();
  if (!displayInfo || !displayInfo.bounds) {
    throw new Error('Select a screen before showing a tree-located highlight.');
  }
  const scaleFactor = displayInfo.scaleFactor || 1;
  const physicalBounds = displayInfo.physicalBounds || {
    x: displayInfo.bounds.x * scaleFactor,
    y: displayInfo.bounds.y * scaleFactor
  };

  const physicalX = Math.round(bounds.x + bounds.width / 2);
  const physicalY = Math.round(bounds.y + bounds.height / 2);
  const dipX = Math.round((physicalX - physicalBounds.x) / scaleFactor + displayInfo.bounds.x);
  const dipY = Math.round((physicalY - physicalBounds.y) / scaleFactor + displayInfo.bounds.y);
  const localX = Math.round(dipX - displayInfo.bounds.x);
  const localY = Math.round(dipY - displayInfo.bounds.y);
  const showNext = ['scroll', 'scroll_up', 'scroll_down', 'keypress', 'type', 'wait', 'pinpoint'].includes(normalizedActionType);

  const calloutPayload = {
    heading,
    body: resolvedBody,
    borderColor,
    headingColor,
    x: localX,
    y: localY,
    endX: -1,
    endY: -1,
    keys: [],
    showNext,
    allowClickThrough: true,
    noPointer: true
  };

  lastCalloutPayload = calloutPayload;
  currentTargetRect = {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height
  };
  currentAction = {
    type: normalizedActionType,
    source: 'uia',
    x: physicalX,
    y: physicalY,
    dipX,
    dipY,
    targetRect: currentTargetRect,
    keys: []
  };
  lastCuaSummary = resolvedBody || lastCuaSummary;
  pendingAction = normalizedActionType !== 'callout';

  await Promise.allSettled([
    window.electronAPI.showCallout(calloutPayload),
    window.electronAPI.showElementHighlight(bounds.x, bounds.y, bounds.width, bounds.height, '#f59e0b')
  ]);

  return {
    action: currentAction,
    summary: resolvedBody,
    element: match?.element || null,
    hasPointer: true,
    actionType: normalizedActionType,
    executor: 'uia'
  };
}

export async function runCuaQuestion(question, options = {}) {
  if (!question && !options.allowEmpty) {
    throw new Error('Enter a question first.');
  }

  const runStartedAt = Date.now();
  const delayMs = Number.isFinite(options.delayMs) ? options.delayMs : 0;
  const captureDelayMs = Number.isFinite(options.captureDelayMs) ? options.captureDelayMs : 200;
  const fastCapture = options.fastCapture === true;
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
    if (!fastCapture) {
      await waitForFreshVideoFrame();
    }
    frame = captureFrame();

    if (!frame) {
      throw new Error('Failed to capture screen frame.');
    }

    if (question && options.skipUserMessage !== true) {
      pushConversation('user', question);
    }
    const reasonerContext = {
      user_message: question || '',
      conversation_history: conversationHistory,
      allow_parallel_pinpoint: true,
      last_cua_suggestion: lastCuaSummary || null,
      screen_dimensions: {
        width: frame.reasonerWidth || frame.width,
        height: frame.reasonerHeight || frame.height
      },
      original_screen_dimensions: {
        width: frame.width,
        height: frame.height
      }
    };
    if (options.mode) {
      reasonerContext.mode = options.mode;
    }
    if (options.userStatus) {
      reasonerContext.user_status = options.userStatus;
    }

    const reasonerStart = Date.now();
    const reasonerImage = frame.reasonerDataUrl || frame.dataUrl;
    let reasonerResponse, reasonerDurationMs, reasonerJson;
    try {
      reasonerResponse = await window.electronAPI.runReasonerQuestion({
        context: reasonerContext,
        imageDataUrl: reasonerImage
      });
      reasonerDurationMs = Date.now() - reasonerStart;
      reasonerJson = normalizeReasonerOutput(extractReasonerJson(reasonerResponse));
    } catch (reasonerError) {
      addHistoryItem({
        question: question || '(auto)',
        screenshot: frame.dataUrl,
        answer: `Error: ${reasonerError.message}`,
        ttsEnabled: false,
        actionType: 'error',
        actionExecutor: null,
        actionSummary: null,
        reasonerResponse: reasonerResponse || null,
        reasonerDurationMs: Date.now() - reasonerStart,
        treeLocatorElapsedMs: 0,
        treeResolveElapsedMs: 0,
        uiaElapsedMs: 0,
        uiaAttempted: false,
        uiaSucceeded: false,
        uiaFailureReason: null,
        treeLocatorResponses: [],
        executorElapsedMs: 0,
        cuaElapsedMs: 0,
        cuaResponses: [],
        totalRunDurationMs: Date.now() - runStartedAt
      });
      throw reasonerError;
    }
    const isTaskCompleted = typeof reasonerJson.answer === 'string'
      && reasonerJson.answer.includes('<<TASK_COMPLETED>>');
    const plannedCalls = Array.isArray(reasonerJson.actions) ? reasonerJson.actions : [];
    if (typeof options.onReasonerPlan === 'function') {
      try {
        options.onReasonerPlan({
          isTaskCompleted,
          hasCuaCalls: plannedCalls.length > 0,
          primaryAction: plannedCalls[0]?.action_type || null
        });
      } catch (_) {
        // Keep the CUA flow resilient even if UI callback fails.
      }
    }

    if (reasonerJson.answer) {
      pushConversation('assistant', reasonerJson.answer);
    }

    const cuaCalls = isTaskCompleted
      ? []
      : plannedCalls;
    const calloutOnly = cuaCalls.length === 0;

    let result = { action: null, summary: null, hasPointer: false, actionType: 'callout', executor: null };
    const cuaResponses = [];
    const treeLocatorResponses = [];
    let cuaElapsedMs = 0;
    let treeLocatorElapsedMs = 0;
    let treeResolveElapsedMs = 0;
    let uiaElapsedMs = 0;
    let uiaAttempted = false;
    let uiaSucceeded = false;
    let uiaFailureReason = null;
    let executorElapsedMs = 0;

    if (calloutOnly) {
      if (isTaskCompleted) {
        pendingAction = false;
        queuedActions = [];
        queuedFrame = null;
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
        ? cuaCalls.filter((call) => call.action_type === 'pinpoint')
        : cuaCalls;

      const executorStart = Date.now();
      const guidanceResults = await Promise.all(
        filteredCalls.map((call) => runGuidanceInstruction({ call, frame }))
      );
      executorElapsedMs = Date.now() - executorStart;

      const discrepancyDetected = guidanceResults.some((item, index) => {
        const expectedAction = filteredCalls[index]?.action_type || null;
        return hasDiscrepancy(expectedAction, item?.action || null);
      });
      const retryCount = Number.isFinite(options.discrepancyRetryCount) ? options.discrepancyRetryCount : 0;
      if (discrepancyDetected && retryCount < DISCREPANCY_RETRY_LIMIT) {
        queuedActions = [];
        queuedFrame = null;
        pendingAction = false;
        return runCuaQuestion(question, {
          ...options,
          discrepancyRetryCount: retryCount + 1,
          skipUserMessage: true,
          delayMs: 0,
          captureDelayMs: 0,
          fastCapture: true
        });
      }

      guidanceResults.forEach((item) => {
        if (item?.treeResponse || item?.treeMeta || item?.treeDurationMs) {
          const treeDuration = Number(item.treeDurationMs) || 0;
          treeLocatorElapsedMs += treeDuration;
          treeResolveElapsedMs += Number(item.treeResolveDurationMs) || 0;
          treeLocatorResponses.push({
            response: item.treeResponse || null,
            durationMs: treeDuration,
            treeResolveDurationMs: Number(item.treeResolveDurationMs) || 0,
            tree: item.treeMeta || null,
            failureReason: item.uiaFailureReason || item.failureReason || null,
            attempted: item.uiaAttempted === true,
            succeeded: item.uiaSucceeded === true
          });
        }
        if (item?.uiaAttempted) {
          uiaAttempted = true;
          uiaElapsedMs += Number(item.uiaElapsedMs) || 0;
          if (item.uiaSucceeded) {
            uiaSucceeded = true;
          } else if (!uiaFailureReason && item.uiaFailureReason) {
            uiaFailureReason = String(item.uiaFailureReason);
          }
        }
        if (item?.cuaResponse) {
          const cuaDuration = Number(item.cuaDurationMs) || 0;
          cuaElapsedMs += cuaDuration;
          cuaResponses.push({
            response: item.cuaResponse,
            durationMs: cuaDuration || getDurationMs(item.cuaResponse)
          });
        }
      });

      const primary = guidanceResults[0];
      const primaryCall = filteredCalls[0];
      if (primary) {
        const actionCalloutText = primaryCall.action_callout || (reasonerJson.callout ? reasonerJson.callout.text : null);
        result = primary.kind === 'tree'
          ? await presentTreeAction({
              match: primary.match,
              summary: primary.summary,
              actionTypeOverride: primaryCall.action_type,
              calloutText: actionCalloutText,
              calloutType: reasonerJson.callout ? reasonerJson.callout.type : null
            })
          : await presentCuaAction({
              action: primary.action,
              summary: primary.summary,
              frame,
              actionTypeOverride: primaryCall.action_type,
              calloutText: actionCalloutText,
              calloutType: reasonerJson.callout ? reasonerJson.callout.type : null
            });
      }

      if (guidanceResults.length > 1) {
        queuedActions = guidanceResults.slice(1).map((item, index) => ({
          kind: item.kind,
          action: item.action,
          match: item.match,
          summary: item.summary,
          actionTypeOverride: filteredCalls[index + 1].action_type,
          calloutText: filteredCalls[index + 1].action_callout || (reasonerJson.callout ? reasonerJson.callout.text : null),
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
      ttsEnabled: options.ttsEnabled === true,
      actionType: result.actionType || null,
      actionExecutor: result.executor || null,
      actionSummary: result.summary || null,
      reasonerResponse: reasonerResponse,
      reasonerDurationMs,
      treeLocatorElapsedMs,
      treeResolveElapsedMs,
      uiaElapsedMs,
      uiaAttempted,
      uiaSucceeded,
      uiaFailureReason,
      treeLocatorResponses,
      executorElapsedMs,
      cuaElapsedMs,
      cuaResponses,
      totalRunDurationMs: Date.now() - runStartedAt
    });

    return {
      answer: reasonerJson.answer || null,
      action: result.action,
      summary: result.summary,
      hasPointer: result.hasPointer,
      actionType: result.actionType,
      executor: result.executor || null,
      reasoner: reasonerJson
    };
  } finally {
    await window.electronAPI.setLoadingState(false);
  }
}
