const fs = require('fs');
const path = require('path');

let cachedKeys = null;

function readJsonIfExists(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_) {
    return null;
  }
}

function loadBundledApiKeys() {
  if (cachedKeys !== null) {
    return cachedKeys;
  }

  const candidates = [];
  if (process && process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'api-keys.json'));
  }
  candidates.push(path.join(__dirname, 'api-keys.json'));

  for (const candidate of candidates) {
    const data = readJsonIfExists(candidate);
    if (data) {
      cachedKeys = data;
      return cachedKeys;
    }
  }

  cachedKeys = {};
  return cachedKeys;
}

function getApiKey(serviceKeyName) {
  if (process.env[serviceKeyName]) {
    return process.env[serviceKeyName];
  }
  if (process.env.OPENAI_API_KEY) {
    return process.env.OPENAI_API_KEY;
  }

  const bundled = loadBundledApiKeys();
  if (bundled[serviceKeyName]) {
    return bundled[serviceKeyName];
  }
  if (bundled.OPENAI_API_KEY) {
    return bundled.OPENAI_API_KEY;
  }

  return null;
}

function getProviderApiKey(keyName) {
  if (process.env[keyName]) {
    return process.env[keyName];
  }
  const bundled = loadBundledApiKeys();
  if (bundled[keyName]) {
    return bundled[keyName];
  }
  return null;
}

module.exports = {
  getApiKey,
  getProviderApiKey
};
//
