# How To Run

## Prerequisites

- Windows
- Node.js installed
- An OpenAI key for CUA

## Environment Variables

Set one of these before starting:

- OPENAI_API_KEY or CUA_API_KEY

Optional:

- CUA_MODEL (default: computer-use-preview)
- CUA_ENDPOINT (default: https://api.openai.com/v1/responses)

## Install

```bash
npm install
```

## Start

```bash
npm start
```

## Use The App

1. Click the screen icon to pick a display.
2. Type a question in the widget and press Ask.
3. The overlay shows a callout, and the UIA highlight circles the detected element.
4. Click the plus icon to view the raw CUA JSON response history.

## Troubleshooting

- If no highlight appears, try running the app as Administrator.
- If CUA returns no coordinates, verify the model supports computer_use and your key is valid.
