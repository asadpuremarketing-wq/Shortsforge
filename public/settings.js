import { $, $$, app, esc, fmtTime, parseTime, api, toast, getStatus, getVoices, resetVoices, voiceOptions, onCleanup, poll } from './core.js';

// ---------- Settings ----------

export async function viewSettings() {
  const [keys, s, voices, yt] = await Promise.all([api('GET', '/api/settings'), getStatus(true), getVoices(true), api('GET', '/api/youtube/status')]);
  const eleven = voices.find((g) => g.provider === 'elevenlabs');
  const rows = [
    {
      key: 'ANTHROPIC_API_KEY',
      name: 'Anthropic (Claude)',
      on: s.providers.anthropic,
      url: 'https://console.anthropic.com/settings/keys',
      unlocks: ['Picks the most viral moments (used first when set)', 'Writes hooks and narration scripts; "Punch up" rewrites'],
    },
    {
      key: 'OPENAI_API_KEY',
      name: 'OpenAI',
      on: s.providers.openai,
      url: 'https://platform.openai.com/api-keys',
      unlocks: ['Fast cloud transcription with Whisper', '11 AI voices', 'AI highlights and writing if no Anthropic key is set'],
    },
    {
      key: 'ELEVENLABS_API_KEY',
      name: 'ElevenLabs',
      on: s.providers.elevenlabs && !eleven?.error,
      error: eleven?.error,
      url: 'https://elevenlabs.io/app/settings/api-keys',
      unlocks: ['The most realistic AI voices, including your own cloned voices', 'Exact word timing for narration captions'],
    },
  ];
  app.innerHTML = `
    <div class="settings-grid">
      <div class="stack" style="gap:6px"><h1>Settings</h1><span class="muted">Keys are stored only on this computer, in the <span class="kbd">.env</span> file in the app folder. Without keys, ShortsForge runs fully offline with free tools.</span></div>
      ${rows
        .map(
          (r) => `
        <div class="card stack">
          <div class="spread"><h2>${r.name}</h2>${r.error ? '<span class="pill err"><span class="dot"></span>Key rejected</span>' : r.on ? '<span class="pill ok"><span class="dot"></span>Connected</span>' : '<span class="pill"><span class="dot"></span>Not set</span>'}</div>
          <ul class="unlocks">${r.unlocks.map((u) => `<li>${u}</li>`).join('')}</ul>
          ${r.error ? `<div class="banner err small"><div>${esc(r.error)}</div></div>` : ''}
          <div class="key-row">
            <label class="field">API key <input type="password" data-key="${r.key}" placeholder="${keys[r.key] ? `Current: ${esc(keys[r.key])}` : 'Paste key'}" autocomplete="off" /></label>
            <div class="row" style="gap:6px">${keys[r.key] ? `<button class="btn" data-clear="${r.key}">Remove</button>` : ''}<a class="btn ghost" href="${r.url}" target="_blank" rel="noreferrer">Get a key ↗</a></div>
          </div>
        </div>`,
        )
        .join('')}
      <div class="card stack">
        <div class="spread"><h2>YouTube upload</h2>${yt.connected ? `<span class="pill ok"><span class="dot"></span>Connected${yt.channel ? `: ${esc(yt.channel)}` : ''}</span>` : yt.configured ? '<span class="pill warn"><span class="dot"></span>Not connected</span>' : '<span class="pill"><span class="dot"></span>Not set up</span>'}</div>
        <ul class="unlocks"><li>Upload finished videos straight to your channel as Shorts (private, unlisted or public).</li></ul>
        <details ${yt.configured ? '' : 'open'}><summary class="small" style="cursor:pointer">One-time setup (about 5 minutes)</summary>
          <ol class="unlocks" style="line-height:1.8">
            <li>Open <a href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noreferrer">Google Cloud Console</a> and create a project (any name).</li>
            <li>Enable the <a href="https://console.cloud.google.com/apis/library/youtube.googleapis.com" target="_blank" rel="noreferrer">YouTube Data API v3</a>.</li>
            <li>Under <b>OAuth consent screen</b>, choose External, fill in the app name and your email, and add yourself as a <b>test user</b>.</li>
            <li>Under <b>Credentials → Create credentials → OAuth client ID</b>, choose <b>Web application</b> and add this authorized redirect URI: <span class="kbd">${esc(yt.redirect)}</span></li>
            <li>Paste the client ID and secret below, click <b>Save keys</b>, then <b>Connect YouTube</b>.</li>
          </ol>
        </details>
        <div class="two">
          <label class="field">Client ID<input type="password" data-key="YOUTUBE_CLIENT_ID" placeholder="${keys.YOUTUBE_CLIENT_ID ? `Current: ${esc(keys.YOUTUBE_CLIENT_ID)}` : 'Paste client ID'}" autocomplete="off" /></label>
          <label class="field">Client secret<input type="password" data-key="YOUTUBE_CLIENT_SECRET" placeholder="${keys.YOUTUBE_CLIENT_SECRET ? `Current: ${esc(keys.YOUTUBE_CLIENT_SECRET)}` : 'Paste client secret'}" autocomplete="off" /></label>
        </div>
        <div class="row">${yt.configured ? (yt.connected ? '<button class="btn" id="ytOff">Disconnect</button>' : '<a class="btn primary" href="/api/youtube/connect">Connect YouTube</a>') : ''}</div>
      </div>
      <div class="row"><button class="btn primary" id="saveKeys">Save keys</button></div>
      <div class="card stack">
        <h2>Free fallbacks in use</h2>
        <ul class="unlocks">
          <li>Transcription: ${s.providers.openai ? 'OpenAI Whisper (cloud)' : 'Whisper running locally on your computer'}</li>
          <li>Highlights: ${s.llm === 'anthropic' ? 'Claude' : s.llm === 'openai' ? 'OpenAI' : 'built-in picker (speech density, hook words, complete sentences)'}</li>
          <li>Voices: ${voices.filter((g) => g.voices.length).map((g) => `${esc(g.label)} (${g.voices.length})`).join(', ') || 'none'}</li>
        </ul>
      </div>
    </div>`;

  $('#ytOff')?.addEventListener('click', async () => {
    await api('DELETE', '/api/youtube');
    viewSettings();
  });
  $('#saveKeys').addEventListener('click', async () => {
    const body = {};
    $$('[data-key]').forEach((el) => {
      if (el.value.trim()) body[el.dataset.key] = el.value.trim();
    });
    if (!Object.keys(body).length) return toast('Paste a key first.');
    await api('POST', '/api/settings', body);
    resetVoices();
    toast('Saved.');
    viewSettings();
  });
  $$('[data-clear]').forEach((b) =>
    b.addEventListener('click', async () => {
      await api('POST', '/api/settings', { [b.dataset.clear]: '' });
      resetVoices();
      toast('Removed.');
      viewSettings();
    }),
  );
}
