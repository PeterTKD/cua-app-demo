# Workflow: End-to-End System Behavior

## 1) What This App Is
This is an Electron desktop assistant that watches a user-selected screen, plans next UI guidance steps with a reasoning model, validates those steps with a Computer Use model, and guides the user with visual callouts/highlights. It also monitors OS-level input to detect when the step was completed.

Core pattern:
1. Capture screen context.
2. Plan the next action(s).
3. Show guidance on-screen.
4. Observe user input.
5. Verify completion and continue.

The system is agentic but human-in-the-loop: the app proposes/points, the user performs the action.

---

## 2) Architecture Overview

### Main Process (`main.js`)
Responsibilities:
- Owns all windows:
  - Main widget window (`index.html`)
  - Full-screen transparent overlay (`overlay.html`)
  - Floating callout window (`callout-window.html`)
  - Highlight border window (dynamic `data:` HTML)
  - History window (`history-window.html`)
  - Screen picker modal (`screen-picker.html`)
- Exposes IPC handlers for:
  - screen source discovery and display metadata
  - overlay/callout/highlight control
  - CUA + reasoner API requests
  - TTS + STT API requests
  - UI Automation element detection
  - widget resizing and app lifecycle actions
- Starts OS-level global input listeners via `uiohook-napi` and forwards events to renderer.

### Preload Bridge (`preload.js`)
- Exposes safe `window.electronAPI` methods/events to renderer.
- Renderer does not directly use Node APIs.

### Renderer Orchestration
- `renderer/app.js`: main controller/state transitions/button and mode logic.
- `renderer/cua.js`: planning/execution loop integration and action presentation.
- `renderer/screen-share.js`: display selection, capture stream, frame extraction.
- `renderer/input.js`: OS input matching against active action criteria.
- `renderer/history.js`: in-memory session history model.

### External Service Clients
- `cua-client.js`: OpenAI Responses API with `computer_use_preview` tool.
- `reasoner-client.js`: OpenAI/Anthropic reasoning endpoint abstraction.
- `tts-client.js`: speech synthesis endpoint.
- `stt-api.js`: speech transcription endpoint.

### Local Automation Engine
- `ui-automation.js`: PowerShell + Windows UI Automation (UIA) lookup at screen points.

---

## 3) Startup And Initialization Flow
1. App starts (`app.whenReady`).
2. Main widget window is created as frameless, transparent, always-on-top.
3. Permission handler allows media/microphone requests.
4. Renderer loads and initializes:
   - binds event handlers
   - enters GUIDE mode by default
   - clears chat UI
   - sets initial status
5. Main process starts OS input capture (`uIOhook.start`) after widget load.
6. Global shortcut is registered: `Ctrl/Cmd + Alt + D` to toggle overlay clickability mode.

Crash handling:
- If renderer crashes (`render-process-gone`), main logs and reloads renderer.

---

## 4) Screen Selection And Sharing Workflow
1. User clicks screen select in widget.
2. Renderer requests `open-screen-picker`.
3. Main opens modal picker and returns selected desktop source (`sourceId`, `displayId`).
4. Renderer starts `getUserMedia` desktop capture for that source.
   - Tries physical resolution first, falls back to DIP size if needed.
5. Renderer stores stream in hidden `<video>`.
6. Renderer asks main to `show-border-overlay(displayId)`.
7. Main stores current display metadata:
   - display bounds (DIP)
   - scale factor
   - computed physical bounds

Result: app now has live screen pixels and coordinate mapping context.

---

## 5) Ask/Plan/Guide Loop (Primary Agentic Loop)

### Step A: User Ask Trigger
Trigger sources:
- Ask button
- Enter key
- Auto-followup timer
- Next button
- Overlay Next event

`handleAsk()` in `renderer/app.js` does:
1. Resolve question text (new or last question for guided continuation).
2. Resolve mode (`guide/chat/diff_method/point`).
3. Ensure screen share exists; if not, invoke picker.
4. Set running flags; stop any active TTS/voice capture conflicts.
5. Call `runCuaQuestion(question, options)` in `renderer/cua.js`.

### Step B: Frame Capture
`renderer/cua.js`:
1. Ensures widget visible and clears old callout/highlight.
2. Waits for fresh video frame callback.
3. Captures frame from shared video.
4. Produces:
   - Full PNG data URL (`dataUrl`) for CUA-level operations/history.
   - Scaled JPEG (`reasonerDataUrl`) for reasoner.

### Step C: Reasoner Planning
`runReasonerQuestion` receives:
- `context.user_message`
- `context.conversation_history` (in-memory, full session)
- `context.last_cua_suggestion`
- mode/user status flags
- screenshot image

Reasoner returns JSON expected to include:
- `answer` (assistant text)
- `cua_calls` (planned low-level action calls)
- optional `callout` metadata

### Step D: CUA Action Resolution
If no actions or task completed marker:
- app shows callout-only guidance or clears pending action.

If actions exist:
1. For each call, app runs CUA instruction (`runCuaInstruction`) with:
   - action target description
   - same frame image
   - display size
2. CUA returns concrete action payload (click/double_click/drag/scroll/type/etc + coords/keys).
3. App checks expected-vs-actual action discrepancy.
4. On discrepancy, retries once with immediate recapture path.

### Step E: Presenting Action To User
`presentCuaAction()`:
1. Converts CUA image coords to display absolute physical coordinates.
2. Converts physical coords to DIP/local overlay coords for UI placement.
3. Shows callout window near target point.
4. Requests UIA element detection at target point (parallelized).
5. If UIA returns bounds, main draws highlight window around that element.
6. Stores `currentAction`, `currentTargetRect`, `pendingAction`.

### Step F: Completion Detection
`renderer/input.js` listens to OS events forwarded from main:
- click/double click
- mouse down/up/move
- wheel
- keydown

For each active action type, it checks criteria:
- click/double click near target within tolerance
- drag start and end within target points
- wheel for scroll
- key combo match for keypress
- pinpoint proximity on move

For click/double-click, app can run pixel-diff confirmation:
- captures pre-action sample
- waits settle delay
- captures post-action sample
- computes changed percentage excluding center cursor zone
- only completes if diff >= threshold

### Step G: Continue Or Finish
On criteria met:
1. callout/highlight cleared
2. queued action shown (if multiple planned)
3. otherwise assistant marks completion note and triggers follow-up ask automatically

On criteria not met:
- pending action reset, guidance faded, reasoner gets user_status feedback and replans.

Task completion:
- on `callout-complete`, app resets CUA/session state, clears history/chat UI and returns to ready state.

---

## 6) Voice Flow (Optional)

### Capture
- Renderer starts microphone capture via `audio-start-capture` (main process `naudiodon`).
- Audio chunks buffered in memory.

### Interim
- Renderer periodically asks for `audio-interim` (last ~4s WAV base64) and sends to STT for interim text preview.

### Final
- Renderer calls `audio-stop-capture`, receives WAV base64.
- Sends WAV to STT endpoint, gets transcript.
- Merges transcript into question input.

### TTS
- Assistant text can be synthesized via TTS endpoint.
- Text is cleaned (markdown/code markers removed), truncated to 4096 chars, returned as MP3 base64, and played in renderer.

---

## 7) Windows, Coordinates, And Overlays

### Coordinate Domains
- Image coordinates: model output space (captured frame dimensions).
- Physical screen coordinates: actual pixel coordinates used by UIA and OS events.
- DIP coordinates: Electron window positioning/rendering space.

### Conversion usage
- CUA point -> display absolute point -> overlay/callout local point.
- UIA highlight rect physical -> DIP for highlight BrowserWindow placement.

### Overlay click-through behavior
- Default guidance mode is click-through.
- Toggle shortcut can switch overlay interactivity.

---

## 8) Data Inventory: What The App Gets, Generates, Sends, Stores

## 8.1 Inputs Collected Locally
From user/system:
- User typed question text.
- Voice audio (if mic used) as PCM chunks in memory.
- Desktop video stream pixels from selected screen.
- OS-level global input telemetry events:
  - mouse coordinates/button actions
  - wheel rotation
  - key down events + modifiers
- Selected display metadata:
  - display id
  - bounds
  - scale factors

From UI Automation:
- UI element metadata at target point:
  - Name, ClassName, ControlType, AutomationId
  - ProcessId, ProcessName, ProcessPath (if available)
  - IsEnabled, IsOffscreen
  - Bounding rectangle
  - optional parent metadata

## 8.2 Derived/Generated Data In App
- Full PNG screenshot data URL per ask cycle.
- Scaled JPEG screenshot data URL for reasoner.
- Action plans from reasoner (`cua_calls`, callout metadata).
- Resolved concrete actions from CUA.
- Mapped absolute/dip target coordinates.
- Pixel-diff percentages for completion verification.
- Session conversation history (in-memory array).
- Session history items (question, screenshot, answer, action metadata, model timings).

## 8.3 Data Sent To External APIs
Reasoner request sends:
- screenshot image (`imageDataUrl`)
- user message
- entire in-session conversation history text
- mode/status context

CUA request sends:
- action instruction text
- screenshot image (`imageDataUrl`)
- display dimensions
- tool config (`computer_use_preview`, environment)

STT request sends (when used):
- WAV audio blob
- model + language

TTS request sends (when used):
- cleaned assistant text
- model + voice

Endpoints configurable via env; defaults include:
- `https://api.openai.com/v1/responses`
- `https://api.openai.com/v1/audio/transcriptions`
- `https://api.openai.com/v1/audio/speech`
- or Anthropic messages endpoint for selected reasoner model.

## 8.4 Local Storage And Retention
- History and conversation state are in-memory only during runtime.
- No built-in persistent database for session logs.
- API keys can be loaded from environment variables and/or `api-keys.json`.
- Prompt text is read from local `prompts/` files.
- UIA tree helper may write temporary JSON files in `%TEMP%` during deep tree fetch, then attempts cleanup.

Practical implication:
- Sensitive screen/audio content is transient in process memory unless added external logging is introduced.

---

## 9) Security/Privacy-Relevant Notes
- App can observe full selected screen contents.
- App can capture global keyboard/mouse events while running.
- App transmits captured screen/audio/user prompts to configured AI services.
- API keys may be present in local file if not env-based.
- Session history currently has no hard cap (unlimited in-memory growth).

---

## 10) Failure Handling And Recovery
- Renderer crash: auto reload from main process.
- Missing screen stream: ask path prompts screen selection.
- Missing API key: specific throw from service clients.
- CUA discrepancy: one automatic retry.
- On app close: overlay/callout windows are destroyed and OS hook stops.

---

## 11) Practical Summary
This app is a guided desktop automation assistant with a closed loop:
1. perceive screen
2. reason and plan
3. propose concrete UI action
4. visualize target with callout/highlight
5. verify user action from OS telemetry + optional pixel diff
6. continue until task completion

It is not just static workflow scripting; it is an adaptive, stateful, human-in-the-loop agentic system.
