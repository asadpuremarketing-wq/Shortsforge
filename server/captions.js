// Builds .ass subtitle files with word-by-word highlighting, burned in by ffmpeg's libass.

export const CAPTION_STYLES = {
  bold: { label: 'Bold pop', font: 'Arial Black', size: 88, upper: true, maxWords: 3, maxChars: 22, active: '&H0000E5FF&', outline: 7, shadow: 3, box: false },
  green: { label: 'Green highlight', font: 'Arial Black', size: 84, upper: true, maxWords: 3, maxChars: 22, active: '&H0045FF39&', outline: 7, shadow: 3, box: false },
  clean: { label: 'Clean box', font: 'Arial', size: 64, upper: false, maxWords: 7, maxChars: 34, active: null, outline: 14, shadow: 0, box: true, bold: true },
  minimal: { label: 'Minimal', font: 'Segoe UI Black', size: 70, upper: false, maxWords: 4, maxChars: 26, active: '&H00FFFFFF&', outline: 4, shadow: 2, box: false, dim: true },
  none: { label: 'No captions' },
};

const ts = (t) => {
  t = Math.max(0, t);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  const cs = Math.floor((t - Math.floor(t)) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
};

const clean = (s) => s.replace(/[{}\\]/g, '').replace(/\s+/g, ' ');

function groupWords(words, style) {
  const groups = [];
  let cur = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const chars = cur.reduce((n, x) => n + x.w.length + 1, 0) + w.w.length;
    if (cur.length && (cur.length >= style.maxWords || chars > style.maxChars || w.s - cur[cur.length - 1].e > 0.6)) {
      groups.push(cur);
      cur = [];
    }
    cur.push(w);
    if (/[.!?,;:]$/.test(w.w) && cur.length >= 2) {
      groups.push(cur);
      cur = [];
    }
  }
  if (cur.length) groups.push(cur);
  return groups;
}

/**
 * words: [{ w, s, e }] relative to clip start. Returns ASS file contents, or null for "none".
 * position: 'lower' (default) or 'middle' (split-screen seam).
 */
export function buildAss(words, styleKey = 'bold', { position = 'lower', duration } = {}) {
  const style = CAPTION_STYLES[styleKey] || CAPTION_STYLES.bold;
  if (!style.font || !words.length) return null;

  const align = position === 'middle' ? 5 : 2;
  const marginV = position === 'middle' ? 0 : 560;
  const borderStyle = style.box ? 3 : 1;
  const back = style.box ? '&H80000000' : '&H64000000';
  const outlineColour = style.box ? '&H80000000' : '&H00000000';
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,${style.font},${style.size},&H00FFFFFF,&H00FFFFFF,${outlineColour},${back},${style.bold ? -1 : 0},0,0,0,100,100,0,0,${borderStyle},${style.outline},${style.shadow},${align},80,80,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const text = (w) => clean(style.upper ? w.w.toUpperCase() : w.w);
  const groups = groupWords(words, style);
  const lines = [];
  groups.forEach((g, gi) => {
    const next = groups[gi + 1];
    let end = g[g.length - 1].e + 0.25;
    if (next && next[0].s - end < 0.5) end = next[0].s; // no flicker between close groups
    if (next) end = Math.min(end, next[0].s);
    if (duration) end = Math.min(end, duration);
    const pop = '{\\fad(40,0)}';

    if (!style.active) {
      lines.push(`Dialogue: 0,${ts(g[0].s)},${ts(end)},Cap,,0,0,0,,${pop}${g.map(text).join(' ')}`);
      return;
    }
    g.forEach((w, wi) => {
      const s = wi === 0 ? g[0].s : w.s;
      const e = wi < g.length - 1 ? g[wi + 1].s : end;
      if (e <= s) return;
      const body = g
        .map((x, xi) => {
          if (xi === wi) return `{\\c${style.active}\\fscx108\\fscy108}${text(x)}{\\r}`;
          return style.dim ? `{\\alpha&H60&}${text(x)}{\\r}` : text(x);
        })
        .join(' ');
      lines.push(`Dialogue: 0,${ts(s)},${ts(e)},Cap,,0,0,0,,${wi === 0 ? pop : ''}${body}`);
    });
  });
  return header + lines.join('\n') + '\n';
}
