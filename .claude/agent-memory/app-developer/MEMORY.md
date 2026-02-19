# App Developer Memory

## Renderer Module Structure (after refactor)
- `renderer/state.js` — Shared constants (`APP_MODES`, `CHAT_WIDTH`, `FOCUS_WIDTH`, `POSITION_TOLERANCE`, `DOUBLE_CLICK_WINDOW_MS`) and mutable `appState` object
- `renderer/resize.js` — `requestWidgetResize()`, `setupResizeObserver()` — imports from dom.js, state.js
- `renderer/tts.js` — `stopCurrentAudio()`, `speakText()` — imports from state.js
- `renderer/chat.js` — `escapeHtml()`, `renderMarkdown()`, `updateChatLayout()`, `streamTextIntoBubble()`, `finishActiveStream()`, `addChatMessage()`, `addSystemMessage()`, `clearChatLog()` — imports from dom.js, state.js, resize.js
- `renderer/mode.js` — `setAppMode()`, `setGuideProcessActive()`, `updateModeUI()`, `getFollowupDelayMs()`, `resolveAutoMode()`, `inferModeFromQuestion()`, `isGuidanceActionType()`, `registerSetStatus()` — imports from dom.js, state.js, resize.js, chat.js, cua.js
- `renderer/input.js` — `UIOHOOK_KEYCODES`, `UIOHOOK_MODIFIER_KEYCODES`, `normalizeKeyName()`, `matchesKeyCombo()`, `withinTolerance()`, `bindOSInputHandlers()` — imports from state.js, cua.js
- `renderer/app.js` — Orchestrator: `handleAsk`, `completeStep`, `completeTaskAndReset`, `startGuideKickoff`, `resolveQuestion`, `waitForDisplayBounds`, `handleSelectScreen`, `setStatus`, `setTaskButtonsEnabled`, `bindEvents`, `init`

## Circular Dependency Pattern
- `setAppMode` (mode.js) needed `startGuideKickoff` (app.js). Solved via `onGuideKickoff` callback in options + `registerSetStatus()` for the `setStatus` dependency.
- `bindOSInputHandlers` (input.js) receives `{ completeStep, setStatus }` as parameter to avoid importing from app.js.

## Key Conventions
- All mutable state lives in `appState` object (state.js) — shared by reference across modules
- `window.electronAPI` hints in TS diagnostics are pre-existing and expected (Electron preload bridge)
