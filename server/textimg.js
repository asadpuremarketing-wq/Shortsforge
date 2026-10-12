// Draws ranking text (title, rank lines, end screen) as transparent PNGs with canvas, so colored
// words AND color emoji work. ffmpeg overlays the PNGs at the right times.
import fs from 'node:fs';
import path from 'node:path';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { FONTS_DIR } from './config.js';
import { listFonts } from './fonts.js';

export const W = 1080;
export const H = 1920;
const SCALE = W / 360; // editor sizes are "preview pixels" on a 360-wide phone

let registered = false;
function registerFonts() {
  if (registered) return;
  for (const f of listFonts()) GlobalFonts.registerFromPath(path.join(FONTS_DIR, f.file), f.family);
  const emoji = path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts', 'seguiemj.ttf');
  if (fs.existsSync(emoji)) GlobalFonts.registerFromPath(emoji, 'Segoe UI Emoji');
  registered = true;
}

const RUN = /\[c=(#[0-9a-f]{6})\]([\s\S]*?)\[\/c\]/gi;

/** Markup → [{ t, c }] runs with the base color filled in. */
export function parseRuns(markup, base) {
  const s = String(markup || '');
  const runs = [];
  let last = 0;
  for (const m of s.matchAll(RUN)) {
    if (m.index > last) runs.push({ t: s.slice(last, m.index), c: base });
    runs.push({ t: m[2], c: m[1] });
    last = m.index + m[0].length;
  }
  if (last < s.length) runs.push({ t: s.slice(last), c: base });
  return runs;
}

const fontSpec = ({ family, size, bold, italic }) => `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${Math.round(size)}px "${family}", "Segoe UI Emoji"`;

/** Word-wrap colored runs into lines of { t, c, w } pieces (spaces kept as their own pieces). */
function layout(g, runs, maxWidth) {
  const pieces = [];
  for (const r of runs) for (const tok of r.t.split(/(\s+|\n)/)) if (tok) pieces.push({ t: tok, c: r.c });
  const lines = [[]];
  let width = 0;
  for (const p of pieces) {
    if (p.t.includes('\n')) {
      lines.push([]);
      width = 0;
      continue;
    }
    const w = g.measureText(p.t).width;
    const isSpace = !p.t.trim();
    if (!isSpace && width + w > maxWidth && lines[lines.length - 1].some((x) => x.t.trim())) {
      lines.push([]);
      width = 0;
    }
    if (isSpace && !lines[lines.length - 1].length) continue; // no leading spaces
    lines[lines.length - 1].push({ ...p, w });
    width += w;
  }
  // Trim trailing spaces per line.
  for (const line of lines) while (line.length && !line[line.length - 1].t.trim()) line.pop();
  return lines.filter((l, i) => l.length || i < lines.length - 1);
}

/**
 * Draw rich text into a new canvas. Returns { canvas, width, height } where the text block's
 * top edge is at y = pad. align: left | center | right within `boxWidth`.
 */
function drawBlock({ markup, base, family, size, bold, italic, align = 'left', boxWidth, stroke = 0, strokeColor = '#000000', bg = '', lineHeight = 1.2, pad = 0 }) {
  registerFonts();
  const font = fontSpec({ family, size, bold, italic });
  const g0 = createCanvas(10, 10).getContext('2d');
  g0.font = font;
  const lines = layout(g0, parseRuns(markup, base), boxWidth);
  const lh = size * lineHeight;
  const bgPad = bg ? 14 : 0;
  const margin = Math.ceil(stroke + bgPad + 4);
  const height = Math.ceil(lines.length * lh + 2 * margin + pad * 2);
  const c = createCanvas(Math.ceil(boxWidth + 2 * margin), height);
  const g = c.getContext('2d');
  g.font = font;
  g.textBaseline = 'alphabetic';
  g.lineJoin = 'round';
  g.miterLimit = 2;
  lines.forEach((line, i) => {
    const lineW = line.reduce((n, p) => n + p.w, 0);
    let x = margin + (align === 'center' ? (boxWidth - lineW) / 2 : align === 'right' ? boxWidth - lineW : 0);
    const top = margin + pad + i * lh;
    const baseline = top + (lh + size * 0.72) / 2;
    if (bg && lineW > 0) {
      g.fillStyle = bg;
      g.fillRect(x - bgPad, top - bgPad / 2, lineW + 2 * bgPad, lh + bgPad);
    }
    // Outline first (whole line), then fill each colored piece on top.
    if (stroke > 0 && !bg) {
      g.strokeStyle = strokeColor;
      g.lineWidth = stroke * 2;
      let sx = x;
      for (const p of line) {
        g.strokeText(p.t, sx, baseline);
        sx += p.w;
      }
    }
    for (const p of line) {
      g.fillStyle = p.c;
      g.fillText(p.t, x, baseline);
      x += p.w;
    }
  });
  return { canvas: c, margin, height, lines: lines.length, lineHeight: lh };
}

/** Title image placed at the top: returns { file, x, y }. */
export function titleImage(dir, t) {
  const size = t.size * SCALE;
  const boxWidth = W - 96;
  const block = drawBlock({ markup: t.text, base: t.color, family: t.font, size, bold: t.bold, italic: t.italic, align: t.align || 'center', boxWidth, stroke: t.strokeWidth * SCALE, strokeColor: t.strokeColor, bg: t.bg });
  const file = 'ovl-title.png';
  fs.writeFileSync(path.join(dir, file), block.canvas.toBuffer('image/png'));
  return { file, x: 48 - block.margin, y: Math.round(t.y * H) - block.margin };
}

/** One line of the rank list ("3." or "3. Label 🔥"): returns { file, x, y }. */
export function rankLineImage(dir, r, i, withLabel) {
  const k = r.ranks;
  const item = r.items[i];
  const size = k.size * SCALE;
  const lineH = Math.round(size * 1.45);
  const labelColor = item.color || k.labelColor;
  const number = `[c=${k.numberColor}]${i + 1}.[/c]`;
  const markup = withLabel && item.label ? `${number} ${item.label}` : number;
  const block = drawBlock({ markup, base: labelColor, family: item.font || k.font, size, boxWidth: W - Math.round(k.x * W) - 20, stroke: k.strokeWidth * SCALE, strokeColor: k.strokeColor || '#000000', lineHeight: 1.45 });
  const file = `ovl-rank${i + 1}${withLabel ? 'L' : ''}.png`;
  fs.writeFileSync(path.join(dir, file), block.canvas.toBuffer('image/png'));
  return { file, x: Math.round(k.x * W) - block.margin, y: Math.round(k.y * H) + i * lineH - block.margin };
}

/** Full-frame end screen: darkened background + centered text. */
export function endImage(dir, r) {
  const x = r.extras;
  const block = drawBlock({ markup: x.endText, base: x.endColor || '#ffffff', family: r.title.font, size: 96, align: 'center', boxWidth: W - 160, stroke: 8, strokeColor: '#000000' });
  const c = createCanvas(W, H);
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.fillRect(0, 0, W, H);
  g.drawImage(block.canvas, (W - block.canvas.width) / 2, (H - block.canvas.height) / 2);
  const file = 'ovl-end.png';
  fs.writeFileSync(path.join(dir, file), c.toBuffer('image/png'));
  return { file, x: 0, y: 0 };
}
