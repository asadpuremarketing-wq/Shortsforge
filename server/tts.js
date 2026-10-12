import fs from 'node:fs';
import path from 'node:path';
import OpenAI from 'openai';
import { run, probe } from './ffmpeg.js';
import { ROOT, providers, OPENAI_TTS_MODEL, ELEVENLABS_MODEL } from './config.js';
import { spreadWords } from './transcribe.js';

const SAPI_SCRIPT = path.join(ROOT, 'server', 'sapi-tts.ps1');
const OPENAI_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse'];

let sapiVoiceCache;
let elevenVoiceCache;

function powershell(args) {
  return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SAPI_SCRIPT, ...args]);
}

async function sapiVoices() {
  if (!sapiVoiceCache) {
    try {
      const { stdout } = await powershell(['-List']);
      sapiVoiceCache = stdout.toString().split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    } catch {
      sapiVoiceCache = [];
    }
  }
  return sapiVoiceCache;
}

async function elevenVoices() {
  if (!elevenVoiceCache) {
    const res = await fetch('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY } });
    if (!res.ok) throw new Error(await elevenError(res));
    const data = await res.json();
    elevenVoiceCache = data.voices.map((v) => ({
      id: `elevenlabs:${v.voice_id}`,
      name: v.name,
      detail: [v.labels?.gender, v.labels?.accent, v.labels?.description || v.labels?.use_case].filter(Boolean).join(' · '),
      preview: v.preview_url,
    }));
  }
  return elevenVoiceCache;
}

async function elevenError(res) {
  const body = await res.text();
  try {
    const { detail } = JSON.parse(body);
    return (typeof detail === 'string' ? detail : detail?.message) || `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}: ${body.slice(0, 200)}`;
  }
}

export function clearVoiceCache() {
  elevenVoiceCache = undefined;
}

/** Voices grouped by provider, best provider first. Voice ids look like "openai:nova". */
export async function listVoices() {
  const p = providers();
  const groups = [];
  if (p.elevenlabs) {
    try {
      groups.push({ provider: 'elevenlabs', label: 'ElevenLabs', voices: await elevenVoices() });
    } catch (err) {
      groups.push({ provider: 'elevenlabs', label: 'ElevenLabs', voices: [], error: err.message });
    }
  }
  if (p.openai) {
    groups.push({ provider: 'openai', label: 'OpenAI', voices: OPENAI_VOICES.map((v) => ({ id: `openai:${v}`, name: v[0].toUpperCase() + v.slice(1) })) });
  }
  if (p.localTts) {
    const voices = await sapiVoices();
    groups.push({ provider: 'local', label: 'Windows (free, offline)', voices: voices.map((v) => ({ id: `local:${v}`, name: v.replace(/^Microsoft /, '').replace(/ Desktop$/, '') })) });
  }
  return groups;
}

export async function defaultVoiceId() {
  const groups = await listVoices();
  for (const g of groups) if (g.voices.length) return g.voices[0].id;
  return null;
}

/**
 * Speak `text` with `voiceId` and write `${outBase}.mp3|.wav`.
 * Returns { file, duration, words } where words are timed relative to the start of the audio.
 */
export async function synthesize(text, voiceId, outBase) {
  voiceId ||= await defaultVoiceId();
  if (!voiceId) throw new Error('No voice available. Add an ElevenLabs or OpenAI key in Settings.');
  const [provider, ...rest] = voiceId.split(':');
  const voice = rest.join(':');
  let file;
  let words;

  if (provider === 'elevenlabs') {
    file = `${outBase}.mp3`;
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}/with-timestamps?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ text, model_id: ELEVENLABS_MODEL }),
    });
    if (!res.ok) throw new Error(`ElevenLabs: ${await elevenError(res)}`);
    const data = await res.json();
    fs.writeFileSync(file, Buffer.from(data.audio_base64, 'base64'));
    words = alignmentToWords(data.alignment);
  } else if (provider === 'openai') {
    file = `${outBase}.mp3`;
    const client = new OpenAI();
    const res = await client.audio.speech.create({ model: OPENAI_TTS_MODEL, voice, input: text, response_format: 'mp3' });
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  } else if (provider === 'local') {
    file = `${outBase}.wav`;
    const textFile = `${outBase}.txt`;
    fs.writeFileSync(textFile, text, 'utf8');
    await powershell(['-TextFile', textFile, '-Out', file, '-Voice', voice]);
    fs.rmSync(textFile, { force: true });
  } else {
    throw new Error(`Unknown voice provider: ${provider}`);
  }

  const { duration } = await probe(file);
  if (!words?.length) words = spreadWords(text, 0.05, Math.max(0.2, duration - 0.1));
  return { file, duration, words };
}

/** ElevenLabs returns per-character timing; group characters into words. */
function alignmentToWords(alignment) {
  if (!alignment?.characters) return null;
  const { characters: chars, character_start_times_seconds: starts, character_end_times_seconds: ends } = alignment;
  const words = [];
  let cur = null;
  for (let i = 0; i < chars.length; i++) {
    if (/\s/.test(chars[i])) {
      if (cur) words.push(cur);
      cur = null;
      continue;
    }
    if (!cur) cur = { w: '', s: starts[i], e: ends[i] };
    cur.w += chars[i];
    cur.e = ends[i];
  }
  if (cur) words.push(cur);
  return words;
}
