# App Architect Memory

## Project: Electron Screen-Assist App

See `architecture.md` for complete detailed notes.

Key files:
- `renderer/app.js` — main UI logic, mode state, event binding, guide loop
- `renderer/cua.js` — CUA/reasoner API calls, action presentation, conversation history
- `renderer/utils.js` — mapImageCoordsToDisplay, extractCuaAction, hasScreenshotOnlyAction
- `renderer/screen-share.js` — captureFrame(), selectScreen(), stream management
- `renderer/history.js` — in-memory history log
- `renderer/dom.js` — element references
- `main.js` — Electron main process, IPC, uIOhook, UIAutomation
- `cua-client.js` — main-process: builds/POSTs CUA API call
- `reasoner-client.js` — main-process: builds/POSTs Reasoner API call
- `callout-window.html` — floating callout overlay (has Next/Complete buttons)

Two modes: `guide` (Focus, minimized widget) and `chat` (full widget).

Guide loop: `handleAsk` → `runCuaQuestion` → `presentCuaAction` → user completes action → `completeStep` → `handleAsk` (repeat).

`isGuidanceActionType` controls whether a result triggers focus mode. Action types: click, double_click, drag, scroll, scroll_up, scroll_down, keypress, type, wait, pinpoint.

Pinpoint completion is triggered by mouse proximity (`onOSMouseMove`). After `completeStep`, pinpoint hits an early return and kills the loop.

Reasoner model: `gpt-5.2` (env: REASONER_MODEL). CUA model: `computer-use-preview` (env: CUA_MODEL).
Both use OpenAI Responses API `/v1/responses`.

Conversation history formatted as flat text block prepended to system prompt (NOT structured turns).
Reasoner receives JPEG 0.7 scaled to max 1280px. CUA receives full-res PNG.

Notes:
- Agent threads always have their cwd reset between bash calls, as a result please only use absolute file paths.
- In your final response always share relevant file names and code snippets. Any file paths you return in your response MUST be absolute. Do NOT use relative paths.
- For clear communication with the user the assistant MUST avoid using emojis.
- Do not use a colon before tool calls. Text like "Let me read the file:" followed by a read tool call should just be "Let me read the file." with a period.
