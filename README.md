# ShortsForge

A local, Viblo-style studio for making short vertical videos (YouTube Shorts, TikTok, Reels).

## Install (for everyone on the team)

You need a Windows PC. An NVIDIA graphics card makes rendering faster but isn't required.

1. Download **[ShortsForge (ZIP)](https://github.com/asadpuremarketing-wq/Shortsforge/archive/refs/heads/main.zip)** and unzip it somewhere you'll keep it, for example `Documents\ShortsForge`.
2. Double-click **Start ShortsForge.bat**. The first time, it installs Node.js (if needed) and everything else, which takes a few minutes. Your browser then opens ShortsForge.
   - If Windows shows "Windows protected your PC", click **More info → Run anyway**. This appears because the file was downloaded from the internet.
3. Keep the black window open while you work. Close it to stop ShortsForge.

**Getting updates:** close ShortsForge, double-click **Update ShortsForge.bat**, then start it again. Your projects (in the `data` folder) and keys are kept.

Each person's projects stay on their own computer. No API keys are needed for Video Ranking. Optional keys go in **Settings**.

## For developers

```
npm install     # first time only
npm start       # then open http://localhost:5173
npm test        # automated tests for the core logic
```

## Tools

| Tool | What it does |
|---|---|
| **Video Ranking** | Add up to 7 videos (TikTok, Instagram or YouTube links, or uploads) and rank them. Each one is trimmed to its best moment so the whole video fits your target length. The best moment comes from loudness, motion and cuts, plus Claude or OpenAI looking at frames when a key is set. The editor has a live phone preview with title and rank styling. Extras: rank pop-ups, flash or dip transitions, whooshes, "Number 3!" voice announcements, background music, a watermark, an end screen and undo/redo. |
| **Auto Clipping** | Long video → several shorts. Speaker-following crop, word-by-word captions (fix mistakes by double-clicking a word), zoom punch-ins, emoji pop-ups, AI hook or full AI narration. |
| **Split Screen** | Auto Clipping with your clip on top and gameplay or b-roll underneath. |
| **Video Story** | A Reddit-style post card, then the story is narrated over background footage with captions. |
| **Text Story** | A text-message conversation that plays out bubble by bubble, read aloud by two voices. |
| **Video Commentary** | A script is split into scenes. Each scene gets one of your clips or images (or an AI-generated image), with voiceover and captions. |
| **Thumbnail Maker** | A frame from any of your videos, or an uploaded or AI image, with big outlined text. Outputs 1280×720 or 1080×1920 PNG. |
| **Generate AI Voiceover / Video Transcriber** | Script → audio. Video → text and `.srt`. |
| **Upload to YouTube** | From any finished video, once you connect your channel in Settings (one-time Google setup, steps are on the page). |
| **Storage** | See disk usage, clean temporary files, delete projects. |

## API keys (optional, in Settings)

Everything works without keys, using free local tools. Keys improve quality:

- **Anthropic (Claude)**: picks highlights and best moments (it looks at frames), writes hooks, stories, chat scripts and titles, and plans scenes.
- **OpenAI**: fast transcription, voices, AI images (thumbnails and commentary scenes). Also handles AI writing if no Anthropic key is set.
- **ElevenLabs**: the most realistic voices.
- **YouTube client ID/secret**: direct upload.

Optional `.env` overrides: `CLAUDE_MODEL` (default `claude-opus-5-5`), `OPENAI_MODEL`, `OPENAI_TTS_MODEL`, `OPENAI_IMAGE_MODEL`, `ELEVENLABS_MODEL`, `LOCAL_WHISPER_MODEL`, `DETECT_MODEL`, `ENCODER=cpu` (turn off GPU encoding), `PORT`.

## How it's built

- `server/`: Express API and the video pipeline. ffmpeg comes bundled through npm, and the NVIDIA, Intel or AMD hardware encoder is detected automatically. Local Whisper and person detection run through transformers.js. Story graphics are drawn with @napi-rs/canvas. Links are downloaded with yt-dlp, fetched on first use.
- `public/`: the web app, plain ES modules with no build step.
- `data/`: projects, fonts, models and caches. It's in `.gitignore`.

Only repost videos you have the rights to use.
