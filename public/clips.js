import { $, $$, app, esc, fmtTime, parseTime, api, toast, getStatus, getVoices, resetVoices, voiceOptions, onCleanup, poll } from './core.js';

// ---------- Create ----------

const LEN_PRESETS = { '15-30': [15, 30], '20-60': [20, 60], '30-90': [30, 90], '60-120': [60, 120] };
const form = { file: null, bg: null, name: '', clipCount: 3, len: '20-60', layout: 'blur', captionStyle: 'bold', voiceMode: 'original', voiceId: '', zoom: false, emojis: false };

export function freeModeBanner(s) {
  const p = s.providers;
  if (s.llm && (p.elevenlabs || p.openai)) return '';
  const missing = [];
  if (!s.llm) missing.push('AI highlight picking and script writing (Anthropic or OpenAI key)');
  if (!p.openai) missing.push('faster cloud transcription (OpenAI key)');
  if (!p.elevenlabs && !p.openai) missing.push('realistic AI voices (ElevenLabs or OpenAI key)');
  return `<div class="banner"><div>⚡</div><div><b>Running in free mode.</b> Everything works offline, but you'll get better results with API keys: ${missing.join(', ')}. <a href="#/settings">Add keys in Settings →</a></div></div>`;
}

export async function viewCreate(params) {
  if (params?.get('layout') === 'split') form.layout = 'split';
  const [s, voices] = await Promise.all([getStatus(true), getVoices(true)]);
  const captionSamples = {
    bold: '<span>THIS IS <em>HOW</em></span>',
    green: '<span>THIS IS <em>HOW</em></span>',
    clean: '<span>This is how</span>',
    minimal: '<span>this is <em>how</em></span>',
    none: '<span>—</span>',
  };
  const layoutIcons = {
    crop: '<div class="phone crop"><div class="a"></div></div>',
    blur: '<div class="phone blur"><div class="a"></div></div>',
    split: '<div class="phone split"><div class="a"></div><div class="b"></div></div>',
  };
  const layoutNames = { crop: ['Fill', 'Follows the speaker'], blur: ['Fit', 'Blurred background'], split: ['Split screen', 'Video + background clip'] };

  app.innerHTML = `
    <section class="hero">
      <h1>Turn long videos into <span>viral shorts</span></h1>
      <p>Upload a video. ShortsForge finds the best moments, adds captions and AI voiceover, and exports ready-to-post 9:16 clips.</p>
    </section>
    <div class="stack">
      ${freeModeBanner(s)}
      <div class="dropzone ${form.file ? 'has-file' : ''}" id="drop">
        ${
          form.file
            ? `<video src="${URL.createObjectURL(form.file)}" muted controls></video><div><b>${esc(form.file.name)}</b> <span class="muted">· ${(form.file.size / 1e6).toFixed(1)} MB</span></div><span class="muted small">Click or drop to choose a different video</span>`
            : `<div class="icon">🎬</div><div><b>Drop your video here</b> or click to browse</div><span class="muted small">MP4, MOV, MKV, WebM: podcasts, streams, interviews, vlogs, tutorials</span>`
        }
        <input type="file" id="file" accept="video/*" hidden />
      </div>

      <div class="card options">
        <div class="opt-group">
          <span class="label">Number of clips</span>
          <div class="range-row"><input type="range" id="clipCount" min="1" max="10" value="${form.clipCount}" /><output id="clipCountOut">${form.clipCount}</output></div>
        </div>
        <div class="opt-group">
          <span class="label">Clip length</span>
          <div class="seg" id="len">${Object.keys(LEN_PRESETS).map((k) => `<button data-v="${k}" class="${form.len === k ? 'selected' : ''}">${k.replace('-', '–')}s</button>`).join('')}</div>
        </div>
        <div class="opt-group">
          <span class="label">Layout</span>
          <div class="choices" id="layout">${Object.keys(s.layouts).map((k) => `<div class="choice ${form.layout === k ? 'selected' : ''}" data-v="${k}">${layoutIcons[k]}<div>${layoutNames[k][0]}<br /><small>${layoutNames[k][1]}</small></div></div>`).join('')}</div>
          <div id="bgPick" ${form.layout === 'split' ? '' : 'hidden'} class="row small">
            <button class="btn sm" id="bgBtn">${form.bg ? 'Change background clip' : 'Choose background clip'}</button>
            <span class="muted">${form.bg ? esc(form.bg.name) : 'Gameplay, satisfying loops, b-roll… (plays under your video)'}</span>
            <input type="file" id="bgFile" accept="video/*" hidden />
          </div>
        </div>
        <div class="opt-group">
          <span class="label">Captions</span>
          <div class="choices" id="captionStyle">${Object.entries(s.captionStyles).map(([k, label]) => `<div class="choice ${form.captionStyle === k ? 'selected' : ''}" data-v="${k}"><div class="cap-sample ${k}">${captionSamples[k] || ''}</div>${esc(label)}</div>`).join('')}</div>
        </div>
        <div class="opt-group">
          <span class="label">Voiceover</span>
          <div class="seg" id="voiceMode">
            <button data-v="original" class="${form.voiceMode === 'original' ? 'selected' : ''}">Original audio</button>
            <button data-v="hook" class="${form.voiceMode === 'hook' ? 'selected' : ''}">AI hook intro</button>
            <button data-v="narration" class="${form.voiceMode === 'narration' ? 'selected' : ''}">Full AI narration</button>
          </div>
          <span class="muted small" id="voiceHelp"></span>
        </div>
        <div class="opt-group">
          <span class="label">Extras</span>
          <label class="toggle-row"><span class="switch"><input type="checkbox" id="optZoom" ${form.zoom ? 'checked' : ''} /><span></span></span>Auto zoom punch-ins</label>
          <label class="toggle-row"><span class="switch"><input type="checkbox" id="optEmoji" ${form.emojis ? 'checked' : ''} /><span></span></span>Emoji pop-ups</label>
        </div>
        <div class="opt-group" id="voicePick" ${form.voiceMode === 'original' ? 'hidden' : ''}>
          <span class="label">Voice</span>
          <select id="voiceId"><option value="">Auto (best available)</option>${voiceOptions(voices, form.voiceId)}</select>
          ${voices.filter((g) => g.error).map((g) => `<span class="small" style="color:var(--warn)">${esc(g.label)} unavailable: check your key in <a href="#/settings">Settings</a>.</span>`).join('')}
        </div>
      </div>

      <div class="row" style="justify-content:center">
        <button class="btn primary big" id="go" ${form.file ? '' : 'disabled'}>✨ Generate shorts</button>
      </div>
      <div id="uploadState" hidden class="card stack">
        <div class="spread"><b id="uploadLabel">Uploading…</b><span class="muted" id="uploadPct"></span></div>
        <div class="progress"><div id="uploadBar" style="width:0%"></div></div>
      </div>
    </div>`;

  const voiceHelp = {
    original: 'Keeps the speaker’s voice. Captions follow what they say.',
    hook: 'An AI voice reads a short hook over the first seconds, then the original audio continues.',
    narration: 'An AI voice narrates a new script over the footage (great for faceless channels).',
  };
  $('#voiceHelp').textContent = voiceHelp[form.voiceMode];

  const drop = $('#drop');
  const fileInput = $('#file');
  drop.addEventListener('click', (e) => {
    if (e.target.tagName !== 'VIDEO') fileInput.click();
  });
  fileInput.addEventListener('change', () => setFile(fileInput.files[0]));
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    setFile(e.dataTransfer.files[0]);
  });
  function setFile(f) {
    if (!f) return;
    if (!f.type.startsWith('video/') && !/\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(f.name)) return toast('That doesn’t look like a video file.', true);
    form.file = f;
    viewCreate();
  }

  $('#clipCount').addEventListener('input', (e) => {
    form.clipCount = Number(e.target.value);
    $('#clipCountOut').textContent = form.clipCount;
  });
  const bindChoice = (id, key, after) =>
    $$(`#${id} [data-v]`).forEach((el) =>
      el.addEventListener('click', () => {
        form[key] = el.dataset.v;
        $$(`#${id} [data-v]`).forEach((x) => x.classList.toggle('selected', x === el));
        after?.();
      }),
    );
  bindChoice('len', 'len');
  bindChoice('layout', 'layout', () => ($('#bgPick').hidden = form.layout !== 'split'));
  bindChoice('captionStyle', 'captionStyle');
  bindChoice('voiceMode', 'voiceMode', () => {
    $('#voicePick').hidden = form.voiceMode === 'original';
    $('#voiceHelp').textContent = voiceHelp[form.voiceMode];
  });
  $('#voiceId').addEventListener('change', (e) => (form.voiceId = e.target.value));
  $('#optZoom').addEventListener('change', (e) => (form.zoom = e.target.checked));
  $('#optEmoji').addEventListener('change', (e) => (form.emojis = e.target.checked));
  $('#bgBtn').addEventListener('click', () => $('#bgFile').click());
  $('#bgFile').addEventListener('change', (e) => {
    form.bg = e.target.files[0] || null;
    $('#bgBtn').textContent = form.bg ? 'Change background clip' : 'Choose background clip';
    $('#bgPick span').textContent = form.bg ? form.bg.name : '';
  });

  $('#go').addEventListener('click', () => {
    if (!form.file) return;
    if (form.layout === 'split' && !form.bg) toast('No background clip chosen: split screen will fall back to the blurred layout. You can add one later in the editor.');
    const [minLen, maxLen] = LEN_PRESETS[form.len];
    const fd = new FormData();
    fd.append('video', form.file);
    if (form.bg && form.layout === 'split') fd.append('background', form.bg);
    fd.append('options', JSON.stringify({ clipCount: form.clipCount, minLen, maxLen, layout: form.layout, captionStyle: form.captionStyle, voiceMode: form.voiceMode, voiceId: form.voiceId || null, zoom: form.zoom, emojis: form.emojis }));
    $('#go').disabled = true;
    $('#uploadState').hidden = false;
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/projects');
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      const pct = Math.round((e.loaded / e.total) * 100);
      $('#uploadBar').style.width = pct + '%';
      $('#uploadPct').textContent = pct + '%';
      if (pct === 100) $('#uploadLabel').textContent = 'Reading video…';
    };
    xhr.onload = () => {
      const data = JSON.parse(xhr.responseText || '{}');
      if (xhr.status >= 400) {
        toast(data.error || 'Upload failed', true);
        $('#go').disabled = false;
        $('#uploadState').hidden = true;
        return;
      }
      form.file = null;
      form.bg = null;
      location.hash = `#/p/${data.id}`;
    };
    xhr.onerror = () => {
      toast('Upload failed. Is the server running?', true);
      $('#go').disabled = false;
    };
    xhr.send(fd);
  });
}

// ---------- Projects list ----------

export const STATUS_PILL = {
  queued: '<span class="pill"><span class="dot"></span>Queued</span>',
  processing: '<span class="pill warn"><span class="dot"></span>Processing</span>',
  ready: '<span class="pill ok"><span class="dot"></span>Ready</span>',
  partial: '<span class="pill warn"><span class="dot"></span>Some clips failed</span>',
  error: '<span class="pill err"><span class="dot"></span>Failed</span>',
};

// ---------- Project ----------

function clipCard(p, c) {
  const busy = ['queued', 'rendering', 'pending'].includes(c.status);
  let overlay = '';
  if (busy) {
    const label = c.status === 'rendering' ? `Rendering… <span class="pct">${c.progress || 0}%</span>` : c.status === 'pending' ? 'Waiting to render' : 'Queued';
    overlay = `<div class="overlay"><div class="spinner"></div><div>${label}</div><div class="progress"><div style="width:${c.progress || 0}%"></div></div></div>`;
  } else if (c.status === 'error') {
    overlay = `<div class="overlay"><div style="color:var(--err)">Render failed</div><div class="small muted">${esc(c.error)}</div></div>`;
  }
  const media = c.file && c.status !== 'error' ? `<video src="/files/${p.id}/${c.file}?v=${c.version}" poster="/files/${p.id}/${c.thumb}?v=${c.version}" controls preload="none" playsinline></video>` : '';
  return `
    <div class="clip-card" data-clip="${c.id}">
      <div class="media">${media}${overlay}${c.score ? `<span class="score">🔥 ${c.score}</span>` : ''}</div>
      <div class="body">
        <div class="title">${esc(c.title)}</div>
        <div class="muted small">${fmtTime(c.start)}–${fmtTime(c.end)} · ${Math.round(c.duration || c.end - c.start)}s</div>
        <div class="reason">${esc(c.reason || '')}</div>
        <div class="actions">
          <a class="btn sm" href="#/p/${p.id}/c/${c.id}">✏️ Edit</a>
          ${c.status === 'ready' ? `<a class="btn sm" href="/files/${p.id}/${c.file}?download=1" title="Download">⬇</a><button class="btn sm" data-yt-project="${p.id}" data-yt-file="${c.file}" data-yt-title="${esc(c.title)}" title="Upload to YouTube">▶ YT</button>` : ''}
          <button class="btn sm ghost danger" data-del="${c.id}" title="Delete clip" ${busy ? 'disabled' : ''}>🗑</button>
        </div>
      </div>
    </div>`;
}

export async function viewProject(id) {
  let p = await api('GET', `/api/projects/${id}`);
  app.innerHTML = `
    <div class="stack">
      <div class="spread">
        <div class="stack" style="gap:6px">
          <a href="#/library" class="muted small">← Library</a>
          <div class="row"><h1 id="pname">${esc(p.name)}</h1><span id="pstatus"></span></div>
          <span class="muted small" id="pmeta"></span>
        </div>
        <div class="row" id="pactions"></div>
      </div>
      <div id="pprogress"></div>
      <div id="pnotes"></div>
      <div class="clips" id="clips"></div>
    </div>`;

  const sigs = new Map();
  const update = () => {
    $('#pstatus').innerHTML = STATUS_PILL[p.status] || '';
    $('#pmeta').textContent = `${p.source.name} · ${fmtTime(p.source.duration)} · ${p.source.width}×${p.source.height}${p.transcript ? ` · transcribed with ${p.transcript.provider === 'openai' ? 'OpenAI Whisper' : p.transcript.provider === 'local' ? 'local Whisper' : 'no speech'}` : ''}`;
    const working = ['queued', 'processing'].includes(p.status);
    $('#pprogress').innerHTML = working
      ? `<div class="card stack"><div class="spread"><b>${esc(p.step || 'Working')}…</b><span class="muted">${p.progress || 0}%</span></div><div class="progress"><div style="width:${p.progress || 0}%"></div></div><span class="muted small">You can leave this page; processing continues in the background.</span></div>`
      : p.status === 'error'
        ? `<div class="banner err"><div><b>Processing failed:</b> ${esc(p.error)}</div></div>`
        : '';
    $('#pnotes').innerHTML = (p.notes || []).map((n) => `<div class="banner warn">${esc(n)}</div>`).join('');
    $('#pactions').innerHTML = working
      ? ''
      : `<button class="btn" id="addClip">+ Add clip</button>
         <button class="btn" id="redetect">↻ Re-detect highlights</button>
         ${p.status === 'error' ? '<button class="btn primary" id="retry">Retry</button>' : ''}
         <button class="btn ghost danger" id="delProject">Delete project</button>`;

    const box = $('#clips');
    const ids = new Set(p.clips.map((c) => c.id));
    $$('[data-clip]', box).forEach((el) => {
      if (!ids.has(el.dataset.clip)) {
        el.remove();
        sigs.delete(el.dataset.clip);
      }
    });
    if (!p.clips.length && working) box.innerHTML = '';
    p.clips.forEach((c, i) => {
      const sig = [c.status, c.version, c.title, c.start, c.end, c.error].join('|');
      let el = $(`[data-clip="${c.id}"]`, box);
      if (!el || sigs.get(c.id) !== sig) {
        const tmp = document.createElement('div');
        tmp.innerHTML = clipCard(p, c);
        const fresh = tmp.firstElementChild;
        if (el) el.replaceWith(fresh);
        else box.children[i] ? box.insertBefore(fresh, box.children[i]) : box.appendChild(fresh);
        sigs.set(c.id, sig);
      } else if (c.status === 'rendering') {
        const bar = $('.progress > div', el);
        if (bar) bar.style.width = `${c.progress || 0}%`;
        const pct = $('.pct', el);
        if (pct) pct.textContent = `${c.progress || 0}%`;
      }
    });
    if (!p.clips.length && !working) box.innerHTML = '<div class="empty" style="grid-column:1/-1">No clips yet. Use <b>+ Add clip</b> or re-detect highlights.</div>';
  };
  update();

  app.addEventListener('click', onClick);
  onCleanup(() => app.removeEventListener('click', onClick));
  async function onClick(e) {
    const t = e.target.closest('button');
    if (!t) return;
    try {
      if (t.dataset.del) {
        if (!confirm('Delete this clip?')) return;
        await api('DELETE', `/api/projects/${id}/clips/${t.dataset.del}`);
        p = await api('GET', `/api/projects/${id}`);
        update();
      } else if (t.id === 'addClip') {
        const c = await api('POST', `/api/projects/${id}/clips`, { start: 0 });
        location.hash = `#/p/${id}/c/${c.id}`;
      } else if (t.id === 'redetect') {
        if (!confirm('Find highlights again? This replaces all current clips.')) return;
        p = await api('POST', `/api/projects/${id}/retry`, { redetect: true });
        update();
        startPolling();
      } else if (t.id === 'retry') {
        p = await api('POST', `/api/projects/${id}/retry`, {});
        update();
        startPolling();
      } else if (t.id === 'delProject') {
        if (!confirm('Delete this project and all its clips?')) return;
        await api('DELETE', `/api/projects/${id}`);
        location.hash = '#/library';
      }
    } catch (err) {
      toast(err.message, true);
    }
  }

  const needsPoll = () => ['queued', 'processing'].includes(p.status) || p.clips.some((c) => ['queued', 'rendering', 'pending'].includes(c.status));
  let stop;
  function startPolling() {
    stop?.();
    stop = poll(async () => {
      p = await api('GET', `/api/projects/${id}`);
      update();
      return needsPoll();
    }, 1500);
  }
  if (needsPoll()) startPolling();
}

// ---------- Editor ----------

export async function viewEditor(id, clipId) {
  const [p, transcript, voices, s] = await Promise.all([api('GET', `/api/projects/${id}`), api('GET', `/api/projects/${id}/transcript`), getVoices(), getStatus()]);
  let clip = p.clips.find((c) => c.id === clipId);
  if (!clip) throw new Error('Clip not found');
  const words = transcript.words || [];
  const dur = p.source.duration;
  const draft = { title: clip.title, start: clip.start, end: clip.end, layout: clip.layout, captionStyle: clip.captionStyle, voiceMode: clip.voiceMode, voiceId: clip.voiceId || '', hook: clip.hook || '', narration: clip.narration || '', follow: clip.follow !== false, zoom: Boolean(clip.zoom), emojis: Boolean(clip.emojis) };
  const aiOn = Boolean(s.llm);

  app.innerHTML = `
    <div class="stack">
      <div class="spread">
        <div class="stack" style="gap:6px">
          <a href="#/p/${id}" class="muted small">← ${esc(p.name)}</a>
          <input type="text" id="title" value="${esc(draft.title)}" style="font-size:22px;font-weight:700;background:transparent;border-color:transparent;padding:4px 0" />
        </div>
        <div class="row">
          ${clip.status === 'ready' ? `<a class="btn" id="dl" href="/files/${id}/${clip.file}?download=1">⬇ Download</a><button class="btn" data-yt-project="${id}" data-yt-file="${clip.file}" data-yt-title="${esc(clip.title)}">▶ Upload to YouTube</button>` : ''}
          <button class="btn primary" id="render">▶ Render clip</button>
        </div>
      </div>
      <div class="editor">
        <div class="stack">
          <div class="card stack">
            <video class="source-video" id="src" src="/files/${id}/${p.preview || p.source.file}" preload="metadata" playsinline></video>
            <div class="row">
              <button class="btn sm" id="playSel">▶ Play selection</button>
              <button class="btn sm" id="playPause">⏯ Play / pause</button>
              <span class="muted small" id="now">0:00.0</span>
              <span class="muted small" style="margin-left:auto">Selected: <b id="selLen"></b></span>
            </div>
            <div class="overview" id="overview" title="Whole video: click to jump"><div class="win"></div><div class="clipmark"></div></div>
            <div class="timeline" id="tl">
              <div class="ticks"></div>
              <div class="words"></div>
              <div class="sel"><div class="handle l"></div><div class="handle r"></div></div>
              <div class="playhead"></div>
            </div>
            <div class="time-inputs">
              <label class="field">Start<div class="with-btn"><input type="text" id="startIn" /><button class="btn sm" id="setStart" title="Set start to playhead">⇤ Here</button></div></label>
              <label class="field">End<div class="with-btn"><input type="text" id="endIn" /><button class="btn sm" id="setEnd" title="Set end to playhead">Here ⇥</button></div></label>
            </div>
          </div>
          <div class="card stack">
            <div class="spread"><h3>Transcript</h3><span class="muted small">Click a word to jump there. <span class="kbd">Shift</span>+click sets start, <span class="kbd">Alt</span>+click sets end. Double-click a word to fix it.</span></div>
            <div class="transcript" id="tx">${words.length ? '' : '<span class="muted">No speech was detected in this video.</span>'}</div>
          </div>
        </div>

        <div class="side">
          <div class="output-video-wrap" id="outWrap"></div>
          <div class="card stack">
            <label class="field">Layout<select id="layout">${Object.entries(s.layouts).map(([k, v]) => `<option value="${k}" ${draft.layout === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
            <div id="bgRow" class="row small" ${draft.layout === 'split' ? '' : 'hidden'}>
              <span class="muted">Background: ${p.background ? esc(p.background.name) : '<span style="color:var(--warn)">none (falls back to Fit)</span>'}</span>
              <button class="btn sm" id="bgBtn">${p.background ? 'Replace' : 'Upload'}</button>
              <input type="file" id="bgFile" accept="video/*" hidden />
            </div>
            <div class="stack" style="gap:10px">
              <label class="toggle-row" id="followRow" ${draft.layout === 'crop' ? '' : 'hidden'}><span class="switch"><input type="checkbox" id="optFollow" ${draft.follow ? 'checked' : ''} /><span></span></span>Follow the speaker</label>
              <label class="toggle-row"><span class="switch"><input type="checkbox" id="optZoom" ${draft.zoom ? 'checked' : ''} /><span></span></span>Auto zoom punch-ins</label>
              <label class="toggle-row"><span class="switch"><input type="checkbox" id="optEmoji" ${draft.emojis ? 'checked' : ''} /><span></span></span>Emoji pop-ups</label>
            </div>
            <label class="field">Captions<select id="captionStyle">${Object.entries(s.captionStyles).map(([k, v]) => `<option value="${k}" ${draft.captionStyle === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
            <label class="field">Voiceover<select id="voiceMode">
              <option value="original" ${draft.voiceMode === 'original' ? 'selected' : ''}>Original audio</option>
              <option value="hook" ${draft.voiceMode === 'hook' ? 'selected' : ''}>AI hook intro + original audio</option>
              <option value="narration" ${draft.voiceMode === 'narration' ? 'selected' : ''}>Full AI narration</option>
            </select></label>
            <div id="voiceBox" class="stack" ${draft.voiceMode === 'original' ? 'hidden' : ''}>
              <label class="field">Voice<select id="voiceId"><option value="">Auto (best available)</option>${voiceOptions(voices, draft.voiceId)}</select></label>
              <label class="field" id="hookField" ${draft.voiceMode === 'hook' ? '' : 'hidden'}>
                <span class="spread">Hook line <span class="row" style="gap:4px">${aiOn ? '<button class="btn sm ai-btn" data-ai="hook">✨ Write</button><button class="btn sm ai-btn" data-ai="rewrite-hook">↻ Punch up</button>' : ''}</span></span>
                <textarea id="hook" rows="2" placeholder="Leave empty to auto-write when rendering">${esc(draft.hook)}</textarea>
              </label>
              <label class="field" id="narrField" ${draft.voiceMode === 'narration' ? '' : 'hidden'}>
                <span class="spread">Narration script <span class="row" style="gap:4px">${aiOn ? '<button class="btn sm ai-btn" data-ai="narration">✨ Write</button><button class="btn sm ai-btn" data-ai="rewrite-narration">↻ Punch up</button>' : ''}</span></span>
                <textarea id="narration" rows="7" placeholder="Leave empty to auto-write when rendering">${esc(draft.narration)}</textarea>
                <span class="muted small" id="narrInfo"></span>
              </label>
              ${aiOn ? '' : '<span class="muted small">Tip: add an Anthropic or OpenAI key in <a href="#/settings">Settings</a> to have AI write hooks and scripts.</span>'}
            </div>
          </div>
        </div>
      </div>
    </div>`;

  const video = $('#src');
  const tl = $('#tl');

  // ----- Output preview -----
  const renderOutput = () => {
    const wrap = $('#outWrap');
    const busy = ['queued', 'rendering', 'pending'].includes(clip.status);
    const vid = clip.file && clip.status !== 'error' ? `<video src="/files/${id}/${clip.file}?v=${clip.version}" poster="/files/${id}/${clip.thumb}?v=${clip.version}" controls playsinline></video>` : '';
    let overlay = '';
    if (busy) overlay = `<div class="overlay"><div class="spinner"></div><div>${clip.status === 'rendering' ? `Rendering… ${clip.progress || 0}%` : 'Queued…'}</div><div class="progress"><div style="width:${clip.progress || 0}%"></div></div></div>`;
    else if (clip.status === 'error') overlay = `<div class="overlay"><b style="color:var(--err)">Render failed</b><span class="small">${esc(clip.error)}</span></div>`;
    else if (!clip.file) overlay = `<div class="overlay muted">Not rendered yet. Press <b>Render clip</b>.</div>`;
    const sig = [clip.status, clip.version, clip.progress].join('|');
    if (wrap.dataset.sig === sig) return;
    // Keep the playing <video> element if only progress changed.
    wrap.dataset.sig = sig;
    wrap.innerHTML = vid + overlay;
    $('#render').disabled = busy;
    const dl = $('#dl');
    if (dl) dl.hidden = clip.status !== 'ready';
  };
  renderOutput();

  // ----- Save draft (debounced) -----
  let saveTimer;
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => api('PATCH', `/api/projects/${id}/clips/${clipId}`, draft).catch((err) => toast(err.message, true)), 500);
  };
  onCleanup(() => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      api('PATCH', `/api/projects/${id}/clips/${clipId}`, draft).catch(() => {});
    }
  });

  // ----- Timeline -----
  let win = [0, dur];
  const computeWindow = () => {
    const len = draft.end - draft.start;
    const pad = Math.max(15, len * 0.75);
    win = [Math.max(0, draft.start - pad), Math.min(dur, draft.end + pad)];
    const ticks = $('.ticks', tl);
    const span = win[1] - win[0];
    const step = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600].find((s) => span / s <= 10) || 1200;
    let html = '';
    for (let t = Math.ceil(win[0] / step) * step; t <= win[1]; t += step) html += `<span style="left:${((t - win[0]) / span) * 100}%">${fmtTime(t)}</span>`;
    ticks.innerHTML = html;
    $('.words', tl).innerHTML = words
      .filter((w) => w.e >= win[0] && w.s <= win[1])
      .map((w) => `<i style="left:${((w.s - win[0]) / span) * 100}%;width:${Math.max(0.15, ((w.e - w.s) / span) * 100)}%"></i>`)
      .join('');
    const ov = $('#overview');
    $('.win', ov).style.cssText = `left:${(win[0] / dur) * 100}%;width:${(span / dur) * 100}%`;
  };
  const xToTime = (clientX) => {
    const r = tl.getBoundingClientRect();
    return win[0] + Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * (win[1] - win[0]);
  };
  const drawSel = () => {
    const span = win[1] - win[0];
    const sel = $('.sel', tl);
    sel.style.left = `${((draft.start - win[0]) / span) * 100}%`;
    sel.style.width = `${((draft.end - draft.start) / span) * 100}%`;
    $('.clipmark', $('#overview')).style.cssText = `left:${(draft.start / dur) * 100}%;width:${((draft.end - draft.start) / dur) * 100}%`;
    $('#startIn').value = fmtTime(draft.start, true);
    $('#endIn').value = fmtTime(draft.end, true);
    $('#selLen').textContent = `${(draft.end - draft.start).toFixed(1)}s`;
    $$('#tx .w').forEach((el) => {
      const t = Number(el.dataset.s);
      el.classList.toggle('in', t >= draft.start - 0.05 && t < draft.end);
    });
  };
  const drawPlayhead = () => {
    const span = win[1] - win[0];
    const ph = $('.playhead', tl);
    const t = video.currentTime;
    ph.style.display = t < win[0] || t > win[1] ? 'none' : '';
    ph.style.left = `${((t - win[0]) / span) * 100}%`;
    $('#now').textContent = fmtTime(t, true);
  };

  const snapToWord = (t, edge) => {
    // Snap within 0.25 s to the nearest word boundary for clean cuts.
    let best = t;
    let bestD = 0.25;
    for (const w of words) {
      const b = edge === 'start' ? w.s : w.e;
      const d = Math.abs(b - t);
      if (d < bestD) {
        best = b;
        bestD = d;
      }
    }
    return best;
  };
  const setRange = (start, end) => {
    draft.start = +Math.max(0, Math.min(start, dur - 0.5)).toFixed(2);
    draft.end = +Math.min(dur, Math.max(end, draft.start + 0.5)).toFixed(2);
    drawSel();
    save();
  };

  let drag = null;
  tl.addEventListener('pointerdown', (e) => {
    const t = xToTime(e.clientX);
    if (e.target.classList.contains('handle')) drag = { kind: e.target.classList.contains('l') ? 'l' : 'r' };
    else if (e.target.classList.contains('sel')) drag = { kind: 'move', offset: t - draft.start, len: draft.end - draft.start };
    else {
      video.currentTime = t;
      drawPlayhead();
      return;
    }
    tl.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  tl.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const t = xToTime(e.clientX);
    if (drag.kind === 'l') setRange(Math.min(snapToWord(t, 'start'), draft.end - 0.5), draft.end);
    else if (drag.kind === 'r') setRange(draft.start, Math.max(snapToWord(t, 'end'), draft.start + 0.5));
    else {
      const start = Math.min(Math.max(0, t - drag.offset), dur - drag.len);
      setRange(start, start + drag.len);
    }
    video.currentTime = drag.kind === 'r' ? draft.end : draft.start;
  });
  tl.addEventListener('pointerup', () => {
    if (!drag) return;
    drag = null;
    computeWindow();
    drawSel();
    drawPlayhead();
  });
  $('#overview').addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const t = ((e.clientX - r.left) / r.width) * dur;
    video.currentTime = t;
    const len = draft.end - draft.start;
    if (confirm(`Move this clip to ${fmtTime(t)}?`)) {
      const start = Math.min(t, dur - len);
      setRange(start, start + len);
      computeWindow();
      drawSel();
    }
  });

  $('#startIn').addEventListener('change', (e) => {
    const t = parseTime(e.target.value);
    if (!isNaN(t)) setRange(t, draft.end);
    computeWindow();
    drawSel();
  });
  $('#endIn').addEventListener('change', (e) => {
    const t = parseTime(e.target.value);
    if (!isNaN(t)) setRange(draft.start, t);
    computeWindow();
    drawSel();
  });
  $('#setStart').addEventListener('click', () => {
    setRange(video.currentTime, Math.max(draft.end, video.currentTime + 1));
    computeWindow();
    drawSel();
  });
  $('#setEnd').addEventListener('click', () => {
    setRange(Math.min(draft.start, video.currentTime - 1), video.currentTime);
    computeWindow();
    drawSel();
  });

  let stopAt = null;
  $('#playSel').addEventListener('click', () => {
    video.currentTime = draft.start;
    stopAt = draft.end;
    video.play();
  });
  $('#playPause').addEventListener('click', () => {
    stopAt = null;
    video.paused ? video.play() : video.pause();
  });
  let lastWord = null;
  video.addEventListener('timeupdate', () => {
    if (stopAt !== null && video.currentTime >= stopAt) {
      video.pause();
      stopAt = null;
    }
    drawPlayhead();
    const cur = $$('#tx .w').find((el) => Number(el.dataset.s) <= video.currentTime && Number(el.dataset.e) >= video.currentTime);
    if (cur !== lastWord) {
      lastWord?.classList.remove('now');
      cur?.classList.add('now');
      lastWord = cur;
    }
  });

  // ----- Transcript -----
  if (words.length) {
    // Show the clip with ~90 s of context on each side.
    const from = Math.max(0, draft.start - 90);
    const to = Math.min(dur, draft.end + 90);
    const renderTx = () => {
      $('#tx').innerHTML = words
        .map((w, i) => (w.s >= from && w.s <= to ? `<span class="w" data-i="${i}" data-s="${w.s}" data-e="${w.e}">${esc(w.w)}</span>` : ''))
        .filter(Boolean)
        .join(' ');
      drawSel();
    };
    renderTx();
    $('#tx').addEventListener('dblclick', async (e) => {
      const el = e.target.closest('.w');
      if (!el) return;
      const i = Number(el.dataset.i);
      const fixed = prompt('Fix this word (leave empty to delete it). Re-render the clip to update its captions.', words[i].w);
      if (fixed === null || fixed.trim() === words[i].w) return;
      try {
        const { words: fresh } = await api('POST', `/api/projects/${id}/words`, { i, w: fixed });
        words.splice(0, words.length, ...fresh);
        renderTx();
        toast('Fixed. Render the clip to update its captions.');
      } catch (err) {
        toast(err.message, true);
      }
    });
    $('#tx').addEventListener('click', (e) => {
      const el = e.target.closest('.w');
      if (!el) return;
      const s0 = Number(el.dataset.s);
      const e0 = Number(el.dataset.e);
      if (e.shiftKey) setRange(s0, Math.max(draft.end, s0 + 1));
      else if (e.altKey) setRange(Math.min(draft.start, e0 - 1), e0);
      else video.currentTime = s0;
      computeWindow();
      drawSel();
    });
  }

  computeWindow();
  drawSel();
  video.addEventListener('loadedmetadata', () => {
    video.currentTime = draft.start;
    drawPlayhead();
  });
  // Scroll the transcript so the clip is visible.
  setTimeout(() => {
    const first = $('#tx .w.in');
    const tx = $('#tx');
    if (first) tx.scrollTop = first.offsetTop - tx.clientHeight / 3;
  }, 50);

  // ----- Settings fields -----
  const narrInfo = () => {
    const n = draft.narration.trim().split(/\s+/).filter(Boolean).length;
    $('#narrInfo').textContent = n ? `${n} words ≈ ${Math.round(n / 2.6)}s spoken. The clip length follows the narration.` : 'The clip length follows the narration.';
  };
  narrInfo();
  $('#title').addEventListener('input', (e) => {
    draft.title = e.target.value;
    save();
  });
  $('#layout').addEventListener('change', (e) => {
    draft.layout = e.target.value;
    $('#followRow').hidden = draft.layout !== 'crop';
    $('#bgRow').hidden = draft.layout !== 'split';
    save();
  });
  for (const [elId, key] of [['optFollow', 'follow'], ['optZoom', 'zoom'], ['optEmoji', 'emojis']]) {
    $(`#${elId}`).addEventListener('change', (e) => {
      draft[key] = e.target.checked;
      save();
    });
  }
  $('#captionStyle').addEventListener('change', (e) => {
    draft.captionStyle = e.target.value;
    save();
  });
  $('#voiceMode').addEventListener('change', (e) => {
    draft.voiceMode = e.target.value;
    $('#voiceBox').hidden = draft.voiceMode === 'original';
    $('#hookField').hidden = draft.voiceMode !== 'hook';
    $('#narrField').hidden = draft.voiceMode !== 'narration';
    save();
  });
  $('#voiceId').addEventListener('change', (e) => {
    draft.voiceId = e.target.value;
    save();
  });
  $('#hook').addEventListener('input', (e) => {
    draft.hook = e.target.value;
    save();
  });
  $('#narration').addEventListener('input', (e) => {
    draft.narration = e.target.value;
    narrInfo();
    save();
  });
  $('#bgBtn').addEventListener('click', () => $('#bgFile').click());
  $('#bgFile').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const fd = new FormData();
    fd.append('background', f);
    toast('Uploading background clip…');
    const res = await fetch(`/api/projects/${id}/background`, { method: 'POST', body: fd });
    if (!res.ok) return toast('Upload failed', true);
    toast('Background clip saved. Render to see it.');
    $('#bgRow span').textContent = `Background: ${f.name}`;
  });

  $$('[data-ai]').forEach((b) =>
    b.addEventListener('click', async (e) => {
      e.preventDefault();
      const kind = b.dataset.ai;
      const target = kind.endsWith('hook') ? 'hook' : 'narration';
      const old = b.textContent;
      b.disabled = true;
      b.textContent = '…';
      try {
        const body = kind.startsWith('rewrite') ? { kind: 'rewrite', text: draft[target] } : { kind, start: draft.start, end: draft.end, title: draft.title };
        if (kind.startsWith('rewrite') && !draft[target].trim()) throw new Error('Write or generate some text first.');
        const { text } = await api('POST', `/api/projects/${id}/clips/${clipId}/write`, body);
        draft[target] = text;
        $(`#${target}`).value = text;
        if (target === 'narration') narrInfo();
        save();
      } catch (err) {
        toast(err.message, true);
      } finally {
        b.disabled = false;
        b.textContent = old;
      }
    }),
  );

  // ----- Render -----
  let stopPoll;
  const watch = () => {
    stopPoll?.();
    stopPoll = poll(async () => {
      const fresh = await api('GET', `/api/projects/${id}`);
      clip = fresh.clips.find((c) => c.id === clipId) || clip;
      renderOutput();
      return ['queued', 'rendering', 'pending'].includes(clip.status);
    }, 1000);
  };
  $('#render').addEventListener('click', async () => {
    clearTimeout(saveTimer);
    saveTimer = null;
    try {
      clip = await api('POST', `/api/projects/${id}/clips/${clipId}/render`, draft);
      renderOutput();
      watch();
    } catch (err) {
      toast(err.message, true);
    }
  });
  if (['queued', 'rendering', 'pending'].includes(clip.status)) watch();
}
