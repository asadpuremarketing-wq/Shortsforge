import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ENV_FILE = path.join(ROOT, '.env');
export const DATA_DIR = path.join(ROOT, 'data');
export const PROJECTS_DIR = path.join(DATA_DIR, 'projects');
export const FONTS_DIR = path.join(DATA_DIR, 'fonts');
export const MODELS_DIR = path.join(DATA_DIR, 'models');
export const BIN_DIR = path.join(DATA_DIR, 'bin');

// override: keys saved in Settings (.env) win over stale system-wide environment variables.
dotenv.config({ path: ENV_FILE, quiet: true, override: true });

for (const dir of [DATA_DIR, PROJECTS_DIR, FONTS_DIR, MODELS_DIR, BIN_DIR]) fs.mkdirSync(dir, { recursive: true });

export const PORT = Number(process.env.PORT || 5173);

export const KEY_NAMES = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'ELEVENLABS_API_KEY', 'YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET'];

export function providers() {
  const has = (k) => Boolean(process.env[k] && process.env[k].trim());
  return {
    anthropic: has('ANTHROPIC_API_KEY'),
    openai: has('OPENAI_API_KEY'),
    elevenlabs: has('ELEVENLABS_API_KEY'),
    localTts: process.platform === 'win32',
  };
}

export const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-opus-5-5';
export const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
export const OPENAI_TTS_MODEL = process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts';
export const ELEVENLABS_MODEL = process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2';
export const LOCAL_WHISPER_MODEL = process.env.LOCAL_WHISPER_MODEL || 'onnx-community/whisper-base_timestamped';

/** Save API keys to .env and apply them to the running process. Empty string removes a key. */
export function saveKeys(updates) {
  const lines = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/) : [];
  for (const [key, raw] of Object.entries(updates)) {
    if (!KEY_NAMES.includes(key) || raw === undefined) continue;
    const value = String(raw).trim();
    const idx = lines.findIndex((l) => l.startsWith(`${key}=`));
    if (value) {
      if (idx >= 0) lines[idx] = `${key}=${value}`;
      else lines.push(`${key}=${value}`);
      process.env[key] = value;
    } else {
      // Write an explicit empty value so it also masks a system-wide variable of the same name on restart.
      if (idx >= 0) lines[idx] = `${key}=`;
      else lines.push(`${key}=`);
      process.env[key] = '';
    }
  }
  fs.writeFileSync(ENV_FILE, lines.filter(Boolean).join('\n') + '\n');
}
