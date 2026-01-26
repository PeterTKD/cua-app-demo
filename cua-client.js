const fs = require('fs');
const path = require('path');

const DEFAULT_CUA_ENDPOINT = process.env.CUA_ENDPOINT || 'https://api.openai.com/v1/responses';
const PROMPTS_DIR = process.env.CUA_PROMPTS_DIR || path.join(__dirname, 'prompts');
const PROMPT_VERSION = process.env.CUA_PROMPT_VERSION || null;

function resolvePromptPath() {
  if (process.env.CUA_PROMPT_PATH) {
    return process.env.CUA_PROMPT_PATH;
  }
  let version = PROMPT_VERSION;
  if (!version) {
    const currentPath = path.join(PROMPTS_DIR, 'current.txt');
    if (fs.existsSync(currentPath)) {
      version = fs.readFileSync(currentPath, 'utf8').trim();
    }
  }
  if (!version) {
    throw new Error('Missing prompt version. Set CUA_PROMPT_PATH or prompts/current.txt.');
  }
  return path.join(PROMPTS_DIR, version, 'system.txt');
}

function loadPrompt() {
  const promptPath = resolvePromptPath();
  if (!fs.existsSync(promptPath)) {
    throw new Error(`Prompt file not found: ${promptPath}`);
  }
  return fs.readFileSync(promptPath, 'utf8');
}

function buildCuaPayload({ question, imageDataUrl, displayWidth, displayHeight, strict }) {
  const model = process.env.CUA_MODEL || 'computer-use-preview';
  const environment = process.env.CUA_ENVIRONMENT || 'windows';
  // Base system prompt loaded from prompts/<version>/system.txt (or env override).
  const prompt = loadPrompt();


  return {
    model,
    instructions: prompt,
    input: [
      {
        role: 'user',
        content: [
          { type: 'input_text', text: `${question}`},
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

async function runCuaQuestion({ question, imageDataUrl, displayWidth, displayHeight, strict }) {
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

  const payload = buildCuaPayload({ question, imageDataUrl, displayWidth, displayHeight, strict });
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
