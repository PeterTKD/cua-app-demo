const fs = require('fs');
const path = require('path');
const { getApiKey, getProviderApiKey } = require('./api-keys');

const CUA_54_PROMPT_PATH = process.env.CUA_54_PROMPT_PATH || path.join(__dirname, 'prompts', 'v1.0.3', 'cua_5.4.txt');
let currentModelId = process.env.CUA_54_MODEL || 'gpt-5.4-2026-03-05';

function loadPrompt() {
  if (!fs.existsSync(CUA_54_PROMPT_PATH)) {
    throw new Error(`CUA 5.4 prompt file not found: ${CUA_54_PROMPT_PATH}`);
  }
  return fs.readFileSync(CUA_54_PROMPT_PATH, 'utf8');
}

function resolveApiKey() {
  return getProviderApiKey('OPENAI_API_KEY') || getApiKey('CUA_54_API_KEY') || getApiKey('REASONER_API_KEY');
}

function buildStructuredOutputSchema() {
  return {
    type: 'object',
    properties: {
      points: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            x: { type: 'number' },
            y: { type: 'number' }
          },
          required: ['x', 'y'],
          additionalProperties: false
        }
      }
    },
    required: ['points'],
    additionalProperties: false
  };
}

function buildUserText({ reasonerInput, screenDimensions, originalScreenDimensions }) {
  const lines = [];
  const inputText = String(reasonerInput || '').trim();
  if (!inputText) {
    throw new Error('Missing reasoner input for CUA 5.4');
  }

  lines.push(inputText);

  const screenWidth = Number(screenDimensions?.width);
  const screenHeight = Number(screenDimensions?.height);
  if (Number.isFinite(screenWidth) && Number.isFinite(screenHeight) && screenWidth > 0 && screenHeight > 0) {
    lines.push(`Screen dimensions: ${Math.round(screenWidth)}x${Math.round(screenHeight)} pixels`);
  }

  const originalWidth = Number(originalScreenDimensions?.width);
  const originalHeight = Number(originalScreenDimensions?.height);
  if (Number.isFinite(originalWidth) && Number.isFinite(originalHeight) && originalWidth > 0 && originalHeight > 0) {
    lines.push(`Original screenshot dimensions: ${Math.round(originalWidth)}x${Math.round(originalHeight)} pixels`);
  }

  return lines.join('\n');
}

function buildPayload({ userText, imageDataUrl }) {
  return {
    model: currentModelId,
    instructions: loadPrompt(),
    input: [
      {
        role: 'user',
        content: [
          { type: 'input_text', text: userText },
          { type: 'input_image', image_url: imageDataUrl }
        ]
      }
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'guidy_pointer_points',
        strict: true,
        schema: buildStructuredOutputSchema()
      }
    },
    truncation: 'auto',
    reasoning: { effort: 'none' }
  };
}

function normalizeResult(json) {
  let text = json?.output_text || '';
  if (!text && Array.isArray(json?.output)) {
    const message = json.output.find((item) => item.type === 'message');
    const content = message?.content?.find((entry) => entry.type === 'output_text');
    if (content?.text) {
      text = content.text;
    }
  }

  const cachedInputTokens = Number(json?.usage?.input_tokens_details?.cached_tokens ?? 0);
  return {
    output_text: text,
    usage: {
      input_tokens: Number(json?.usage?.input_tokens ?? 0),
      cached_input_tokens: cachedInputTokens,
      output_tokens: Number(json?.usage?.output_tokens ?? 0),
      total_tokens: Number(json?.usage?.total_tokens ?? (Number(json?.usage?.input_tokens ?? 0) + Number(json?.usage?.output_tokens ?? 0)))
    },
    _meta: {
      modelId: currentModelId,
      label: 'CUA-5.4',
      pricing: {
        input: 2.5,
        output: 15,
        cached_input: 0.25
      }
    }
  };
}

async function runCua54Question({ reasonerInput, imageDataUrl, screenDimensions, originalScreenDimensions }) {
  if (!imageDataUrl) {
    throw new Error('Missing image data for CUA 5.4');
  }

  const apiKey = resolveApiKey();
  if (!apiKey) {
    throw new Error('Missing API key for CUA 5.4 (OPENAI_API_KEY or CUA_54_API_KEY)');
  }

  const userText = buildUserText({ reasonerInput, screenDimensions, originalScreenDimensions });
  const payload = buildPayload({ userText, imageDataUrl });

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`CUA 5.4 request failed (${response.status}): ${errorText}`);
  }

  const json = await response.json();
  return normalizeResult(json);
}

function getCurrentModel() {
  return currentModelId;
}

function setCurrentModel(modelId) {
  const next = String(modelId || '').trim();
  if (!next) {
    throw new Error('Model id is required');
  }
  currentModelId = next;
}

module.exports = {
  runCua54Question,
  getCurrentModel,
  setCurrentModel
};
