import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { ffmpeg } from './ffmpeg.js';
import { generateJSON, llmProvider } from './llm.js';

const MAX_FRAMES = 20;

/** Grab evenly spaced small JPEG frames: [{ t, data(base64) }]. */
export async function sampleFrames(file, duration, workDir, count = MAX_FRAMES) {
  const n = Math.max(2, Math.min(count, Math.ceil(duration)));
  const dir = fs.mkdtempSync(path.join(workDir, 'frames-'));
  try {
    const fps = n / duration;
    await ffmpeg(['-i', file, '-vf', `fps=${fps.toFixed(5)},scale=320:-2`, '-q:v', '6', '-frames:v', String(n), path.join(dir, 'f%03d.jpg')]);
    return fs
      .readdirSync(dir)
      .sort()
      .map((name, i) => ({ t: +((i + 0.5) / fps).toFixed(1), data: fs.readFileSync(path.join(dir, name)).toString('base64') }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const MomentSchema = z.object({
  peak: z.number().describe('Time in seconds of the single most exciting instant (the payoff: the fail, the trick landing, the punchline)'),
  label: z.string().describe('2 to 4 word punchy label for this clip in a ranking video, Title Case, no emojis'),
  reason: z.string().describe('One short sentence on what happens'),
});

/**
 * Ask the vision model where a clip's payoff is. Returns { peak, label, reason } or null without an AI key.
 * `energy` is the per-bin loudness/motion score from analyze.js, given as a hint.
 */
export async function findPeakWithAI(file, duration, workDir, energy) {
  if (!llmProvider()) return null;
  const frames = await sampleFrames(file, duration, workDir);
  const loudest = energy?.bins
    ?.map((v, i) => ({ v, t: +(i * energy.binSec).toFixed(1) }))
    .sort((a, b) => b.v - a.v)
    .slice(0, 5)
    .map((x) => `${x.t}s`)
    .join(', ');
  const out = await generateJSON({
    effort: 'low',
    schema: MomentSchema,
    system: 'You edit ranking compilation videos (like "Top 5 Craziest Fails") for YouTube Shorts and TikTok. You look at frames from a clip and find its payoff moment.',
    images: frames.map((f) => ({ caption: `Frame at ${f.t}s:`, data: f.data })),
    prompt: `These are ${frames.length} frames from a ${duration.toFixed(1)}-second clip.${loudest ? ` The loudest / most active moments by audio and motion are at: ${loudest}.` : ''}
Where is the payoff? Give the time of the single most exciting instant, a short label for the clip, and what happens.`,
  });
  return { ...out, peak: Math.min(duration, Math.max(0, out.peak)), label: out.label.trim().slice(0, 40) };
}
