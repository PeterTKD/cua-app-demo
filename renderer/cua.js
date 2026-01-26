import { elements } from './dom.js';
import { captureFrame } from './screen-share.js';
import { addHistoryItem } from './history.js';
import { extractCuaAction, hasScreenshotOnlyAction, mapImageCoordsToDisplay } from './utils.js';

function buildCalloutText(summary) {
  if (!summary) {
    return 'Click the highlighted item to continue.';
  }

  const cleaned = summary.replace(/\s+/g, ' ').trim();
  const hasCoords = /(?:^|\\b)[xy]\\s*[:=]\\s*\\d+/i.test(cleaned) ||
    /click action/i.test(cleaned) ||
    /button\\s*:\\s*\\d+/i.test(cleaned);


  return cleaned;
}

const ACTION_COLORS = {
  click: '#1f2937',
  double_click: '#22c55e',
  scroll: '#a855f7',
  keypress: '#0f766e',
  type: '#3b82f6',
  wait: '#a16207',
  drag: '#facc15',
  callout: '#ef4444'
};

let currentTargetRect = null;
let currentAction = null;
const previousResponses = [];
let lastResponseId = null;
let hasRunOnce = false;
let followUpPromptCache = null;

async function getFollowUpPrompt() {
  if (followUpPromptCache !== null) {
    return followUpPromptCache;
  }
  try {
    // Follow-up prompt loaded from prompts/<version>/followup.txt via main process.
    followUpPromptCache = await window.electronAPI.getPromptText('followup');
  } catch {
    followUpPromptCache = '';
  }
  return followUpPromptCache;
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

async function waitForFreshVideoFrame(timeoutMs = 1000) {
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

export async function runCuaQuestion(question, options = {}) {
  if (!question) {
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
    try {
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      if (captureDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, captureDelayMs));
      }
      await waitForFreshVideoFrame();
      await waitForFreshVideoFrame();
      frame = captureFrame();
    } finally {
      // Keep widget visible during capture.
    }

    if (!frame) {
      throw new Error('Failed to capture screen frame.');
    }

    const result = await runCuaOnce(question, frame, false);
    return result;
  } finally {
    await window.electronAPI.setLoadingState(false);
  }
}

async function runCuaOnce(question, frame, strict) {
  const followUpPrompt = await getFollowUpPrompt();
  const historyText = previousResponses.length > 0
    ? previousResponses.map((entry, index) => (
        `Step ${index + 1} (${entry.id})\n` +
        `reasoning_summary: ${entry.summary}\n` +
        `type: ${entry.type || 'unknown'}\n` +
        `status: ${entry.status || 'unknown'}\n` +
        `action: ${entry.action ? JSON.stringify(entry.action) : 'none'}`
      )).join('\n\n')
    : '';
  const promptQuestion = hasRunOnce
    ? `Goal: ${question}
Follow-up tasks:
- Continue from the latest step
${followUpPrompt}
${historyText ? `Previous responses:\n${historyText}\n` : ''}
`
    : question;
  const response = await window.electronAPI.runCuaQuestion({
    question: promptQuestion,
    imageDataUrl: frame.dataUrl,
    displayWidth: frame.width,
    displayHeight: frame.height,
    strict
  });

  const durationMs = response && response.created_at && response.completed_at
    ? (response.completed_at - response.created_at) * 1000
    : null;
  const usage = response && response.usage ? response.usage : {};
  addHistoryItem({
    question,
    response,
    screenshot: frame.dataUrl,
    durationMs,
    inputTokens: usage.input_tokens || null,
    outputTokens: usage.output_tokens || null,
    totalTokens: usage.total_tokens || null
  });

  const { action, summary, actionType, actionStatus } = extractCuaAction(response);
  hasRunOnce = true;
  if (response && response.id) {
    lastResponseId = response.id;
  }
  const storedSummary = summary || 'No summary available';
  if (storedSummary) {
    previousResponses.push({
      id: response && response.id ? response.id : 'unknown',
      summary: storedSummary,
      type: actionType,
      status: actionStatus,
      action: action || null
    });
    if (previousResponses.length > 8) {
      previousResponses.shift();
    }
  }
  const calloutText = buildCalloutText(summary);
  const actionTypeName = action && action.type ? action.type : null;
  const requiresPointer = ['click', 'double_click', 'drag'].includes(actionTypeName);
  const hasDragPath = actionTypeName === 'drag' && Array.isArray(action?.path) && action.path.length > 1;
  if (!action || (requiresPointer && !hasDragPath && (typeof action.x !== 'number' || typeof action.y !== 'number'))) {
    if (hasScreenshotOnlyAction(action) && !strict) {
      return runCuaOnce(question, frame, true);
    }

    const fallbackText = hasScreenshotOnlyAction(action)
      ? 'CUA returned a screenshot only. Please try asking again.'
      : calloutText;
      await window.electronAPI.showCallout({
        heading: 'Call Out',
        body: fallbackText,
        borderColor: ACTION_COLORS.callout,
        headingColor: ACTION_COLORS.callout,
        x: -1,
        y: -1,
        showNext: true
      });
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
  let absX = -1;
  let absY = -1;
  let dipX = -1;
  let dipY = -1;
  let localX = -1;
  let localY = -1;
  let startPoint = { x: action?.x, y: action?.y };
  let endPoint = { x: action?.x2 ?? action?.end_x ?? action?.endX, y: action?.y2 ?? action?.end_y ?? action?.endY };
  if (actionTypeName === 'drag' && Array.isArray(action.path) && action.path.length > 1) {
    startPoint = action.path[0];
    endPoint = action.path[action.path.length - 1];
  }
  if (requiresPointer && typeof startPoint.x === 'number' && typeof startPoint.y === 'number') {
    const mapped = mapImageCoordsToDisplay(
      { x: startPoint.x, y: startPoint.y },
      { width: frame.width, height: frame.height },
      displayInfo
    );
    absX = mapped.absX;
    absY = mapped.absY;
    dipX = Math.round((absX - physicalBounds.x) / scaleFactor + displayInfo.bounds.x);
    dipY = Math.round((absY - physicalBounds.y) / scaleFactor + displayInfo.bounds.y);
    localX = Math.round(dipX - displayInfo.bounds.x);
    localY = Math.round(dipY - displayInfo.bounds.y);
  }

  const normalizedActionType = actionTypeName || 'click';
  const heading = normalizedActionType === 'double_click' ? 'Double click'
    : normalizedActionType === 'keypress' ? 'Key press'
    : normalizedActionType === 'scroll' || normalizedActionType === 'scroll_up' || normalizedActionType === 'scroll_down' ? 'Scroll'
    : normalizedActionType === 'type' ? 'Type'
    : normalizedActionType === 'wait' ? 'Wait'
    : normalizedActionType === 'drag' ?
     'Drag'
    : 'Click';
  const borderColor = ACTION_COLORS[normalizedActionType] || ACTION_COLORS.click;
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
    const endX = endPoint?.x;
    const endY = endPoint?.y;
    if (typeof endX === 'number' && typeof endY === 'number') {
      const { absX: endAbsX, absY: endAbsY } = mapImageCoordsToDisplay(
        { x: endX, y: endY },
        { width: frame.width, height: frame.height },
        displayInfo
      );
      endDipX = Math.round((endAbsX - physicalBounds.x) / scaleFactor + displayInfo.bounds.x);
      endDipY = Math.round((endAbsY - physicalBounds.y) / scaleFactor + displayInfo.bounds.y);
      endLocalX = Math.round(endDipX - displayInfo.bounds.x);
      endLocalY = Math.round(endDipY - displayInfo.bounds.y);
    }
  }

  const showNext = ['scroll', 'scroll_up', 'scroll_down', 'keypress', 'type', 'wait'].includes(normalizedActionType);
  const resolvedHeading = heading || 'Click';
  let resolvedBody = calloutText || 'Click the highlighted item to continue.';
  if (normalizedActionType === 'drag') {
    const lower = resolvedBody.toLowerCase();
    if (!lower.includes('drag') && !lower.includes('start') && !lower.includes('end')) {
      resolvedBody = `${resolvedBody} Drag from the bright dot to the dim dot.`;
    }
  }
  await window.electronAPI.showCallout({
    heading: resolvedHeading,
    body: resolvedBody,
    borderColor,
    headingColor,
    x: localX,
    y: localY,
    endX: endLocalX,
    endY: endLocalY,
    keys,
    showNext
  });

  const physicalX = absX >= 0 ? Math.round(absX) : null;
  const physicalY = absY >= 0 ? Math.round(absY) : null;
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

  if (physicalX !== null && physicalY !== null) {
    const element = await window.electronAPI.detectElementAtPoint(physicalX, physicalY);
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
  }

  const hasPointer = ['click', 'double_click', 'drag'].includes(normalizedActionType);
  return { action, summary, element, hasPointer, actionType: normalizedActionType };
}
