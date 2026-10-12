import fs from 'node:fs';
import path from 'node:path';
import OpenAI from 'openai';
import { ffmpeg, decodePcm16k } from './ffmpeg.js';
import { providers, MODELS_DIR, LOCAL_WHISPER_MODEL } from './config.js';

/**
 * Transcribe a media file into word-level timings: { words: [{ w, s, e }], text, provider }.
 * Uses OpenAI Whisper when a key is set, otherwise a local Whisper model (downloaded on first use).
 */
export async function transcribe(mediaFile, workDir, duration, onProgress) {
  if (providers().openai) {
    try {
      return await transcribeOpenAI(mediaFile, workDir, duration, onProgress);
    } catch (err) {
      console.warn('[transcribe] OpenAI failed, falling back to local Whisper:', err.message);
    }
  }
  return transcribeLocal(mediaFile, duration, onProgress);
}

// ---------- OpenAI ----------

const OPENAI_CHUNK_SEC = 600; // 10 min of 32 kbps mono mp3 ≈ 2.4 MB, well under the 25 MB upload limit

async function transcribeOpenAI(mediaFile, workDir, duration, onProgress) {
  const client = new OpenAI();
  const words = [];
  const chunks = Math.max(1, Math.ceil(duration / OPENAI_CHUNK_SEC));
  for (let i = 0; i < chunks; i++) {
    const offset = i * OPENAI_CHUNK_SEC;
    const chunkFile = path.join(workDir, `audio-${i}.mp3`);
    await ffmpeg(['-ss', String(offset), '-t', String(OPENAI_CHUNK_SEC), '-i', mediaFile, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '32k', chunkFile]);
    const res = await client.audio.transcriptions.create({
      file: fs.createReadStream(chunkFile),
      model: 'whisper-1',
      response_format: 'verbose_json',
      timestamp_granularities: ['word', 'segment'],
    });
    fs.rmSync(chunkFile, { force: true });
    words.push(...restorePunctuation(res.words || [], res.segments || []).map((x) => ({ ...x, s: x.s + offset, e: x.e + offset })));
    onProgress?.((i + 1) / chunks);
  }
  return { words, text: words.map((x) => x.w).join(' '), provider: 'openai' };
}

const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');

/** Whisper's word list drops punctuation; copy it back from the segment text so captions and sentence splits look right. */
function restorePunctuation(apiWords, segments) {
  const out = apiWords.map((x) => ({ w: x.word.trim(), s: x.start, e: x.end }));
  const tokens = segments.flatMap((seg) => seg.text.trim().split(/\s+/).filter(Boolean));
  let t = 0;
  for (const word of out) {
    const target = norm(word.w);
    // Look a few tokens ahead so one mismatch doesn't derail the rest.
    for (let k = t; k < Math.min(tokens.length, t + 4); k++) {
      if (norm(tokens[k]) === target) {
        word.w = tokens[k];
        t = k + 1;
        break;
      }
    }
  }
  return out;
}

// ---------- Local (transformers.js) ----------

let localPipe;
const LOCAL_CHUNK_SEC = 300;

async function getLocalPipe() {
  if (!localPipe) {
    const { pipeline, env } = await import('@huggingface/transformers');
    env.cacheDir = MODELS_DIR;
    localPipe = pipeline('automatic-speech-recognition', LOCAL_WHISPER_MODEL, { dtype: 'q8' });
  }
  return localPipe;
}

async function transcribeLocal(mediaFile, duration, onProgress) {
  onProgress?.(0.02, 'Loading local Whisper model (first run downloads ~100 MB)');
  const transcriber = await getLocalPipe();
  const pcm = await decodePcm16k(mediaFile);
  const sr = 16000;
  const words = [];
  const chunkLen = LOCAL_CHUNK_SEC * sr;
  const chunks = Math.max(1, Math.ceil(pcm.length / chunkLen));
  for (let i = 0; i < chunks; i++) {
    const slice = pcm.subarray(i * chunkLen, (i + 1) * chunkLen);
    const offset = i * LOCAL_CHUNK_SEC;
    let out;
    try {
      out = await transcriber(slice, { return_timestamps: 'word', chunk_length_s: 30, stride_length_s: 5 });
      for (const c of out.chunks || []) {
        const w = c.text.trim();
        if (!w) continue;
        const [s, e] = c.timestamp;
        words.push({ w, s: offset + s, e: offset + (e ?? s + 0.3) });
      }
    } catch (err) {
      // Some Whisper exports lack the attention heads needed for word timing; fall back to
      // segment timing and spread each segment's words across it by length.
      console.warn('[transcribe] word timestamps unavailable, using segment timing:', err.message);
      out = await transcriber(slice, { return_timestamps: true, chunk_length_s: 30, stride_length_s: 5 });
      for (const c of out.chunks || []) {
        const [s, e] = c.timestamp;
        words.push(...spreadWords(c.text, offset + s, offset + (e ?? s + 2)));
      }
    }
    onProgress?.((i + 1) / chunks);
  }
  return { words: dedupeWords(words), text: words.map((x) => x.w).join(' '), provider: 'local' };
}

/** Evenly assign times to the words of a phrase, weighted by word length. */
export function spreadWords(text, start, end) {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  const weights = tokens.map((t) => t.length + 2 + (/[.,!?;:]$/.test(t) ? 3 : 0));
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const span = Math.max(0.1, end - start);
  let t = start;
  return tokens.map((w, i) => {
    const d = (weights[i] / total) * span;
    const word = { w, s: t, e: t + d * 0.92 };
    t += d;
    return word;
  });
}

function dedupeWords(words) {
  words.sort((a, b) => a.s - b.s);
  const out = [];
  for (const w of words) {
    const prev = out[out.length - 1];
    if (prev && Math.abs(prev.s - w.s) < 0.05 && norm(prev.w) === norm(w.w)) continue;
    if (prev && w.s < prev.e) prev.e = Math.max(prev.s + 0.05, w.s);
    out.push(w);
  }
  return out;
}
