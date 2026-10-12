import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';

export const FFMPEG = process.env.FFMPEG_PATH || ffmpegPath;
export const FFPROBE = process.env.FFPROBE_PATH || ffprobeStatic.path;

/** Run a binary and collect stdout (as Buffer) and stderr. Rejects with the stderr tail on failure. */
export function run(bin, args, { cwd, onStderr } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { cwd, windowsHide: true });
    const out = [];
    let err = '';
    proc.stdout.on('data', (d) => out.push(d));
    proc.stderr.on('data', (d) => {
      const s = d.toString();
      err = (err + s).slice(-20000);
      onStderr?.(s);
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve({ stdout: Buffer.concat(out), stderr: err });
      else reject(new Error(`${bin.split(/[\\/]/).pop()} exited with ${code}: ${err.trim().split('\n').slice(-6).join('\n')}`));
    });
  });
}

export function ffmpeg(args, opts) {
  return run(FFMPEG, ['-hide_banner', '-y', ...args], opts);
}

/** ffmpeg with a progress callback (0..1) based on the expected output duration. */
export function ffmpegWithProgress(args, durationSec, onProgress, opts = {}) {
  return ffmpeg(args, {
    ...opts,
    onStderr: (s) => {
      const m = /time=(\d+):(\d+):(\d+\.\d+)/.exec(s);
      if (m && durationSec > 0) {
        const t = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
        onProgress?.(Math.min(1, t / durationSec));
      }
    },
  });
}

export async function probe(file) {
  const { stdout } = await run(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]);
  const info = JSON.parse(stdout.toString());
  const video = info.streams.find((s) => s.codec_type === 'video');
  const audio = info.streams.find((s) => s.codec_type === 'audio');
  let fps = 30;
  if (video?.avg_frame_rate && video.avg_frame_rate !== '0/0') {
    const [n, d] = video.avg_frame_rate.split('/').map(Number);
    if (n && d) fps = n / d;
  }
  // Phone footage stores portrait video as landscape + rotation metadata.
  const rotation = Math.abs(Number(video?.side_data_list?.find((x) => x.rotation !== undefined)?.rotation ?? video?.tags?.rotate ?? 0));
  const swap = rotation === 90 || rotation === 270;
  return {
    duration: Number(info.format.duration) || Number(video?.duration) || 0,
    width: swap ? video?.height : video?.width,
    height: swap ? video?.width : video?.height,
    fps,
    hasVideo: Boolean(video),
    hasAudio: Boolean(audio),
  };
}

/** Decode any media file to mono 16 kHz float32 PCM (what Whisper expects). */
export async function decodePcm16k(file) {
  const { stdout } = await run(FFMPEG, ['-hide_banner', '-i', file, '-vn', '-ac', '1', '-ar', '16000', '-f', 'f32le', 'pipe:1']);
  const len = Math.floor(stdout.byteLength / 4) * 4;
  // Copy out: Buffer.concat may hand back a pooled buffer whose offset isn't 4-byte aligned.
  return new Float32Array(stdout.buffer.slice(stdout.byteOffset, stdout.byteOffset + len));
}
