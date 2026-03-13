# AGENTS.md

## Project
Electron app for screen sharing with a drawing overlay and Windows UI automation support.

## Primary entry points
- `main.js`: Electron main process orchestration.
- `renderer/app.js`: Main renderer-side UI and interactions.
- `overlay.html`, `overlay-preload.js`: Overlay window + bridge.
- `ui-automation.js`: Windows UI automation logic.

## Run and build
- Install: `npm install`
- Start app: `npm start`

## Editing guidance
- Keep IPC contracts between `main.js`, preload files, and renderer code synchronized.
- Prefer minimal, focused changes over broad refactors.
- Preserve existing file layout and naming patterns.
- Update related preload bridges when adding new renderer capabilities.

## Safety and secrets
- Do not commit or expose values from `.env` or `api-keys.json`.
- Keep sensitive configuration in local env/files only.

## Validation
- After code changes, run `npm start` and verify:
  1. Main window loads.
  2. Screen picker and overlay still open.
  3. Drawing/automation flows still trigger without renderer/main IPC errors.