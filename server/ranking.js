import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ffmpeg, ffmpegWithProgress } from './ffmpeg.js';
import { buildAss } from './captions.js';
import { transcribe } from './transcribe.js';
import { synthesize } from './tts.js';
import { bestWindow } from './analyze.js';
import { videoCodecArgs } from './encoder.js';

const W = 1080;
const H = 1920;
// Sizes in the editor are "preview pixels" on a 360-wide phone; the output is 3× that.
const SCALE = W / 360;
export const MAX_RANKS = 7;

export function defaultRanking() {
  return {
    title: { text: 'Ranking Best Moments', font: 'Archivo Black', size: 28, bold: false, italic: false, align: 'center', color: '#ffffff', bg: '', strokeColor: '#000000', strokeWidth: 2, y: 0.05 },
    general: { videoHeight: 80, background: '#000000', fit: 'cover', captions: false, captionStyle: 'bold', targetLength: 60 },
    ranks: { show: true, font: 'Archivo Black', size: 22, numberColor: '#ffffff', labelColor: '#ffe500', strokeColor: '#000000', popColor: '#ffe500', strokeWidth: 2, x: 0.04, y: 0.2 },
    playback: { custom: false, order: 'countdown' },
    extras: { rankPop: true, transition: 'flash', sfx: true, announce: false, announceVoice: '', musicVolume: 0.15, watermark: '', markColor: '#ffffff', endText: '', endColor: '#ffffff', endDuration: 2.5 },
    music: null,
    items: [],
  };
}

/** The order clips play in: by default a countdown (last rank first, #1 last). */
export function playOrder(r) {
  const idx = r.items.map((_, i) => i);
  const order = r.playback.custom ? r.playback.order : 'countdown';
  return order === 'ascending' ? idx : idx.reverse();
}

const assColor = (hex, alpha = '00') => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  const v = m ? m[1] : 'ffffff';
  return `&H${alpha}${v.slice(4, 6)}${v.slice(2, 4)}${v.slice(0, 2)}`.toUpperCase();
};
const ts = (t) => {
  t = Math.max(0, t);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  const cs = Math.floor((t - Math.floor(t)) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
};
const clean = (s) => String(s || '').replace(/[{}\\]/g, '').replace(/\r?\n/g, '\\N');
// Rich text: the editor stores per-word colors inline as [c=#rrggbb]words[/c]. Text outside a
// color run uses the field's own color, so old plain-text projects render unchanged.
const RUN = /\[c=(#[0-9a-f]{6})\]([\s\S]*?)\[\/c\]/gi;

/** Plain text without color markup (for AI prompts, file names, YouTube titles). */
export function plainText(text) {
  return String(text || '').replace(RUN, '$2');
}

/** Rich text → ASS text with color tags; `color` is the field's base color. */
export function richToAss(text, color) {
  let out = '';
  let last = 0;
  const s = String(text || '');
  for (const m of s.matchAll(RUN)) {
    out += clean(s.slice(last, m.index));
    out += `{\\c${assColor(m[1])}}${clean(m[2])}{\\c${assColor(color)}}`;
    last = m.index + m[0].length;
  }
  return out + clean(s.slice(last));
}
const FULL_RECT = `m 0 0 l ${W} 0 ${W} ${H} 0 ${H}`;

/** Title, rank list, rank pop-ups, transitions, watermark and end screen as one subtitle layer. */
export function overlayAss(r, segments, bodyLen, endLen) {
  const t = r.title;
  const k = r.ranks;
  const x = { ...defaultRanking().extras, ...r.extras };
  const total = bodyLen + endLen;
  const titleBox = Boolean(t.bg);
  const styles = [
    `Style: Title,${t.font},${Math.round(t.size * SCALE)},${assColor(t.color)},${assColor(t.color)},${assColor(titleBox ? t.bg : t.strokeColor)},&H00000000,${t.bold ? -1 : 0},${t.italic ? -1 : 0},0,0,100,100,0,0,${titleBox ? 3 : 1},${titleBox ? 14 : Math.round(t.strokeWidth * SCALE)},0,8,48,48,0,1`,
    `Style: Rank,${k.font},${Math.round(k.size * SCALE)},${assColor(k.numberColor)},${assColor(k.numberColor)},${assColor(k.strokeColor || '#000000')},&H00000000,0,0,0,0,100,100,0,0,1,${Math.round(k.strokeWidth * SCALE)},0,7,0,0,0,1`,
    `Style: Pop,${k.font},240,${assColor(k.popColor || k.labelColor)},${assColor(k.popColor || k.labelColor)},&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,12,6,5,0,0,0,1`,
    `Style: End,${t.font},96,${assColor(x.endColor)},${assColor(x.endColor)},&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,8,0,5,80,80,0,1`,
    `Style: Mark,Arial,40,${assColor(x.markColor)},${assColor(x.markColor)},&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,2,0,3,0,0,0,1`,
    `Style: Fx,Arial,20,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1`,
  ];
  const lines = [];
  if (t.text?.trim()) {
    const an = { left: 7, center: 8, right: 9 }[t.align] || 8;
    const px = { 7: 48, 8: W / 2, 9: W - 48 }[an];
    lines.push(`Dialogue: 2,${ts(0)},${ts(total)},Title,,0,0,0,,{\\an${an}\\pos(${px},${Math.round(t.y * H)})}${richToAss(t.text, t.color)}`);
  }
  if (k.show) {
    const lineH = Math.round(k.size * SCALE * 1.45);
    const px = Math.round(k.x * W);
    r.items.forEach((item, i) => {
      const seg = segments.find((s) => s.index === i);
      if (!seg) return;
      const pos = `{\\an7\\pos(${px},${Math.round(k.y * H) + i * lineH})}`;
      const number = `${i + 1}.`;
      const labelColor = item.color || k.labelColor;
      const label = plainText(item.label).trim() ? richToAss(item.label, labelColor) : '';
      // Number only until this rank plays, then the label appears next to it and stays.
      if (seg.start > 0) lines.push(`Dialogue: 2,${ts(0)},${ts(seg.start)},Rank,,0,0,0,,${pos}${number}`);
      lines.push(`Dialogue: 2,${ts(seg.start)},${ts(total)},Rank,,0,0,0,,${pos}${number}${label ? ` {\\c${assColor(labelColor)}}${label}` : ''}`);
    });
  }
  for (const seg of segments) {
    if (x.rankPop) {
      // Big "#3" that punches in at the start of each rank.
      lines.push(`Dialogue: 3,${ts(seg.start)},${ts(seg.start + 1.1)},Pop,,0,0,0,,{\\an5\\pos(${W / 2},${H / 2})\\fad(60,300)\\fscx60\\fscy60\\t(0,180,\\fscx115\\fscy115)\\t(180,320,\\fscx100\\fscy100)}#${seg.index + 1}`);
    }
    if (seg.start > 0 && x.transition === 'flash') {
      lines.push(`Dialogue: 4,${ts(seg.start)},${ts(seg.start + 0.3)},Fx,,0,0,0,,{\\an7\\pos(0,0)\\p1\\1c&HFFFFFF&\\fad(0,280)}${FULL_RECT}`);
    } else if (seg.start > 0 && x.transition === 'dip') {
      lines.push(`Dialogue: 4,${ts(seg.start - 0.18)},${ts(seg.start + 0.18)},Fx,,0,0,0,,{\\an7\\pos(0,0)\\p1\\1c&H000000&\\fad(170,170)}${FULL_RECT}`);
    }
  }
  if (x.watermark?.trim()) lines.push(`Dialogue: 5,${ts(0)},${ts(total)},Mark,,0,0,0,,{\\an3\\pos(${W - 36},${H - 36})\\alpha&H50&}${clean(x.watermark)}`);
  if (endLen > 0) {
    lines.push(`Dialogue: 6,${ts(bodyLen)},${ts(total)},Fx,,0,0,0,,{\\an7\\pos(0,0)\\p1\\1c&H000000&\\alpha&H40&\\fad(250,0)}${FULL_RECT}`);
    lines.push(`Dialogue: 7,${ts(bodyLen)},${ts(total)},End,,0,0,0,,{\\an5\\pos(${W / 2},${H / 2})\\fad(250,0)}${richToAss(x.endText, x.endColor)}`);
  }
  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
${styles.join('\n')}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${lines.join('\n')}
`;
}

/** A short synthetic whoosh (filtered pink noise with a fast swell), so no sound files need shipping. */
async function makeWhoosh(dir) {
  const file = path.join(dir, 'whoosh.wav');
  if (!fs.existsSync(file)) {
    await ffmpeg(['-f', 'lavfi', '-i', 'anoisesrc=d=0.6:c=pink:a=0.7', '-af', 'highpass=f=350,lowpass=f=5500,afade=t=in:d=0.3:curve=exp,afade=t=out:st=0.3:d=0.3,volume=0.9', '-ar', '48000', '-ac', '2', file]);
  }
  return file;
}

/** "Number 3" voice lines, cached per voice. */
async function announcement(dir, rank, voiceId) {
  const key = crypto.createHash('sha1').update(`${voiceId}|${rank}`).digest('hex').slice(0, 10);
  const meta = path.join(dir, `announce-${key}.json`);
  if (fs.existsSync(meta)) {
    const cached = JSON.parse(fs.readFileSync(meta, 'utf8'));
    if (fs.existsSync(path.join(dir, cached.file))) return { ...cached, file: path.join(dir, cached.file) };
  }
  const out = await synthesize(`Number ${rank}!`, voiceId || null, path.join(dir, `announce-${key}`));
  fs.writeFileSync(meta, JSON.stringify({ ...out, file: path.basename(out.file) }));
  return out;
}

/**
 * Render a ranking project to ranking.mp4. Returns { file, thumb, duration }.
 * onProgress(fraction, step)
 */
export async function renderRanking(dir, project, onProgress) {
  const r = project.ranking;
  const x = { ...defaultRanking().extras, ...r.extras };
  if (!r.items.length) throw new Error('Add at least one video to rank.');
  const pending = r.items.find((it) => it.status !== 'ready');
  if (pending) throw new Error(`Rank ${r.items.indexOf(pending) + 1} isn't ready yet (${pending.status}).`);

  const boxH = Math.round((H * Math.min(100, Math.max(20, r.general.videoHeight))) / 100 / 2) * 2;
  const boxY = Math.round((H - boxH) / 2);
  const fitFilter =
    r.general.fit === 'contain'
      ? `scale=${W}:${boxH}:force_original_aspect_ratio=decrease,setsar=1`
      : `scale=${W}:${boxH}:force_original_aspect_ratio=increase,crop=${W}:${boxH},setsar=1`;
  const bg = /^#[0-9a-f]{6}$/i.test(r.general.background) ? r.general.background.slice(1) : '000000';
  const codec = await videoCodecArgs();

  // 1. Normalize each clip onto the canvas, in play order.
  const order = playOrder(r);
  const segments = [];
  let t = 0;
  const totalLen = order.reduce((n, i) => n + itemLength(r.items[i]), 0);
  for (const [n, i] of order.entries()) {
    const item = r.items[i];
    const len = itemLength(item);
    const segName = `seg-${n}.mp4`;
    const inputs = ['-ss', String(item.trimStart || 0), '-t', len.toFixed(3), '-i', item.file];
    if (!item.hasAudio) inputs.push('-f', 'lavfi', '-t', len.toFixed(3), '-i', 'anullsrc=r=48000:cl=stereo');
    const filter = [
      `color=c=0x${bg}:s=${W}x${H}:r=30:d=${len.toFixed(3)}[bg]`,
      `[0:v]${fitFilter},fps=30[fg]`,
      `[bg][fg]overlay=(W-w)/2:${boxY}+(${boxH}-h)/2:shortest=1,format=yuv420p[v]`,
      // Level every clip to the same loudness (-16 LUFS, the usual target for phone video) so volume doesn't jump between ranks.
      item.hasAudio ? `[0:a]aformat=channel_layouts=stereo,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[a]` : `[1:a]aresample=48000,aformat=channel_layouts=stereo[a]`,
    ].join(';');
    const base = t;
    // Every segment uses identical encoder settings so they can be joined without re-encoding.
    await ffmpegWithProgress(
      [...inputs, '-filter_complex', filter, '-map', '[v]', '-map', '[a]', '-t', len.toFixed(3), ...codec, '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', segName],
      len,
      (f) => onProgress?.(((base + f * len) / totalLen) * 0.65, `Preparing rank ${i + 1}`),
      { cwd: dir },
    );
    segments.push({ index: i, start: t, end: t + len, file: segName });
    t += len;
  }
  const bodyLen = t;
  const endLen = x.endText?.trim() ? Math.min(8, Math.max(1, Number(x.endDuration) || 2.5)) : 0;
  const total = bodyLen + endLen;

  // 2. Join the segments.
  onProgress?.(0.67, 'Joining clips');
  fs.writeFileSync(path.join(dir, 'concat.txt'), segments.map((s) => `file '${s.file}'`).join('\n'));
  await ffmpeg(['-f', 'concat', '-safe', '0', '-i', 'concat.txt', '-c', 'copy', 'body.mp4'], { cwd: dir });

  // 3. Captions (from the clips' own audio) and the overlay layer.
  const vf = [];
  if (endLen) vf.push(`tpad=stop_mode=clone:stop_duration=${endLen.toFixed(2)}`);
  if (r.general.captions) {
    onProgress?.(0.7, 'Transcribing for captions');
    const { words } = await transcribe(path.join(dir, 'body.mp4'), dir, bodyLen, (f) => onProgress?.(0.7 + f * 0.08, 'Transcribing for captions'));
    const ass = buildAss(words, r.general.captionStyle || 'bold', { position: 'lower', duration: bodyLen });
    if (ass) {
      fs.writeFileSync(path.join(dir, 'captions.ass'), ass, 'utf8');
      vf.push('subtitles=captions.ass:fontsdir=../../fonts');
    }
  }
  fs.writeFileSync(path.join(dir, 'overlay.ass'), overlayAss(r, segments, bodyLen, endLen), 'utf8');
  vf.push('subtitles=overlay.ass:fontsdir=../../fonts');

  // 4. Audio: clip audio (ducked under announcements) + announcements + whooshes + music.
  onProgress?.(0.79, 'Mixing audio');
  const inputs = ['-i', 'body.mp4'];
  const af = [];
  const mix = [];
  let next = 1;
  const duckWindows = [];
  if (x.announce) {
    for (const seg of segments) {
      const a = await announcement(dir, seg.index + 1, x.announceVoice);
      inputs.push('-i', a.file);
      const delay = Math.round((seg.start + 0.05) * 1000);
      af.push(`[${next}:a]aresample=48000,aformat=channel_layouts=stereo,volume=1.7,adelay=${delay}|${delay}[ann${next}]`);
      mix.push(`[ann${next}]`);
      duckWindows.push([seg.start, seg.start + a.duration + 0.15]);
      next++;
    }
  }
  const cuts = segments.filter((s) => s.start > 0);
  if (x.sfx && cuts.length) {
    inputs.push('-i', await makeWhoosh(dir));
    af.push(`[${next}:a]asplit=${cuts.length}${cuts.map((_, j) => `[w${j}]`).join('')}`);
    cuts.forEach((seg, j) => {
      const delay = Math.max(0, Math.round((seg.start - 0.3) * 1000));
      af.push(`[w${j}]adelay=${delay}|${delay},volume=0.6[wd${j}]`);
      mix.push(`[wd${j}]`);
    });
    next++;
  }
  if (r.music?.file && fs.existsSync(path.join(dir, r.music.file))) {
    inputs.push('-stream_loop', '-1', '-i', r.music.file);
    const vol = Math.min(1, Math.max(0, Number(x.musicVolume) || 0.15));
    af.push(`[${next}:a]aresample=48000,aformat=channel_layouts=stereo,volume=${vol},atrim=0:${total.toFixed(2)},afade=t=out:st=${Math.max(0, total - 1.5).toFixed(2)}:d=1.5[mus]`);
    mix.push('[mus]');
    next++;
  }
  const duck = duckWindows.length ? `,volume='if(${duckWindows.map(([a, b]) => `between(t,${a.toFixed(2)},${b.toFixed(2)})`).join('+')},0.3,1)':eval=frame` : '';
  af.unshift(`[0:a]apad=whole_dur=${total.toFixed(2)}${duck}[main]`);
  const audioOut = mix.length ? `[main]${mix.join('')}amix=inputs=${mix.length + 1}:duration=first:normalize=0[aout]` : '[main]anull[aout]';
  af.push(audioOut);

  // 5. Final render.
  const filter = `[0:v]${vf.join(',')}[vout];${af.join(';')}`;
  await ffmpegWithProgress(
    [...inputs, '-filter_complex', filter, '-map', '[vout]', '-map', '[aout]', '-t', total.toFixed(2), ...codec, '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', 'ranking.tmp.mp4'],
    total,
    (f) => onProgress?.(0.8 + f * 0.2, 'Adding title, ranks and effects'),
    { cwd: dir },
  );
  fs.renameSync(path.join(dir, 'ranking.tmp.mp4'), path.join(dir, 'ranking.mp4'));
  await ffmpeg(['-ss', String(Math.min(1.5, total / 2)), '-i', 'ranking.mp4', '-frames:v', '1', '-vf', 'scale=360:-2', '-q:v', '4', 'ranking-thumb.jpg'], { cwd: dir });
  for (const s of segments) fs.rmSync(path.join(dir, s.file), { force: true });
  for (const f of ['body.mp4', 'concat.txt', 'whoosh.wav']) fs.rmSync(path.join(dir, f), { force: true });
  return { file: 'ranking.mp4', thumb: 'ranking-thumb.jpg', duration: +total.toFixed(2) };
}

/**
 * Split the target length across the ranks and trim every auto-trimmed item to its best moment.
 * Short clips are used whole; the time they don't need goes to the longer clips.
 */
export function applyAutoTrim(r) {
  const items = r.items.filter((it) => it.status === 'ready');
  if (!items.length) return;
  let budget = Math.max(5, r.general.targetLength || 60);
  // Manually trimmed items keep their length and use up part of the budget.
  for (const it of items) if (it.auto === false) budget -= itemLength(it);
  const auto = items.filter((it) => it.auto !== false).sort((a, b) => a.duration - b.duration);
  let remaining = auto.length;
  for (const it of auto) {
    const share = Math.max(3, budget / remaining);
    const win = bestWindow(it.analysis?.bins, it.analysis?.binSec || 0.5, it.duration, share, it.ai?.peak);
    it.trimStart = win.start;
    it.trimEnd = win.end;
    budget -= win.end - win.start;
    remaining--;
  }
}

export function itemLength(item) {
  const start = item.trimStart || 0;
  const end = item.trimEnd && item.trimEnd > start ? Math.min(item.trimEnd, item.duration) : item.duration;
  return Math.max(0.5, end - start);
}
