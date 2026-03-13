'use strict';

const fs = require('fs');
const path = require('path');
const { getProviderApiKey } = require('./api-keys');

const TREE_LOCATOR_PROMPT_PATH = process.env.TREE_LOCATOR_PROMPT_PATH
  || path.join(__dirname, 'prompts', 'v1.0.2', 'tree_grok_locator.txt');

const TREE_LOCATOR_MODEL = process.env.TREE_LOCATOR_MODEL || 'grok-4-1-fast-non-reasoning';
const TREE_LOCATOR_ENDPOINT = process.env.TREE_LOCATOR_ENDPOINT || 'https://api.x.ai/v1/chat/completions';

function loadTreeLocatorPrompt() {
  if (!fs.existsSync(TREE_LOCATOR_PROMPT_PATH)) {
    throw new Error(`Tree locator prompt file not found: ${TREE_LOCATOR_PROMPT_PATH}`);
  }
  return fs.readFileSync(TREE_LOCATOR_PROMPT_PATH, 'utf8');
}

function resolveTreeLocatorApiKey() {
  const direct = getProviderApiKey('TREE_LOCATOR_API_KEY');
  if (direct) return direct;

  const grok = getProviderApiKey('GROK_API_KEY');
  if (grok) return grok;

  const xai = getProviderApiKey('XAI_API_KEY');
  if (xai) return xai;

  return null;
}

function normalizeTreeLocatorResult(json) {
  const content = json?.choices?.[0]?.message?.content || '';
  const usage = json?.usage || {};
  return {
    output_text: content,
    usage: {
      input_tokens: Number(usage.prompt_tokens ?? 0),
      output_tokens: Number(usage.completion_tokens ?? 0),
      total_tokens: Number(usage.total_tokens ?? (Number(usage.prompt_tokens ?? 0) + Number(usage.completion_tokens ?? 0)))
    },
    _meta: {
      modelId: TREE_LOCATOR_MODEL,
      label: 'Grok Tree Locator',
      pricing: { input: 0.2, output: 0.5 }
    }
  };
}

async function runTreeLocator({ description, uiaTarget, uiTree }) {
  if (!uiaTarget || typeof uiaTarget !== 'object') {
    throw new Error('Missing uiaTarget for tree locator');
  }
  if (!Array.isArray(uiTree) || uiTree.length === 0) {
    throw new Error('Missing UI tree for tree locator');
  }

  const apiKey = resolveTreeLocatorApiKey();
  if (!apiKey) {
    throw new Error('Missing TREE_LOCATOR_API_KEY, GROK_API_KEY, or XAI_API_KEY');
  }

  const systemPrompt = loadTreeLocatorPrompt();
  let userContent = `Description: "${description || ''}"`;
  userContent += `\n\nStructured hints:${JSON.stringify(uiaTarget, null, 2)}`;
  userContent += `\n\nUI Tree:\n${JSON.stringify(uiTree)}`;

  const payload = {
    model: TREE_LOCATOR_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent }
    ],
    temperature: 0.1,
    response_format: { type: 'json_object' }
  };

  const response = await fetch(TREE_LOCATOR_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Tree locator request failed (${response.status}): ${errorText}`);
  }

  const json = await response.json();
  return normalizeTreeLocatorResult(json);
}

module.exports = {
  runTreeLocator
};
