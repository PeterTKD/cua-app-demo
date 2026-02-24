const { getApiKey } = require('./api-keys');

const STT_ENDPOINT = process.env.STT_ENDPOINT || 'https://api.openai.com/v1/audio/transcriptions';
const STT_MODEL = process.env.STT_MODEL || 'whisper-1';

async function transcribeAudio({ wavBase64, language = 'en' }) {
  if (!wavBase64) {
    throw new Error('Missing audio payload for STT.');
  }

  const apiKey = getApiKey('STT_API_KEY');
  if (!apiKey) {
    throw new Error('Missing STT_API_KEY or OPENAI_API_KEY');
  }

  const wavBuffer = Buffer.from(wavBase64, 'base64');
  const blob = new Blob([wavBuffer], { type: 'audio/wav' });

  const formData = new FormData();
  formData.append('file', blob, 'audio.wav');
  formData.append('model', STT_MODEL);
  if (language) formData.append('language', language);

  const response = await fetch(STT_ENDPOINT, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: formData
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`STT request failed (${response.status}): ${errText}`);
  }

  const data = await response.json();
  return (data.text || '').trim();
}

module.exports = { transcribeAudio };
