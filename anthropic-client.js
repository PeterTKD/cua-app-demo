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
      actions: {
        type: 'array',
        description: 'Ordered action suggestions. Empty array if no actions are needed.',
        items: {
          type: 'object',
          properties: {
            action_type: {
              type: 'string',
              enum: ['click', 'double_click', 'drag', 'scroll', 'scroll_up', 'scroll_down', 'keypress', 'type', 'wait', 'pinpoint']
            },
            action_callout: {
              type: 'string',
              description: 'Callout text shown to the user for this action'
            },
            target_description: {
              type: 'string',
              description: 'Detailed instruction for CUA describing the target element and how to interact with it'
            },
            uia_target: {
              description: 'Optional structured Windows UIA target; null when not used.',
              type: ['object', 'null'],
              properties: {
                name: { type: 'string' },
                control_type: { type: 'string' },
                interactivity: { type: 'boolean' },
                must_include_tokens: {
                  type: 'array',
                  items: { type: 'string' }
                },
                must_exclude_tokens: {
                  type: 'array',
                  items: { type: 'string' }
                },
                position_hint: { type: 'string' },
                position_index: {
                  type: ['number', 'null']
                },
                ancestor_hint: {
                  type: ['string', 'null']
                },
                siblings_hint: {
                  type: ['string', 'null']
                },
                approx_x: {
                  type: ['number', 'null']
                },
                approx_y: {
                  type: ['number', 'null']
                }
              },
              required: ['name', 'control_type', 'interactivity', 'must_include_tokens', 'must_exclude_tokens', 'position_hint', 'position_index', 'ancestor_hint', 'siblings_hint', 'approx_x', 'approx_y']
            }
          },
          required: ['action_type', 'action_callout', 'target_description', 'uia_target']
        }
      }
    },
    required: ['answer', 'actions']
  }
};

function buildAnthropicPayload(config, fullSystemPrompt, conversationMessages, imageDataUrl) {
  const match = imageDataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    throw new Error('Invalid image data URL format for Anthropic provider');
  }
  const messages = Array.isArray(conversationMessages) && conversationMessages.length > 0
    ? conversationMessages.map((message, index) => {
        const content = [{ type: 'text', text: message.text || 'Give next step' }];
        if (index === conversationMessages.length - 1) {
          content.push({ type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } });
        }
        return {
          role: message.role === 'assistant' ? 'assistant' : 'user',
          content
        };
      })
    : [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Give next step' },
            { type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } }
          ]
        }
      ];
  return {
    model: config.id,
    system: fullSystemPrompt,
    tools: [GUIDANCE_TOOL],
    tool_choice: { type: 'tool', name: 'guidance_response' },
    messages,
    max_tokens: 800
  };
}

function normalizeAnthropicResult(json, config) {
  // input is already a parsed JS object — no JSON.parse needed
  // We stringify it so extractReasonerJson in cua.js can parse it as before (zero downstream changes)
  const toolUse = (json.content || []).find(c => c.type === 'tool_use' && c.name === 'guidance_response');
  const input = toolUse?.input || { answer: '', actions: [] };
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
