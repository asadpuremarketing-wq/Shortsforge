// Thumbnail maker: a frame (or image) + big outlined text, rendered with canvas.
import fs from 'node:fs';
import path from 'node:path';
import { createCanvas, GlobalFonts, loadImage } from '@napi-rs/canvas';
import { DATA_DIR, FONTS_DIR } from './config.js';
import { ffmpeg, probe } from './ffmpeg.js';
import { listFonts } from './fonts.js';
import { newId, projectDir, loadProject } from './store.js';
import { generateImage, imagesAvailable } from './images.js';

const DIR = path.join(DATA_DIR, 'tools');
const SIZES = { youtube: [1280, 720], short: [1080, 1920] };
let fontsRegistered = false;

function registerFonts() {
  if (fontsRegistered) return;
  for (const f of listFonts()) GlobalFonts.registerFromPath(path.join(FONTS_DIR, f.file), f.family);
  const emoji = path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts', 'seguiemj.ttf');
  if (fs.existsSync(emoji)) GlobalFonts.registerFromPath(emoji, 'Segoe UI Emoji');
  fontsRegistered = true;
}

/** Resolve a source id to a file: an uploaded/AI file in data/tools, or "p:<projectId>:<file>" from a project. */
function sourceFile(src) {
  if (/^p:[A-Za-z0-9]+:[\w.-]+$/.test(src)) {
    const [, pid, file] = src.split(':');
    if (!loadProject(pid)) return null;
    const f = path.join(projectDir(pid), path.basename(file));
    return fs.existsSync(f) ? f : null;
  }
  const f = path.join(DIR, path.basename(src));
  return fs.existsSync(f) ? f : null;
}

async function frameAt(file, t) {
  if (/\.(png|jpe?g|webp)$/i.test(file)) return file;
  const out = path.join(DIR, `frame-${path.basename(file).replace(/\W/g, '')}-${Math.round(t * 10)}.jpg`);
  if (!fs.existsSync(out)) await ffmpeg(['-ss', String(Math.max(0, t)), '-i', file, '-frames:v', '1', '-q:v', '2', out]);
  return out;
}

function wrap(g, text, maxW) {
  const lines = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const test = line ? `${line} ${word}` : word;
      if (g.measureText(test).width > maxW && line) {
        lines.push(line);
        line = word;
      } else line = test;
    }
    if (line) lines.push(line);
  }
  return lines;
}

export async function renderThumbnail(o) {
  registerFonts();
  const [w, h] = SIZES[o.format] || SIZES.youtube;
  const c = createCanvas(w, h);
  const g = c.getContext('2d');
  g.fillStyle = '#111';
  g.fillRect(0, 0, w, h);
  const file = o.src && sourceFile(o.src);
  if (file) {
    const img = await loadImage(fs.readFileSync(await frameAt(file, Number(o.t) || 0)));
    const scale = Math.max(w / img.width, h / img.height) * (Number(o.zoom) || 1);
    const dw = img.width * scale;
    const dh = img.height * scale;
    g.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  }
  // Darken toward the text for readability.
  const dark = Math.min(0.9, Math.max(0, Number(o.dark ?? 0.45)));
  const pos = o.pos || 'bottom';
  const grad = pos === 'top' ? g.createLinearGradient(0, 0, 0, h) : pos === 'bottom' ? g.createLinearGradient(0, h, 0, 0) : null;
  if (grad) {
    grad.addColorStop(0, `rgba(0,0,0,${dark})`);
    grad.addColorStop(0.7, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
  } else g.fillStyle = `rgba(0,0,0,${dark * 0.6})`;
  g.fillRect(0, 0, w, h);

  const text = String(o.text || '').toUpperCase().slice(0, 120);
  if (text.trim()) {
    const size = Math.round((Number(o.size) || 12) * (w / 100));
    const family = o.font || 'Archivo Black';
    g.font = `${size}px "${family}", "Segoe UI Emoji"`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const lines = wrap(g, text, w * 0.9);
    const lh = size * 1.08;
    const blockH = lines.length * lh;
    const y0 = pos === 'top' ? h * 0.06 + lh / 2 : pos === 'center' ? h / 2 - blockH / 2 + lh / 2 : h * 0.94 - blockH + lh / 2;
    lines.forEach((line, i) => {
      const y = y0 + i * lh;
      g.lineJoin = 'round';
      g.lineWidth = size * 0.16;
      g.strokeStyle = o.stroke || '#000000';
      g.strokeText(line, w / 2, y);
      // Every other line in the accent color, a common thumbnail look.
      g.fillStyle = i % 2 === 1 && o.accent ? o.accent : o.color || '#ffffff';
      g.fillText(line, w / 2, y);
    });
  }
  return c.toBuffer('image/png');
}

export function registerThumbnailRoutes(app, upload, wrap) {
  app.post('/api/thumbnail/source', upload.single('file'), wrap(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Choose an image or video.' });
    const name = `thumbsrc-${newId()}${(path.extname(req.file.originalname) || '').toLowerCase()}`;
    fs.renameSync(req.file.path, path.join(DIR, name));
    let duration = 0;
    if (!/\.(png|jpe?g|webp)$/i.test(name)) {
      try {
        duration = (await probe(path.join(DIR, name))).duration;
      } catch {
        fs.rmSync(path.join(DIR, name), { force: true });
        return res.status(400).json({ error: "Couldn't read that file." });
      }
    }
    res.json({ src: name, duration });
  }));

  app.post('/api/thumbnail/ai', wrap(async (req, res) => {
    if (!imagesAvailable()) return res.status(400).json({ error: 'AI images need an OpenAI key (add it in Settings).' });
    const name = `thumbsrc-${newId()}.png`;
    const size = req.body?.format === 'short' ? '1024x1536' : '1536x1024';
    await generateImage(`${String(req.body?.prompt || '').slice(0, 800)}. Eye-catching YouTube thumbnail background, bold composition, no text.`, path.join(DIR, name), size);
    res.json({ src: name, duration: 0 });
  }));

  app.get('/api/thumbnail/render.png', wrap(async (req, res) => {
    const png = await renderThumbnail(req.query);
    if (req.query.download) res.attachment(`thumbnail-${req.query.format === 'short' ? '1080x1920' : '1280x720'}.png`);
    res.type('png').send(png);
  }));
}
