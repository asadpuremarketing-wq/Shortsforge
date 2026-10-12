// Story-style videos: Video Story (Reddit-style narration), Text Story (chat), Video Commentary (script → scenes).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createCanvas, GlobalFonts, loadImage } from '@napi-rs/canvas';
import { ffmpeg, ffmpegWithProgress, probe } from './ffmpeg.js';
import { buildAss } from './captions.js';
import { synthesize } from './tts.js';
import { videoCodecArgs } from './encoder.js';

const W = 1080;
const H = 1920;
const WIN_FONTS = path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts');
for (const [file, family] of [['segoeui.ttf', 'Segoe UI'], ['segoeuib.ttf', 'Segoe UI Bold'], ['seguiemj.ttf', 'Segoe UI Emoji']]) {
  const f = path.join(WIN_FONTS, file);
  if (fs.existsSync(f)) GlobalFonts.registerFromPath(f, family);
}
const FONT = '"Segoe UI", "Segoe UI Emoji", sans-serif';
const FONT_BOLD = '"Segoe UI Bold", "Segoe UI Emoji", sans-serif';

export function defaultStory(kind) {
  const common = { voiceId: '', captionStyle: 'bold', background: null, musicVolume: 0.12, music: null };
  if (kind === 'text') {
    return {
      kind,
      ...common,
      contactName: 'Mom',
      theme: 'dark',
      readAloud: true,
      voiceLeft: '',
      voiceRight: '',
      messages: [
        { side: 'left', text: 'Why is there a llama in the backyard??' },
        { side: 'right', text: "I can explain" },
        { side: 'left', text: 'You have 10 seconds.' },
      ],
    };
  }
  if (kind === 'commentary') return { kind, ...common, script: '', scenes: [], media: [] };
  return { kind: 'video', ...common, username: 'r/AskReddit', title: 'What is the strangest thing that happened at your job?', body: '' };
}

// ---------- Shared helpers ----------

/** Background: the uploaded clip (looped, cropped to 9:16) or an animated gradient. */
function backgroundInput(dir, story, duration) {
  if (story.background?.file && fs.existsSync(path.join(dir, story.background.file))) {
    return { args: ['-stream_loop', '-1', '-i', story.background.file], filter: (i) => `[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=30` };
  }
  return {
    args: ['-f', 'lavfi', '-i', `gradients=s=${W}x${H}:r=30:d=${duration.toFixed(2)}:speed=0.012:c0=0x1d2b6b:c1=0x5b2a86:c2=0x0b5e7a:c3=0x1a1a40:nb_colors=4`],
    filter: (i) => `[${i}:v]setsar=1`,
  };
}

const splitSentences = (text) => text.replace(/\s+/g, ' ').trim().split(/(?<=[.!?…])\s+(?=[A-Z0-9"'“(])/).filter(Boolean);

/** TTS for long text: chunked (APIs cap request size), joined, with word timings across the whole thing. */
export async function synthesizeLong(text, voiceId, dir, base) {
  const key = crypto.createHash('sha1').update(`${voiceId}|${text}`).digest('hex').slice(0, 12);
  const meta = path.join(dir, `${base}-${key}.json`);
  if (fs.existsSync(meta)) {
    const c = JSON.parse(fs.readFileSync(meta, 'utf8'));
    if (fs.existsSync(path.join(dir, c.file))) return { ...c, file: path.join(dir, c.file) };
  }
  const chunks = [];
  let cur = '';
  for (const s of splitSentences(text)) {
    if (cur && (cur + ' ' + s).length > 2500) {
      chunks.push(cur);
      cur = s;
    } else cur = cur ? `${cur} ${s}` : s;
  }
  if (cur) chunks.push(cur);
  const parts = [];
  for (const [i, chunk] of chunks.entries()) parts.push(await synthesize(chunk, voiceId || null, path.join(dir, `${base}-${key}-part${i}`)));
  const out = path.join(dir, `${base}-${key}.m4a`);
  if (parts.length === 1) await ffmpeg(['-i', parts[0].file, '-ar', '48000', '-ac', '2', '-c:a', 'aac', '-b:a', '192k', out]);
  else {
    const inputs = parts.flatMap((p) => ['-i', p.file]);
    const filter = parts.map((_, i) => `[${i}:a]aresample=48000,aformat=channel_layouts=stereo[a${i}]`).join(';') + ';' + parts.map((_, i) => `[a${i}]`).join('') + `concat=n=${parts.length}:v=0:a=1[out]`;
    await ffmpeg([...inputs, '-filter_complex', filter, '-map', '[out]', '-c:a', 'aac', '-b:a', '192k', out]);
  }
  const words = [];
  let offset = 0;
  for (const p of parts) {
    words.push(...p.words.map((w) => ({ w: w.w, s: w.s + offset, e: w.e + offset })));
    offset += p.duration;
    fs.rmSync(p.file, { force: true });
  }
  const result = { file: path.basename(out), duration: offset, words };
  fs.writeFileSync(meta, JSON.stringify(result));
  return { ...result, file: out };
}

function wrapLines(g, text, maxWidth) {
  const lines = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const test = line ? `${line} ${word}` : word;
      if (g.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else line = test;
    }
    lines.push(line);
  }
  return lines;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

async function musicMix(dir, story, total, inputs, mixLabels, nextIdx) {
  if (!story.music?.file || !fs.existsSync(path.join(dir, story.music.file))) return { filters: [], next: nextIdx };
  inputs.push('-stream_loop', '-1', '-i', story.music.file);
  const vol = Math.min(1, Math.max(0, Number(story.musicVolume) || 0.12));
  mixLabels.push('[mus]');
  return {
    filters: [`[${nextIdx}:a]aresample=48000,aformat=channel_layouts=stereo,volume=${vol},atrim=0:${total.toFixed(2)},afade=t=out:st=${Math.max(0, total - 1.5).toFixed(2)}:d=1.5[mus]`],
    next: nextIdx + 1,
  };
}

async function finish(dir, outName, total) {
  const thumb = outName.replace(/\.mp4$/, '-thumb.jpg');
  await ffmpeg(['-ss', String(Math.min(1.5, total / 2)), '-i', outName, '-frames:v', '1', '-vf', 'scale=360:-2', '-q:v', '4', thumb], { cwd: dir });
  return { file: outName, thumb, duration: +total.toFixed(2) };
}

// ---------- Video Story ----------

function titleCard(story, file) {
  const cw = 920;
  const g0 = createCanvas(cw, 10).getContext('2d');
  g0.font = `56px ${FONT_BOLD}`;
  const lines = wrapLines(g0, story.title, cw - 96);
  const ch = 190 + lines.length * 70 + 70;
  const c = createCanvas(cw, ch);
  const g = c.getContext('2d');
  roundRect(g, 0, 0, cw, ch, 40);
  g.fillStyle = '#ffffff';
  g.fill();
  g.fillStyle = '#ff4500';
  g.beginPath();
  g.arc(88, 92, 44, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#fff';
  g.font = `48px ${FONT_BOLD}`;
  g.textAlign = 'center';
  g.fillText('r/', 88, 108);
  g.textAlign = 'left';
  g.fillStyle = '#1a1a1b';
  g.font = `40px ${FONT_BOLD}`;
  g.fillText(story.username || 'r/stories', 152, 84);
  g.fillStyle = '#7c7c7c';
  g.font = `32px ${FONT}`;
  g.fillText('🏆 ❤️ 🔥  · 12h', 152, 128);
  g.fillStyle = '#1a1a1b';
  g.font = `56px ${FONT_BOLD}`;
  lines.forEach((l, i) => g.fillText(l, 48, 230 + i * 70));
  g.fillStyle = '#7c7c7c';
  g.font = `34px ${FONT}`;
  g.fillText('⬆ 99+     💬 99+     ↗ Share', 48, ch - 44);
  fs.writeFileSync(file, c.toBuffer('image/png'));
  return { w: cw, h: ch };
}

async function renderVideoStory(dir, story, onProgress) {
  if (!story.body?.trim()) throw new Error('Write the story first (or have AI write it).');
  onProgress(0.05, 'Generating voice');
  const titleVo = await synthesizeLong(story.title, story.voiceId, dir, 'vo-title');
  const bodyVo = await synthesizeLong(story.body, story.voiceId, dir, 'vo-body');
  const gap = 0.35;
  const bodyStart = titleVo.duration + gap;
  const total = bodyStart + bodyVo.duration + 0.6;

  const card = titleCard(story, path.join(dir, 'title-card.png'));
  const bg = backgroundInput(dir, story, total);
  const inputs = [...bg.args, '-loop', '1', '-t', (bodyStart + 0.3).toFixed(2), '-i', 'title-card.png', '-i', titleVo.file, '-i', bodyVo.file];
  const words = bodyVo.words.map((w) => ({ w: w.w, s: w.s + bodyStart, e: w.e + bodyStart }));
  const ass = buildAss(words, story.captionStyle || 'bold', { position: 'middle', duration: total });
  if (ass) fs.writeFileSync(path.join(dir, 'story.ass'), ass, 'utf8');
  const filters = [
    `${bg.filter(0)}[bg]`,
    `[1:v]format=rgba,fade=t=in:st=0:d=0.25:alpha=1,fade=t=out:st=${(bodyStart - 0.1).toFixed(2)}:d=0.3:alpha=1[card]`,
    `[bg][card]overlay=x=(W-w)/2:y=(H-h)/2:eof_action=pass[v0]`,
    `[v0]${ass ? 'subtitles=story.ass:fontsdir=../../fonts,' : ''}format=yuv420p[vout]`,
    `[2:a]aresample=48000,aformat=channel_layouts=stereo[t]`,
    `[3:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${Math.round(bodyStart * 1000)}|${Math.round(bodyStart * 1000)}[b]`,
  ];
  const mix = ['[t]', '[b]'];
  const m = await musicMix(dir, story, total, inputs, mix, 4);
  filters.push(...m.filters, `${mix.join('')}amix=inputs=${mix.length}:duration=longest:normalize=0,apad=whole_dur=${total.toFixed(2)}[aout]`);
  void card;
  await ffmpegWithProgress(
    [...inputs, '-filter_complex', filters.join(';'), '-map', '[vout]', '-map', '[aout]', '-t', total.toFixed(2), ...(await videoCodecArgs()), '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', 'story.mp4'],
    total,
    (f) => onProgress(0.2 + f * 0.8, 'Rendering'),
    { cwd: dir },
  );
  return finish(dir, 'story.mp4', total);
}

// ---------- Text Story (chat) ----------

const CHAT_W = 960;
function chatImage(story, upto, file) {
  const dark = story.theme !== 'light';
  const pal = dark
    ? { bg: '#000000', head: '#1c1c1e', text: '#ffffff', sub: '#8e8e93', left: '#26252a', leftText: '#ffffff' }
    : { bg: '#ffffff', head: '#f6f6f6', text: '#000000', sub: '#8e8e93', left: '#e9e9eb', leftText: '#000000' };
  const font = 44;
  const pad = 30;
  const maxBubble = CHAT_W * 0.68;
  const g0 = createCanvas(CHAT_W, 10).getContext('2d');
  g0.font = `${font}px ${FONT}`;
  const bubbles = story.messages.slice(0, upto + 1).map((m) => {
    const lines = wrapLines(g0, m.text, maxBubble - 2 * pad);
    const w = Math.min(maxBubble, Math.max(...lines.map((l) => g0.measureText(l).width)) + 2 * pad);
    return { ...m, lines, w, h: lines.length * (font * 1.25) + 2 * 22 };
  });
  const headH = 170;
  const maxBody = 1080;
  // Show the newest messages that fit.
  let used = 0;
  let first = bubbles.length;
  while (first > 0 && used + bubbles[first - 1].h + 14 <= maxBody) used += bubbles[--first].h + 14;
  const shown = bubbles.slice(first);
  const ch = headH + used + 50;
  const c = createCanvas(CHAT_W, ch);
  const g = c.getContext('2d');
  roundRect(g, 0, 0, CHAT_W, ch, 44);
  g.fillStyle = pal.bg;
  g.fill();
  g.save();
  roundRect(g, 0, 0, CHAT_W, ch, 44);
  g.clip();
  g.fillStyle = pal.head;
  g.fillRect(0, 0, CHAT_W, headH);
  g.restore();
  g.fillStyle = '#9aa0ac';
  g.beginPath();
  g.arc(CHAT_W / 2, 62, 40, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#fff';
  g.font = `40px ${FONT_BOLD}`;
  g.textAlign = 'center';
  g.fillText((story.contactName || '?').trim().charAt(0).toUpperCase(), CHAT_W / 2, 76);
  g.fillStyle = pal.text;
  g.font = `34px ${FONT}`;
  g.fillText(`${story.contactName || 'Unknown'} ›`, CHAT_W / 2, 145);
  g.textAlign = 'left';
  let y = headH + 30;
  for (const b of shown) {
    const right = b.side === 'right';
    const x = right ? CHAT_W - 28 - b.w : 28;
    roundRect(g, x, y, b.w, b.h, 40);
    g.fillStyle = right ? '#0b84ff' : pal.left;
    g.fill();
    g.fillStyle = right ? '#ffffff' : pal.leftText;
    g.font = `${font}px ${FONT}`;
    b.lines.forEach((l, i) => g.fillText(l, x + pad, y + 22 + font + i * font * 1.25 - 8));
    y += b.h + 14;
  }
  fs.writeFileSync(file, c.toBuffer('image/png'));
}

async function renderTextStory(dir, story, onProgress) {
  const msgs = story.messages.filter((m) => m.text?.trim());
  if (!msgs.length) throw new Error('Add some messages first.');
  story = { ...story, messages: msgs };
  // Timing: read aloud (each side its own voice) or a reading pace.
  const timeline = [];
  let t = 0.4;
  for (const [i, m] of msgs.entries()) {
    onProgress((i / msgs.length) * 0.3, 'Generating voices');
    let audio = null;
    let dur = Math.min(5, Math.max(1.2, 0.7 + m.text.length * 0.055));
    if (story.readAloud) {
      audio = await synthesizeLong(m.text, m.side === 'right' ? story.voiceRight || story.voiceId : story.voiceLeft || story.voiceId, dir, `msg${i}`);
      dur = audio.duration + 0.4;
    }
    timeline.push({ start: t, end: t + dur, audio });
    t += dur;
  }
  const total = t + 1;
  onProgress(0.32, 'Drawing chat');
  msgs.forEach((_, i) => chatImage(story, i, path.join(dir, `chat-${i}.png`)));

  const bg = backgroundInput(dir, story, total);
  const inputs = [...bg.args];
  const filters = [`${bg.filter(0)}[bg0]`];
  let next = 1;
  let cur = 'bg0';
  timeline.forEach((seg, i) => {
    const end = i === timeline.length - 1 ? total : seg.end;
    inputs.push('-loop', '1', '-t', total.toFixed(2), '-i', `chat-${i}.png`);
    filters.push(`[${cur}][${next}:v]overlay=x=(W-w)/2:y=150:enable='between(t,${seg.start.toFixed(2)},${end.toFixed(2)})'[c${i}]`);
    cur = `c${i}`;
    next++;
  });
  filters.push(`[${cur}]format=yuv420p[vout]`);
  // Audio: voices plus a soft "pop" per message.
  inputs.push('-f', 'lavfi', '-i', 'sine=f=1100:d=0.07,afade=t=out:st=0.02:d=0.05,volume=0.35');
  const popIdx = next++;
  filters.push(`[${popIdx}:a]aresample=48000,aformat=channel_layouts=stereo,asplit=${timeline.length}${timeline.map((_, i) => `[p${i}]`).join('')}`);
  const mix = [];
  timeline.forEach((seg, i) => {
    const d = Math.round(seg.start * 1000);
    filters.push(`[p${i}]adelay=${d}|${d}[pd${i}]`);
    mix.push(`[pd${i}]`);
    if (seg.audio) {
      inputs.push('-i', seg.audio.file);
      const vd = Math.round((seg.start + 0.15) * 1000);
      filters.push(`[${next}:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${vd}|${vd}[v${i}]`);
      mix.push(`[v${i}]`);
      next++;
    }
  });
  const m = await musicMix(dir, story, total, inputs, mix, next);
  filters.push(...m.filters, `${mix.join('')}amix=inputs=${mix.length}:duration=longest:normalize=0,apad=whole_dur=${total.toFixed(2)}[aout]`);
  await ffmpegWithProgress(
    [...inputs, '-filter_complex', filters.join(';'), '-map', '[vout]', '-map', '[aout]', '-t', total.toFixed(2), ...(await videoCodecArgs()), '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', 'text-story.mp4'],
    total,
    (f) => onProgress(0.35 + f * 0.65, 'Rendering'),
    { cwd: dir },
  );
  msgs.forEach((_, i) => fs.rmSync(path.join(dir, `chat-${i}.png`), { force: true }));
  return finish(dir, 'text-story.mp4', total);
}

/** Preview image of the chat (all messages) for the editor. */
export function chatPreview(dir, story) {
  const msgs = story.messages.filter((m) => m.text?.trim());
  const file = path.join(dir, 'chat-preview.png');
  chatImage({ ...story, messages: msgs.length ? msgs : [{ side: 'left', text: '…' }] }, Math.max(0, msgs.length - 1), file);
  return file;
}

// ---------- Video Commentary ----------

/** Split the script into scenes (1–2 sentences) and give each a media item, round-robin, unless already assigned. */
export function planScenes(story) {
  const sentences = splitSentences(story.script || '');
  const scenes = [];
  for (let i = 0; i < sentences.length; i += 2) scenes.push({ text: sentences.slice(i, i + 2).join(' '), media: null, prompt: '' });
  return scenes.map((s, i) => ({ ...s, media: story.media.length ? story.media[i % story.media.length].id : null }));
}

async function renderCommentary(dir, story, onProgress) {
  const scenes = (story.scenes?.length ? story.scenes : planScenes(story)).filter((s) => s.text.trim());
  if (!scenes.length) throw new Error('Write a script first.');
  if (!story.media.length) throw new Error('Add at least one video or image (or generate images with AI).');
  onProgress(0.05, 'Generating voice');
  const script = scenes.map((s) => s.text.trim()).join(' ');
  const vo = await synthesizeLong(script, story.voiceId, dir, 'vo-script');
  // Scene boundaries: count words through the narration's word timings.
  let wi = 0;
  const bounds = scenes.map((s, i) => {
    const n = s.text.trim().split(/\s+/).length;
    const start = i === 0 ? 0 : vo.words[Math.min(wi, vo.words.length - 1)]?.s ?? 0;
    wi += n;
    return start;
  });
  const total = vo.duration + 0.6;
  const codec = await videoCodecArgs();
  const segs = [];
  for (const [i, s] of scenes.entries()) {
    const start = bounds[i];
    const end = i + 1 < scenes.length ? bounds[i + 1] : total;
    const len = Math.max(0.5, end - start);
    const media = story.media.find((m) => m.id === s.media) || story.media[i % story.media.length];
    const seg = `scene-${i}.mp4`;
    const frames = Math.round(len * 30);
    let args;
    if (media.kind === 'image') {
      // Slow Ken Burns zoom; alternate zoom-in and zoom-out per scene.
      const z = i % 2 ? `1.12-0.12*on/${frames}` : `1+0.12*on/${frames}`;
      args = ['-loop', '1', '-t', len.toFixed(2), '-i', media.file, '-vf', `scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,crop=${W * 2}:${H * 2},zoompan=z='${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H}:fps=30,setsar=1,format=yuv420p`];
    } else {
      args = ['-stream_loop', '-1', '-i', media.file, '-vf', `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=30,format=yuv420p`];
    }
    await ffmpegWithProgress([...args, '-an', '-t', len.toFixed(3), ...codec, seg], len, (f) => onProgress(0.15 + ((i + f) / scenes.length) * 0.55, `Building scene ${i + 1} of ${scenes.length}`), { cwd: dir });
    segs.push(seg);
  }
  fs.writeFileSync(path.join(dir, 'scenes.txt'), segs.map((s) => `file '${s}'`).join('\n'));
  await ffmpeg(['-f', 'concat', '-safe', '0', '-i', 'scenes.txt', '-c', 'copy', 'scenes.mp4'], { cwd: dir });
  const ass = buildAss(vo.words, story.captionStyle || 'bold', { position: 'lower', duration: total });
  if (ass) fs.writeFileSync(path.join(dir, 'commentary.ass'), ass, 'utf8');
  const inputs = ['-i', 'scenes.mp4', '-i', vo.file];
  const mix = ['[vo]'];
  const filters = [`[0:v]${ass ? 'subtitles=commentary.ass:fontsdir=../../fonts,' : ''}format=yuv420p[vout]`, `[1:a]aresample=48000,aformat=channel_layouts=stereo[vo]`];
  const m = await musicMix(dir, story, total, inputs, mix, 2);
  filters.push(...m.filters, `${mix.join('')}amix=inputs=${mix.length}:duration=longest:normalize=0,apad=whole_dur=${total.toFixed(2)}[aout]`);
  await ffmpegWithProgress(
    [...inputs, '-filter_complex', filters.join(';'), '-map', '[vout]', '-map', '[aout]', '-t', total.toFixed(2), ...codec, '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', 'commentary.mp4'],
    total,
    (f) => onProgress(0.72 + f * 0.28, 'Adding voice and captions'),
    { cwd: dir },
  );
  for (const s of [...segs, 'scenes.txt', 'scenes.mp4']) fs.rmSync(path.join(dir, s), { force: true });
  return finish(dir, 'commentary.mp4', total);
}

export async function renderStory(dir, story, onProgress) {
  if (story.kind === 'text') return renderTextStory(dir, story, onProgress);
  if (story.kind === 'commentary') return renderCommentary(dir, story, onProgress);
  return renderVideoStory(dir, story, onProgress);
}

export async function probeMedia(file) {
  const ext = path.extname(file).toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
    const img = await loadImage(fs.readFileSync(file));
    return { kind: 'image', width: img.width, height: img.height };
  }
  const info = await probe(file);
  if (!info.hasVideo) throw new Error('No video in that file.');
  return { kind: 'video', width: info.width, height: info.height, duration: info.duration };
}
