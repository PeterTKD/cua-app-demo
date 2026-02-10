const fs = require('fs');
const path = require('path');

const DEFAULT_CUA_ENDPOINT = process.env.CUA_ENDPOINT || 'https://api.openai.com/v1/responses';
const CUA_PROMPT_PATH = process.env.CUA_PROMPT_PATH || path.join(__dirname, 'prompts', 'v1.0.1', 'cua.txt');

function loadCuaPrompt() {
  if (!fs.existsSync(CUA_PROMPT_PATH)) {
    return '';
  }
  return fs.readFileSync(CUA_PROMPT_PATH, 'utf8');
}


function buildCuaPayload({ question, imageDataUrl, displayWidth, displayHeight }) {
  const model = process.env.CUA_MODEL || 'computer-use-preview';
  const environment = process.env.CUA_ENVIRONMENT || 'windows';
  const instructions = loadCuaPrompt();

  return {
    model,
    instructions,
    input: [
      {
        role: 'user',
        content: [
          { type: 'input_text', text: `${question}` },
          { type: 'input_image', image_url: imageDataUrl }
        ]
      }
    ],
    reasoning: {
      summary: 'concise'
    },
    tools: [{
      type: 'computer_use_preview',
      display_width: displayWidth,
      display_height: displayHeight,
      environment
    }],
    tool_choice: 'required',
    truncation: 'auto'
  };
}

async function runCuaQuestion({ question, imageDataUrl, displayWidth, displayHeight }) {
  if (!question) {
    throw new Error('Missing question');
  }
  if (!imageDataUrl) {
    throw new Error('Missing image data');
  }
  if (!displayWidth || !displayHeight) {
    throw new Error('Missing display size');
  }

  const apiKey = process.env.CUA_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('Missing CUA_API_KEY or OPENAI_API_KEY');
  }

  const payload = buildCuaPayload({ question, imageDataUrl, displayWidth, displayHeight });
  const maxAttempts = 2;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch(DEFAULT_CUA_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    });

    if (response.ok) {
      return response.json();
    }

    const errorText = await response.text();
    lastError = new Error(`CUA request failed (${response.status}): ${errorText}`);

    if (response.status >= 500 && attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
      continue;
    }

    throw lastError;
  }

  throw lastError;
}

module.exports = {
  runCuaQuestion
};
