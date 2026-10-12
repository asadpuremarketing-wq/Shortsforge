import fs from 'node:fs';
import path from 'node:path';
import { run, FFMPEG } from './ffmpeg.js';
import { BIN_DIR } from './config.js';

const YTDLP = path.join(BIN_DIR, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
const YTDLP_URL = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'}`;

let installing;
let updateChecked = false;
async function ensureYtDlp() {
  if (fs.existsSync(YTDLP)) {
    // Sites change often and yt-dlp ships fixes weekly: self-update when the copy is over a week old.
    if (!updateChecked && Date.now() - fs.statSync(YTDLP).mtimeMs > 7 * 86400_000) {
      updateChecked = true;
      await run(YTDLP, ['-U']).then(() => fs.utimesSync(YTDLP, new Date(), new Date())).catch((err) => console.warn('[yt-dlp] update failed:', err.message.split('\n')[0]));
    }
    return YTDLP;
  }
  installing ||= (async () => {
    const res = await fetch(YTDLP_URL);
    if (!res.ok) throw new Error(`Couldn't download yt-dlp (HTTP ${res.status})`);
    fs.writeFileSync(YTDLP + '.part', Buffer.from(await res.arrayBuffer()));
    fs.renameSync(YTDLP + '.part', YTDLP);
    if (process.platform !== 'win32') fs.chmodSync(YTDLP, 0o755);
  })().finally(() => (installing = null));
  await installing;
  return YTDLP;
}

export function isSupportedLink(url) {
  try {
    const u = new URL(url);
    return ['http:', 'https:'].includes(u.protocol);
  } catch {
    return false;
  }
}

/**
 * Download a TikTok / Instagram / YouTube (or any yt-dlp supported) video as MP4 into `dir`.
 * Returns { file, title }.
 */
export async function downloadVideo(url, dir, baseName, onProgress) {
  const bin = await ensureYtDlp();
  const template = `${baseName}.%(ext)s`;
  const args = [
    '--no-playlist',
    '--no-warnings',
    // YouTube needs a JavaScript runtime to unlock formats; reuse the Node.js running this app.
    '--js-runtimes', `node:${process.execPath}`,
    '--newline',
    // Best quality up to 1080×1920. Non-H.264 results (TikTok sends HEVC) are converted afterwards for the browser.
    '-f', 'bv*[height<=1920]+ba/b[height<=1920]/bv*+ba/b',
    '--merge-output-format', 'mp4',
    '--ffmpeg-location', FFMPEG,
    '--print', 'after_move:filepath',
    '--print', 'before_dl:title',
    '-o', template,
    url,
  ];
  const { stdout } = await run(bin, args, {
    cwd: dir,
    onStderr: () => {},
  }).catch((err) => {
    throw new Error(`Couldn't download that link. ${err.message.split('\n').filter((l) => /ERROR/.test(l)).join(' ') || 'Check that it is public.'}`);
  });
  const lines = stdout.toString().split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const file = lines.reverse().find((l) => /\.(mp4|mkv|webm|mov)$/i.test(l));
  const title = lines.find((l) => !/\.(mp4|mkv|webm|mov)$/i.test(l)) || '';
  if (!file) throw new Error('Download finished but no video file was produced.');
  onProgress?.(1);
  return { file: path.basename(file), title };
}

/** Turn a TikTok/YouTube caption into a short rank label, or '' if it's mostly hashtags and noise. */
export function labelFromTitle(title) {
  const cleaned = String(title || '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[#@][\w.]+/g, '')
    .replace(/\p{Extended_Pictographic}|\uFE0F/gu, '')
    .replace(/\s*[|•–—-]\s*.*$/, '') // drop " | channel name" style suffixes
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // A long caption cut short reads badly as a label; leave it for the user (or AI) to write.
  if (cleaned.length < 3 || cleaned.length > 32) return '';
  return cleaned.replace(/[,.;:]+$/, '');
}
