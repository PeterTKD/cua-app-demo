import { elements } from './dom.js';

let currentStream = null;
let currentSource = null;
let currentDisplayId = null;
let currentDisplayInfo = null;

export async function selectScreen() {
  const choice = await window.electronAPI.openScreenPicker();
  if (!choice) {
    return null;
  }

  await startShare(choice);
  return choice;
}

export async function ensureVideoReady() {
  if (elements.video.videoWidth && elements.video.videoHeight) {
    return true;
  }

  await new Promise((resolve) => {
    const onReady = () => {
      if (elements.video.videoWidth && elements.video.videoHeight) {
        cleanup();
        resolve();
      }
    };

    const cleanup = () => {
      elements.video.removeEventListener('loadedmetadata', onReady);
      elements.video.removeEventListener('loadeddata', onReady);
    };

    elements.video.addEventListener('loadedmetadata', onReady);
    elements.video.addEventListener('loadeddata', onReady);
  });

  return true;
}

export function getShareState() {
  return {
    stream: currentStream,
    sourceId: currentSource?.sourceId || null,
    displayId: currentDisplayId
  };
}

function getExpectedCaptureSize() {
  const physicalSize = currentDisplayInfo?.physicalSize;
  if (physicalSize?.width > 0 && physicalSize?.height > 0) {
    return physicalSize;
  }

  const bounds = currentDisplayInfo?.bounds;
  if (bounds?.width > 0 && bounds?.height > 0) {
    return { width: bounds.width, height: bounds.height };
  }

  const size = currentDisplayInfo?.size;
  if (size?.width > 0 && size?.height > 0) {
    return size;
  }

  return null;
}

function getCaptureCrop(sourceWidth, sourceHeight) {
  const expectedSize = getExpectedCaptureSize();
  if (!expectedSize) {
    return { x: 0, y: 0, width: sourceWidth, height: sourceHeight };
  }

  const sourceAspect = sourceWidth / sourceHeight;
  const targetAspect = expectedSize.width / expectedSize.height;
  if (!Number.isFinite(sourceAspect) || !Number.isFinite(targetAspect) || targetAspect <= 0) {
    return { x: 0, y: 0, width: sourceWidth, height: sourceHeight };
  }

  if (Math.abs(sourceAspect - targetAspect) < 0.01) {
    return { x: 0, y: 0, width: sourceWidth, height: sourceHeight };
  }

  if (sourceAspect > targetAspect) {
    const cropWidth = Math.max(1, Math.round(sourceHeight * targetAspect));
    return {
      x: Math.max(0, Math.round((sourceWidth - cropWidth) / 2)),
      y: 0,
      width: cropWidth,
      height: sourceHeight
    };
  }

  const cropHeight = Math.max(1, Math.round(sourceWidth / targetAspect));
  return {
    x: 0,
    y: Math.max(0, Math.round((sourceHeight - cropHeight) / 2)),
    width: sourceWidth,
    height: cropHeight
  };
}

export function captureFrame() {
  if (!currentStream || !elements.video.videoWidth || !elements.video.videoHeight) {
    throw new Error('No active screen stream');
  }

  const sourceWidth = elements.video.videoWidth;
  const sourceHeight = elements.video.videoHeight;
  const crop = getCaptureCrop(sourceWidth, sourceHeight);
  const maxDimension = 1280;
  const scale = Math.min(1, maxDimension / Math.max(crop.width, crop.height));
  const targetWidth = Math.max(1, Math.round(crop.width * scale));
  const targetHeight = Math.max(1, Math.round(crop.height * scale));

  const fullCanvas = document.createElement('canvas');
  fullCanvas.width = crop.width;
  fullCanvas.height = crop.height;
  const fullCtx = fullCanvas.getContext('2d');
  fullCtx.drawImage(
    elements.video,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    crop.width,
    crop.height
  );

  const scaledCanvas = document.createElement('canvas');
  scaledCanvas.width = targetWidth;
  scaledCanvas.height = targetHeight;
  const scaledCtx = scaledCanvas.getContext('2d');
  scaledCtx.drawImage(fullCanvas, 0, 0, targetWidth, targetHeight);

  const reasonerDataUrl = scaledCanvas.toDataURL('image/webp', 0.7);
  let fullDataUrl = null;

  return {
    width: fullCanvas.width,
    height: fullCanvas.height,
    reasonerDataUrl,
    reasonerWidth: scaledCanvas.width,
    reasonerHeight: scaledCanvas.height,
    getDataUrl() {
      if (!fullDataUrl) {
        fullDataUrl = fullCanvas.toDataURL('image/webp');
      }
      return fullDataUrl;
    }
  };
}

async function startShare({ sourceId, displayId, name }) {
  const displayInfo = await window.electronAPI.getDisplayInfo(displayId);
  const baseMandatory = {
    chromeMediaSource: 'desktop',
    chromeMediaSourceId: sourceId
  };

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { mandatory: baseMandatory }
  });

  if (currentStream) {
    currentStream.getTracks().forEach((track) => track.stop());
  }

  currentStream = stream;
  currentSource = { sourceId, name };
  currentDisplayId = displayId;
  currentDisplayInfo = displayInfo || null;

  elements.video.srcObject = stream;

  await window.electronAPI.showBorderOverlay(displayId);

  stream.getVideoTracks()[0].addEventListener('ended', () => {
    stopShare();
  });
}

export async function stopShare() {
  if (currentStream) {
    currentStream.getTracks().forEach((track) => track.stop());
    currentStream = null;
  }

  currentSource = null;
  currentDisplayId = null;
  currentDisplayInfo = null;

  elements.video.srcObject = null;

  await window.electronAPI.hideBorderOverlay();
}
