// ShortsForge front end: sidebar shell + hash router.
import { $, $$, app, esc, fmtTime, api, toast, getVoices, voiceOptions, runCleanups, poll, openYouTubeUpload } from './core.js';
import { icon } from './icons.js';
import { viewCreate, viewProject, viewEditor, STATUS_PILL } from './clips.js';
import { viewSettings } from './settings.js';
import { viewRankingHome, viewRankingEditor } from './ranking.js';
import { viewStoryHome, viewStoryEditor } from './stories.js';
import { viewThumbnail } from './thumbnail.js';

const ICON = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  library: '<path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  ranking: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>',
  clipping: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 3v18M16 3v18M3 12h5M16 12h5"/>',
  split: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M4 12h16"/>',
  voice: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  transcribe: '<path d="M4 6h16M4 10h10M4 14h16M4 18h8"/>',
  text: '<path d="M4 7V5h16v2M9 19h6M12 5v14"/>',
  story: '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/>',
  commentary: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
  thumbnail: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-8 8"/>',
  storage: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
};
const svg = (name) => `<svg viewBox="0 0 24 24">${ICON[name]}</svg>`;

const TOOLS = [
  { key: 'ranking', href: '#/ranking', name: 'Video Ranking', desc: 'Rank up to 7 TikToks into one countdown video. Best moments are picked automatically.', icon: 'ranking' },
  { key: 'clipping', href: '#/clipping', name: 'Auto Clipping', desc: 'Turn one long video into several viral shorts with captions.', icon: 'clipping' },
  { key: 'split', href: '#/clipping?layout=split', name: 'Split Screen', desc: 'Your clip on top, gameplay or b-roll underneath.', icon: 'split' },
  { key: 'voiceover', href: '#/voiceover', name: 'Generate AI Voiceover', desc: 'Type a script and download a natural AI voice.', icon: 'voice' },
  { key: 'transcriber', href: '#/transcriber', name: 'Video Transcriber', desc: 'Get the text and SRT subtitles of any video.', icon: 'transcribe' },
  { key: 'text', href: '#/story/text', name: 'Text Story', desc: 'A text conversation that plays out bubble by bubble, read by two voices.', icon: 'text' },
  { key: 'video', href: '#/story/video', name: 'Video Story', desc: 'A Reddit-style story narrated over gameplay with captions.', icon: 'story' },
  { key: 'commentary', href: '#/story/commentary', name: 'Video Commentary', desc: 'Turn a script into scenes with voiceover and captions.', icon: 'commentary' },
  { key: 'thumbnail', href: '#/thumbnail', name: 'Thumbnail Maker', desc: 'Bold-text YouTube thumbnails and Shorts covers.', icon: 'thumbnail' },
];

function renderSidebar(active) {
  const item = (key, href, label, icon, soon) =>
    soon
      ? `<span class="nav-item disabled">${svg(icon)}${label}<span class="soon">Soon</span></span>`
      : `<a class="nav-item ${active === key ? 'active' : ''}" href="${href}">${svg(icon)}${label}</a>`;
  $('#sidebar').innerHTML = `
    <a class="brand" href="#/"><span class="logo"><svg viewBox="0 0 32 32"><path d="M12 9l11 7-11 7z" fill="currentColor"/></svg></span>ShortsForge</a>
    ${item('home', '#/', 'Home', 'home')}
    ${item('library', '#/library', 'Library', 'library')}
    <div class="section">All Tools</div>
    ${TOOLS.map((t) => item(t.key, t.href, t.name, t.icon, t.soon)).join('')}
    <div class="spacer"></div>
    ${item('storage', '#/storage', 'Storage', 'storage')}
    ${item('settings', '#/settings', 'Settings', 'settings')}
    <div class="side-foot"><b><span class="live"></span>Running on this PC</b>Your videos stay on your computer.</div>`;
}

// ---------- Router ----------

async function route() {
  runCleanups();
  const [pathPart, query = ''] = (location.hash.replace(/^#/, '') || '/').split('?');
  const params = new URLSearchParams(query);
  const parts = pathPart.split('/').filter(Boolean);
  const [a, b, c, d] = parts;
  const active =
    a === 'p' ? 'clipping' : a === 't' ? 'transcriber' : a === 'story' ? b : a === 'clipping' && params.get('layout') === 'split' ? 'split' : a || 'home';
  renderSidebar(active);
  // The ranking editor uses the full width; every other page is a centered column.
  app.className = (a === 'ranking' && b) || (a === 'story' && c) ? '' : 'page';
  window.scrollTo(0, 0);
  try {
    if (a === 'library') await viewLibrary();
    else if (a === 'settings') await viewSettings();
    else if (a === 'ranking' && b) await viewRankingEditor(b);
    else if (a === 'ranking') await viewRankingHome();
    else if (a === 'story' && c) await viewStoryEditor(c);
    else if (a === 'story') await viewStoryHome(['video', 'text', 'commentary'].includes(b) ? b : 'video');
    else if (a === 'thumbnail') await viewThumbnail(params);
    else if (a === 'storage') await viewStorage();
    else if (a === 'clipping') await viewCreate(params);
    else if (a === 'p' && c === 'c') await viewEditor(b, d);
    else if (a === 'p') await viewProject(b);
    else if (a === 'voiceover') await viewVoiceover();
    else if (a === 'transcriber') await viewTranscriber();
    else if (a === 't') await viewTranscript(b);
    else await viewHome();
  } catch (err) {
    app.innerHTML = `<div class="banner err">${esc(err.message)}</div>`;
  }
}
window.addEventListener('hashchange', route);

// Any button with data-yt-project/file/title opens the YouTube upload dialog.
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-yt-project]');
  if (!b) return;
  e.preventDefault();
  openYouTubeUpload({ projectId: b.dataset.ytProject, file: b.dataset.ytFile, title: b.dataset.ytTitle }).catch((err) => toast(err.message, true));
});

// ---------- Home ----------

function projectHref(p) {
  if (p.type === 'ranking') return `#/ranking/${p.id}`;
  if (p.type === 'transcript') return `#/t/${p.id}`;
  if (p.type === 'story') return `#/story/${p.story.kind}/${p.id}`;
  return `#/p/${p.id}`;
}
const TYPE_LABEL = { ranking: 'Video Ranking', transcript: 'Transcript', clips: 'Auto Clipping', story: 'Story' };

function projectCard(p) {
  let thumbs = [];
  if (p.output?.thumb) thumbs = [`/files/${p.id}/${p.output.thumb}?v=${p.output.version}`];
  else if (p.clips) thumbs = p.clips.filter((c) => c.thumb).slice(0, 4).map((c) => `/files/${p.id}/${c.thumb}?v=${c.version}`);
  const meta =
    p.type === 'story'
      ? `${{ video: 'Video Story', text: 'Text Story', commentary: 'Commentary' }[p.story.kind]}${p.output ? ` · ${fmtTime(p.output.duration)}` : ''}`
      : p.type === 'ranking'
      ? `${p.ranking.items.length} ranked videos${p.output ? ` · ${fmtTime(p.output.duration)}` : ''}`
      : p.type === 'transcript'
        ? `${fmtTime(p.source.duration)} audio`
        : `${p.clips.length} clips · ${fmtTime(p.source.duration)} source`;
  const pill = p.status === 'draft' ? '<span class="pill">Draft</span>' : STATUS_PILL[p.status] || '';
  return `
    <a class="project-card" href="${projectHref(p)}">
      <div class="thumbs">${thumbs.length ? thumbs.map((t) => `<img src="${t}" alt="" />`).join('') : '<div class="ph"></div><div class="ph"></div><div class="ph"></div>'}</div>
      <div class="spread"><b>${esc(p.name)}</b>${pill}</div>
      <span class="muted small"><span class="badge">${TYPE_LABEL[p.type || 'clips']}</span> ${meta} · ${new Date(p.createdAt).toLocaleDateString()}</span>
    </a>`;
}

async function viewHome() {
  const projects = await api('GET', '/api/projects');
  const rankings = projects.filter((p) => p.type === 'ranking');
  const others = TOOLS.filter((t) => t.key !== 'ranking');
  app.innerHTML = `
    <div class="stack" style="gap:30px">
      <section class="home-hero">
        <div class="stack" style="gap:10px;max-width:560px">
          <span class="badge blue" style="align-self:flex-start">Video Ranking</span>
          <h1>Make a <em>ranking video</em><br />in minutes</h1>
          <p class="muted" style="margin:0;font-size:16px">Paste up to 7 TikTok or YouTube links, put them in order, and ShortsForge trims the best moments, adds your title and rank list, and renders a ready-to-post Short.</p>
          <div class="row" style="margin-top:6px"><button class="btn primary big" id="homeNew">${icon('plus', 18)} New ranking video</button>${rankings.length ? '<a class="btn" href="#/ranking">See all rankings</a>' : ''}</div>
        </div>
        <ol class="home-steps">
          <li><b>Add videos</b><span>Links or files, ranked #1 to #7</span></li>
          <li><b>Style it</b><span>Title, colors, emoji, effects</span></li>
          <li><b>Generate</b><span>1080×1920 MP4, ready for YouTube</span></li>
        </ol>
      </section>
      ${
        projects.length
          ? `<section class="stack"><div class="spread"><h2>Continue where you left off</h2><a href="#/library" class="muted small">Library →</a></div><div class="project-list">${projects.slice(0, 4).map(projectCard).join('')}</div></section>`
          : ''
      }
      <section class="stack">
        <h2>More tools</h2>
        <div class="tool-grid compact">
          ${others
            .map(
              (t) => `
            <a class="tool-card ${t.soon ? 'soon' : ''}" ${t.href ? `href="${t.href}"` : ''}>
              <div class="row" style="gap:12px;flex-wrap:nowrap"><div class="ic">${svg(t.icon)}</div><b>${t.name}</b></div>
              <span>${t.desc}</span>
            </a>`,
            )
            .join('')}
        </div>
      </section>
    </div>`;
  $('#homeNew').addEventListener('click', async () => {
    const p = await api('POST', '/api/rankings', { name: 'Untitled ranking' });
    location.hash = `#/ranking/${p.id}`;
  });
}

// ---------- Library ----------

async function viewLibrary() {
  const render = async () => {
    const projects = await api('GET', '/api/projects');
    app.innerHTML = `
      <div class="spread" style="margin-bottom:20px"><h1>Library</h1><div class="row"><a class="btn" href="#/clipping">+ Auto Clipping</a><a class="btn primary" href="#/ranking">+ Video Ranking</a></div></div>
      ${projects.length ? `<div class="project-list">${projects.map(projectCard).join('')}</div>` : '<div class="empty">Nothing here yet. Pick a tool from the sidebar to make your first video.</div>'}`;
    return projects.some((p) => ['queued', 'processing'].includes(p.status));
  };
  if (await render()) poll(render, 2500);
}

// ---------- Generate AI Voiceover ----------

async function viewVoiceover() {
  const voices = await getVoices();
  app.innerHTML = `
    <div class="stack" style="max-width:760px">
      <div class="stack" style="gap:6px"><h1>Generate AI Voiceover</h1><span class="muted">Type a script, pick a voice, and download the audio.</span></div>
      <div class="panel">
        <label class="field">Script<textarea id="vo-text" rows="8" placeholder="Type what the voice should say…"></textarea></label>
        <div class="spread"><span class="muted small" id="vo-count">0 characters</span></div>
        <label class="field">Voice<select id="vo-voice"><option value="">Auto (best available)</option>${voiceOptions(voices, '')}</select></label>
        <div class="row"><button class="btn primary" id="vo-go">🎙 Generate voiceover</button></div>
        <div id="vo-out"></div>
      </div>
    </div>`;
  $('#vo-text').addEventListener('input', (e) => ($('#vo-count').textContent = `${e.target.value.length} characters`));
  $('#vo-go').addEventListener('click', async () => {
    const btn = $('#vo-go');
    btn.disabled = true;
    btn.textContent = 'Generating…';
    try {
      const out = await api('POST', '/api/tools/voiceover', { text: $('#vo-text').value, voiceId: $('#vo-voice').value || null });
      $('#vo-out').innerHTML = `<div class="stack"><audio controls src="${out.url}" style="width:100%"></audio><div class="row"><a class="btn" href="${out.url}?download=1">⬇ Download audio</a><span class="muted small">${out.duration.toFixed(1)}s</span></div></div>`;
    } catch (err) {
      toast(err.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = '🎙 Generate voiceover';
    }
  });
}

// ---------- Video Transcriber ----------

async function viewTranscriber() {
  const projects = (await api('GET', '/api/projects')).filter((p) => p.type === 'transcript');
  app.innerHTML = `
    <div class="stack" style="max-width:860px">
      <div class="stack" style="gap:6px"><h1>Video Transcriber</h1><span class="muted">Upload a video or audio file to get its transcript and SRT subtitles.</span></div>
      <div class="dropzone" id="drop"><div class="icon">📝</div><div><b>Drop a video or audio file</b> or click to browse</div><input type="file" id="file" accept="video/*,audio/*" hidden /></div>
      <div id="up" hidden class="card stack"><div class="spread"><b>Uploading…</b><span class="muted" id="pct"></span></div><div class="progress"><div id="bar" style="width:0%"></div></div></div>
      ${projects.length ? `<h2>Previous transcripts</h2><div class="project-list">${projects.map(projectCard).join('')}</div>` : ''}
    </div>`;
  const send = (file) => {
    if (!file) return;
    const fd = new FormData();
    fd.append('video', file);
    $('#up').hidden = false;
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/transcribe');
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      const pct = Math.round((e.loaded / e.total) * 100);
      $('#bar').style.width = `${pct}%`;
      $('#pct').textContent = `${pct}%`;
    };
    xhr.onload = () => {
      const data = JSON.parse(xhr.responseText || '{}');
      if (xhr.status >= 400) {
        $('#up').hidden = true;
        return toast(data.error || 'Upload failed', true);
      }
      location.hash = `#/t/${data.id}`;
    };
    xhr.send(fd);
  };
  $('#drop').addEventListener('click', () => $('#file').click());
  $('#file').addEventListener('change', (e) => send(e.target.files[0]));
  $('#drop').addEventListener('dragover', (e) => e.preventDefault());
  $('#drop').addEventListener('drop', (e) => {
    e.preventDefault();
    send(e.dataTransfer.files[0]);
  });
}

async function viewTranscript(id) {
  const render = async () => {
    const p = await api('GET', `/api/projects/${id}`);
    const done = p.status === 'ready';
    let text = '';
    if (done) {
      const t = await api('GET', `/api/projects/${id}/transcript`);
      text = t.words.map((w) => w.w).join(' ');
    }
    app.innerHTML = `
      <div class="stack" style="max-width:860px">
        <a href="#/transcriber" class="muted small">← Video Transcriber</a>
        <div class="spread"><h1>${esc(p.name)}</h1>${STATUS_PILL[p.status] || ''}</div>
        ${
          done
            ? `<div class="row"><a class="btn" href="/api/projects/${id}/export.txt">⬇ Text (.txt)</a><a class="btn" href="/api/projects/${id}/export.srt">⬇ Subtitles (.srt)</a><button class="btn" id="copy">Copy text</button></div>
               <div class="card" style="white-space:pre-wrap;line-height:1.7">${esc(text) || '<span class="muted">No speech found.</span>'}</div>`
            : p.status === 'error'
              ? `<div class="banner err">${esc(p.error)}</div>`
              : `<div class="card stack"><div class="spread"><b>${esc(p.step || 'Working')}…</b><span class="muted">${p.progress || 0}%</span></div><div class="progress"><div style="width:${p.progress || 0}%"></div></div></div>`
        }
      </div>`;
    $('#copy')?.addEventListener('click', async () => {
      await navigator.clipboard.writeText(text);
      toast('Copied.');
    });
    return !done && p.status !== 'error';
  };
  if (await render()) poll(render, 1500);
}

// ---------- Storage ----------

const fmtSize = (b) => (b > 1e9 ? `${(b / 1e9).toFixed(2)} GB` : b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1e3)} KB`);

async function viewStorage() {
  const [st, status] = await Promise.all([api('GET', '/api/storage'), api('GET', '/api/status')]);
  const total = st.projects.reduce((n, p) => n + p.size, 0) + Object.values(st.caches).reduce((n, v) => n + v, 0);
  app.innerHTML = `
    <div class="stack" style="gap:20px;max-width:900px">
      <div class="stack" style="gap:6px"><h1>Storage</h1><span class="muted">Everything lives in the <span class="kbd">data</span> folder: ${fmtSize(total)} in total. Video encoding uses <b>${esc(status.encoder)}</b>.</span></div>
      <div class="panel">
        <div class="spread"><div><b>Temporary files</b><div class="muted small">Voice caches, subtitle files, frames and leftover uploads. Rebuilt automatically when needed.</div></div><div class="row"><b>${fmtSize(st.caches.rebuildable)}</b><button class="btn sm" data-clean="rebuildable">Clean up</button></div></div>
        <div class="spread"><div><b>AI models</b><div class="muted small">Local Whisper and person detection. Downloaded again on next use.</div></div><div class="row"><b>${fmtSize(st.caches.models)}</b><button class="btn sm" data-clean="models">Delete</button></div></div>
        <div class="spread"><div><b>Link downloader and fonts</b><div class="muted small">Small, kept.</div></div><b>${fmtSize(st.caches.downloader + st.caches.fonts)}</b></div>
      </div>
      <div class="panel">
        <h2>Projects (largest first)</h2>
        ${
          st.projects.length
            ? st.projects
                .map((p) => `<div class="spread"><div><a href="${projectHref({ ...p, story: { kind: '' } })}" data-proj="${p.id}">${esc(p.name)}</a> <span class="badge">${TYPE_LABEL[p.type] || p.type}</span></div><div class="row"><b>${fmtSize(p.size)}</b><button class="btn sm ghost danger" data-del="${p.id}">Delete</button></div></div>`)
                .join('')
            : '<span class="muted">No projects.</span>'
        }
      </div>
    </div>`;
  $$('[data-clean]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (b.dataset.clean === 'models' && !confirm('Delete downloaded AI models? They download again (a few hundred MB) next time they are needed.')) return;
      await api('POST', '/api/storage/clean', { what: b.dataset.clean });
      toast('Cleaned up.');
      viewStorage();
    }),
  );
  $$('[data-del]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('Delete this project and all its files? This cannot be undone.')) return;
      try {
        await api('DELETE', `/api/projects/${b.dataset.del}`);
        viewStorage();
      } catch (err) {
        toast(err.message, true);
      }
    }),
  );
  // Story links need the kind, which the storage list doesn't carry; resolve on click.
  $$('[data-proj]').forEach((a) =>
    a.addEventListener('click', async (e) => {
      e.preventDefault();
      location.hash = projectHref(await api('GET', `/api/projects/${a.dataset.proj}`)).slice(1);
    }),
  );
}

route();
