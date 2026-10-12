import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import OpenAI from 'openai';
import { z } from 'zod';
import { providers, CLAUDE_MODEL, OPENAI_MODEL } from './config.js';

// Models that accept the server-side refusal fallback ("default" routing).
const FALLBACK_MODELS = ['claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1', 'claude-sonnet-5-5'];

export function llmProvider() {
  const p = providers();
  if (p.anthropic) return 'anthropic';
  if (p.openai) return 'openai';
  return null;
}

/**
 * Ask the configured LLM for JSON matching a zod schema. Claude is preferred when both keys exist.
 * images: optional [{ data: base64 JPEG, caption }] shown before the prompt (used for frame analysis).
 */
export async function generateJSON({ system, prompt, schema, effort = 'medium', images = [] }) {
  const provider = llmProvider();
  if (provider === 'anthropic') {
    const client = new Anthropic();
    const useFallback = FALLBACK_MODELS.includes(CLAUDE_MODEL);
    const res = await client.beta.messages.parse({
      model: CLAUDE_MODEL,
      max_tokens: 16000,
      ...(useFallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}),
      output_config: { effort, format: betaZodOutputFormat(schema) },
      system,
      messages: [
        {
          role: 'user',
          content: images.length
            ? [
                ...images.flatMap((img) => [
                  { type: 'text', text: img.caption },
                  { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: img.data } },
                ]),
                { type: 'text', text: prompt },
              ]
            : prompt,
        },
      ],
    });
    if (res.stop_reason === 'refusal') throw new Error('Claude declined this request.');
    if (res.stop_reason === 'max_tokens') throw new Error('Claude response was cut off (max_tokens).');
    if (!res.parsed_output) throw new Error('Claude returned output that did not match the expected format.');
    return res.parsed_output;
  }
  if (provider === 'openai') {
    const client = new OpenAI();
    const res = await client.chat.completions.create({
      model: OPENAI_MODEL,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: `${system}\n\nRespond with a single JSON object matching this JSON Schema:\n${JSON.stringify(z.toJSONSchema(schema))}` },
        {
          role: 'user',
          content: images.length
            ? [
                ...images.flatMap((img) => [
                  { type: 'text', text: img.caption },
                  { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${img.data}`, detail: 'low' } },
                ]),
                { type: 'text', text: prompt },
              ]
            : prompt,
        },
      ],
    });
    return schema.parse(JSON.parse(res.choices[0].message.content));
  }
  throw new Error('No AI provider configured. Add an Anthropic or OpenAI key in Settings.');
}

// ---------- Writing helpers ----------

const SCRIPT_SYSTEM = `You write voiceover copy for short vertical videos (TikTok, Reels, YouTube Shorts).
Write the way people talk: short sentences, concrete words, no hashtags, no emojis, no stage directions.
Only output words that should be spoken aloud.`;

export async function writeHook({ title, clipText }) {
  const { hook } = await generateJSON({
    system: SCRIPT_SYSTEM,
    effort: 'low',
    schema: z.object({ hook: z.string() }),
    prompt: `Write one spoken hook line (6 to 14 words) that plays over the first seconds of this clip and makes viewers stay to hear the rest. Don't give away the payoff.

Clip title: ${title}
Clip transcript:
${clipText}`,
  });
  return hook.trim();
}

export async function writeNarration({ title, clipText, seconds, style }) {
  const targetWords = Math.max(15, Math.round(seconds * 2.6));
  const { script } = await generateJSON({
    system: SCRIPT_SYSTEM,
    effort: 'medium',
    schema: z.object({ script: z.string() }),
    prompt: `Write a voiceover narration of about ${targetWords} words for a short video built from the clip below. The narration replaces the original audio, so it must stand on its own: open with a strong hook in the first sentence, deliver the key point, and end with a short line that invites a follow or comment.
${style ? `Style: ${style}\n` : ''}
Clip title: ${title}
Clip transcript:
${clipText || '(no speech in this clip)'}`,
  });
  return script.trim();
}

export async function rewriteText({ text, instruction }) {
  const { text: out } = await generateJSON({
    system: SCRIPT_SYSTEM,
    effort: 'low',
    schema: z.object({ text: z.string() }),
    prompt: `Rewrite this voiceover text. Instruction: ${instruction || 'Make it punchier and more engaging while keeping the meaning and roughly the same length.'}

Text:
${text}`,
  });
  return out.trim();
}

