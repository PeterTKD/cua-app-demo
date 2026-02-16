# System Design Architect Memory

## Project: Screen Guidance App (Electron + CUA)

### Architecture Overview
- Two-agent system: Reasoner (gpt-5.2) + CUA (computer-use-preview)
- Reasoner outputs JSON with `answer`, `callout`, `cua_calls`
- CUA receives screenshot + instruction, returns coordinates via `computer_use_preview` tool
- Prompt files: `prompts/v1.0.1/reasoner.txt` and `prompts/v1.0.1/cua.txt`
- API clients: `reasoner-client.js` and `cua-client.js`
- Renderer logic: `renderer/cua.js` (CUA orchestration), `renderer/app.js` (UI + state machine)

### Key Design Decisions
- Reasoner runs with `reasoning: { effort: 'none' }` -- prompts must be extremely explicit
- CUA uses `tool_choice: 'required'` -- always forces a tool call
- Multiple CUA calls filtered to pinpoints only if >1 call
- `<<TASK_COMPLETED>>` sentinel in `answer` field triggers task reset
- Conversation history appended as formatted text to reasoner instructions
- `current.txt` points to v1.0.0 but code hardcodes v1.0.1 paths (dead code in main.js)

### Known Issues (v1.0.1 prompts)
- Reasoner schema incomplete: `callout` object used by code but not in prompt schema
- Dead references: SAFE MODE, step_state.status, next_step_hint
- Mode system (guide/chat) undefined in prompt despite being core feature
- CUA prompt is 6 lines, misrepresents CUA's role, no format/coordinate guidance
- Auto-follow-up loop risk: no prompt-level loop detection

### See Also
- [prompt-analysis.md](prompt-analysis.md) - Detailed gap analysis from Feb 2026
