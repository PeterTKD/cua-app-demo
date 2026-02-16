# Architecture Notes — Electron Screen-Assist App

## File Map

| File | Role |
|------|------|
| `main.js` | Electron main process. IPC handlers, window management, uIOhook OS event capture, UIAutomation wrapper |
| `renderer/app.js` | UI orchestration: mode FSM, handleAsk loop, OS event listeners for action completion |
| `renderer/cua.js` | Agent pipeline: captures frame, calls Reasoner, calls CUA, calls presentCuaAction |
| `renderer/utils.js` | `mapImageCoordsToDisplay`, `extractCuaAction`, `hasScreenshotOnlyAction` |
| `renderer/screen-share.js` | Screen stream management, `captureFrame()`, `selectScreen()` |
| `renderer/history.js` | In-memory history log (questions + notes), unlimited |
| `renderer/dom.js` | Single source of truth for all DOM element references |
| `cua-client.js` | Main-process module: builds and POSTs to OpenAI CUA endpoint |
| `reasoner-client.js` | Main-process module: builds and POSTs to OpenAI Reasoner endpoint |
| `ui-automation.js` | Windows UI Automation wrapper for `getElementAtPoint` |

## Prompt System

Prompts live in `prompts/{version}/`. Version is read from `prompts/current.txt`.
- `system.txt` / `reasoner.txt` — Reasoner system prompt
- `cua.txt` — CUA instructions
- `followup.txt`, `diff_method.txt`, `point.txt` — alternate prompt modes
Environment variables can override: `CUA_PROMPT_PATH`, `CUA_PROMPT_VERSION`, `CUA_PROMPTS_DIR`.

## Agent Models

- Reasoner: `REASONER_MODEL` env var, default `gpt-5.2`, endpoint `REASONER_ENDPOINT`
- CUA: `CUA_MODEL` env var, default `computer-use-preview`, endpoint `CUA_ENDPOINT`
- Both use OpenAI Responses API (`/v1/responses`)

## Reasoner Input Structure

Built in `reasoner-client.js → buildReasonerPayload`. Sent via IPC `reasoner-run` → main process.

```
{
  model: REASONER_MODEL,
  instructions: systemPrompt + "\n\n=== Conversation History ===\n" + formattedHistory,
  input: [{
    role: 'user',
    content: [
      { type: 'input_text', text: user_message },
      { type: 'input_image', image_url: reasonerDataUrl }   // JPEG 0.7 quality, max 1280px
    ]
  }],
  reasoning: { effort: 'none' },
  truncation: 'auto'
}
```

Context object sent from renderer (`cua.js → runCuaQuestion`):
```js
{
  user_message: question || '',
  conversation_history: [...],   // { role, content } pairs
  allow_parallel_pinpoint: true,
  last_cua_suggestion: lastCuaSummary || null,
  mode?: 'guide' | 'chat',
  user_status?: 'Action Criteria Met' | 'Action Criteria Was not met'
}
```

History is formatted as flat text: `ROLE: content\n` — NOT passed as structured turns.
History is concatenated into instructions string, not the input array.

## Reasoner Output Structure

Must be valid JSON (parsed via `extractReasonerJson`):
```json
{
  "answer": "Markdown text shown in chat bubble. May include <<TASK_COMPLETED>>.",
  "cua_calls": [
    {
      "action": "click | double_click | drag | scroll | scroll_up | scroll_down | keypress | type | wait | pinpoint",
      "action-callout": "Short text for the overlay callout bubble",
      "target_description": "Natural language description of what to find on screen"
    }
  ],
  "callout": {
    "text": "Fallback callout text (used when no cua_calls)",
    "type": "info | hint | warning | error-solving"
  }
}
```

Key rules:
- If `cua_calls` is empty → show callout only (no CUA invocation)
- If `cua_calls.length > 1` → filter to pinpoints only
- `<<TASK_COMPLETED>>` in answer → suppress callout, trigger task reset
- `answer` is always pushed to `conversationHistory` as `assistant` role

## CUA Input Structure

Built in `cua-client.js → buildCuaPayload`. Sent via IPC `cua-run`.

```js
{
  model: CUA_MODEL,                     // 'computer-use-preview'
  instructions: cuaPrompt,
  input: [{
    role: 'user',
    content: [
      { type: 'input_text', text: `Action: ${call.action}\nInstruction: ${call.target_description}` },
      { type: 'input_image', image_url: frame.dataUrl }   // full-res PNG
    ]
  }],
  reasoning: { summary: 'concise' },
  tools: [{
    type: 'computer_use_preview',
    display_width: frame.width,
    display_height: frame.height,
    environment: 'windows'
  }],
  tool_choice: 'required',
  truncation: 'auto'
}
```

Note: CUA receives the FULL resolution PNG (not the scaled JPEG the Reasoner gets).
The `strict` flag triggers a retry if the CUA returns a `screenshot` action (no coordinates found).

## CUA Output Parsing (`extractCuaAction` in utils.js)

Walks `response.output[]`:
- Looks for `item.summary[].type === 'summary_text'` → `summary`
- Looks for `item.type === 'computer_call' && item.action` → `action`
- Falls back to `item.type === 'message' && item.content[].type === 'output_text'` → `summary`
- Final fallback: `response.output_text` → `summary`

The `action` object shape depends on action type:
- click/double_click/pinpoint: `{ type, x, y }`
- drag: `{ type, path: [{x,y},...] }` or `{ type, x, y, x2/end_x/endX, y2/end_y/endY }`
- scroll: `{ type, x, y }` (direction inferred from action type override)
- keypress: `{ type, key }` or `{ type, keys: [...] }`
- type: `{ type, text }`
- wait: `{ type }`
- screenshot: `{ type: 'screenshot' }` — triggers strict retry

## Coordinate Mapping System

Three coordinate spaces:
1. **Image coords** — pixel x,y within the captured frame (full-res PNG, same as display physical size)
2. **Physical (absolute) coords** — OS-level screen coordinates in pixels
3. **DIP (device-independent pixel) coords** — Electron/CSS logical pixels

Mapping in `utils.js → mapImageCoordsToDisplay`:
```
absX = physicalBounds.x + (x / imageWidth) * physicalBounds.width
absY = physicalBounds.y + (y / imageHeight) * physicalBounds.height
```

Then in `cua.js → presentCuaAction`:
```
dipX = (absX - physicalBounds.x) / scaleFactor + displayBounds.x
dipY = (absY - physicalBounds.y) / scaleFactor + displayBounds.y
localX = dipX - displayBounds.x   (relative to display top-left)
localY = dipY - displayBounds.y
```

`displayInfo` comes from `getSharedDisplayBounds` IPC:
```js
{
  bounds: { x, y, width, height },    // DIP bounds
  scaleFactor: number,                 // display DPI scale
  physicalBounds: { x, y, width, height },  // physical pixel bounds
  virtualScaleFactor: number           // primary display scale factor
}
```

Callout window is positioned at `localX, localY` (display-relative DIP).
`currentAction` stores both physical (`x, y`) and DIP (`dipX, dipY`) coords.
OS click completion checks use physical coords from uIOhook.

## Element Detection & Highlighting

Called in parallel with callout display (optimization):
```js
window.electronAPI.detectElementAtPoint(physicalX, physicalY)
```
→ IPC `ui-automation-detect-point` → `UIAutomationDetector.getElementAtPoint(x, y)`
→ Returns `{ BoundingRect: { X, Y, Width, Height }, ... }` in physical coords

`show-element-highlight` IPC converts physical rect to DIP, creates a transparent `BrowserWindow` as a colored border overlay.
Color: amber `#f59e0b` for all element highlights.
`currentTargetRect` stores the physical bounding rect for proximity checks.

## Conversation History Management

- Array of `{ role: 'user' | 'assistant' | 'system', content: string }`
- User question pushed before Reasoner call
- Reasoner answer pushed after response
- System notes added via `addConversationNote(text)`: "User Completed The Action", "Action Criteria Was not met"
- No cap — unlimited history
- Formatted as flat text block prepended to Reasoner system prompt (NOT as structured message turns)
- Reset by `resetCuaState()` (called on task complete/reset)

## Action Completion Detection

| Action Type | Completion Trigger |
|-------------|-------------------|
| click | `onOSClick` within 20px POSITION_TOLERANCE of `action.x, action.y` |
| double_click | Two `onOSClick` events within 550ms DOUBLE_CLICK_WINDOW_MS, both within tolerance |
| drag | `onOSMouseDown` near start + `onOSMouseMove` near end (dragArmed flag) |
| scroll/scroll_up/scroll_down | Any `onOSWheel` event |
| keypress | `onOSKeyDown` — single key: any keydown; combo: `matchesKeyCombo()` check |
| type | No OS detection — must use Next button / callout Next |
| wait | Auto-complete via setTimeout (300ms guide, 2000ms chat) |
| pinpoint | `onOSMouseMove` within 20px of target — triggers early return, no follow-up loop |

## Guide Loop (complete flow)

```
init() → setAppMode(GUIDE) → startGuideKickoff()
    → handleAsk({ auto: true, allowEmpty: true, emptyInput: true })
        → runCuaQuestion('', { mode: 'guide', ... })
            → captureFrame()
            → runReasonerQuestion({ context, imageDataUrl: reasonerJpeg })
            → extractReasonerJson() → { answer, cua_calls, callout }
            → [if cua_calls] runCuaInstruction() × N → CUA API
            → presentCuaAction() → showCallout + detectElementAtPoint + showElementHighlight
        → addChatMessage(answer)
        → [if guidance action] setGuideProcessActive(true)
    ← returns result

[user performs action]
    → onOSClick/onOSMouseMove/onOSWheel/onOSKeyDown fires
    → withinTolerance() check passes
    → completeStep()
        → handleActionCriteriaMet() → [if queued: present next] → done
        → [if no more queued]
        → addConversationNote('User Completed The Action')
        → setTimeout(settleDelayMs) → handleAsk({ auto: true, userStatus: 'Action Criteria Met' })
            → [loop repeats]
```

## Mode Switching Logic

`isGuidanceActionType` = `['click','double_click','drag','scroll','scroll_up','scroll_down','keypress','type','wait']`

After `runCuaQuestion` returns:
- `actionType` in `isGuidanceActionType` → `setGuideProcessActive(true)`, ensure GUIDE mode
- `actionType === 'pinpoint'` → `setGuideProcessActive(false)`, switch to CHAT mode
- `actionType === 'wait'` → special: auto-completes after timeout
- `actionType === 'callout'` → stays in current mode, no follow-up loop
- `hasPointer === false` → re-triggers `handleAsk` after delay (500ms guide, 2000ms chat)

Mode inference from question text uses `GUIDE_INTENT_PATTERNS` and `CHAT_INTENT_PATTERNS` regex lists.

## Edge Cases

### Multiple CUA Calls
If Reasoner returns `cua_calls.length > 1`, only pinpoints are kept (`filter(call => call.action === 'pinpoint')`). All filtered calls run in parallel via `Promise.all`. Results queue via `queuedActions` + `queuedFrame`. On `handleActionCriteriaMet`, next action in queue is presented without a new Reasoner call.

### Screenshot-Only CUA Response (strict retry)
If CUA returns `{ type: 'screenshot' }` and `strict === false`, `runCuaInstruction` calls itself with `strict: true`. Strict mode is set in the payload (currently the payload doesn't change between strict/non-strict — this may be a prompt cue).

### Task Completion
Reasoner includes `<<TASK_COMPLETED>>` in `answer`:
- `suppressCallout = true` → no callout shown
- `pendingAction = false`
- Chat bubble strips the token, shows "Task Completed" system message
- User must click "Complete" button in callout (or it's auto-triggered) → `completeTaskAndReset()` → resets all state

### Epoch Guard (stale loop prevention)
`guideProcessEpoch` increments whenever `setGuideProcessActive(false)` is called. `setTimeout` callbacks capture the epoch at scheduling time and abort if it has changed. This prevents multiple concurrent guide loops.

### isRunningCua Gate
`isRunningCua` boolean prevents concurrent `handleAsk` calls. Set to `true` at start of ask, cleared in `finally`.

### New User Message During Pending Action
If `hasPendingAction()` when `handleAsk` fires: `fadeGuidance()`, `handleActionCriteriaNotMet()` (clears queue), `userStatus = 'Action Criteria Was not met'`.

## Widget Resize System

`requestWidgetResize()` → `requestAnimationFrame` → reads `widget.scrollWidth/Height` → IPC `resize-widget`.
Main process anchors bottom edge: `nextY = (currentBottom) - nextHeight`. Widget grows upward.
Focus mode width: 128px. Chat mode width: 288px. Max height: 720px.

## Screen Capture Details

`captureFrame()` in `screen-share.js`:
- Full canvas: native resolution PNG → `frame.dataUrl`, `frame.width`, `frame.height`
- Scaled canvas: max 1280px on longest side, JPEG 0.7 → `frame.reasonerDataUrl`
- Reasoner receives the scaled JPEG
- CUA receives the full-res PNG

Two `waitForFreshVideoFrame()` calls before capture in normal mode; one in `fastCapture` mode (Guide mode default).
