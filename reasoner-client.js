const fs = require('fs');
const path = require('path');

const DEFAULT_REASONER_ENDPOINT = process.env.REASONER_ENDPOINT || 'https://api.openai.com/v1/responses';
const REASONER_MODEL = process.env.REASONER_MODEL || 'gpt-5.2';
// Change the prompt path as needed
const REASONER_PROMPT_PATH = process.env.REASONER_PROMPT_PATH || path.join(__dirname, 'prompts', 'v1.0.1', 'reasoner.txt');

function loadReasonerPrompt() {
  if (!fs.existsSync(REASONER_PROMPT_PATH)) {
    throw new Error(`Reasoner prompt file not found: ${REASONER_PROMPT_PATH}`);
  }
  return fs.readFileSync(REASONER_PROMPT_PATH, 'utf8');
}

function formatConversationHistory(history) {
  if (!Array.isArray(history) || history.length === 0) {
    return '';
  }
  return history
    .map((item) => {
      const role = item?.role ? String(item.role) : 'unknown';
      const content = item?.content ? String(item.content) : '';
      return `${role.toUpperCase()}: ${content}`;
    })
    .join('\n');
}

function buildReasonerPayload({ context, imageDataUrl }) {
  const basePrompt = loadReasonerPrompt();
  const historyText = formatConversationHistory(context?.conversation_history);
  const prompt = historyText
    ? `${basePrompt}\n\n=== Conversation History ===\n${historyText}\n`
    : basePrompt;
  const inputText = context?.user_message ? String(context.user_message) : '';

  return {
    model: REASONER_MODEL,
    instructions: prompt,
    input: [
      {
        role: 'user',
        content: [
          { type: 'input_text', text: inputText },
          { type: 'input_image', image_url: imageDataUrl }
        ]
      }
    ],
    reasoning: { effort: 'none' },
    truncation: 'auto'
  };
}

async function runReasonerQuestion({ context, imageDataUrl }) {
  if (!context) {
    throw new Error('Missing reasoner context');
  }
  if (!imageDataUrl) {
    throw new Error('Missing image data');
  }

  const apiKey = process.env.REASONER_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('Missing REASONER_API_KEY or OPENAI_API_KEY');
  }

  const payload = buildReasonerPayload({ context, imageDataUrl });

  const response = await fetch(DEFAULT_REASONER_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Reasoner request failed (${response.status}): ${errorText}`);
  }

  return response.json();
}

module.exports = {
  runReasonerQuestion
};
