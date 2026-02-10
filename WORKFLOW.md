# How It Works

This app combines an Electron screen-share widget with OpenAI Computer Use (CUA), a reasoner model, and Windows UI Automation (UIA) to guide users through on‑screen steps via callouts and highlights.

## High-Level Flow

1. User selects a display in the screen picker.
2. The renderer starts a screen share and draws a border overlay on the chosen display.
3. The user asks a question in the widget.
4. The renderer captures a frame and sends it (plus the question) to CUA.
5. CUA returns an action (click, type, drag, scroll, pinpoint, etc.) with image coordinates.
6. The renderer maps image coords to screen coords and requests UIA data at that point.
7. UIA returns the element bounds; the main process renders a highlight window and a callout.
8. OS‑level mouse/keyboard events are captured to verify the action is completed.
9. The next action (if any) is queued, or the task is marked done.

## Components And Responsibilities

- `main.js`
  - Owns all Electron windows: main widget, overlay, callout, highlight, history, screen picker.
  - Provides IPC handlers for screen capture, overlay controls, UIA detection, and model calls.
  - Tracks display scale/bounds and translates physical/DIP coordinates for overlays.
  - Captures OS‑level input via `uiohook-napi` and forwards events to the renderer.
  - Supports toggling overlay clickability and generates composite screenshots when needed.
- `preload.js`
  - Exposes a safe `window.electronAPI` surface for the renderer to call IPC methods.
- `renderer/app.js`
  - Main UI controller: chat log, status, buttons, history, and step completion UX.
  - Dispatches model requests and drives the task state machine.
- `renderer/screen-share.js`
  - Opens the screen picker, starts the desktop stream, and stops it when finished.
  - Captures frames for CUA (full PNG) and the reasoner (scaled JPEG).
- `renderer/cua.js`
  - Builds CUA prompts, parses actions, and decides when to show callouts/highlights.
  - Queues multi‑step actions and tracks pending/complete state.
  - Coordinates with UIA and overlay to visualize guidance.
- `renderer/utils.js`
  - Extracts CUA action data and maps image coordinates to display coordinates.
- `renderer/history.js`
  - Stores and renders response history for the history window.
- `cua-client.js`
  - Calls the OpenAI Responses API with the `computer_use_preview` tool and prompt text.
  - Uses `CUA_API_KEY` or `OPENAI_API_KEY`.
- `reasoner-client.js`
  - Calls the OpenAI Responses API for higher‑level reasoning over the same screen frame.
  - Uses `REASONER_API_KEY` or `OPENAI_API_KEY` and includes conversation history.
- `ui-automation.js`
  - Uses PowerShell UI Automation APIs to find the element at a screen point and return bounds.

## Windows And Overlays

- **Main widget**: The chat UI where the user asks questions and sees guidance text.
- **Overlay**: Transparent window covering the shared display to draw guidance and accept clicks.
- **Callout**: Always‑on‑top window with step instructions and status.
- **Highlight**: Transparent border window drawn around the detected UI element.
- **History**: Shows the raw JSON output from CUA.
- **Screen picker**: Modal window to select which display to share.

## Coordinate Mapping

CUA returns coordinates in the image space used in the request. The renderer converts them to absolute screen coordinates using the selected display’s bounds and scale factor:

absX = display.x + (x / imageWidth) * display.width  
absY = display.y + (y / imageHeight) * display.height

These mapped points are used for UIA detection and highlight placement.

## Completion Checks

The app listens to OS‑level mouse/keyboard events to confirm that the requested action actually occurred. When it detects a matching interaction near the target, it advances to the next step.

## Prompts And Models

- Prompt files are loaded from `prompts/` (versioned with `prompts/current.txt`).
- CUA uses `computer-use-preview` with a screenshot of the shared display.
- The reasoner model can use a scaled screenshot plus conversation history to refine guidance.
