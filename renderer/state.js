export const APP_MODES = {
  GUIDE: 'guide',
  CHAT: 'chat'
};

export const CHAT_WIDTH = 680;
export const FOCUS_WIDTH = 540;
export const POSITION_TOLERANCE = 20;
export const DOUBLE_CLICK_WINDOW_MS = 550;

export const appState = {
  lastQuestion: '',
  isRunningCua: false,
  isCompletingStep: false,
  lastStepCompletedAt: 0,
  lastClickTime: 0,
  lastClickPoint: null,
  dragArmed: false,
  lastKeydownAt: 0,
  resizeRaf: null,
  appMode: 'guide',
  hasGuideKickoffStarted: false,
  isGuideProcessActive: false,
  guideProcessEpoch: 0,
  isTTSEnabled: false,
  currentAudio: null,
  currentAudioUrl: null,
  activeStreamInterval: null,
  activeStreamTarget: null,
  activeStreamMessage: '',
  activeStreamOnDone: null,
  actionMessageBubbles: []
};
