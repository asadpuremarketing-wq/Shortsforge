import fs from 'node:fs';
import OpenAI from 'openai';
import { providers } from './config.js';

export const IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1';

export function imagesAvailable() {
  return providers().openai;
}

/** Generate one image with OpenAI and save it as PNG. size: '1024x1536' (portrait) | '1536x1024' | '1024x1024'. */
export async function generateImage(prompt, outFile, size = '1024x1536') {
  if (!imagesAvailable()) throw new Error('AI images need an OpenAI key (add it in Settings).');
  const client = new OpenAI();
  const res = await client.images.generate({ model: IMAGE_MODEL, prompt, size, n: 1 });
  const b64 = res.data?.[0]?.b64_json;
  if (b64) fs.writeFileSync(outFile, Buffer.from(b64, 'base64'));
  else if (res.data?.[0]?.url) fs.writeFileSync(outFile, Buffer.from(await (await fetch(res.data[0].url)).arrayBuffer()));
  else throw new Error('The image service returned no image.');
  return outFile;
}
