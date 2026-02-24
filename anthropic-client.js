'use strict';

// Forced tool use = guaranteed schema-valid response, no JSON parse failures possible.
// The model MUST populate this tool's input — it cannot return conversational text.

const GUIDANCE_TOOL = {
  name: 'guidance_response',
  description: 'Return structured guidance to the user based on screen analysis.',
  input_schema: {
    type: 'object',
    properties: {
      answer: {
        type: 'string',
        description: 'Conversational reply to the user in markdown. Keep it concise — it is passed to TTS.'
      },
      cua_calls: {
        type: 'array',
        description: 'Ordered CUA action suggestions. Empty array if no actions are needed.',
        items: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['click', 'double_click', 'drag', 'scroll', 'scroll_up', 'scroll_down', 'keypress', 'type', 'wait', 'pinpoint']
            },
            'action-callout': {
              type: 'string',
              description: 'Callout text shown to the user for this action'
            },
            target_description: {
              type: 'string',
              description: 'Detailed instruction for CUA describing the target element and how to interact with it'
            }
          },
          required: ['action', 'action-callout', 'target_description']
        }
      }
    },
    required: ['answer', 'cua_calls']
  }
};

function buildAnthropicPayload(config, fullSystemPrompt, userText, imageDataUrl) {
  const match = imageDataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    throw new Error('Invalid image data URL format for Anthropic provider');
  }
  return {
    model: config.id,
    system: fullSystemPrompt,
    tools: [GUIDANCE_TOOL],
    tool_choice: { type: 'tool', name: 'guidance_response' },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: userText || 'Give next step' },
          { type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } }
        ]
      }
    ],
    max_tokens: 800
  };
}

function normalizeAnthropicResult(json, config) {
  // input is already a parsed JS object — no JSON.parse needed
  // We stringify it so extractReasonerJson in cua.js can parse it as before (zero downstream changes)
  const toolUse = (json.content || []).find(c => c.type === 'tool_use' && c.name === 'guidance_response');
  const input = toolUse?.input || { answer: '', cua_calls: [] };
  const usage = json.usage || {};
  const inputTokens = Number(usage.input_tokens ?? 0);
  const outputTokens = Number(usage.output_tokens ?? 0);
  return {
    output_text: JSON.stringify(input),
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens
    },
    _meta: {
      modelId: config.id,
      label: config.label,
      pricing: config.pricing
    }
  };
}

module.exports = { buildAnthropicPayload, normalizeAnthropicResult };
