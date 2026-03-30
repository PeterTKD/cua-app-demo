import { elements } from './dom.js';
import { captureFrame } from './screen-share.js';
import { addHistoryItem } from './history.js';
import { mapImageCoordsToDisplay } from './utils.js';

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
let lastReasonerThought = null;
const DISCREPANCY_RETRY_LIMIT = 1;
const UIA_SUPPORTED_ACTIONS = new Set(['click', 'double_click', 'pinpoint', 'type']);
const CUA54_POINTER_ACTIONS = new Set(['click', 'double_click', 'drag', 'scroll', 'scroll_up', 'scroll_down', 'pinpoint', 'type']);

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

function normalizeCapturedFrame(frame) {
  if (!frame || typeof frame !== 'object') return null;
  return {
    ...frame,
    getDataUrl() {
      return frame.dataUrl || frame.reasonerDataUrl || null;
    }
  };
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
  const path = Array.isArray(action.path)
    ? action.path
      .map((point) => ({
        x: Number(point?.x),
        y: Number(point?.y)
      }))
      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    : [];
  const targetDescriptions = Array.isArray(action.target_descriptions)
    ? action.target_descriptions.map((entry) => String(entry).trim()).filter(Boolean)
    : typeof action.target_description === 'string' && action.target_description.trim()
      ? [action.target_description.trim()]
      : [];
  const text = typeof action.text === 'string' ? action.text : null;
  const keys = Array.isArray(action.keys)
    ? action.keys.map((key) => String(key).trim()).filter(Boolean)
    : null;
  const waitMs = Number.isFinite(action.wait_ms) ? Number(action.wait_ms) : null;
  return {
    ...action,
    action: actionType,
    action_type: actionType,
    action_callout: action.action_callout || action['action-callout'] || null,
    path,
    target_descriptions: targetDescriptions,
    text,
    keys,
    wait_ms: waitMs,
    target_description: targetDescriptions[0] || action.target_description || ''
  };
}

function buildReasonerResolvedAction(call, resolvedPoints = []) {
  if (!call || typeof call !== 'object') return null;

  const actionType = call.action_type || call.action || null;
  if (!actionType) return null;

  const resolved = {
    type: actionType,
    source: 'reasoner',
    executor: resolvedPoints.length > 0 ? 'cua-5.4' : 'reasoner',
    coordinateSpace: 'original'
  };

  const path = Array.isArray(resolvedPoints) && resolvedPoints.length > 0
    ? resolvedPoints
      .map((point) => ({
        x: Number(point?.x),
        y: Number(point?.y)
      }))
      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    : Array.isArray(call.path)
    ? call.path
      .map((point) => ({
        x: Number(point?.x),
        y: Number(point?.y)
      }))
      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    : [];

  if (actionType === 'drag') {
    if (path.length > 0) {
      resolved.path = path;
    }
  } else if (path.length > 0) {
    resolved.x = path[0].x;
    resolved.y = path[0].y;
  }

  if (actionType === 'keypress') {
    const keys = Array.isArray(call.keys)
      ? call.keys.map((key) => String(key).trim()).filter(Boolean)
      : [];
    resolved.keys = keys;
    if (keys.length === 1) {
      resolved.key = keys[0];
    }
  }

  if (actionType === 'wait' && Number.isFinite(call.wait_ms)) {
    resolved.wait_ms = Number(call.wait_ms);
  }

  return resolved;
}

function normalizeCua54Points(result) {
  const points = Array.isArray(result?.points) ? result.points : [];
  return points
    .map((point) => ({
      x: Number(point?.x),
      y: Number(point?.y)
    }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
}

function buildCua54ReasonerInput(description) {
  return String(description || '').trim();
}

async function resolveCua54Point({ description, frame }) {
  const reasonerInput = buildCua54ReasonerInput(description);
  if (!reasonerInput) {
    throw new Error('Missing target description for CUA 5.4');
  }

  const startedAt = Date.now();
  const response = await window.electronAPI.runCua54Question({
    reasonerInput,
    frameId: frame?.frameId || null,
    imageDataUrl: frame?.getDataUrl?.() || frame?.reasonerDataUrl || null,
    screenDimensions: {
      width: frame?.reasonerWidth || frame?.width || 0,
      height: frame?.reasonerHeight || frame?.height || 0
    },
    originalScreenDimensions: {
      width: frame?.width || frame?.reasonerWidth || 0,
      height: frame?.height || frame?.reasonerHeight || 0
    }
  });

  const parsed = extractReasonerJson(response);
  const points = normalizeCua54Points(parsed);
  if (points.length === 0) {
    throw new Error(`CUA 5.4 returned no points for target: ${reasonerInput}`);
  }
  return {
    point: points[0],
    response,
    durationMs: Date.now() - startedAt
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
    return { thought: '', answer: '', actions: [] };
  }
  const rawActions = Array.isArray(reasonerJson.actions)
    ? reasonerJson.actions
    : Array.isArray(reasonerJson.cua_calls)
      ? reasonerJson.cua_calls
      : [];
  return {
    ...reasonerJson,
    thought: typeof reasonerJson.thought === 'string' ? reasonerJson.thought.trim() : '',
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
  lastReasonerThought = null;
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

async function runTreeInstruction({ call, frame, treePrefetchIdPromise }) {
  const locatorAction = await buildTreeLocatorAction(call, frame);
  const prefetchId = treePrefetchIdPromise ? await treePrefetchIdPromise : null;
  const startedAt = Date.now();
  const treeResponse = await window.electronAPI.runTreeLocator({
    action: locatorAction,
    prefetchId
  });
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
  const actionType = call?.action_type || call?.action || null;
  const descriptions = Array.isArray(call?.target_descriptions) && call.target_descriptions.length > 0
    ? call.target_descriptions
    : call?.target_description
      ? [call.target_description]
      : [];

  let resolvedPoints = [];
  const cuaResponses = [];
  let cuaElapsedMs = 0;
  if (CUA54_POINTER_ACTIONS.has(actionType)) {
    if (actionType === 'drag') {
      const startDescription = descriptions[0] || call?.action_callout || '';
      const endDescription = descriptions[1] || descriptions[0] || call?.action_callout || '';
      const [startResult, endResult] = await Promise.all([
        resolveCua54Point({ description: startDescription, frame }),
        resolveCua54Point({ description: endDescription, frame })
      ]);
      resolvedPoints = [startResult.point, endResult.point];
      cuaResponses.push(
        { response: startResult.response, durationMs: startResult.durationMs },
        { response: endResult.response, durationMs: endResult.durationMs }
      );
      cuaElapsedMs += startResult.durationMs + endResult.durationMs;
    } else {
      const description = descriptions[0] || call?.action_callout || '';
      const cuaResult = await resolveCua54Point({ description, frame });
      resolvedPoints = [cuaResult.point];
      cuaResponses.push({ response: cuaResult.response, durationMs: cuaResult.durationMs });
      cuaElapsedMs += cuaResult.durationMs;
    }
  }

  return {
    action: buildReasonerResolvedAction(call, resolvedPoints),
    summary: call?.action_callout || null,
    kind: 'reasoner',
    cuaResponses,
    cuaElapsedMs,
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
    return { action: null, summary: fallbackText, hasPointer: false, actionType: 'callout', executor: 'reasoner' };
  }

  const displayInfo = await window.electronAPI.getSharedDisplayBounds();
  if (!displayInfo || !displayInfo.bounds) {
    throw new Error('Select a screen before showing guidance.');
  }
  const scaleFactor = displayInfo.scaleFactor || 1;
  const physicalBounds = displayInfo.physicalBounds || {
    x: displayInfo.bounds.x * scaleFactor,
    y: displayInfo.bounds.y * scaleFactor
  };

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

  const coordinateImageSize = action?.coordinateSpace === 'reasoner'
    ? {
        width: frame.reasonerWidth || frame.width,
        height: frame.reasonerHeight || frame.height
      }
    : {
        width: frame.width,
        height: frame.height
      };
  const hasAnchorPoint = typeof startPoint.x === 'number' && typeof startPoint.y === 'number';
  const mapped = hasAnchorPoint
    ? mapImageCoordsToDisplay(
        { x: startPoint.x, y: startPoint.y },
        coordinateImageSize,
        displayInfo
      )
    : null;
  const absX = mapped ? mapped.absX : null;
  const absY = mapped ? mapped.absY : null;
  const dipX = mapped ? Math.round((absX - physicalBounds.x) / scaleFactor + displayInfo.bounds.x) : -1;
  const dipY = mapped ? Math.round((absY - physicalBounds.y) / scaleFactor + displayInfo.bounds.y) : -1;
  const localX = dipX >= 0 ? Math.round(dipX - displayInfo.bounds.x) : -1;
  const localY = dipY >= 0 ? Math.round(dipY - displayInfo.bounds.y) : -1;

  let endDipX = -1;
  let endDipY = -1;
  let endLocalX = -1;
  let endLocalY = -1;
  if (normalizedActionType === 'drag') {
    if (typeof endPoint?.x === 'number' && typeof endPoint?.y === 'number') {
      const { absX: endAbsX, absY: endAbsY } = mapImageCoordsToDisplay(
        { x: endPoint.x, y: endPoint.y },
        coordinateImageSize,
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

  const physicalX = Number.isFinite(absX) ? Math.round(absX) : null;
  const physicalY = Number.isFinite(absY) ? Math.round(absY) : null;

  // Start element detection immediately in parallel (optimization #9)
  let elementDetectionPromise = null;
  if (requiresPointer && physicalX !== null && physicalY !== null) {
    elementDetectionPromise = window.electronAPI.detectElementAtPoint(physicalX, physicalY);
  }

  currentAction = {
    type: normalizedActionType,
    source: action?.source || 'reasoner',
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
          '#3B82F6'
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
  return {
    action,
    summary: resolvedBody,
    element: null,
    hasPointer,
    actionType: normalizedActionType,
    executor: action?.executor || action?.source || 'reasoner'
  };
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
    return { action: null, summary, hasPointer: false, actionType: 'callout', executor: 'uia' };
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
    window.electronAPI.showElementHighlight(bounds.x, bounds.y, bounds.width, bounds.height, '#3B82F6')
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
  const captureDelayMs = Number.isFinite(options.captureDelayMs) ? options.captureDelayMs : 0;
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
    frame = normalizeCapturedFrame(await window.electronAPI.captureRunFrame({
      includeFull: true,
      cacheFull: true,
      maxDimension: 0
    }).catch(() => null));
    if (!frame) {
      await waitForFreshVideoFrame();
      frame = normalizeCapturedFrame(captureFrame());
    }

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
    if (lastReasonerThought) {
      reasonerContext.developer_context = lastReasonerThought;
    }
    if (options.mode) {
      reasonerContext.mode = options.mode;
    }
    if (options.userStatus) {
      reasonerContext.user_status = options.userStatus;
    }

    const setupElapsedMs = Date.now() - runStartedAt;
    const reasonerStart = Date.now();
    const reasonerImage = frame.reasonerDataUrl || frame.getDataUrl();
    let reasonerResponse, reasonerDurationMs, reasonerJson;
    try {
      reasonerResponse = await window.electronAPI.runReasonerQuestion({
        context: reasonerContext,
        frameId: frame.frameId || null,
        imageDataUrl: reasonerImage
      });
      reasonerDurationMs = Date.now() - reasonerStart;
      reasonerJson = normalizeReasonerOutput(extractReasonerJson(reasonerResponse));
      lastReasonerThought = reasonerJson.thought || null;
    } catch (reasonerError) {
      addHistoryItem({
        question: question || '(auto)',
        screenshot: frame.reasonerDataUrl || frame.getDataUrl(),
        answer: `Error: ${reasonerError.message}`,
        thought: null,
        ttsEnabled: false,
        actionType: 'error',
        actionExecutor: null,
        actionSummary: null,
        reasonerResponse: reasonerResponse || null,
        setupElapsedMs,
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
        // Keep the guidance flow resilient even if UI callback fails.
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
      const filteredCalls = cuaCalls;

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
        if (Array.isArray(item?.cuaResponses) && item.cuaResponses.length > 0) {
          cuaResponses.push(...item.cuaResponses);
          cuaElapsedMs += Number(item.cuaElapsedMs) || 0;
        }
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
      });

      const primary = guidanceResults[0];
      const primaryCall = filteredCalls[0];
      if (primary) {
        const actionCalloutText = primaryCall.action_callout || (reasonerJson.callout ? reasonerJson.callout.text : null);
        result = await presentCuaAction({
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

    const displayAnswer = reasonerJson.answer || result.summary || null;
    const historyQuestion = question || '(auto)';
    addHistoryItem({
      question: historyQuestion,
      screenshot: frame.reasonerDataUrl || frame.getDataUrl(),
      answer: displayAnswer,
      thought: reasonerJson.thought || null,
      ttsEnabled: options.ttsEnabled === true,
      actionType: result.actionType || null,
      actionExecutor: result.executor || null,
      actionSummary: result.summary || null,
      reasonerResponse: reasonerResponse,
      setupElapsedMs,
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
      answer: displayAnswer,
      thought: reasonerJson.thought || null,
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
