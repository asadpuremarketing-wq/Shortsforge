import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { defaultStory, planScenes, chatPreview, probeMedia } from './stories.js';
import { generateJSON, llmProvider } from './llm.js';
import { generateImage, imagesAvailable } from './images.js';
import { newId, projectDir, loadProject, saveProject } from './store.js';
import { queueStoryRender } from './pipeline.js';

const KINDS = ['video', 'text', 'commentary'];
const KIND_NAMES = { video: 'Video Story', text: 'Text Story', commentary: 'Video Commentary' };
const WRITER = 'You write viral short-form video scripts for TikTok, Reels and YouTube Shorts. Hook in the first line, keep it tight, end with a twist or payoff. Plain spoken English, no hashtags, no stage directions.';

export function registerStoryRoutes(app, upload, wrap) {
  const getStory = (req, res) => {
    const p = loadProject(req.params.id);
    if (!p || p.type !== 'story') {
      res.status(404).json({ error: 'Story not found' });
      return null;
    }
    return p;
  };

  app.post('/api/stories', (req, res) => {
    const kind = KINDS.includes(req.body?.kind) ? req.body.kind : 'video';
    const id = newId();
    fs.mkdirSync(projectDir(id), { recursive: true });
    res.json(saveProject({ id, type: 'story', name: `Untitled ${KIND_NAMES[kind].toLowerCase()}`, createdAt: Date.now(), status: 'draft', progress: 0, story: defaultStory(kind) }));
  });

  app.get('/api/stories/:id', (req, res) => {
    const p = getStory(req, res);
    if (p) res.json(p);
  });

  app.put('/api/stories/:id', (req, res) => {
    const p = getStory(req, res);
    if (!p) return;
    const s = p.story;
    const body = req.body || {};
    if (typeof body.name === 'string') p.name = body.name.slice(0, 120);
    const src = body.story || {};
    const d = defaultStory(s.kind);
    for (const [k, def] of Object.entries(d)) {
      if (['kind', 'background', 'music', 'media', 'messages', 'scenes'].includes(k) || src[k] === undefined) continue;
      if (typeof def === 'number') {
        const n = Number(src[k]);
        if (Number.isFinite(n)) s[k] = n;
      } else if (typeof def === typeof src[k]) s[k] = typeof src[k] === 'string' ? src[k].slice(0, 20000) : src[k];
    }
    if (Array.isArray(src.messages)) s.messages = src.messages.slice(0, 60).map((m) => ({ side: m.side === 'right' ? 'right' : 'left', text: String(m.text || '').slice(0, 500) }));
    if (Array.isArray(src.scenes)) {
      const ids = new Set(s.media.map((m) => m.id));
      s.scenes = src.scenes.slice(0, 80).map((sc) => ({ text: String(sc.text || '').slice(0, 1000), media: ids.has(sc.media) ? sc.media : null, prompt: String(sc.prompt || '').slice(0, 500) }));
    }
    res.json(saveProject(p));
  });

  app.post('/api/stories/:id/upload', upload.single('file'), wrap(async (req, res) => {
    const p = getStory(req, res);
    if (!p) return req.file && fs.rmSync(req.file.path, { force: true });
    if (!req.file) return res.status(400).json({ error: 'Choose a file.' });
    const role = ['background', 'music', 'media'].includes(req.body?.role) ? req.body.role : 'media';
    const dir = projectDir(p.id);
    const file = `${role}-${newId()}${(path.extname(req.file.originalname) || '').toLowerCase()}`;
    fs.renameSync(req.file.path, path.join(dir, file));
    const s = p.story;
    if (role === 'music') {
      if (s.music?.file) fs.rmSync(path.join(dir, s.music.file), { force: true });
      s.music = { file, name: req.file.originalname };
    } else {
      let info;
      try {
        info = await probeMedia(path.join(dir, file));
      } catch (err) {
        fs.rmSync(path.join(dir, file), { force: true });
        return res.status(400).json({ error: `Couldn't read that file (${err.message}).` });
      }
      if (role === 'background') {
        if (info.kind !== 'video') return res.status(400).json({ error: 'The background must be a video.' });
        if (s.background?.file) fs.rmSync(path.join(dir, s.background.file), { force: true });
        s.background = { file, name: req.file.originalname };
      } else {
        s.media.push({ id: newId(), file, name: req.file.originalname, ...info });
      }
    }
    res.json(saveProject(p));
  }));

  app.delete('/api/stories/:id/upload/:role', (req, res) => {
    const p = getStory(req, res);
    if (!p) return;
    const role = req.params.role;
    if (!['background', 'music'].includes(role)) return res.status(400).end();
    if (p.story[role]?.file) fs.rmSync(path.join(projectDir(p.id), p.story[role].file), { force: true });
    p.story[role] = null;
    res.json(saveProject(p));
  });

  app.delete('/api/stories/:id/media/:mid', (req, res) => {
    const p = getStory(req, res);
    if (!p) return;
    const m = p.story.media.find((x) => x.id === req.params.mid);
    if (m) fs.rmSync(path.join(projectDir(p.id), m.file), { force: true });
    p.story.media = p.story.media.filter((x) => x !== m);
    for (const sc of p.story.scenes) if (sc.media === req.params.mid) sc.media = null;
    res.json(saveProject(p));
  });

  app.get('/api/stories/:id/chat-preview.png', (req, res) => {
    const p = getStory(req, res);
    if (p) res.sendFile(chatPreview(projectDir(p.id), p.story));
  });

  // AI writing for each kind.
  app.post('/api/stories/:id/write', wrap(async (req, res) => {
    const p = getStory(req, res);
    if (!p) return;
    if (!llmProvider()) return res.status(400).json({ error: 'Add an Anthropic or OpenAI key in Settings to use AI writing.' });
    const s = p.story;
    const idea = String(req.body?.prompt || '').slice(0, 1000) || 'something surprising and relatable';
    if (s.kind === 'video') {
      const out = await generateJSON({
        system: WRITER,
        schema: z.object({ username: z.string(), title: z.string(), body: z.string() }),
        prompt: `Write a Reddit-style story for a narrated short video about: ${idea}. Give a subreddit name (like r/AskReddit), a post title (a question or hook, under 100 characters), and the story body (180 to 260 words, first person, with a twist at the end).`,
      });
      Object.assign(s, out);
    } else if (s.kind === 'text') {
      const out = await generateJSON({
        system: WRITER,
        schema: z.object({ contactName: z.string(), messages: z.array(z.object({ side: z.enum(['left', 'right']), text: z.string() })) }),
        prompt: `Write a funny or dramatic text-message conversation for a "text story" short video about: ${idea}. "right" is the phone owner, "left" is the contact. 10 to 18 short messages, escalating, with a punchline at the end. Give the contact name as it would appear in the phone.`,
      });
      s.contactName = out.contactName;
      s.messages = out.messages.map((m) => ({ side: m.side, text: m.text.slice(0, 500) }));
    } else {
      const out = await generateJSON({
        system: WRITER,
        schema: z.object({ script: z.string() }),
        prompt: `Write a voiceover script for a commentary / explainer short about: ${idea}. 120 to 180 words. Short sentences.`,
      });
      s.script = out.script;
      s.scenes = [];
    }
    res.json(saveProject(p));
  }));

  // Commentary: split the script into scenes and match media (AI when available).
  app.post('/api/stories/:id/plan', wrap(async (req, res) => {
    const p = getStory(req, res);
    if (!p) return;
    const s = p.story;
    let scenes = planScenes(s);
    if (llmProvider() && scenes.length) {
      try {
        const out = await generateJSON({
          effort: 'low',
          system: 'You are a video editor turning a voiceover script into scenes for a short vertical video.',
          schema: z.object({ scenes: z.array(z.object({ text: z.string(), media: z.number(), prompt: z.string() })) }),
          prompt: `Split this script into scenes of 1 to 2 sentences each, keeping the exact wording in order.
For each scene, pick the best matching media by number (or -1 if none fits), and write a short image-generation prompt describing a vertical visual for it.
Media:
${s.media.map((m, i) => `${i}: ${m.kind} "${m.name}"`).join('\n') || '(none uploaded)'}

Script:
${s.script}`,
        });
        scenes = out.scenes.map((sc) => ({ text: sc.text, media: s.media[sc.media]?.id ?? null, prompt: sc.prompt }));
      } catch (err) {
        console.warn('[plan] AI planning failed, using sentence split:', err.message);
      }
    }
    s.scenes = scenes;
    res.json(saveProject(p));
  }));

  // Commentary: generate an AI image for every scene without media.
  app.post('/api/stories/:id/images', wrap(async (req, res) => {
    const p = getStory(req, res);
    if (!p) return;
    if (!imagesAvailable()) return res.status(400).json({ error: 'AI images need an OpenAI key (add it in Settings).' });
    const s = p.story;
    if (!s.scenes.length) s.scenes = planScenes(s);
    const todo = s.scenes.filter((sc) => !sc.media).slice(0, 12);
    for (const sc of todo) {
      const file = `media-${newId()}.png`;
      await generateImage(`${sc.prompt || sc.text}. Vertical 9:16 composition, cinematic, high detail, no text.`, path.join(projectDir(p.id), file));
      const m = { id: newId(), file, name: `AI: ${(sc.prompt || sc.text).slice(0, 40)}`, kind: 'image', width: 1024, height: 1536 };
      s.media.push(m);
      sc.media = m.id;
    }
    res.json(saveProject(p));
  }));

  app.post('/api/stories/:id/render', (req, res) => {
    const p = getStory(req, res);
    if (!p) return;
    if (['queued', 'processing'].includes(p.status)) return res.status(409).json({ error: 'Already rendering.' });
    queueStoryRender(p.id);
    res.json(loadProject(p.id));
  });
}
