import fs from 'node:fs';
import path from 'node:path';
import { ffmpeg, ffmpegWithProgress } from './ffmpeg.js';
import { buildAss } from './captions.js';
import { wordsIn, toSegments } from './highlights.js';
import { trackSpeaker, cropXExpr } from './tracking.js';
import { pickEmojis, emojiPng } from './emoji.js';
import { videoCodecArgs } from './encoder.js';

export const LAYOUTS = {
  crop: 'Fill (follows the speaker)',
  blur: 'Fit with blurred background',
  split: 'Split screen (your video + background clip)',
};

const W = 1080;
const H = 1920;

function videoChain(layout, hasBackground, cropX) {
  if (layout === 'split' && hasBackground) {
    return [
      `[0:v]scale=${W}:${H / 2}:force_original_aspect_ratio=increase,crop=${W}:${H / 2},setsar=1[top]`,
      `[1:v]scale=${W}:${H / 2}:force_original_aspect_ratio=increase,crop=${W}:${H / 2},setsar=1[bot]`,
      `[top][bot]vstack=inputs=2[base]`,
    ];
  }
  if (layout === 'blur' || layout === 'split') {
    return [
      `[0:v]split=2[bga][fga]`,
      `[bga]scale=${W / 4}:${H / 4}:force_original_aspect_ratio=increase,crop=${W / 4}:${H / 4},boxblur=12:3,scale=${W}:${H},setsar=1[bg]`,
      `[fga]scale=${W}:${H}:force_original_aspect_ratio=decrease,setsar=1[fg]`,
      `[bg][fg]overlay=(W-w)/2:(H-h)/2[base]`,
    ];
  }
  if (cropX) return [`[0:v]scale=-2:${H},crop=${W}:${H}:x='${cropX}':y=0,setsar=1[base]`];
  return [`[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1[base]`];
}

/** zoompan expression: alternate 1.0× / 1.15× on each sentence for a jump-cut "punch-in" feel. */
function zoomFilter(words) {
  const segs = toSegments(words);
  const zoomed = segs.filter((_, i) => i % 2 === 1).map((s) => `between(it,${s.s.toFixed(2)},${(s.e + 0.15).toFixed(2)})`);
  if (!zoomed.length) return null;
  return `zoompan=z='if(${zoomed.join('+')},1.15,1)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${W}x${H}:fps=30`;
}

/**
 * Render one clip to `clip-<id>.mp4` in the project dir.
 * voice: null | { mode: 'hook'|'narration', file, duration, words }
 */
export async function renderClip({ dir, project, clip, voice, onProgress, onStep }) {
  const source = project.source;
  const bgFile = project.background?.file ? path.join(dir, project.background.file) : null;
  const useSplit = clip.layout === 'split' && bgFile && fs.existsSync(bgFile);
  const narration = voice?.mode === 'narration';
  const hook = voice?.mode === 'hook';
  const clipLen = clip.end - clip.start;
  const duration = narration ? voice.duration + 0.5 : clipLen;

  // Caption words, relative to clip start.
  const spoken = wordsIn(project.transcript?.words || [], clip.start, clip.end).map((w) => ({ w: w.w, s: w.s - clip.start, e: w.e - clip.start }));
  let captionWords = spoken;
  if (narration) captionWords = voice.words;
  else if (hook) captionWords = [...voice.words, ...spoken.filter((w) => w.s >= voice.duration + 0.15)];

  const inputs = [];
  inputs.push(...(narration ? ['-stream_loop', '-1'] : []), '-ss', String(clip.start), '-i', path.join(dir, source.file));
  let next = 1;
  if (useSplit) {
    inputs.push('-stream_loop', '-1', '-i', bgFile);
    next++;
  }
  let voiceIdx = -1;
  if (voice) {
    inputs.push('-i', voice.file);
    voiceIdx = next++;
  }
  let silenceIdx = -1;
  if (!source.hasAudio) {
    inputs.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo');
    silenceIdx = next++;
  }

  // Speaker tracking for the Fill layout on landscape sources (cached per clip range).
  let track = clip.track;
  let cropX = null;
  const landscape = source.width && source.height && source.width / source.height > W / H + 0.05;
  if (clip.layout === 'crop' && clip.follow !== false && landscape) {
    if (!track || track.start !== clip.start || track.end !== clip.end) {
      onStep?.('Finding the speaker');
      const points = await trackSpeaker(path.join(dir, source.file), clip.start, clip.end, dir).catch((err) => {
        console.warn('[tracking] failed, using center crop:', err.message);
        return null;
      });
      track = { start: clip.start, end: clip.end, points };
    }
    if (track.points) cropX = cropXExpr(track.points, Math.round((source.width * H) / source.height / 2) * 2);
  }

  const filters = videoChain(clip.layout, useSplit, cropX);
  let cur = 'base';
  if (clip.zoom && !narration) {
    const z = zoomFilter(spoken);
    if (z) {
      filters.push(`[base]${z}[zoomed]`);
      cur = 'zoomed';
    }
  }

  // Emoji pop-ups above the captions.
  let emojiPicks = clip.emojiPicks;
  if (clip.emojis) {
    const key = `${clip.start}|${clip.end}|${clip.voiceMode}|${captionWords.length}`;
    if (!emojiPicks || emojiPicks.key !== key) {
      onStep?.('Adding emojis');
      emojiPicks = { key, picks: await pickEmojis(captionWords, duration) };
    }
    const y = useSplit ? 560 : 1000;
    for (const [j, pick] of emojiPicks.picks.entries()) {
      const png = emojiPng(pick.emoji, dir);
      inputs.push('-loop', '1', '-t', duration.toFixed(2), '-i', png);
      const idx = next++;
      filters.push(`[${idx}:v]format=rgba,fade=t=in:st=${pick.start}:d=0.15:alpha=1,fade=t=out:st=${Math.max(pick.start, pick.end - 0.25).toFixed(2)}:d=0.25:alpha=1[e${j}]`);
      filters.push(`[${cur}][e${j}]overlay=x=(W-w)/2:y=${y}:enable='between(t,${pick.start},${pick.end})'[em${j}]`);
      cur = `em${j}`;
    }
  }
  const assName = `captions-${clip.id}.ass`;
  const ass = clip.captionStyle === 'none' ? null : buildAss(captionWords, clip.captionStyle, { position: useSplit ? 'middle' : 'lower', duration });
  if (ass) {
    fs.writeFileSync(path.join(dir, assName), ass, 'utf8');
    // Relative paths only: Windows drive colons break ffmpeg's filter parser. ffmpeg runs with cwd = project dir.
    filters.push(`[${cur}]fps=30,subtitles=${assName}:fontsdir=../../fonts,format=yuv420p[v]`);
  } else {
    filters.push(`[${cur}]fps=30,format=yuv420p[v]`);
  }

  const srcAudio = source.hasAudio ? '[0:a]' : `[${silenceIdx}:a]`;
  if (narration) {
    filters.push(`${srcAudio}aresample=48000,volume=${source.hasAudio ? clip.bedVolume ?? 0.08 : 0}[bed]`);
    filters.push(`[${voiceIdx}:a]aresample=48000,volume=1.4,apad[vo]`);
    filters.push(`[bed][vo]amix=inputs=2:duration=longest:normalize=0[a]`);
  } else if (hook) {
    const duckUntil = (voice.duration + 0.2).toFixed(2);
    filters.push(`${srcAudio}aresample=48000,volume='if(lt(t,${duckUntil}),0.15,1)':eval=frame[orig]`);
    filters.push(`[${voiceIdx}:a]aresample=48000,volume=1.4,apad[vo]`);
    filters.push(`[orig][vo]amix=inputs=2:duration=first:normalize=0[a]`);
  } else {
    filters.push(`${srcAudio}aresample=48000[a]`);
  }

  const outName = `clip-${clip.id}.mp4`;
  const tmpName = `clip-${clip.id}.tmp.mp4`;
  const args = [
    ...inputs,
    '-filter_complex', filters.join(';'),
    '-map', '[v]', '-map', '[a]',
    '-t', duration.toFixed(2),
    ...(await videoCodecArgs()),
    '-c:a', 'aac', '-b:a', '160k', '-ac', '2',
    '-movflags', '+faststart',
    tmpName,
  ];
  await ffmpegWithProgress(args, duration, onProgress, { cwd: dir });
  fs.renameSync(path.join(dir, tmpName), path.join(dir, outName));

  const thumbName = `thumb-${clip.id}.jpg`;
  await ffmpeg(['-ss', String(Math.min(duration / 2, 2)), '-i', outName, '-frames:v', '1', '-vf', 'scale=360:-2', '-q:v', '4', thumbName], { cwd: dir });
  return { file: outName, thumb: thumbName, duration: +duration.toFixed(2), track, emojiPicks };
}
