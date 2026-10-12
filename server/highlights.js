import { z } from 'zod';
import { generateJSON, llmProvider } from './llm.js';

/** Group words into sentence-like segments: split on end punctuation, long pauses, or ~25 words. */
export function toSegments(words) {
  const segs = [];
  let cur = [];
  const flush = () => {
    if (cur.length) segs.push({ s: cur[0].s, e: cur[cur.length - 1].e, text: cur.map((w) => w.w).join(' '), i0: words.indexOf(cur[0]) });
    cur = [];
  };
  words.forEach((w, i) => {
    cur.push(w);
    const next = words[i + 1];
    if (/[.!?…]["')\]]?$/.test(w.w) || !next || next.s - w.e > 1.2 || cur.length >= 25) flush();
  });
  flush();
  return segs;
}

export function wordsIn(words, start, end) {
  return words.filter((w) => w.s >= start - 0.05 && w.e <= end + 0.05);
}

const fmt = (t) => t.toFixed(1);

const HighlightSchema = z.object({
  clips: z.array(
    z.object({
      start: z.number().describe('Start time in seconds; must be the start of a transcript line'),
      end: z.number().describe('End time in seconds; must be the end of a transcript line'),
      title: z.string().describe('Catchy title, under 60 characters'),
      reason: z.string().describe('One sentence on why this moment works as a short'),
      score: z.number().describe('Virality score from 1 to 100'),
    }),
  ),
});

/**
 * Pick the best moments for shorts. Returns [{ start, end, title, reason, score }] sorted by score.
 * Uses the LLM when available, otherwise a speech-density heuristic.
 */
export async function findHighlights({ words, duration, count, minLen, maxLen, onNote }) {
  if (!words.length) return evenSplit(duration, count, minLen, maxLen);
  const segs = toSegments(words);
  let clips = [];
  if (llmProvider()) {
    try {
      clips = await llmHighlights(segs, duration, count, minLen, maxLen);
    } catch (err) {
      console.warn('[highlights] AI selection failed, using heuristic:', err.message);
      onNote?.(`AI highlight selection failed (${err.message}); used the built-in picker instead.`);
    }
  }
  clips = clips.map((c) => snap(c, segs, duration, minLen, maxLen)).filter(Boolean);
  clips = removeOverlaps(clips);
  if (clips.length < count) {
    const extra = heuristicHighlights(segs, count * 3, minLen, maxLen);
    clips = removeOverlaps([...clips, ...extra]);
  }
  if (!clips.length) return evenSplit(duration, count, minLen, maxLen);
  return clips.slice(0, count);
}

async function llmHighlights(segs, duration, count, minLen, maxLen) {
  const transcript = segs.map((s) => `[${fmt(s.s)}-${fmt(s.e)}] ${s.text}`).join('\n');
  const { clips } = await generateJSON({
    effort: 'medium',
    schema: HighlightSchema,
    system: `You are a short-form video editor who finds the moments in long videos that will perform best as TikToks, Reels and YouTube Shorts.
A great clip opens with a hook in its first 3 seconds (a bold claim, a question, a surprising fact, conflict or emotion), makes sense without the rest of the video, and ends on a payoff, punchline or complete thought, never mid-sentence.`,
    prompt: `Here is a timestamped transcript of a ${Math.round(duration)}-second video. Each line is [start-end] in seconds.

${transcript}

Pick up to ${count} non-overlapping clips, each between ${minLen} and ${maxLen} seconds long. Start each clip at the start of a line and end it at the end of a line. Rank them best first. If there are fewer than ${count} strong moments, return fewer.`,
  });
  return clips.sort((a, b) => b.score - a.score);
}

const HOOK_WORDS = /\b(secret|mistake|never|always|why|how|best|worst|truth|actually|nobody|everyone|money|stop|wrong|crazy|insane|biggest|first|only|changed|life|hack|easy|free)\b/gi;

/** Score sliding windows of whole sentences by speech density, hook words and questions. */
function heuristicHighlights(segs, count, minLen, maxLen) {
  const candidates = [];
  for (let i = 0; i < segs.length; i++) {
    let text = '';
    for (let j = i; j < segs.length; j++) {
      const len = segs[j].e - segs[i].s;
      if (len > maxLen) break;
      text += ' ' + segs[j].text;
      if (len < minLen) continue;
      const words = text.split(/\s+/).length;
      const opener = segs[i].text;
      let score = (words / len) * 10;
      score += (text.match(HOOK_WORDS) || []).length * 3;
      score += (text.match(/[?!]/g) || []).length * 2;
      if (/[?!]|\b(you|your)\b/i.test(opener)) score += 8; // hooky opener
      if (/^(and|but|so|because|or)\b/i.test(opener)) score -= 10; // starts mid-thought
      if (/[.!?]$/.test(segs[j].text)) score += 4; // ends on a complete thought
      candidates.push({ start: segs[i].s, end: segs[j].e, score, title: titleFrom(segs.slice(i, j + 1)), reason: 'Picked by the built-in highlight finder (dense speech and hook words).' });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const max = candidates[0]?.score || 1;
  return removeOverlaps(candidates)
    .slice(0, count)
    .map((c) => ({ ...c, score: Math.round(40 + (c.score / max) * 55) }));
}

/** Title = the hookiest sentence in the clip, trimmed to a natural break. */
function titleFrom(clipSegs) {
  const best = bestLine(clipSegs.map((x) => x.text)) || clipSegs[0].text;
  let words = best.replace(/[.,;:]+$/, '').split(/\s+/);
  if (words.length > 9) {
    const comma = words.findIndex((w, i) => i >= 3 && i < 9 && /,$/.test(w));
    words = comma > 0 ? words.slice(0, comma + 1) : words.slice(0, 8);
    words[words.length - 1] = words[words.length - 1].replace(/,$/, '') + '…';
  }
  const t = words.join(' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** The sentence most likely to grab attention: questions and hook words, short beats long. */
export function bestLine(sentences, maxWords = 16) {
  let best = null;
  let bestScore = -Infinity;
  for (const raw of sentences) {
    const text = raw.trim();
    const n = text.split(/\s+/).length;
    if (n < 3 || n > maxWords) continue;
    let score = (text.match(HOOK_WORDS) || []).length * 3 + (/\?$/.test(text) ? 4 : 0) + (/!$/.test(text) ? 2 : 0) - n * 0.15;
    if (/^(and|but|so|because|or|thanks|welcome)\b/i.test(text)) score -= 5;
    if (score > bestScore) {
      best = text;
      bestScore = score;
    }
  }
  return best;
}

/** Snap clip bounds onto sentence boundaries and enforce length limits. */
function snap(clip, segs, duration, minLen, maxLen) {
  if (!(clip.end > clip.start)) return null;
  const nearest = (t, key) => segs.reduce((best, s) => (Math.abs(s[key] - t) < Math.abs(best[key] - t) ? s : best), segs[0]);
  let start = nearest(clip.start, 's').s;
  let end = nearest(clip.end, 'e').e;
  if (end <= start) end = Math.min(duration, start + minLen);
  if (end - start > maxLen) {
    // Trim to the last sentence end that fits.
    const fit = segs.filter((s) => s.e > start && s.e - start <= maxLen).pop();
    end = fit ? fit.e : start + maxLen;
  }
  if (end - start < minLen * 0.6) return null;
  start = Math.max(0, start - 0.15);
  end = Math.min(duration, end + 0.35);
  return { ...clip, start: +start.toFixed(2), end: +end.toFixed(2), score: Math.round(clip.score) };
}

function removeOverlaps(clips) {
  const kept = [];
  for (const c of clips) if (!kept.some((k) => c.start < k.end && c.end > k.start)) kept.push(c);
  return kept;
}

function evenSplit(duration, count, minLen, maxLen) {
  const len = Math.min(maxLen, Math.max(minLen, duration / count));
  const n = Math.max(1, Math.min(count, Math.floor(duration / len)));
  return Array.from({ length: n }, (_, i) => ({
    start: +(i * (duration / n)).toFixed(2),
    end: +Math.min(duration, i * (duration / n) + len).toFixed(2),
    title: `Clip ${i + 1}`,
    reason: 'No speech detected, so the video was split evenly.',
    score: 50,
  }));
}
