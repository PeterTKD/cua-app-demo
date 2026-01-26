export function mapImageCoordsToDisplay({ x, y }, imageSize, displayInfo) {
  if (!displayInfo || !displayInfo.bounds) {
    throw new Error('Shared display bounds not available');
  }
  if (!imageSize.width || !imageSize.height) {
    throw new Error('Invalid image size');
  }

  const scaleFactor = displayInfo.scaleFactor || 1;
  const originScaleFactor = displayInfo.virtualScaleFactor || scaleFactor;
  const physicalBounds = displayInfo.physicalBounds || {
    x: displayInfo.bounds.x * originScaleFactor,
    y: displayInfo.bounds.y * originScaleFactor,
    width: displayInfo.bounds.width * scaleFactor,
    height: displayInfo.bounds.height * scaleFactor
  };

  const absX = physicalBounds.x + (x / imageSize.width) * physicalBounds.width;
  const absY = physicalBounds.y + (y / imageSize.height) * physicalBounds.height;
  return { absX, absY };
}

export function extractCuaAction(response) {
  if (!response) {
    return { action: null, summary: null };
  }

  const outputs = response.output || response.outputs || response?.response?.output || [];
  let summary = null;
  let action = null;
  let actionType = null;
  let actionStatus = null;

  outputs.forEach((item) => {
    if (!summary && item?.summary) {
      const summaryItem = item.summary.find((entry) => entry.type === 'summary_text');
      if (summaryItem?.text) {
        summary = summaryItem.text;
      }
    }

    if (!action && item?.type === 'computer_call' && item?.action) {
      action = item.action;
      actionType = item.type || 'computer_call';
      actionStatus = item.status || null;
    }

    if (!summary && item?.type === 'message' && Array.isArray(item.content)) {
      const textItem = item.content.find((entry) => entry.type === 'output_text');
      if (textItem?.text) {
        summary = textItem.text;
      }
    }
  });

  if (!summary && response.output_text) {
    summary = response.output_text;
  }

  return { action, summary, actionType, actionStatus };
}

export function hasScreenshotOnlyAction(action) {
  return action && action.type === 'screenshot';
}
