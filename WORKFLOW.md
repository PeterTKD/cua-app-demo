# How It Works

This app connects a lightweight Electron screen share UI with OpenAI Computer Use (CUA) and Windows UI Automation (UIA).

## High-Level Flow

1. User selects a screen to share.
2. The renderer captures a single video frame and sends it to CUA with the user's question.
3. CUA returns a computer_call action with pixel coordinates.
4. The renderer maps those image coordinates to absolute screen coordinates.
5. UIA is called at that point and returns the element bounding box.
6. The app draws a highlight window around the UIA element and places a callout on the overlay.

## Key Modules

- main.js
  - Creates the main window, overlay, and highlight window.
  - Exposes IPC handlers for screen sources, overlay controls, UIA detection, and CUA requests.
- preload.js
  - Defines the safe renderer API for IPC calls.
- renderer/app.js
  - Wires the widget, asks CUA, and updates status.
- renderer/screen-share.js
  - Picks a display, starts the stream, and captures a frame.
- renderer/cua.js
  - Sends the question + frame to CUA, parses the response, and triggers UIA highlight.
- renderer/utils.js
  - Maps image coords to screen coords and extracts CUA action data.
- cua-client.js
  - Calls the CUA endpoint and returns the JSON response.
- ui-automation.js
  - Uses PowerShell to query Windows UI Automation at a point and return element data.

## Coordinate Mapping

CUA returns coordinates in the image space used in the request. The mapping is:

absX = display.x + (x / imageWidth) * display.width  
absY = display.y + (y / imageHeight) * display.height

The mapped point is used for UIA detection and the highlight window.

## UIA Highlight

UIA returns a BoundingRect for the element. The main process creates a transparent always-on-top window with a border to circle the target.

## History Panel

Each question stores the raw CUA JSON response in a small history list shown by the plus icon.
