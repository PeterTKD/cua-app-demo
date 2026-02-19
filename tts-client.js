const TTS_ENDPOINT = process.env.TTS_ENDPOINT || 'https://api.openai.com/v1/audio/speech';
const TTS_MODEL = process.env.TTS_MODEL || 'gpt-4o-mini-tts-2025-12-15';
const TTS_VOICE = process.env.TTS_VOICE || 'alloy';

function cleanTextForTTS(text) {
  if (!text) return '';
  return text
    .replace(/<<TASK_COMPLETED>>/g, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/#{1,6}\s+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function synthesizeSpeech({ text, voice, model }) {
  const apiKey = process.env.TTS_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('Missing TTS_API_KEY or OPENAI_API_KEY');
  }

  const cleaned = cleanTextForTTS(text);
  if (!cleaned) return null;

  const input = cleaned.length > 4096 ? cleaned.slice(0, 4096) : cleaned;

  const response = await fetch(TTS_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model || TTS_MODEL,
      voice: voice || TTS_VOICE,
      input,
      response_format: 'mp3'
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`TTS request failed (${response.status}): ${errText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

module.exports = { synthesizeSpeech, cleanTextForTTS };
