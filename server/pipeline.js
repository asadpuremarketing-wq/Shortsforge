import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ffmpeg, ffmpegWithProgress, probe } from './ffmpeg.js';
import { videoCodecArgs } from './encoder.js';
import { renderRanking, applyAutoTrim } from './ranking.js';
import { analyzeClip } from './analyze.js';
import { findPeakWithAI } from './vision.js';
import { renderStory } from './stories.js';
import { downloadVideo, labelFromTitle } from './download.js';
import { transcribe } from './transcribe.js';
import { findHighlights, wordsIn, bestLine } from './highlights.js';
import { renderClip } from './render.js';
import { synthesize } from './tts.js';
import { llmProvider, writeHook, writeNarration } from './llm.js';
import { loadProject, saveProject, updateProject, projectDir, newId } from './store.js';

// ---------- A single-worker queue: video encoding is CPU-bound, so one job at a time. ----------

const queue = [];
let running = false;

export function enqueue(task) {
  return new Promise((resolve, reject) => {
    queue.push({ task, resolve, reject });
    pump();
  });
}

async function pump() {
  if (running) return;
  const item = queue.shift();
  if (!item) return;
  running = true;
  try {
    item.resolve(await item.task());
  } catch (err) {
    item.reject(err);
  } finally {
    running = false;
    pump();
  }
}

// ---------- Full pipeline ----------

function setStep(id, step, progress) {
  updateProject(id, (p) => {
    p.step = step;
    if (progress !== undefined) p.progress = Math.round(progress);
  });
}

export function queueProject(id) {
  updateProject(id, (p) => {
    p.status = 'queued';
    p.step = 'Waiting in queue';
    p.error = null;
  });
  return enqueue(() => processProject(id)).catch((err) => {
    console.error(`[pipeline] project ${id} failed:`, err);
    updateProject(id, (p) => {
      p.status = 'error';
      p.error = err.message;
    });
  });
}

async function processProject(id) {
  const dir = projectDir(id);
  let project = loadProject(id);
  project.status = 'processing';
  project.notes = [];
  saveProject(project);
  const src = path.join(dir, project.source.file);

  // 1. Browser-friendly preview for the editor (handles HEVC/MOV sources browsers can't play).
  if (!project.preview) {
    setStep(id, 'Preparing preview', 2);
    await ffmpegWithProgress(
      ['-i', src, '-vf', 'scale=-2:540', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', 'preview.mp4'],
      project.source.duration,
      (f) => setStep(id, 'Preparing preview', 2 + f * 8),
      { cwd: dir },
    );
    updateProject(id, (p) => (p.preview = 'preview.mp4'));
  }

  // 2. Transcribe.
  project = loadProject(id);
  if (!project.transcript) {
    setStep(id, 'Transcribing speech', 10);
    const transcript = project.source.hasAudio
      ? await transcribe(src, dir, project.source.duration, (f, msg) => setStep(id, msg || 'Transcribing speech', 10 + f * 35))
      : { words: [], text: '', provider: 'none' };
    updateProject(id, (p) => (p.transcript = transcript));
  }

  // 3. Find highlights.
  project = loadProject(id);
  if (!project.clips?.length) {
    setStep(id, llmProvider() ? 'AI is picking the best moments' : 'Finding the best moments', 46);
    const { clipCount, minLen, maxLen } = project.options;
    const notes = [];
    const highlights = await findHighlights({
      words: project.transcript.words,
      duration: project.source.duration,
      count: clipCount,
      minLen,
      maxLen,
      onNote: (n) => notes.push(n),
    });
    updateProject(id, (p) => {
      p.notes.push(...notes);
      p.clips = highlights.map((h) => newClip(p, h));
    });
  }

  // 4. Voice + render each clip.
  project = loadProject(id);
  const total = project.clips.length;
  for (let i = 0; i < total; i++) {
    const clip = loadProject(id).clips[i];
    if (clip.status === 'ready') continue;
    const base = 55 + (i / total) * 45;
    await renderOne(id, clip.id, (f, step) => setStep(id, step || `Rendering clip ${i + 1} of ${total}`, base + (f * 45) / total));
  }

  updateProject(id, (p) => {
    p.status = p.clips.some((c) => c.status === 'error') ? 'partial' : 'ready';
    p.step = 'Done';
    p.progress = 100;
  });
}

export function newClip(project, h) {
  const o = project.options;
  return {
    id: newId(),
    start: h.start,
    end: h.end,
    title: h.title,
    reason: h.reason,
    score: h.score,
    layout: o.layout,
    captionStyle: o.captionStyle,
    voiceMode: o.voiceMode,
    voiceId: o.voiceId || null,
    follow: true,
    zoom: Boolean(o.zoom),
    emojis: Boolean(o.emojis),
    hook: '',
    narration: '',
    status: 'pending',
    progress: 0,
  };
}

// ---------- Rendering a single clip (also used by the editor) ----------

export function queueClipRender(id, clipId) {
  updateProject(id, (p) => {
    const c = p.clips.find((x) => x.id === clipId);
    c.status = 'queued';
    c.error = null;
    c.progress = 0;
  });
  return enqueue(() => renderOne(id, clipId)).catch((err) => console.error(`[pipeline] clip ${clipId} failed:`, err));
}

function patchClip(id, clipId, patch) {
  updateProject(id, (p) => Object.assign(p.clips.find((x) => x.id === clipId), patch));
}

async function renderOne(id, clipId, onProgress) {
  const dir = projectDir(id);
  try {
    patchClip(id, clipId, { status: 'rendering', progress: 0, error: null });
    let project = loadProject(id);
    let clip = project.clips.find((x) => x.id === clipId);
    const clipText = wordsIn(project.transcript.words, clip.start, clip.end).map((w) => w.w).join(' ');

    let voice = null;
    if (clip.voiceMode === 'hook' || clip.voiceMode === 'narration') {
      onProgress?.(0.02, 'Writing voiceover');
      let text = clip.voiceMode === 'hook' ? clip.hook : clip.narration;
      if (!text?.trim()) {
        text = await defaultVoiceText(clip, clipText);
        patchClip(id, clipId, clip.voiceMode === 'hook' ? { hook: text } : { narration: text });
      }
      onProgress?.(0.08, 'Generating AI voice');
      voice = await getVoice(dir, clip, text);
      voice.mode = clip.voiceMode;
    }

    project = loadProject(id);
    clip = project.clips.find((x) => x.id === clipId);
    const out = await renderClip({
      dir,
      project,
      clip,
      voice,
      onStep: (step) => onProgress?.(0.1, step),
      onProgress: (f) => {
        patchClip(id, clipId, { progress: Math.round(f * 100) });
        onProgress?.(0.1 + f * 0.9);
      },
    });
    patchClip(id, clipId, { status: 'ready', progress: 100, ...out, version: Date.now() });
  } catch (err) {
    console.error(`[render] clip ${clipId}:`, err);
    patchClip(id, clipId, { status: 'error', error: err.message });
  }
}

async function defaultVoiceText(clip, clipText) {
  const seconds = clip.end - clip.start;
  if (llmProvider()) {
    try {
      return clip.voiceMode === 'hook' ? await writeHook({ title: clip.title, clipText }) : await writeNarration({ title: clip.title, clipText, seconds });
    } catch (err) {
      console.warn('[voice] AI writing failed, using fallback text:', err.message);
    }
  }
  if (clip.voiceMode === 'hook') {
    return bestLine(clipText.split(/(?<=[.!?])\s+/), 12) || 'Wait until you hear this.';
  }
  return clipText || clip.title;
}

/** Synthesize voiceover, reusing the cached file when the text and voice haven't changed. */
async function getVoice(dir, clip, text) {
  const key = crypto.createHash('sha1').update(`${clip.voiceId}|${text}`).digest('hex').slice(0, 12);
  const meta = path.join(dir, `voice-${key}.json`);
  if (fs.existsSync(meta)) {
    const cached = JSON.parse(fs.readFileSync(meta, 'utf8'));
    const file = path.join(dir, cached.file);
    if (fs.existsSync(file)) return { ...cached, file };
  }
  const voice = await synthesize(text, clip.voiceId, path.join(dir, `voice-${key}`));
  fs.writeFileSync(meta, JSON.stringify({ ...voice, file: path.basename(voice.file) }));
  return voice;
}

// ---------- Video Ranking ----------

export function queueRankingRender(id) {
  updateProject(id, (p) => {
    p.status = 'queued';
    p.step = 'Waiting in queue';
    p.progress = 0;
    p.error = null;
  });
  return enqueue(async () => {
    updateProject(id, (p) => (p.status = 'processing'));
    const out = await renderRanking(projectDir(id), loadProject(id), (f, step) => setStep(id, step, f * 100));
    updateProject(id, (p) => {
      p.output = { ...out, version: Date.now() };
      p.status = 'ready';
      p.step = 'Done';
      p.progress = 100;
    });
  }).catch((err) => {
    console.error(`[ranking] ${id} failed:`, err);
    updateProject(id, (p) => {
      p.status = 'error';
      p.error = err.message;
    });
  });
}

function patchItem(id, itemId, patch) {
  updateProject(id, (p) => {
    const item = p.ranking.items.find((x) => x.id === itemId);
    if (item) Object.assign(item, patch);
  });
}

/**
 * Browsers can't reliably play HEVC/AV1/VP9 (TikTok and iPhone use HEVC), so convert anything
 * that isn't H.264 + yuv420p. Uses the GPU encoder when available. Returns { file, info }.
 */
async function toBrowserFriendly(dir, file, onStatus) {
  let info = await probe(path.join(dir, file));
  if (!info.hasVideo || (info.videoCodec === 'h264' && info.pixFmt === 'yuv420p')) return { file, info };
  onStatus?.();
  const out = `${path.parse(file).name}-h264.mp4`;
  await ffmpeg(['-i', file, '-map', '0:v:0', '-map', '0:a:0?', ...(await videoCodecArgs()), '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out], { cwd: dir });
  fs.rmSync(path.join(dir, file), { force: true });
  info = await probe(path.join(dir, out));
  return { file: out, info };
}

/** Repair ranking items added before conversion and accurate lengths existed (runs once per item). */
export function repairRankingItems(id) {
  const p = loadProject(id);
  const todo = (p?.ranking?.items || []).filter((it) => it.status === 'ready' && !it.compat);
  if (!todo.length) return;
  enqueue(async () => {
    for (const it of todo) {
      try {
        const { file, info } = await toBrowserFriendly(projectDir(id), it.file);
        updateProject(id, (x) => {
          const item = x.ranking.items.find((y) => y.id === it.id);
          if (!item) return;
          const duration = +info.duration.toFixed(2);
          Object.assign(item, { file, duration, compat: true });
          item.trimEnd = Math.min(item.trimEnd ?? duration, duration);
          item.trimStart = Math.min(item.trimStart || 0, Math.max(0, duration - 0.5));
          applyAutoTrim(x.ranking);
        });
      } catch (err) {
        console.warn(`[repair] ${it.file}:`, err.message);
      }
    }
  }).catch(() => {});
}

/** Probe a file now in the project dir and mark the ranking item ready. */
export async function finishItem(id, itemId, file) {
  const converted = await toBrowserFriendly(projectDir(id), file, () => patchItem(id, itemId, { status: 'processing' }));
  file = converted.file;
  const info = converted.info;
  if (!info.hasVideo) throw new Error('That file has no video.');
  patchItem(id, itemId, { compat: true });
  const duration = +info.duration.toFixed(2);
  patchItem(id, itemId, { file, status: 'analyzing', error: null, duration, width: info.width, height: info.height, hasAudio: info.hasAudio, trimStart: 0, trimEnd: duration, auto: true });
  let analysis = null;
  try {
    analysis = await analyzeClip(path.join(projectDir(id), file), duration);
  } catch (err) {
    console.warn('[analyze] failed, using whole clip:', err.message);
  }
  let ai = null;
  if (llmProvider()) {
    try {
      ai = await findPeakWithAI(path.join(projectDir(id), file), duration, projectDir(id), analysis);
    } catch (err) {
      console.warn('[vision] AI moment pick failed, using sound/motion only:', err.message);
    }
  }
  updateProject(id, (p) => {
    const item = p.ranking.items.find((x) => x.id === itemId);
    if (!item) return;
    Object.assign(item, { analysis, ai, status: 'ready' });
    if (ai?.label && !item.label) item.label = ai.label;
    applyAutoTrim(p.ranking);
  });
}

/** Downloads run outside the render queue so they don't wait behind long renders. */
export async function downloadItem(id, itemId, url) {
  try {
    const { file, title } = await downloadVideo(url, projectDir(id), `item-${itemId}`);
    await finishItem(id, itemId, file);
    updateProject(id, (p) => {
      const item = p.ranking.items.find((x) => x.id === itemId);
      if (item && !item.label && title) item.label = labelFromTitle(title);
    });
  } catch (err) {
    console.error(`[download] ${url}:`, err.message);
    patchItem(id, itemId, { status: 'error', error: err.message });
  }
}

// ---------- Video Transcriber ----------

export function queueTranscription(id) {
  updateProject(id, (p) => {
    p.status = 'queued';
    p.step = 'Waiting in queue';
  });
  return enqueue(async () => {
    const p = loadProject(id);
    updateProject(id, (x) => (x.status = 'processing'));
    const transcript = await transcribe(path.join(projectDir(id), p.source.file), projectDir(id), p.source.duration, (f, msg) => setStep(id, msg || 'Transcribing', f * 100));
    updateProject(id, (x) => {
      x.transcript = transcript;
      x.status = 'ready';
      x.step = 'Done';
      x.progress = 100;
    });
  }).catch((err) => {
    updateProject(id, (p) => {
      p.status = 'error';
      p.error = err.message;
    });
  });
}

// ---------- Stories (video, text, commentary) ----------

export function queueStoryRender(id) {
  updateProject(id, (p) => {
    p.status = 'queued';
    p.step = 'Waiting in queue';
    p.progress = 0;
    p.error = null;
  });
  return enqueue(async () => {
    updateProject(id, (p) => (p.status = 'processing'));
    const p = loadProject(id);
    const out = await renderStory(projectDir(id), p.story, (f, step) => setStep(id, step, f * 100));
    updateProject(id, (x) => {
      x.output = { ...out, version: Date.now() };
      x.status = 'ready';
      x.step = 'Done';
      x.progress = 100;
    });
  }).catch((err) => {
    console.error(`[story] ${id} failed:`, err);
    updateProject(id, (p) => {
      p.status = 'error';
      p.error = err.message;
    });
  });
}
