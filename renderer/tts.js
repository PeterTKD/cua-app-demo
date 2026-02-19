import { appState } from './state.js';

export function stopCurrentAudio() {
  if (appState.currentAudio) {
    appState.currentAudio.pause();
    appState.currentAudio.src = '';
    appState.currentAudio = null;
  }
  if (appState.currentAudioUrl) {
    URL.revokeObjectURL(appState.currentAudioUrl);
    appState.currentAudioUrl = null;
  }
}

export function speakText(text) {
  if (!appState.isTTSEnabled || !text) return;
  stopCurrentAudio();

  window.electronAPI.synthesizeSpeech({ text }).then((base64Audio) => {
    if (!base64Audio || !appState.isTTSEnabled) return;

    const binaryString = atob(base64Audio);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    const blob = new Blob([bytes], { type: 'audio/mpeg' });
    appState.currentAudioUrl = URL.createObjectURL(blob);
    appState.currentAudio = new Audio(appState.currentAudioUrl);
    appState.currentAudio.playbackRate = 1.25;
    appState.currentAudio.play().catch((err) => {
      console.warn('TTS playback failed:', err);
    });
    appState.currentAudio.addEventListener('ended', () => {
      stopCurrentAudio();
    });
  }).catch((err) => {
    console.warn('TTS synthesis failed:', err.message);
  });
}
