# Prompt Engineer Memory

## Project Context
- Electron screen-guidance app with two AI agents: Reasoner (GPT-5.2) and CUA (computer-use-preview)
- Prompts live in `prompts/` directory; versioned folders (v1.0.0, v1.0.1) are read-only
- Agent-generated prompts go in `prompts/agent-generated/`
- Prompt files are loaded via `reasoner-client.js` and `cua-client.js` (env vars override paths)
- Reasoner uses OpenAI Responses API with `reasoning: { effort: 'none' }` (fast, no chain-of-thought)
- CUA uses `tool_choice: 'required'` (must always return a tool call)

## Key Architecture Details
- Reasoner receives: instructions (prompt + conversation history appended), input (user message + screenshot)
- CUA receives: instructions (prompt), input ("Action: X\nInstruction: Y" + screenshot), tools (computer_use_preview)
- Multiple cua_calls: only pinpoints survive filtering if >1 call returned
- Screenshot-only CUA response triggers retry with strict mode
- `<<TASK_COMPLETED>>` token in answer field triggers task reset

## Prompt Design Patterns That Work
- For JSON-output models: schema first, then examples, then behavioral rules
- For tool-calling models (CUA): explain input format, coordinate system, and failure modes explicitly
- Action selection tables are clearer than prose for enumerated choices
- Concrete examples of valid output prevent schema misinterpretation
- Negative instructions ("NEVER return screenshot action") are critical for CUA reliability
- Loop detection rules need specific heuristics, not vague "think about it"

## Common Weaknesses in v1.0.1 Prompts (Fixed)
- Undefined references (SAFE MODE, step_state.status, next_step_hint)
- Empty sections (MODES, CHAT HISTORY)
- Contradictory instructions (ask questions vs. never ask)
- Missing examples of valid JSON output
- CUA prompt too short (6 lines) for a task requiring coordinate precision
