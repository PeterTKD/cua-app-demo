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

  const canvas = document.createElement('canvas');
  canvas.width = elements.video.videoWidth;
  canvas.height = elements.video.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(elements.video, 0, 0, canvas.width, canvas.height);

  return {
    dataUrl: canvas.toDataURL('image/png'),
    width: canvas.width,
    height: canvas.height
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
