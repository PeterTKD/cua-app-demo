import { elements } from './dom.js';

let currentStream = null;
let currentSource = null;
let currentDisplayId = null;

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

export function captureFrame() {
  if (!currentStream || !elements.video.videoWidth || !elements.video.videoHeight) {
    throw new Error('No active screen stream');
  }

  const sourceWidth = elements.video.videoWidth;
  const sourceHeight = elements.video.videoHeight;
  const maxDimension = 1280;
  const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
  const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
  const targetHeight = Math.max(1, Math.round(sourceHeight * scale));

  const fullCanvas = document.createElement('canvas');
  fullCanvas.width = sourceWidth;
  fullCanvas.height = sourceHeight;
  const fullCtx = fullCanvas.getContext('2d');
  fullCtx.drawImage(elements.video, 0, 0, sourceWidth, sourceHeight);

  const scaledCanvas = document.createElement('canvas');
  scaledCanvas.width = targetWidth;
  scaledCanvas.height = targetHeight;
  const scaledCtx = scaledCanvas.getContext('2d');
  scaledCtx.drawImage(fullCanvas, 0, 0, targetWidth, targetHeight);

  return {
    dataUrl: fullCanvas.toDataURL('image/png'),
    width: fullCanvas.width,
    height: fullCanvas.height,
    reasonerDataUrl: scaledCanvas.toDataURL('image/jpeg', 0.7),
    reasonerWidth: scaledCanvas.width,
    reasonerHeight: scaledCanvas.height
  };
}

async function startShare({ sourceId, displayId, name }) {
  const displayInfo = await window.electronAPI.getDisplayInfo(displayId);
  const baseMandatory = {
    chromeMediaSource: 'desktop',
    chromeMediaSourceId: sourceId
  };

  const requestStream = async (size) => {
    const mandatory = { ...baseMandatory };
    if (size && size.width && size.height) {
      mandatory.minWidth = size.width;
      mandatory.minHeight = size.height;
      mandatory.maxWidth = size.width;
      mandatory.maxHeight = size.height;
    }
    return navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { mandatory }
    });
  };

  let stream;
  const physicalSize = displayInfo?.physicalSize;
  const dipSize = displayInfo?.size;

  try {
    stream = await requestStream(physicalSize);
    const settings = stream.getVideoTracks()[0]?.getSettings?.() || {};
    if (physicalSize && settings.width && settings.height) {
      const widthRatio = settings.width / physicalSize.width;
      const heightRatio = settings.height / physicalSize.height;
      if (widthRatio < 0.9 || heightRatio < 0.9) {
        stream.getTracks().forEach((track) => track.stop());
        stream = await requestStream(dipSize);
      }
    }
  } catch (error) {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }
    stream = await requestStream(dipSize);
  }

  if (currentStream) {
    currentStream.getTracks().forEach((track) => track.stop());
  }

  currentStream = stream;
  currentSource = { sourceId, name };
  currentDisplayId = displayId;

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

  elements.video.srcObject = null;

  await window.electronAPI.hideBorderOverlay();
}
