import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';
import { probe } from './ffmpeg.js';
import { synthesize } from './tts.js';
import { CAPTION_STYLES } from './captions.js';
import { listFonts } from './fonts.js';
import { defaultRanking, applyAutoTrim, MAX_RANKS, plainText } from './ranking.js';
import { isSupportedLink } from './download.js';
import { z } from 'zod';
import { llmProvider, generateJSON } from './llm.js';
import { newId, projectDir, loadProject, saveProject, summarize, listProjects } from './store.js';
import { queueRankingRender, finishItem, downloadItem, queueTranscription } from './pipeline.js';

const TOOLS_DIR = path.join(DATA_DIR, 'tools');
fs.mkdirSync(TOOLS_DIR, { recursive: true });

/** Copy only known keys whose type matches the defaults, so the client can't inject arbitrary fields. */
function mergeKnown(target, src, defaults) {
  if (!src || typeof src !== 'object') return;
  for (const [key, def] of Object.entries(defaults)) {
    const v = src[key];
    if (v === undefined || v === null) continue;
    if (typeof def === 'number' && Number.isFinite(Number(v))) target[key] = Number(v);
    else if (typeof def === typeof v) target[key] = typeof v === 'string' ? v.slice(0, 2000) : v; // room for color markup
  }
}

export function registerToolRoutes(app, upload, wrap) {
  const fontsDir = path.join(DATA_DIR, 'fonts');
  app.get('/fonts/:file', (req, res) => res.sendFile(path.join(fontsDir, path.basename(req.params.file))));
  app.get('/api/fonts', (req, res) => res.json(listFonts()));

  const getRanking = (req, res) => {
    const p = loadProject(req.params.id);
    if (!p || p.type !== 'ranking') {
      res.status(404).json({ error: 'Ranking not found' });
      return null;
    }
    return p;
  };

  // ---------- Video Ranking ----------

  app.post('/api/rankings', (req, res) => {
    const id = newId();
    fs.mkdirSync(projectDir(id), { recursive: true });
    const ranking = defaultRanking();
    // "New ranking with this style": copy every setting (and the music) from another ranking, but no videos.
    const from = req.body?.fromId && loadProject(req.body.fromId);
    if (from?.type === 'ranking') {
      for (const section of ['title', 'general', 'ranks', 'playback', 'extras']) ranking[section] = { ...ranking[section], ...structuredClone(from.ranking[section] || {}) };
      if (from.ranking.music?.file && fs.existsSync(path.join(projectDir(from.id), from.ranking.music.file))) {
        fs.copyFileSync(path.join(projectDir(from.id), from.ranking.music.file), path.join(projectDir(id), from.ranking.music.file));
        ranking.music = { ...from.ranking.music };
      }
    }
    const p = saveProject({ id, type: 'ranking', name: (req.body?.name || (from ? `${from.name} (new)` : 'Untitled ranking')).slice(0, 120), createdAt: Date.now(), status: 'draft', progress: 0, ranking });
    res.json(p);
  });

  app.get('/api/rankings/:id', (req, res) => {
    const p = getRanking(req, res);
    if (p) res.json(p);
  });

  app.put('/api/rankings/:id', (req, res) => {
    const p = getRanking(req, res);
    if (!p) return;
    const body = req.body || {};
    const d = defaultRanking();
    if (typeof body.name === 'string') p.name = body.name.slice(0, 120);
    const r = body.ranking || {};
    // Fill settings added in newer versions.
    for (const section of ['title', 'general', 'ranks', 'playback', 'extras']) p.ranking[section] = { ...d[section], ...p.ranking[section] };
    for (const section of ['title', 'general', 'ranks', 'playback', 'extras']) mergeKnown(p.ranking[section], r[section], d[section]);
    if (!CAPTION_STYLES[p.ranking.general.captionStyle]) p.ranking.general.captionStyle = 'bold';
    if (!['stay', 'during', 'seconds'].includes(p.ranking.ranks.labelMode)) p.ranking.ranks.labelMode = 'stay';
    p.ranking.ranks.labelSeconds = Math.min(30, Math.max(0.5, Number(p.ranking.ranks.labelSeconds) || 3));
    const fontOk = (f) => listFonts().some((x) => x.family === f);
    if (!fontOk(p.ranking.title.font)) p.ranking.title.font = d.title.font;
    if (!fontOk(p.ranking.ranks.font)) p.ranking.ranks.font = d.ranks.font;
    // Colors must be #rrggbb (they end up inside the subtitle file); fall back to the default otherwise.
    const HEX = /^#[0-9a-f]{6}$/i;
    for (const section of ['title', 'general', 'ranks', 'extras']) {
      for (const [k, v] of Object.entries(p.ranking[section])) {
        if (!/color$|^bg$|^background$/i.test(k)) continue;
        if (k === 'bg' && v === '') continue; // no title background
        if (!HEX.test(v)) p.ranking[section][k] = d[section][k];
      }
    }
    if (Array.isArray(r.items)) {
      // Items: the client sends the order plus editable fields; files and status stay server-side.
      const byId = new Map(p.ranking.items.map((it) => [it.id, it]));
      const ordered = r.items.map((x) => byId.get(x.id)).filter(Boolean);
      for (const it of p.ranking.items) if (!ordered.includes(it)) ordered.push(it);
      for (const x of r.items) {
        const it = byId.get(x.id);
        if (!it) continue;
        if (typeof x.label === 'string') it.label = x.label.slice(0, 800); // room for color markup
        // Per-rank font; empty means "same as the rank list". Only installed fonts are accepted.
        if (x.font === '' || x.font === null) delete it.font;
        else if (typeof x.font === 'string' && listFonts().some((f) => f.family === x.font)) it.font = x.font;
        // Per-rank label color; empty means "use the rank list's label color".
        if (x.color === '' || x.color === null) delete it.color;
        else if (typeof x.color === 'string' && /^#[0-9a-f]{6}$/i.test(x.color)) it.color = x.color;
        if (x.auto === true) it.auto = true;
        else if (Number.isFinite(x.trimStart) && Number.isFinite(x.trimEnd) && (Math.abs(x.trimStart - it.trimStart) > 0.01 || Math.abs(x.trimEnd - it.trimEnd) > 0.01)) {
          // A hand-made trim switches this item to manual.
          it.trimStart = Math.max(0, Math.min(x.trimStart, (it.duration || 0) - 0.5));
          it.trimEnd = Math.min(it.duration || x.trimEnd, Math.max(x.trimEnd, it.trimStart + 0.5));
          it.auto = false;
        }
      }
      p.ranking.items = ordered;
    }
    p.ranking.general.targetLength = Math.min(600, Math.max(5, p.ranking.general.targetLength));
    applyAutoTrim(p.ranking);
    res.json(saveProject(p));
  });

  app.post(
    '/api/rankings/:id/items',
    upload.single('video'),
    wrap(async (req, res) => {
      const p = getRanking(req, res);
      if (!p) return req.file && fs.rmSync(req.file.path, { force: true });
      const itemId = newId();
      const url = req.body?.url?.trim();
      if (!req.file && !isSupportedLink(url)) return res.status(400).json({ error: 'Paste a TikTok, Instagram or YouTube link, or upload a video.' });
      if (p.ranking.items.length >= MAX_RANKS) {
        if (req.file) fs.rmSync(req.file.path, { force: true });
        return res.status(400).json({ error: `A ranking can have up to ${MAX_RANKS} videos.` });
      }
      const item = { id: itemId, label: (req.body?.label || '').slice(0, 80), status: req.file ? 'processing' : 'downloading', url: url || null, sourceName: req.file?.originalname || url };
      // Optional rank (1-based) puts the video at that position; otherwise it goes last.
      const rank = Math.round(Number(req.body?.rank));
      if (rank >= 1 && rank <= p.ranking.items.length) p.ranking.items.splice(rank - 1, 0, item);
      else p.ranking.items.push(item);
      saveProject(p);
      if (req.file) {
        const file = `item-${itemId}${(path.extname(req.file.originalname) || '.mp4').toLowerCase()}`;
        fs.renameSync(req.file.path, path.join(projectDir(p.id), file));
        try {
          await finishItem(p.id, itemId, file);
        } catch (err) {
          const fresh = loadProject(p.id);
          fresh.ranking.items = fresh.ranking.items.filter((x) => x.id !== itemId);
          saveProject(fresh);
          fs.rmSync(path.join(projectDir(p.id), file), { force: true });
          return res.status(400).json({ error: `Couldn't read that video (${err.message}).` });
        }
      } else {
        downloadItem(p.id, itemId, url);
      }
      res.json(loadProject(p.id));
    }),
  );

  // Remove every video from a ranking (settings are kept).
  app.delete('/api/rankings/:id/items', (req, res) => {
    const p = getRanking(req, res);
    if (!p) return;
    if (['queued', 'processing'].includes(p.status)) return res.status(409).json({ error: 'Wait for the render to finish.' });
    for (const it of p.ranking.items) if (it.file) fs.rmSync(path.join(projectDir(p.id), it.file), { force: true });
    p.ranking.items = [];
    res.json(saveProject(p));
  });

  // Duplicate a rank (copies its video file so the two can be trimmed independently).
  app.post('/api/rankings/:id/items/:itemId/duplicate', (req, res) => {
    const p = getRanking(req, res);
    if (!p) return;
    const idx = p.ranking.items.findIndex((x) => x.id === req.params.itemId);
    const src = p.ranking.items[idx];
    if (!src) return res.status(404).json({ error: 'Not found' });
    if (p.ranking.items.length >= MAX_RANKS) return res.status(400).json({ error: `A ranking can have up to ${MAX_RANKS} videos.` });
    if (src.status !== 'ready') return res.status(400).json({ error: 'Wait until this video is ready.' });
    const copy = structuredClone(src);
    copy.id = newId();
    copy.file = `item-${copy.id}${path.extname(src.file)}`;
    fs.copyFileSync(path.join(projectDir(p.id), src.file), path.join(projectDir(p.id), copy.file));
    p.ranking.items.splice(idx + 1, 0, copy);
    applyAutoTrim(p.ranking);
    res.json(saveProject(p));
  });

  app.delete('/api/rankings/:id/items/:itemId', (req, res) => {
    const p = getRanking(req, res);
    if (!p) return;
    const item = p.ranking.items.find((x) => x.id === req.params.itemId);
    if (!item) return res.status(404).json({ error: 'Not found' });
    if (item.file) fs.rmSync(path.join(projectDir(p.id), item.file), { force: true });
    p.ranking.items = p.ranking.items.filter((x) => x !== item);
    applyAutoTrim(p.ranking);
    res.json(saveProject(p));
  });

  app.post('/api/rankings/:id/music', upload.single('music'), (req, res) => {
    const p = getRanking(req, res);
    if (!p) return req.file && fs.rmSync(req.file.path, { force: true });
    if (!req.file) return res.status(400).json({ error: 'Upload an audio file.' });
    const dir = projectDir(p.id);
    if (p.ranking.music?.file) fs.rmSync(path.join(dir, p.ranking.music.file), { force: true });
    const file = `music-${Date.now()}${(path.extname(req.file.originalname) || '.mp3').toLowerCase()}`;
    fs.renameSync(req.file.path, path.join(dir, file));
    p.ranking.music = { file, name: req.file.originalname };
    res.json(saveProject(p));
  });

  app.delete('/api/rankings/:id/music', (req, res) => {
    const p = getRanking(req, res);
    if (!p) return;
    if (p.ranking.music?.file) fs.rmSync(path.join(projectDir(p.id), p.ranking.music.file), { force: true });
    p.ranking.music = null;
    res.json(saveProject(p));
  });

  app.post(
    '/api/rankings/:id/suggest-title',
    wrap(async (req, res) => {
      const p = getRanking(req, res);
      if (!p) return;
      if (!llmProvider()) return res.status(400).json({ error: 'Add an Anthropic or OpenAI key in Settings to use AI titles.' });
      const labels = p.ranking.items.map((it, i) => `#${i + 1}: ${plainText(it.label) || it.ai?.reason || "(no label)"}`).join('\n');
      const { titles } = await generateJSON({
        effort: 'low',
        schema: z.object({ titles: z.array(z.string()) }),
        system: 'You write titles for ranking compilation Shorts, like "Ranking Best Parkour Fails" or "Top 5 Craziest Saves". Under 40 characters, no emojis, no hashtags.',
        prompt: `Suggest 5 titles for a ranking video with these clips:\n${labels}`,
      });
      res.json({ titles: titles.slice(0, 5) });
    }),
  );

  app.post('/api/rankings/:id/render', (req, res) => {
    const p = getRanking(req, res);
    if (!p) return;
    if (['queued', 'processing'].includes(p.status)) return res.status(409).json({ error: 'Already rendering.' });
    if (!p.ranking.items.length) return res.status(400).json({ error: 'Add at least one video first.' });
    const notReady = p.ranking.items.findIndex((x) => x.status !== 'ready');
    if (notReady >= 0) return res.status(400).json({ error: `Rank ${notReady + 1} isn't ready yet.` });
    queueRankingRender(p.id);
    res.json(loadProject(p.id));
  });

  // ---------- Storage ----------

  const dirSize = (p) => {
    if (!fs.existsSync(p)) return 0;
    const st = fs.statSync(p);
    if (!st.isDirectory()) return st.size;
    return fs.readdirSync(p).reduce((n, f) => n + dirSize(path.join(p, f)), 0);
  };
  // Files the app can always rebuild (voice caches, subtitle files, temp uploads, frames).
  const REBUILDABLE = /^(captions-.*\.ass|overlay\.ass|captions\.ass|story\.ass|commentary\.ass|voice-.*|announce-.*|vo-.*|msg\d+-.*|frames-.*|track-.*|emoji-.*\.png|chat-preview\.png|title-card\.png|audio-\d+\.mp3|.*\.tmp\.mp4)$/;

  app.get('/api/storage', (req, res) => {
    const projects = listProjects().map((p) => ({ id: p.id, name: p.name, type: p.type || 'clips', size: dirSize(projectDir(p.id)), createdAt: p.createdAt }));
    let rebuildable = 0;
    for (const p of projects) for (const f of fs.readdirSync(projectDir(p.id))) if (REBUILDABLE.test(f)) rebuildable += dirSize(path.join(projectDir(p.id), f));
    res.json({
      projects: projects.sort((a, b) => b.size - a.size),
      caches: {
        rebuildable: rebuildable + dirSize(path.join(DATA_DIR, 'uploads')) + dirSize(TOOLS_DIR),
        models: dirSize(path.join(DATA_DIR, 'models')),
        downloader: dirSize(path.join(DATA_DIR, 'bin')),
        fonts: dirSize(path.join(DATA_DIR, 'fonts')),
      },
    });
  });

  app.post('/api/storage/clean', (req, res) => {
    const what = req.body?.what;
    if (what === 'rebuildable') {
      for (const p of listProjects()) {
        if (['queued', 'processing'].includes(p.status)) continue;
        for (const f of fs.readdirSync(projectDir(p.id))) if (REBUILDABLE.test(f)) fs.rmSync(path.join(projectDir(p.id), f), { recursive: true, force: true });
        if (p.clips) for (const c of p.clips) delete c.emojiPicks;
      }
      for (const dir of [path.join(DATA_DIR, 'uploads'), TOOLS_DIR]) for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { recursive: true, force: true });
    } else if (what === 'models') {
      fs.rmSync(path.join(DATA_DIR, 'models'), { recursive: true, force: true });
      fs.mkdirSync(path.join(DATA_DIR, 'models'), { recursive: true });
    } else return res.status(400).json({ error: 'Unknown cleanup.' });
    res.json({ ok: true });
  });

  // ---------- Generate AI Voiceover ----------

  app.post(
    '/api/tools/voiceover',
    wrap(async (req, res) => {
      const text = String(req.body?.text || '').trim();
      if (!text) return res.status(400).json({ error: 'Type something to say.' });
      if (text.length > 5000) return res.status(400).json({ error: 'Keep it under 5,000 characters.' });
      const id = newId();
      const out = await synthesize(text, req.body.voiceId || null, path.join(TOOLS_DIR, `voiceover-${id}`));
      res.json({ url: `/tools/${path.basename(out.file)}`, duration: out.duration });
    }),
  );
  app.get('/tools/:file', (req, res) => {
    const file = path.join(TOOLS_DIR, path.basename(req.params.file));
    if (!fs.existsSync(file)) return res.status(404).end();
    if (req.query.download) return res.download(file);
    res.sendFile(file);
  });

  // ---------- Video Transcriber ----------

  app.post(
    '/api/transcribe',
    upload.single('video'),
    wrap(async (req, res) => {
      if (!req.file) return res.status(400).json({ error: 'Upload a video or audio file.' });
      const id = newId();
      const dir = projectDir(id);
      fs.mkdirSync(dir, { recursive: true });
      const file = `source${(path.extname(req.file.originalname) || '.mp4').toLowerCase()}`;
      fs.renameSync(req.file.path, path.join(dir, file));
      let info;
      try {
        info = await probe(path.join(dir, file));
        if (!info.hasAudio) throw new Error('no audio track');
      } catch (err) {
        fs.rmSync(dir, { recursive: true, force: true });
        return res.status(400).json({ error: `Couldn't read audio from that file (${err.message}).` });
      }
      saveProject({ id, type: 'transcript', name: path.parse(req.file.originalname).name.slice(0, 120), createdAt: Date.now(), status: 'queued', progress: 0, source: { file, name: req.file.originalname, ...info } });
      queueTranscription(id);
      res.json(summarize(loadProject(id)));
    }),
  );

  app.get('/api/projects/:id/export.:fmt', (req, res) => {
    const p = loadProject(req.params.id);
    if (!p?.transcript) return res.status(404).json({ error: 'No transcript' });
    const words = p.transcript.words;
    const base = (p.name || 'transcript').replace(/[^\w\- ]+/g, '').trim() || 'transcript';
    if (req.params.fmt === 'txt') {
      res.attachment(`${base}.txt`).type('text/plain').send(paragraphs(words));
    } else if (req.params.fmt === 'srt') {
      res.attachment(`${base}.srt`).type('text/plain').send(toSrt(words));
    } else res.status(400).end();
  });
}

export function paragraphs(words) {
  let out = '';
  words.forEach((w, i) => {
    const prev = words[i - 1];
    if (prev && w.s - prev.e > 1.5) out += '\n\n';
    else if (i) out += ' ';
    out += w.w;
  });
  return out + '\n';
}

export function toSrt(words) {
  const cues = [];
  let cur = [];
  for (const w of words) {
    const text = [...cur, w].map((x) => x.w).join(' ');
    if (cur.length && (text.length > 42 || w.s - cur[cur.length - 1].e > 0.8)) {
      cues.push(cur);
      cur = [];
    }
    cur.push(w);
    if (/[.!?]$/.test(w.w)) {
      cues.push(cur);
      cur = [];
    }
  }
  if (cur.length) cues.push(cur);
  const t = (s) => {
    const ms = Math.round(s * 1000);
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const sec = Math.floor((ms % 60000) / 1000);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
  };
  return cues.map((c, i) => `${i + 1}\n${t(c[0].s)} --> ${t(c[c.length - 1].e)}\n${c.map((x) => x.w).join(' ')}\n`).join('\n');
}
