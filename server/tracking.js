import fs from 'node:fs';
import path from 'node:path';
import { ffmpeg } from './ffmpeg.js';
import { MODELS_DIR } from './config.js';

const DETECT_MODEL = process.env.DETECT_MODEL || 'Xenova/yolos-tiny';
const STEP = 1; // seconds between sampled frames

let detectorPromise;
async function detector() {
  detectorPromise ||= (async () => {
    const { pipeline, env } = await import('@huggingface/transformers');
    env.cacheDir = MODELS_DIR;
    return pipeline('object-detection', DETECT_MODEL, { dtype: 'q8' });
  })();
  return detectorPromise;
}

/**
 * Follow the main person in a clip so a landscape video can be cropped to 9:16 around them.
 * Returns [{ t, cx }] (t relative to `start`, cx = horizontal center 0..1), or null if nobody is found.
 */
export async function trackSpeaker(file, start, end, workDir) {
  const len = end - start;
  const dir = fs.mkdtempSync(path.join(workDir, 'track-'));
  try {
    await ffmpeg(['-ss', String(start), '-t', len.toFixed(2), '-i', file, '-vf', `fps=1/${STEP},scale=416:-2`, '-q:v', '5', path.join(dir, 'f%04d.jpg')]);
    const files = fs.readdirSync(dir).sort();
    if (!files.length) return null;
    const detect = await detector();
    const { RawImage } = await import('@huggingface/transformers');
    const raw = [];
    let prev = null;
    for (const [i, name] of files.entries()) {
      const img = await RawImage.read(path.join(dir, name));
      const found = (await detect(img, { threshold: 0.5, percentage: true })).filter((d) => d.label === 'person');
      let cx = null;
      if (found.length) {
        // Prefer the biggest person, but stick with the one near the previous position to avoid jumping.
        const scored = found.map((d) => {
          const w = d.box.xmax - d.box.xmin;
          const h = d.box.ymax - d.box.ymin;
          const c = (d.box.xmin + d.box.xmax) / 2;
          return { c, score: w * h * d.score - (prev === null ? 0 : Math.abs(c - prev) * 0.3) };
        });
        cx = scored.sort((a, b) => b.score - a.score)[0].c;
        prev = cx;
      }
      raw.push({ t: Math.min(len, i * STEP + STEP / 2), cx });
    }
    const hits = raw.filter((p) => p.cx !== null);
    if (hits.length < Math.max(1, raw.length * 0.25)) return null;
    // Fill gaps with the last known position, then smooth.
    let last = hits[0].cx;
    for (const p of raw) last = p.cx ?? last, (p.cx = last);
    const smooth = raw.map((p, i) => {
      const win = raw.slice(Math.max(0, i - 2), i + 3).map((x) => x.cx).sort((a, b) => a - b);
      return { t: p.t, cx: win[Math.floor(win.length / 2)] };
    });
    // Dead zone: ignore small drifts so the crop holds still while someone talks.
    const out = [];
    for (const p of smooth) {
      const held = out[out.length - 1];
      if (!held || Math.abs(p.cx - held.cx) > 0.06) out.push({ t: +p.t.toFixed(2), cx: +p.cx.toFixed(3) });
    }
    return out;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * ffmpeg crop x-expression that eases between tracked points. `scaledW` is the frame width
 * after scaling to 1920 tall; the crop window is 1080 wide.
 */
export function cropXExpr(points, scaledW, outW = 1080) {
  const maxX = Math.max(0, scaledW - outW);
  const px = (cx) => Math.round(Math.min(maxX, Math.max(0, cx * scaledW - outW / 2)));
  if (!points?.length) return String(Math.round(maxX / 2));
  if (points.length === 1) return String(px(points[0].cx));
  const PAN = 0.6; // seconds to glide to a new position
  // Hold each position, then glide over PAN seconds to the next one.
  let expr = String(px(points[points.length - 1].cx));
  for (let i = points.length - 2; i >= 0; i--) {
    const a = px(points[i].cx);
    const b = px(points[i + 1].cx);
    const t1 = points[i + 1].t;
    const t0 = Math.max(points[i].t, t1 - PAN);
    expr = `if(lt(t,${t0.toFixed(2)}),${a},if(lt(t,${t1.toFixed(2)}),${a}+(${b - a})*(t-${t0.toFixed(2)})/${(t1 - t0).toFixed(2)},${expr}))`;
  }
  return expr;
}
