const fs = require('fs');
const path = require('path');
const { getApiKey, getProviderApiKey } = require('./api-keys');
const { buildAnthropicPayload, normalizeAnthropicResult } = require('./anthropic-client');

const REASONER_PROMPT_PATH = process.env.REASONER_PROMPT_PATH || path.join(__dirname, 'prompts', 'v1.0.2', 'reasoner.txt');

const MODELS = [
  // OpenAI Responses API
  { id: 'gpt-5.2',    label: 'GPT-5.2',         group: 'GPT',    provider: 'openai-responses', endpoint: 'https://api.openai.com/v1/responses',        apiKeyVar: 'OPENAI_API_KEY',    pricing: { input: 1.75, output: 14 } },
  { id: 'gpt-5.4-2026-03-05', label: 'GPT-5.4', group: 'GPT',    provider: 'openai-responses', endpoint: 'https://api.openai.com/v1/responses',        apiKeyVar: 'OPENAI_API_KEY',    pricing: { input: 2.5,  output: 15 } },
  { id: 'gpt-5.3-chat-latest', label: 'GPT-5.3 Chat', group: 'GPT', provider: 'openai-responses', endpoint: 'https://api.openai.com/v1/responses',     apiKeyVar: 'OPENAI_API_KEY',    pricing: { input: 1.75, output: 14 } },
  { id: 'gpt-5.2-chat-latest', label: 'GPT-5.2 Chat', group: 'GPT', provider: 'openai-responses', endpoint: 'https://api.openai.com/v1/responses',     apiKeyVar: 'OPENAI_API_KEY',    pricing: { input: 1.75, output: 14 } },
  // Anthropic
  { id: 'claude-opus-4-6',         label: 'Claude Opus 4.6',    group: 'Claude', provider: 'anthropic', endpoint: 'https://api.anthropic.com/v1/messages', apiKeyVar: 'ANTHROPIC_API_KEY', pricing: { input: 15,   output: 75  } },
  { id: 'claude-sonnet-4-6',       label: 'Claude Sonnet 4.6',  group: 'Claude', provider: 'anthropic', endpoint: 'https://api.anthropic.com/v1/messages', apiKeyVar: 'ANTHROPIC_API_KEY', pricing: { input: 3,    output: 15  } },
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', group: 'Claude', provider: 'anthropic', endpoint: 'https://api.anthropic.com/v1/messages', apiKeyVar: 'ANTHROPIC_API_KEY', pricing: { input: 0.8,  output: 4   } }
];

let currentModelId = process.env.REASONER_MODEL || 'gpt-5.4-2026-03-05';

function getAvailableModels() {
  return MODELS.map(m => ({ id: m.id, label: m.label, group: m.group, pricing: m.pricing }));
}

function getCurrentModel() {
  return currentModelId;
}

function setCurrentModel(id) {
  const found = MODELS.find(m => m.id === id);
  if (!found) {
    throw new Error(`Unknown model id: ${id}`);
  }
  currentModelId = id;
}

function loadReasonerPrompt() {
  if (!fs.existsSync(REASONER_PROMPT_PATH)) {
    throw new Error(`Reasoner prompt file not found: ${REASONER_PROMPT_PATH}`);
  }
  return fs.readFileSync(REASONER_PROMPT_PATH, 'utf8');
}

function resolveApiKey(config) {
  // First try the provider-specific key
  const providerKey = getProviderApiKey(config.apiKeyVar);
  if (providerKey) return providerKey;

  // For OpenAI-compatible providers using OPENAI_API_KEY, also try REASONER_API_KEY as fallback
  if (config.apiKeyVar === 'OPENAI_API_KEY') {
    const reasonerKey = getApiKey('REASONER_API_KEY');
    if (reasonerKey) return reasonerKey;
  }

  return null;
}

function buildFullSystemPrompt() {
  return loadReasonerPrompt();
}

function buildReasonerUserText(context) {
  const lines = [];
  const userMessage = context?.user_message ? String(context.user_message) : '';
  lines.push(`User message: ${userMessage || '(none)'}`);

  if (context?.user_status) {
    lines.push(`User Status: ${String(context.user_status)}`);
  }
  if (context?.last_cua_suggestion) {
    lines.push(`Last action suggestion: ${String(context.last_cua_suggestion)}`);
  }
  if (context?.mode) {
    lines.push(`Mode: ${String(context.mode)}`);
  }
  if (typeof context?.allow_parallel_pinpoint === 'boolean') {
    lines.push(`allow_parallel_pinpoint: ${context.allow_parallel_pinpoint}`);
  }

  const screenWidth = Number(context?.screen_dimensions?.width);
  const screenHeight = Number(context?.screen_dimensions?.height);
  if (Number.isFinite(screenWidth) && Number.isFinite(screenHeight) && screenWidth > 0 && screenHeight > 0) {
    lines.push(`Screen dimensions: ${Math.round(screenWidth)}x${Math.round(screenHeight)} pixels`);
  }

  const originalWidth = Number(context?.original_screen_dimensions?.width);
  const originalHeight = Number(context?.original_screen_dimensions?.height);
  if (Number.isFinite(originalWidth) && Number.isFinite(originalHeight) && originalWidth > 0 && originalHeight > 0) {
    lines.push(`Original screen dimensions: ${Math.round(originalWidth)}x${Math.round(originalHeight)} pixels`);
  }

  return lines.join('\n');
}

function normalizeConversationRole(role) {
  return String(role || '').toLowerCase() === 'assistant' ? 'assistant' : 'user';
}

function sanitizeConversationText(content) {
  if (content == null) return '';
  return String(content).trim();
}

function buildConversationMessages(context, userText) {
  const history = Array.isArray(context?.conversation_history)
    ? [...context.conversation_history]
    : [];
  const currentUserMessage = sanitizeConversationText(context?.user_message);

  // The current user prompt is already pushed into conversationHistory upstream.
  // Drop that trailing duplicate and re-add it as the final turn with the image.
  if (currentUserMessage) {
    const last = history[history.length - 1];
    if (last && normalizeConversationRole(last.role) === 'user' && sanitizeConversationText(last.content) === currentUserMessage) {
      history.pop();
    }
  }

  const messages = history
    .map((item) => {
      const text = sanitizeConversationText(item?.content);
      if (!text) return null;
      return {
        role: normalizeConversationRole(item?.role),
        text
      };
    })
    .filter(Boolean);

  messages.push({
    role: 'user',
    text: userText || 'Give next step'
  });

  return messages;
}

// --- Payload builders ---

function buildOpenAIResponsesPayload(config, fullSystemPrompt, conversationMessages, imageDataUrl) {
  const input = conversationMessages.map((message, index) => {
    const content = [{
      type: message.role === 'assistant' ? 'output_text' : 'input_text',
      text: message.text
    }];
    if (index === conversationMessages.length - 1) {
      content.push({ type: 'input_image', image_url: imageDataUrl });
    }
    return {
      role: message.role,
      content
    };
  });

  const payload = {
    model: config.id,
    instructions: fullSystemPrompt,
    input,
    truncation: 'auto'
  };

  if (config.id !== 'gpt-5.2-chat-latest' && config.id !== 'gpt-5.3-chat-latest') {
    payload.reasoning = { effort: 'none' };
  }

  return payload;
}



// Anthropic payload + normalization live in anthropic-client.js (tool use / structured output)

function buildPayload(config, fullSystemPrompt, conversationMessages, imageDataUrl) {
  switch (config.provider) {
    case 'openai-responses':
      return buildOpenAIResponsesPayload(config, fullSystemPrompt, conversationMessages, imageDataUrl);
    case 'anthropic':
      return buildAnthropicPayload(config, fullSystemPrompt, conversationMessages, imageDataUrl);
    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}

// --- Headers builders ---

function buildHeaders(config, apiKey) {
  switch (config.provider) {
    case 'openai-responses':
      return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      };
    case 'anthropic':
      return {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      };
    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}

// --- Response normalizers ---

function normalizeOpenAIResponsesResult(json, config) {
  // output_text may be at the top level OR nested inside output[].content[]
  let text = json.output_text || '';
  if (!text && Array.isArray(json.output)) {
    const message = json.output.find(item => item.type === 'message');
    const content = message?.content?.find(entry => entry.type === 'output_text');
    if (content?.text) text = content.text;
  }
  const usage = json.usage || {};
  return {
    output_text: text,
    usage: {
      input_tokens: Number(usage.input_tokens ?? 0),
      output_tokens: Number(usage.output_tokens ?? 0),
      total_tokens: Number(usage.total_tokens ?? (Number(usage.input_tokens ?? 0) + Number(usage.output_tokens ?? 0)))
    },
    _meta: {
      modelId: config.id,
      label: config.label,
      pricing: config.pricing
    }
  };
}


function normalizeResponse(json, config) {
  switch (config.provider) {
    case 'openai-responses':
      return normalizeOpenAIResponsesResult(json, config);
    case 'anthropic':
      return normalizeAnthropicResult(json, config);
    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}

// --- Main entry point ---

async function runReasonerQuestion({ context, imageDataUrl }) {
  if (!context) {
    throw new Error('Missing reasoner context');
  }
  if (!imageDataUrl) {
    throw new Error('Missing image data');
  }

  const config = MODELS.find(m => m.id === currentModelId);
  if (!config) {
    throw new Error(`Current model not found: ${currentModelId}`);
  }

  const apiKey = resolveApiKey(config);
  if (!apiKey) {
    throw new Error(`Missing API key for ${config.label} (env var: ${config.apiKeyVar})`);
  }

  const fullSystemPrompt = buildFullSystemPrompt();
  const userText = buildReasonerUserText(context);
  const conversationMessages = buildConversationMessages(context, userText);
  const payload = buildPayload(config, fullSystemPrompt, conversationMessages, imageDataUrl);
  const headers = buildHeaders(config, apiKey);

  const response = await fetch(config.endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Reasoner request failed (${response.status}): ${errorText}`);
  }

  const json = await response.json();
  return normalizeResponse(json, config);
}

module.exports = {
  runReasonerQuestion,
  getAvailableModels,
  getCurrentModel,
  setCurrentModel
};
