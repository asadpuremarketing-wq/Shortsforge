import fs from 'node:fs';
import path from 'node:path';
import { FONTS_DIR } from './config.js';

// Fonts are kept in data/fonts so libass can load them through a colon-free relative path
// and the browser preview can load the same files from /fonts/.
const FONTS = [
  { family: 'Archivo Black', file: 'ArchivoBlack-Regular.ttf', url: 'https://github.com/google/fonts/raw/main/ofl/archivoblack/ArchivoBlack-Regular.ttf' },
  { family: 'Anton', file: 'Anton-Regular.ttf', url: 'https://github.com/google/fonts/raw/main/ofl/anton/Anton-Regular.ttf' },
  { family: 'Bebas Neue', file: 'BebasNeue-Regular.ttf', url: 'https://github.com/google/fonts/raw/main/ofl/bebasneue/BebasNeue-Regular.ttf' },
  { family: 'Luckiest Guy', file: 'LuckiestGuy-Regular.ttf', url: 'https://github.com/google/fonts/raw/main/apache/luckiestguy/LuckiestGuy-Regular.ttf' },
  { family: 'Bangers', file: 'Bangers-Regular.ttf', url: 'https://github.com/google/fonts/raw/main/ofl/bangers/Bangers-Regular.ttf' },
  { family: 'Arial Black', file: 'ariblk.ttf', windows: true },
  { family: 'Arial', file: 'arialbd.ttf', windows: true, bold: true },
  { family: 'Impact', file: 'impact.ttf', windows: true },
  { family: 'Segoe UI Black', file: 'seguibl.ttf', windows: true },
];

/** Copy Windows fonts and download the Google fonts once. Failures are ignored; the font just isn't offered. */
export async function ensureFonts() {
  await Promise.all(
    FONTS.map(async (f) => {
      const dest = path.join(FONTS_DIR, f.file);
      if (fs.existsSync(dest)) return;
      try {
        if (f.windows) {
          const src = path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts', f.file);
          if (fs.existsSync(src)) fs.copyFileSync(src, dest);
        } else {
          const res = await fetch(f.url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
        }
      } catch (err) {
        console.warn(`[fonts] couldn't get ${f.family}: ${err.message}`);
      }
    }),
  );
}

export function listFonts() {
  return FONTS.filter((f) => fs.existsSync(path.join(FONTS_DIR, f.file))).map((f) => ({ family: f.family, file: f.file }));
}
