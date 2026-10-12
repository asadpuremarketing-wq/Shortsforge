import { run, FFMPEG, decodePcm16k } from './ffmpeg.js';

export const BIN_SEC = 0.5;

/**
 * Score every half second of a clip by how "eventful" it is: loudness, sudden loudness jumps
 * (impacts, screams, laughter), and on-screen motion/cuts. Works without speech, which suits
 * TikTok fails, reactions and highlights. Returns { bins: number[0..1], binSec }.
 */
export async function analyzeClip(file, duration) {
  const nBins = Math.max(1, Math.ceil(duration / BIN_SEC));
  const [audio, motion] = await Promise.all([audioEnergy(file, nBins).catch(() => new Array(nBins).fill(0)), motionEnergy(file, nBins).catch(() => new Array(nBins).fill(0))]);
  const a = normalize(audio);
  const onset = normalize(audio.map((v, i) => Math.max(0, v - (audio[i - 1] ?? v))));
  const m = normalize(motion);
  const raw = a.map((_, i) => 0.45 * a[i] + 0.25 * onset[i] + 0.3 * m[i]);
  // Light smoothing so single-frame spikes don't dominate.
  const bins = normalize(raw.map((_, i) => (raw[i - 1] ?? raw[i]) * 0.25 + raw[i] * 0.5 + (raw[i + 1] ?? raw[i]) * 0.25));
  return { bins: bins.map((v) => +v.toFixed(3)), binSec: BIN_SEC };
}

async function audioEnergy(file, nBins) {
  const pcm = await decodePcm16k(file);
  const per = Math.floor(16000 * BIN_SEC);
  const out = new Array(nBins).fill(0);
  for (let b = 0; b < nBins; b++) {
    let sum = 0;
    const end = Math.min(pcm.length, (b + 1) * per);
    for (let i = b * per; i < end; i++) sum += pcm[i] * pcm[i];
    const n = end - b * per;
    // dB-ish scale so quiet clips still show structure.
    out[b] = n > 0 ? Math.max(0, 60 + 10 * Math.log10(sum / n + 1e-9)) : 0;
  }
  return out;
}

async function motionEnergy(file, nBins) {
  const { stdout } = await run(FFMPEG, ['-hide_banner', '-i', file, '-an', '-vf', 'scale=160:-2,fps=8,select=gte(scene\\,0),metadata=mode=print:file=-', '-f', 'null', '-']);
  const out = new Array(nBins).fill(0);
  const counts = new Array(nBins).fill(0);
  let t = null;
  for (const line of stdout.toString().split('\n')) {
    const pts = /pts_time:([\d.]+)/.exec(line);
    if (pts) t = Number(pts[1]);
    const sc = /scene_score=([\d.]+)/.exec(line);
    if (sc && t !== null) {
      const b = Math.min(nBins - 1, Math.floor(t / BIN_SEC));
      out[b] += Number(sc[1]);
      counts[b]++;
    }
  }
  return out.map((v, i) => (counts[i] ? v / counts[i] : 0));
}

function normalize(arr) {
  const max = Math.max(...arr);
  const min = Math.min(...arr);
  return arr.map((v) => (max > min ? (v - min) / (max - min) : 0));
}

/**
 * Choose the best `len`-second window: high average energy, with extra weight on a strong peak
 * in the back half so the clip builds up to its payoff instead of starting on it.
 */
export function bestWindow(bins, binSec, duration, len, aiPeak) {
  if (!bins?.length || duration <= len * 1.15) return { start: 0, end: +duration.toFixed(2) };
  const w = Math.max(1, Math.round(len / binSec));
  let best = { score: -Infinity, start: 0 };
  for (let s = 0; s + w <= bins.length; s++) {
    const win = bins.slice(s, s + w);
    const mean = win.reduce((a, b) => a + b, 0) / w;
    const backHalf = win.slice(Math.floor(w * 0.4));
    const peak = Math.max(...backHalf);
    const quietStart = 1 - Math.min(1, win.slice(0, Math.max(1, Math.floor(w * 0.15))).reduce((a, b) => a + b, 0) / Math.max(1, Math.floor(w * 0.15)));
    let score = mean + 0.6 * peak + 0.1 * quietStart;
    if (aiPeak !== undefined && aiPeak !== null) {
      // The AI saw the frames: strongly prefer windows where its payoff lands 55–85% of the way in.
      const pos = (aiPeak - s * binSec) / len;
      score += pos >= 0.55 && pos <= 0.85 ? 2 : pos >= 0.3 && pos < 1 ? 1 : 0;
    }
    if (score > best.score) best = { score, start: s };
  }
  const start = best.start * binSec;
  return { start: +start.toFixed(2), end: +Math.min(duration, start + len).toFixed(2) };
}
