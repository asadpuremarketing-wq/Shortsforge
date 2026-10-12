import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import { ROOT, DATA_DIR, PORT, KEY_NAMES, providers, saveKeys } from './config.js';
import { probe } from './ffmpeg.js';
import { listVoices, clearVoiceCache } from './tts.js';
import { CAPTION_STYLES } from './captions.js';
import { LAYOUTS } from './render.js';
import { llmProvider, writeHook, writeNarration, rewriteText } from './llm.js';
import { wordsIn } from './highlights.js';
import { newId, projectDir, loadProject, saveProject, updateProject, listProjects, deleteProject, summarize } from './store.js';
import { queueProject, queueClipRender, newClip, queueRankingRender, queueTranscription, downloadItem, queueStoryRender, repairRankingItems } from './pipeline.js';
import { registerToolRoutes } from './routes-tools.js';
import { registerStoryRoutes } from './routes-stories.js';
import { registerThumbnailRoutes } from './thumbnail.js';
import { registerYouTubeRoutes } from './youtube.js';
import { imagesAvailable } from './images.js';
import { ensureFonts } from './fonts.js';
import { detectEncoder } from './encoder.js';

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(ROOT, 'public')));

const UPLOAD_TMP = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_TMP, { recursive: true });
const upload = multer({ dest: UPLOAD_TMP });

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function getProject(req, res) {
  const project = loadProject(req.params.id);
  if (!project) res.status(404).json({ error: 'Project not found' });
  return project;
}

function getClip(project, req, res) {
  const clip = project.clips?.find((c) => c.id === req.params.clipId);
  if (!clip) res.status(404).json({ error: 'Clip not found' });
  return clip;
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

// ---------- Status & settings ----------

app.get('/api/status', wrap(async (req, res) => {
  res.json({
    encoder: (await detectEncoder()).name,
    images: imagesAvailable(),
    providers: providers(),
    llm: llmProvider(),
    captionStyles: Object.fromEntries(Object.entries(CAPTION_STYLES).map(([k, v]) => [k, v.label])),
    layouts: LAYOUTS,
  });
}));

app.get('/api/settings', (req, res) => {
  const mask = (v) => (v ? `${v.slice(0, 4)}…${v.slice(-4)}` : '');
  res.json(Object.fromEntries(KEY_NAMES.map((k) => [k, mask(process.env[k])])));
});

app.post('/api/settings', (req, res) => {
  saveKeys(req.body || {});
  clearVoiceCache();
  res.json({ ok: true, providers: providers(), llm: llmProvider() });
});

app.get('/api/voices', wrap(async (req, res) => res.json(await listVoices())));

// ---------- Projects ----------

app.get('/api/projects', (req, res) => res.json(listProjects().map(summarize)));

app.post(
  '/api/projects',
  upload.fields([{ name: 'video', maxCount: 1 }, { name: 'background', maxCount: 1 }]),
  wrap(async (req, res) => {
    const video = req.files?.video?.[0];
    const bg = req.files?.background?.[0];
    const cleanup = () => [video, bg].forEach((f) => f && fs.rmSync(f.path, { force: true }));
    if (!video) return res.status(400).json({ error: 'Upload a video file.' });

    const id = newId();
    const dir = projectDir(id);
    fs.mkdirSync(dir, { recursive: true });
    const ext = (path.extname(video.originalname) || '.mp4').toLowerCase();
    const sourceFile = `source${ext}`;
    fs.renameSync(video.path, path.join(dir, sourceFile));

    let info;
    try {
      info = await probe(path.join(dir, sourceFile));
      if (!info.hasVideo || !info.duration) throw new Error('No video stream found');
    } catch (err) {
      cleanup();
      fs.rmSync(dir, { recursive: true, force: true });
      return res.status(400).json({ error: `Couldn't read that file as a video (${err.message}).` });
    }

    let background = null;
    if (bg) {
      const bgFile = `background${(path.extname(bg.originalname) || '.mp4').toLowerCase()}`;
      fs.renameSync(bg.path, path.join(dir, bgFile));
      background = { file: bgFile, name: bg.originalname };
    }

    const o = JSON.parse(req.body.options || '{}');
    const minLen = clamp(Number(o.minLen) || 20, 5, 170);
    const options = {
      clipCount: clamp(Math.round(Number(o.clipCount) || 3), 1, 20),
      minLen,
      maxLen: clamp(Number(o.maxLen) || 60, minLen + 5, 180),
      layout: LAYOUTS[o.layout] ? o.layout : 'blur',
      captionStyle: CAPTION_STYLES[o.captionStyle] ? o.captionStyle : 'bold',
      voiceMode: ['original', 'hook', 'narration'].includes(o.voiceMode) ? o.voiceMode : 'original',
      voiceId: o.voiceId || null,
      zoom: Boolean(o.zoom),
      emojis: Boolean(o.emojis),
    };

    const project = saveProject({
      id,
      type: 'clips',
      name: (o.name || path.parse(video.originalname).name).slice(0, 120),
      createdAt: Date.now(),
      status: 'queued',
      step: 'Waiting in queue',
      progress: 0,
      source: { file: sourceFile, name: video.originalname, ...info },
      background,
      options,
      clips: [],
      notes: [],
    });
    queueProject(id);
    res.json(summarize(project));
  }),
);

app.get('/api/projects/:id', (req, res) => {
  const project = getProject(req, res);
  if (project) res.json(summarize(project));
});

app.get('/api/projects/:id/transcript', (req, res) => {
  const project = getProject(req, res);
  if (project) res.json(project.transcript || { words: [] });
});

app.patch('/api/projects/:id', (req, res) => {
  const project = getProject(req, res);
  if (!project) return;
  if (typeof req.body.name === 'string') project.name = req.body.name.slice(0, 120);
  res.json(summarize(saveProject(project)));
});

app.delete('/api/projects/:id', (req, res) => {
  const project = getProject(req, res);
  if (!project) return;
  if (['queued', 'processing'].includes(project.status)) return res.status(409).json({ error: 'Wait for processing to finish before deleting.' });
  deleteProject(project.id);
  res.json({ ok: true });
});

app.post('/api/projects/:id/retry', (req, res) => {
  const project = getProject(req, res);
  if (!project) return;
  if (req.body?.redetect) project.clips = [];
  saveProject(project);
  queueProject(project.id);
  res.json(summarize(loadProject(project.id)));
});

app.post('/api/projects/:id/background', upload.single('background'), (req, res) => {
  const project = getProject(req, res);
  if (!project) return;
  if (!req.file) return res.status(400).json({ error: 'Upload a background video.' });
  const dir = projectDir(project.id);
  if (project.background?.file) fs.rmSync(path.join(dir, project.background.file), { force: true });
  const bgFile = `background-${Date.now()}${(path.extname(req.file.originalname) || '.mp4').toLowerCase()}`;
  fs.renameSync(req.file.path, path.join(dir, bgFile));
  project.background = { file: bgFile, name: req.file.originalname };
  res.json(summarize(saveProject(project)));
});

// ---------- Clips ----------

const CLIP_FIELDS = ['title', 'start', 'end', 'layout', 'captionStyle', 'voiceMode', 'voiceId', 'hook', 'narration', 'follow', 'zoom', 'emojis'];
const BOOL_FIELDS = ['follow', 'zoom', 'emojis'];

function applyClipPatch(project, clip, body) {
  for (const key of CLIP_FIELDS) {
    if (body[key] === undefined) continue;
    let v = body[key];
    if (key === 'start' || key === 'end') v = clamp(Number(v), 0, project.source.duration);
    if (key === 'layout' && !LAYOUTS[v]) continue;
    if (key === 'captionStyle' && !CAPTION_STYLES[v]) continue;
    if (key === 'voiceMode' && !['original', 'hook', 'narration'].includes(v)) continue;
    if (BOOL_FIELDS.includes(key)) v = Boolean(v);
    clip[key] = v;
  }
  if (clip.end - clip.start < 1) clip.end = Math.min(project.source.duration, clip.start + 1);
}

app.post('/api/projects/:id/clips', (req, res) => {
  const project = getProject(req, res);
  if (!project) return;
  const start = clamp(Number(req.body.start) || 0, 0, project.source.duration);
  const clip = newClip(project, { start, end: Math.min(project.source.duration, start + 30), title: 'New clip', reason: 'Added manually.', score: 0 });
  applyClipPatch(project, clip, req.body);
  project.clips.push(clip);
  saveProject(project);
  res.json(clip);
});

app.patch('/api/projects/:id/clips/:clipId', (req, res) => {
  const project = getProject(req, res);
  const clip = project && getClip(project, req, res);
  if (!clip) return;
  applyClipPatch(project, clip, req.body);
  saveProject(project);
  res.json(clip);
});

app.delete('/api/projects/:id/clips/:clipId', (req, res) => {
  const project = getProject(req, res);
  const clip = project && getClip(project, req, res);
  if (!clip) return;
  if (['queued', 'rendering'].includes(clip.status)) return res.status(409).json({ error: 'This clip is rendering.' });
  const dir = projectDir(project.id);
  for (const f of [clip.file, clip.thumb, `captions-${clip.id}.ass`]) if (f) fs.rmSync(path.join(dir, f), { force: true });
  project.clips = project.clips.filter((c) => c.id !== clip.id);
  saveProject(project);
  res.json({ ok: true });
});

app.post('/api/projects/:id/clips/:clipId/render', (req, res) => {
  const project = getProject(req, res);
  const clip = project && getClip(project, req, res);
  if (!clip) return;
  if (['queued', 'rendering'].includes(clip.status)) return res.status(409).json({ error: 'Already rendering.' });
  applyClipPatch(project, clip, req.body || {});
  saveProject(project);
  queueClipRender(project.id, clip.id);
  res.json(loadProject(project.id).clips.find((c) => c.id === clip.id));
});

app.post(
  '/api/projects/:id/clips/:clipId/write',
  wrap(async (req, res) => {
    const project = getProject(req, res);
    const clip = project && getClip(project, req, res);
    if (!clip) return;
    if (!llmProvider()) return res.status(400).json({ error: 'Add an Anthropic or OpenAI key in Settings to use AI writing.' });
    const start = req.body.start ?? clip.start;
    const end = req.body.end ?? clip.end;
    const clipText = wordsIn(project.transcript?.words || [], start, end).map((w) => w.w).join(' ');
    const title = req.body.title ?? clip.title;
    let text;
    if (req.body.kind === 'hook') text = await writeHook({ title, clipText });
    else if (req.body.kind === 'narration') text = await writeNarration({ title, clipText, seconds: end - start, style: req.body.style });
    else if (req.body.kind === 'rewrite') text = await rewriteText({ text: req.body.text || '', instruction: req.body.instruction });
    else return res.status(400).json({ error: 'Unknown kind' });
    res.json({ text });
  }),
);

// Fix a transcription mistake: { i, w } replaces word i; an empty w deletes it.
app.post('/api/projects/:id/words', (req, res) => {
  const project = getProject(req, res);
  if (!project) return;
  const words = project.transcript?.words;
  const i = Number(req.body?.i);
  if (!words || !Number.isInteger(i) || !words[i]) return res.status(400).json({ error: 'Unknown word.' });
  const w = String(req.body.w ?? '').trim().replace(/\s+/g, ' ').slice(0, 60);
  if (w) words[i].w = w;
  else words.splice(i, 1);
  // Emoji picks depend on the words; let them be chosen again.
  for (const c of project.clips || []) delete c.emojiPicks;
  saveProject(project);
  res.json({ ok: true, words });
});

registerToolRoutes(app, upload, wrap);
registerStoryRoutes(app, upload, wrap);
registerThumbnailRoutes(app, upload, wrap);
registerYouTubeRoutes(app, wrap);

// ---------- Files ----------

app.get('/files/:id/:name', (req, res) => {
  const project = getProject(req, res);
  if (!project) return;
  const name = path.basename(req.params.name);
  const file = path.join(projectDir(project.id), name);
  if (!fs.existsSync(file)) return res.status(404).end();
  if (req.query.download) {
    const clip = project.clips?.find((c) => c.file === name);
    const label = clip?.title || (project.type === 'ranking' && name === project.output?.file ? project.name : null);
    const nice = label ? `${label.replace(/[^\w\- ]+/g, '').trim().slice(0, 60) || 'video'}.mp4` : name;
    return res.download(file, nice);
  }
  res.sendFile(file);
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Server error' });
});

// Resume work interrupted by a restart.
for (const p of listProjects()) {
  const interrupted = ['queued', 'processing'].includes(p.status);
  if (p.type === 'ranking') {
    for (const it of p.ranking.items) if (it.status === 'downloading' && it.url) downloadItem(p.id, it.id, it.url);
    repairRankingItems(p.id);
    if (interrupted) queueRankingRender(p.id);
  } else if (p.type === 'story') {
    if (interrupted) queueStoryRender(p.id);
  } else if (p.type === 'transcript') {
    if (interrupted) queueTranscription(p.id);
  } else if (interrupted) queueProject(p.id);
  else for (const c of p.clips || []) if (['queued', 'rendering'].includes(c.status)) queueClipRender(p.id, c.id);
}

ensureFonts();

app.listen(PORT, '127.0.0.1', () => {
  const p = providers();
  console.log(`\n  ShortsForge running at http://localhost:${PORT}\n`);
  console.log(`  AI writing/highlights: ${llmProvider() || 'built-in heuristic (add a key in Settings)'}`);
  console.log(`  Transcription:         ${p.openai ? 'OpenAI Whisper' : 'local Whisper'}`);
  console.log(`  Voices:                ${[p.elevenlabs && 'ElevenLabs', p.openai && 'OpenAI', p.localTts && 'Windows'].filter(Boolean).join(', ')}\n`);
});
