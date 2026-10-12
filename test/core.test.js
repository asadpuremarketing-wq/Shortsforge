import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAss } from '../server/captions.js';
import { toSegments, wordsIn, findHighlights, bestLine } from '../server/highlights.js';
import { bestWindow } from '../server/analyze.js';
import { applyAutoTrim, playOrder, overlayAss, itemLength, defaultRanking } from '../server/ranking.js';
import { cropXExpr } from '../server/tracking.js';
import { toSrt, paragraphs } from '../server/routes-tools.js';
import { spreadWords } from '../server/transcribe.js';

// A fake transcript: sentences of 6 words, 0.4 s per word, 0.6 s pause between sentences.
function transcript(sentences) {
  const words = [];
  let t = 0;
  for (const s of sentences) {
    const toks = s.split(' ');
    toks.forEach((w) => {
      words.push({ w, s: t, e: t + 0.35 });
      t += 0.4;
    });
    t += 0.6;
  }
  return words;
}

test('captions: word-by-word highlight produces one event per word', () => {
  const words = transcript(['This is the biggest mistake ever.']);
  const ass = buildAss(words, 'bold');
  const events = ass.split('\n').filter((l) => l.startsWith('Dialogue:'));
  assert.equal(events.length, words.length);
  assert.match(ass, /\\c&H0000E5FF&/); // highlight colour on the active word
  assert.match(ass, /BIGGEST/); // bold style is uppercase
});

test('captions: "none" style and empty words give no subtitle file', () => {
  assert.equal(buildAss(transcript(['Hello there friend.']), 'none'), null);
  assert.equal(buildAss([], 'bold'), null);
});

test('captions: special characters are stripped so they cannot break the ASS file', () => {
  const ass = buildAss([{ w: '{evil}\\N', s: 0, e: 1 }], 'clean');
  assert.doesNotMatch(ass.split('[Events]')[1], /\{evil\}/);
});

test('highlights: sentences split on punctuation and long pauses', () => {
  const segs = toSegments(transcript(['One two three.', 'Four five six?']));
  assert.equal(segs.length, 2);
  assert.equal(segs[1].text, 'Four five six?');
});

test('highlights: built-in picker returns non-overlapping clips within limits', async () => {
  const sentences = Array.from({ length: 40 }, (_, i) => (i % 5 === 0 ? 'Why does nobody tell you this secret?' : 'And then we walked to the shop.'));
  const words = transcript(sentences);
  const duration = words[words.length - 1].e;
  const clips = await findHighlights({ words, duration, count: 3, minLen: 10, maxLen: 25 });
  assert.ok(clips.length >= 1 && clips.length <= 3);
  for (const c of clips) assert.ok(c.end - c.start <= 25 + 0.6, `clip too long: ${c.end - c.start}`);
  const sorted = [...clips].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i].start >= sorted[i - 1].end, 'clips overlap');
});

test('highlights: bestLine prefers short hooky questions over filler', () => {
  assert.equal(bestLine(['And then we went home.', 'Why does nobody tell you this secret?']), 'Why does nobody tell you this secret?');
});

test('highlights: wordsIn keeps only words inside the range', () => {
  const words = transcript(['a b c d e f.']);
  assert.equal(wordsIn(words, 0.4, 1.2).length, 2);
});

test('analyze: bestWindow picks the window around the loud part', () => {
  const bins = Array.from({ length: 60 }, (_, i) => (i >= 40 && i < 48 ? 1 : 0.05)); // spike at 20–24 s
  const w = bestWindow(bins, 0.5, 30, 6);
  assert.ok(w.start <= 20 && w.end >= 22, `window ${w.start}-${w.end} misses the spike`);
  assert.equal(+(w.end - w.start).toFixed(2), 6);
});

test('analyze: short clips are used whole', () => {
  assert.deepEqual(bestWindow([0.1, 0.2], 0.5, 5, 10), { start: 0, end: 5 });
});

test('analyze: an AI payoff time pulls the window so the payoff lands late in it', () => {
  const flat = Array.from({ length: 120 }, () => 0.3);
  const w = bestWindow(flat, 0.5, 60, 10, 45);
  const pos = (45 - w.start) / 10;
  assert.ok(pos >= 0.55 && pos <= 0.85, `payoff at ${pos} of window`);
});

test('ranking: auto-trim fits the target length and respects manual trims', () => {
  const r = defaultRanking();
  r.general.targetLength = 30;
  const item = (id, duration, extra = {}) => ({ id, status: 'ready', duration, trimStart: 0, trimEnd: duration, analysis: { bins: Array(duration * 2).fill(0.5), binSec: 0.5 }, ...extra });
  r.items = [item('a', 60), item('b', 60), item('c', 8, { auto: false, trimStart: 1, trimEnd: 7 })];
  applyAutoTrim(r);
  const total = r.items.reduce((n, it) => n + itemLength(it), 0);
  assert.ok(Math.abs(total - 30) < 0.6, `total ${total}`);
  assert.equal(r.items[2].trimStart, 1); // manual trim untouched
  assert.equal(r.items[2].trimEnd, 7);
});

test('ranking: countdown order plays the last rank first', () => {
  const r = defaultRanking();
  r.items = [{}, {}, {}];
  assert.deepEqual(playOrder(r), [2, 1, 0]);
  r.playback = { custom: true, order: 'ascending' };
  assert.deepEqual(playOrder(r), [0, 1, 2]);
});

test('ranking: overlay reveals each label when its rank starts, and adds effects', () => {
  const r = defaultRanking();
  r.items = [{ label: 'Best one' }, { label: 'Runner up' }];
  r.extras = { ...r.extras, watermark: '@me', endText: 'Follow!' };
  const segments = [{ index: 1, start: 0, end: 5 }, { index: 0, start: 5, end: 10 }];
  const ass = overlayAss(r, segments, 10, 2);
  assert.match(ass, /Dialogue: 2,0:00:00\.00,0:00:05\.00,Rank.*1\.$/m); // #1 shows only its number before it plays
  assert.match(ass, /Dialogue: 2,0:00:05\.00,0:00:12\.00,Rank.*1\. .*Best one/);
  assert.match(ass, /#2/); // rank pop-up
  assert.match(ass, /@me/);
  assert.match(ass, /Follow!/);
});

test('tracking: crop expression stays within the frame', () => {
  const expr = cropXExpr([{ t: 0.5, cx: 0 }, { t: 3, cx: 1 }], 3414);
  const nums = expr.match(/-?\d+(?=[,)])/g).map(Number);
  assert.ok(Math.min(...nums.filter((n) => n >= 0)) >= 0);
  assert.ok(expr.includes('2334')); // right edge = 3414 - 1080
  assert.equal(cropXExpr(null, 3414), '1167'); // centred when nobody is found
});

test('subtitles: SRT export groups words into numbered cues', () => {
  const srt = toSrt(transcript(['Hello there my friend.', 'How are you today?']));
  assert.match(srt, /^1\n00:00:00,000 --> 00:00:01,550\nHello there my friend\.\n/);
  assert.match(srt, /\n2\n/);
  assert.match(paragraphs(transcript(['One.', 'Two.'])), /One\. Two\./);
});

test('tts timing: spreadWords covers the span in order', () => {
  const w = spreadWords('Number three is wild.', 0, 2);
  assert.equal(w.length, 4);
  assert.ok(w[0].s === 0 && w[3].e <= 2);
  for (let i = 1; i < w.length; i++) assert.ok(w[i].s >= w[i - 1].e);
});
