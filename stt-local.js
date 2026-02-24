const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

function resolveWhisperBinary() {
  return process.env.STT_WHISPER_BIN
    || path.join(__dirname, 'third_party', 'whisper', 'whisper-cli.exe');
}

function resolveWhisperModel() {
  return process.env.STT_WHISPER_MODEL
    || path.join(__dirname, 'third_party', 'whisper', 'models', 'ggml-base.en.bin');
}

function runProcess(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      windowsHide: true
    });

    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk || '');
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `Process exited with code ${code}`));
    });
  });
}

async function transcribeLocalAudio({ wavBase64, language = 'en' }) {
  if (!wavBase64) {
    throw new Error('Missing audio payload for local STT.');
  }

  const whisperBin = resolveWhisperBinary();
  const whisperModel = resolveWhisperModel();

  if (!fs.existsSync(whisperBin)) {
    throw new Error(
      `Local STT binary not found at ${whisperBin}. Set STT_WHISPER_BIN or bundle whisper-cli.exe.`
    );
  }
  if (!fs.existsSync(whisperModel)) {
    throw new Error(
      `Local STT model not found at ${whisperModel}. Set STT_WHISPER_MODEL or bundle a ggml model.`
    );
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guidy-stt-'));
  const wavPath = path.join(tempDir, 'input.wav');
  const outBase = path.join(tempDir, 'output');
  const outTxt = `${outBase}.txt`;

  try {
    fs.writeFileSync(wavPath, Buffer.from(wavBase64, 'base64'));

    const args = [
      '-m', whisperModel,
      '-f', wavPath,
      '-l', language,
      '-otxt',
      '-of', outBase,
      '-np'
    ];

    await runProcess(whisperBin, args, tempDir);

    if (!fs.existsSync(outTxt)) {
      return '';
    }

    return fs.readFileSync(outTxt, 'utf8').trim();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

module.exports = {
  transcribeLocalAudio
};
