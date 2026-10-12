import { ffmpeg } from './ffmpeg.js';

// Hardware H.264 encoders in order of preference. Each is tried once with a tiny test encode.
const CANDIDATES = [
  { name: 'NVIDIA (NVENC)', args: ['-c:v', 'h264_nvenc', '-preset', 'p5', '-rc', 'vbr', '-cq', '21', '-b:v', '0', '-pix_fmt', 'yuv420p'] },
  { name: 'Intel (Quick Sync)', args: ['-c:v', 'h264_qsv', '-global_quality', '22', '-pix_fmt', 'nv12'] },
  { name: 'AMD (AMF)', args: ['-c:v', 'h264_amf', '-quality', 'quality', '-rc', 'cqp', '-qp_i', '20', '-qp_p', '22', '-pix_fmt', 'yuv420p'] },
];
const CPU = { name: 'CPU (x264)', args: ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p'] };

let detected;

/** Pick the fastest working encoder. Set ENCODER=cpu in .env to force software encoding. */
export function detectEncoder() {
  detected ||= (async () => {
    if ((process.env.ENCODER || '').toLowerCase() === 'cpu') return CPU;
    for (const c of CANDIDATES) {
      try {
        await ffmpeg(['-f', 'lavfi', '-i', 'color=c=black:s=1080x1920:r=30:d=0.5', ...c.args, '-f', 'null', '-']);
        return c;
      } catch {
        /* not available on this machine */
      }
    }
    return CPU;
  })();
  return detected;
}

export async function videoCodecArgs() {
  return (await detectEncoder()).args;
}
