import fs from 'node:fs';
import path from 'node:path';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { z } from 'zod';
import { generateJSON, llmProvider } from './llm.js';
import { toSegments } from './highlights.js';

const EMOJI_FONT = path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts', 'seguiemj.ttf');
if (fs.existsSync(EMOJI_FONT)) GlobalFonts.registerFromPath(EMOJI_FONT, 'Segoe UI Emoji');

// Keyword → emoji, checked in order. Kept short and obvious so pop-ups feel intentional.
const KEYWORDS = [
  [/\b(money|dollars?|cash|rich|paid|income|\$\d)/i, '💰'],
  [/\b(fire|hot|lit|insane|crazy)\b/i, '🔥'],
  [/\b(laugh|funny|hilarious|joke|lol)\b/i, '😂'],
  [/\b(mind|blew|blown|shocking|unbelievable)\b/i, '🤯'],
  [/\b(love|heart|loved)\b/i, '❤️'],
  [/\b(secret|hidden|nobody)\b/i, '🤫'],
  [/\b(mistake|wrong|fail|failed|bad)\b/i, '❌'],
  [/\b(right|correct|yes|works?)\b/i, '✅'],
  [/\b(think|idea|smart|brain|learn)\b/i, '🧠'],
  [/\b(time|hours?|minutes?|clock|morning)\b/i, '⏰'],
  [/\b(grow|growth|increase|up|doubled)\b/i, '📈'],
  [/\b(lost|drop|down|crash)\b/i, '📉'],
  [/\b(scared|afraid|fear|scary)\b/i, '😱'],
  [/\b(win|won|winner|best|top)\b/i, '🏆'],
  [/\b(stop|never|warning|careful)\b/i, '⚠️'],
  [/\b(question|why|how|what)\b.*\?$/i, '🤔'],
  [/\b(food|eat|drink|water)\b/i, '🍽️'],
  [/\b(walk|run|gym|workout)\b/i, '🏃'],
  [/\b(phone|app|online)\b/i, '📱'],
];

/** Draw one emoji to a transparent PNG (cached by codepoint). */
export function emojiPng(emoji, dir, size = 220) {
  const name = `emoji-${[...emoji].map((c) => c.codePointAt(0).toString(16)).join('-')}-${size}.png`;
  const file = path.join(dir, name);
  if (!fs.existsSync(file)) {
    const c = createCanvas(size, size);
    const g = c.getContext('2d');
    g.font = `${Math.round(size * 0.8)}px "Segoe UI Emoji"`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(emoji, size / 2, size / 2 + size * 0.04);
    fs.writeFileSync(file, c.toBuffer('image/png'));
  }
  return name;
}

/**
 * Choose emoji pop-ups for a clip: [{ emoji, start, end }] relative to clip start.
 * At most one per sentence and none within 3 s of the previous one.
 */
export async function pickEmojis(words, duration) {
  const segs = toSegments(words).filter((s) => s.e - s.s >= 0.8);
  if (!segs.length) return [];
  let chosen = [];
  if (llmProvider()) {
    try {
      const { picks } = await generateJSON({
        effort: 'low',
        schema: z.object({ picks: z.array(z.object({ line: z.number(), emoji: z.string() })) }),
        system: 'You add emoji pop-ups to short-form video captions, like popular TikTok editors. Use well-known single emojis. Only add one where it reinforces the line; skip filler.',
        prompt: `Pick emojis for some of these caption lines (use the line numbers). About one every 4 to 6 seconds.\n${segs.map((s, i) => `${i}: [${s.s.toFixed(1)}s] ${s.text}`).join('\n')}`,
      });
      chosen = picks.filter((p) => segs[p.line] && p.emoji.trim()).map((p) => ({ seg: segs[p.line], emoji: [...p.emoji.trim()].slice(0, 2).join('') }));
    } catch (err) {
      console.warn('[emoji] AI pick failed, using keywords:', err.message);
    }
  }
  if (!chosen.length) {
    for (const seg of segs) {
      const hit = KEYWORDS.find(([re]) => re.test(seg.text));
      if (hit) chosen.push({ seg, emoji: hit[1] });
    }
  }
  const out = [];
  for (const { seg, emoji } of chosen.sort((a, b) => a.seg.s - b.seg.s)) {
    const start = Math.max(0, seg.s);
    if (out.length && start - out[out.length - 1].start < 3) continue;
    out.push({ emoji, start: +start.toFixed(2), end: +Math.min(duration, start + 1.6).toFixed(2) });
  }
  return out.slice(0, 12);
}
