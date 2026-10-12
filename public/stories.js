// Story tools: Video Story (Reddit-style), Text Story (chat), Video Commentary (script → scenes).
import { $, $$, app, esc, fmtTime, api, toast, getStatus, getVoices, voiceOptions, onCleanup, poll } from './core.js';

export const STORY_KINDS = {
  video: { name: 'Video Story', desc: 'A Reddit-style post read aloud over background footage, with word-by-word captions.' },
  text: { name: 'Text Story', desc: 'A text-message conversation that plays out bubble by bubble, read by two voices.' },
  commentary: { name: 'Video Commentary', desc: 'Your script becomes scenes: each line gets a clip or image, with voiceover and captions.' },
};
const BUSY = ['queued', 'processing'];

export async function viewStoryHome(kind) {
  const meta = STORY_KINDS[kind];
  const projects = (await api('GET', '/api/projects')).filter((p) => p.type === 'story' && p.story.kind === kind);
  app.innerHTML = `
    <div class="stack" style="gap:24px">
      <div class="spread">
        <div class="stack" style="gap:6px"><h1>${meta.name}</h1><span class="muted">${meta.desc}</span></div>
        <button class="btn primary big" id="new">+ New ${meta.name.toLowerCase()}</button>
      </div>
      <h2>Recently created</h2>
      ${
        projects.length
          ? `<div class="project-list">${projects
              .map(
                (p) => `<a class="project-card" href="#/story/${kind}/${p.id}">
                  <div class="thumbs">${p.output?.thumb ? `<img src="/files/${p.id}/${p.output.thumb}?v=${p.output.version}" alt="" />` : '<div class="ph"></div>'}</div>
                  <div class="spread"><b>${esc(p.name)}</b>${p.output ? '<span class="pill ok"><span class="dot"></span>Rendered</span>' : '<span class="pill">Draft</span>'}</div>
                  <span class="muted small">${new Date(p.createdAt).toLocaleDateString()}</span></a>`,
              )
              .join('')}</div>`
          : `<div class="empty">No ${meta.name.toLowerCase()} videos yet.</div>`
      }
    </div>`;
  $('#new').addEventListener('click', async () => {
    const p = await api('POST', '/api/stories', { kind });
    location.hash = `#/story/${kind}/${p.id}`;
  });
}

export async function viewStoryEditor(id) {
  const [P0, s, voices] = await Promise.all([api('GET', `/api/stories/${id}`), getStatus(), getVoices()]);
  let P = P0;
  const S = P.story;
  const kind = S.kind;
  const meta = STORY_KINDS[kind];
  let tab = P.output ? 'final' : 'preview';
  const vopts = (sel) => `<option value="">Auto (best available)</option>${voiceOptions(voices, sel)}`;
  const capOpts = Object.entries(s.captionStyles)
    .map(([k, v]) => `<option value="${k}" ${S.captionStyle === k ? 'selected' : ''}>${esc(v)}</option>`)
    .join('');

  const kindPanel = {
    video: `
      <section class="panel">
        <div class="panel-head"><h2>Story</h2><span class="muted small" id="estimate"></span></div>
        <div class="two">
          <label class="field">Community / username<input type="text" data-f="username" value="${esc(S.username)}" /></label>
          <label class="field">Post title (read first)<input type="text" data-f="title" value="${esc(S.title)}" /></label>
        </div>
        <label class="field">Story<textarea data-f="body" rows="10" placeholder="Write the story, or let AI write it…">${esc(S.body)}</textarea></label>
      </section>`,
    text: `
      <section class="panel">
        <div class="panel-head"><h2>Conversation</h2><span class="muted small" id="estimate"></span></div>
        <div class="two">
          <label class="field">Contact name<input type="text" data-f="contactName" value="${esc(S.contactName)}" /></label>
          <div class="stack" style="gap:8px"><span class="label">Theme</span><div class="seg" id="themeSeg"><button data-v="dark">Dark</button><button data-v="light">Light</button></div></div>
        </div>
        <div class="stack" id="msgs" style="gap:8px"></div>
        <div class="row"><button class="btn sm" data-add="left">+ Message from them</button><button class="btn sm" data-add="right">+ Message from me</button></div>
      </section>`,
    commentary: `
      <section class="panel">
        <div class="panel-head"><h2>Script</h2><span class="muted small" id="estimate"></span></div>
        <textarea data-f="script" rows="8" placeholder="Write the voiceover script, or let AI write it…">${esc(S.script)}</textarea>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Clips &amp; images</h2><button class="btn sm" id="mediaPick">⬆ Add files</button></div>
        <input type="file" id="mediaIn" accept="video/*,image/*" multiple hidden />
        <div id="mediaGrid" class="row" style="gap:10px;align-items:flex-start"></div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Scenes</h2><div class="row" style="gap:6px"><button class="btn sm" id="planBtn">${s.llm ? '✨ Plan scenes with AI' : 'Split into scenes'}</button>${s.images ? '<button class="btn sm" id="imgBtn">🎨 AI images for empty scenes</button>' : ''}</div></div>
        <div id="scenes" class="stack" style="gap:10px"></div>
        <span class="muted small">Without a plan, the script is split every two sentences and media is used in order.${s.images ? '' : ' Add an OpenAI key in Settings to generate images for scenes.'}</span>
      </section>`,
  }[kind];

  app.innerHTML = `
    <div class="rk">
      <div class="rk-main">
        <div class="page-head">
          <div class="row" style="gap:14px;flex:1;min-width:0"><h1>${meta.name}</h1><input type="text" id="pname" value="${esc(P.name)}" style="max-width:320px;padding:8px 12px" /></div>
          <a class="btn sm" href="#/story/${kind}">🕘 Recently Created</a>
        </div>
        <div class="content">
          ${
            s.llm
              ? `<section class="panel"><div class="panel-head"><h2>✨ Write with AI</h2></div><div class="link-row"><div class="input-box"><input type="text" id="idea" placeholder="${kind === 'text' ? 'e.g. a kid explaining to mom why the dog is blue' : kind === 'video' ? 'e.g. a coworker who secretly owned the company' : 'e.g. why octopuses are basically aliens'}" /></div><button class="btn primary" id="writeBtn">Write it</button></div></section>`
              : '<div class="banner"><div>Tip: add an Anthropic or OpenAI key in <a href="#/settings">Settings</a> and AI can write the whole thing from a one-line idea.</div></div>'
          }
          ${kindPanel}
          <section class="panel">
            <div class="panel-head"><h2>Voice &amp; captions</h2></div>
            ${
              kind === 'text'
                ? `<label class="toggle-row"><span class="switch"><input type="checkbox" data-f="readAloud" ${S.readAloud ? 'checked' : ''} /><span></span></span>Read messages aloud</label>
                   <div class="two"><label class="field">Their voice<select data-f="voiceLeft">${vopts(S.voiceLeft)}</select></label><label class="field">My voice<select data-f="voiceRight">${vopts(S.voiceRight)}</select></label></div>`
                : `<div class="two"><label class="field">Voice<select data-f="voiceId">${vopts(S.voiceId)}</select></label><label class="field">Captions<select data-f="captionStyle">${capOpts}</select></label></div>`
            }
          </section>
          <section class="panel">
            <div class="panel-head"><h2>Background &amp; music</h2></div>
            ${kind === 'commentary' ? '' : '<div class="stack" style="gap:8px"><span class="label">Background video</span><div class="row" id="bgRow"></div></div>'}
            <div class="stack" style="gap:8px"><span class="label">Music</span><div class="row" id="musicRow"></div>
              <div class="slider-box" id="musicVol"><span class="small muted">Volume</span><input type="range" min="0" max="0.6" step="0.01" data-f="musicVolume" value="${S.musicVolume}" /></div></div>
            <input type="file" id="upIn" hidden />
          </section>
        </div>
        <div class="render-bar" id="renderBar"></div>
      </div>
      <aside class="rk-preview">
        <div class="pv-tabs"><button data-tab="preview">Preview</button><button data-tab="final">Final video</button></div>
        <div id="pvBox" class="stack" style="align-items:center;gap:14px"></div>
      </aside>
    </div>`;

  // ---------- Saving ----------
  let timer = null;
  let saving = Promise.resolve();
  const payload = () => ({ name: P.name, story: S });
  function scheduleSave() {
    clearTimeout(timer);
    timer = setTimeout(save, 600);
  }
  function save() {
    clearTimeout(timer);
    timer = null;
    const body = payload();
    saving = saving.then(() => api('PUT', `/api/stories/${id}`, body)).then((fresh) => {
      P = { ...P, ...fresh, story: S };
      if (kind === 'text') refreshChat();
    }).catch((err) => toast(err.message, true));
    return saving;
  }
  onCleanup(() => timer && save());
  const replaceStory = (fresh) => {
    Object.keys(S).forEach((k) => delete S[k]);
    Object.assign(S, fresh.story);
    P = fresh;
  };

  // ---------- Fields ----------
  app.addEventListener('input', onField);
  app.addEventListener('change', onField);
  onCleanup(() => {
    app.removeEventListener('input', onField);
    app.removeEventListener('change', onField);
  });
  function onField(e) {
    const el = e.target;
    if (el.id === 'pname') {
      P.name = el.value;
      return scheduleSave();
    }
    if (el.dataset.msg !== undefined) {
      S.messages[Number(el.dataset.msg)].text = el.value;
      return scheduleSave();
    }
    if (el.dataset.scene !== undefined) {
      S.scenes[Number(el.dataset.scene)][el.dataset.key] = el.value;
      return scheduleSave();
    }
    const f = el.dataset.f;
    if (!f) return;
    S[f] = el.type === 'checkbox' ? el.checked : el.type === 'range' ? Number(el.value) : el.value;
    if (f === 'script') S.scenes = [];
    estimate();
    renderPreview();
    scheduleSave();
  }

  function estimate() {
    const el = $('#estimate');
    if (!el) return;
    const text = kind === 'video' ? `${S.title} ${S.body}` : kind === 'text' ? S.messages.map((m) => m.text).join(' ') : S.script;
    const words = (text || '').split(/\s+/).filter(Boolean).length;
    el.textContent = `${words} words ≈ ${fmtTime(words / 2.6 + (kind === 'text' ? S.messages.length * 0.5 : 0))}`;
  }

  // ---------- Text story messages ----------
  function renderMsgs() {
    const box = $('#msgs');
    if (!box) return;
    box.innerHTML = S.messages
      .map(
        (m, i) => `<div class="row" style="gap:8px;flex-wrap:nowrap">
          <button class="btn sm" data-side="${i}" style="min-width:76px;${m.side === 'right' ? 'background:#0b84ff;border-color:#0b84ff;color:#fff' : ''}">${m.side === 'right' ? 'Me' : 'Them'}</button>
          <input type="text" data-msg="${i}" value="${esc(m.text)}" style="flex:1" />
          <button class="btn sm ghost" data-mv="${i}:-1" title="Up" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button class="btn sm ghost" data-mv="${i}:1" title="Down" ${i === S.messages.length - 1 ? 'disabled' : ''}>↓</button>
          <button class="btn sm ghost danger" data-rm="${i}" title="Delete">🗑</button>
        </div>`,
      )
      .join('');
    $$('[data-side]', box).forEach((b) => b.addEventListener('click', () => {
      const m = S.messages[Number(b.dataset.side)];
      m.side = m.side === 'right' ? 'left' : 'right';
      renderMsgs();
      scheduleSave();
    }));
    $$('[data-rm]', box).forEach((b) => b.addEventListener('click', () => {
      S.messages.splice(Number(b.dataset.rm), 1);
      renderMsgs();
      scheduleSave();
    }));
    $$('[data-mv]', box).forEach((b) => b.addEventListener('click', () => {
      const [i, d] = b.dataset.mv.split(':').map(Number);
      const [m] = S.messages.splice(i, 1);
      S.messages.splice(i + d, 0, m);
      renderMsgs();
      scheduleSave();
    }));
    estimate();
  }
  $$('[data-add]').forEach((b) => b.addEventListener('click', () => {
    S.messages.push({ side: b.dataset.add, text: '' });
    renderMsgs();
    $(`[data-msg="${S.messages.length - 1}"]`)?.focus();
  }));
  $$('#themeSeg button').forEach((b) => b.addEventListener('click', () => {
    S.theme = b.dataset.v;
    $$('#themeSeg button').forEach((x) => x.classList.toggle('selected', x === b));
    scheduleSave();
  }));
  $$('#themeSeg button').forEach((x) => x.classList.toggle('selected', x.dataset.v === S.theme));

  // ---------- Commentary media + scenes ----------
  function renderMedia() {
    const grid = $('#mediaGrid');
    if (!grid) return;
    grid.innerHTML = S.media.length
      ? S.media
          .map(
            (m) => `<div style="width:96px" class="stack" title="${esc(m.name)}">
              <div style="width:96px;aspect-ratio:9/16;border-radius:8px;overflow:hidden;background:#000">${m.kind === 'image' ? `<img src="/files/${id}/${m.file}" style="width:100%;height:100%;object-fit:cover" />` : `<video src="/files/${id}/${m.file}#t=0.5" muted preload="metadata" style="width:100%;height:100%;object-fit:cover"></video>`}</div>
              <button class="btn sm ghost danger" data-del-media="${m.id}">Remove</button></div>`,
          )
          .join('')
      : '<span class="muted small">Add the clips and images the video should show. They are matched to the script in order.</span>';
    $$('[data-del-media]', grid).forEach((b) => b.addEventListener('click', async () => {
      replaceStory(await api('DELETE', `/api/stories/${id}/media/${b.dataset.delMedia}`));
      renderMedia();
      renderScenes();
    }));
  }
  function renderScenes() {
    const box = $('#scenes');
    if (!box) return;
    const mediaOpts = (sel) => `<option value="">(automatic)</option>${S.media.map((m, i) => `<option value="${m.id}" ${m.id === sel ? 'selected' : ''}>${i + 1}. ${esc(m.name)}</option>`).join('')}`;
    box.innerHTML = S.scenes.length
      ? S.scenes
          .map(
            (sc, i) => `<div class="card" style="padding:12px" ><div class="spread" style="margin-bottom:6px"><b class="small">Scene ${i + 1}</b><select data-scene="${i}" data-key="media" style="width:auto;max-width:60%">${mediaOpts(sc.media)}</select></div>
              <textarea data-scene="${i}" data-key="text" rows="2">${esc(sc.text)}</textarea>
              ${sc.prompt ? `<span class="muted small">Image idea: ${esc(sc.prompt)}</span>` : ''}</div>`,
          )
          .join('')
      : '<span class="muted small">No scenes yet.</span>';
  }
  $('#mediaPick')?.addEventListener('click', () => $('#mediaIn').click());
  $('#mediaIn')?.addEventListener('change', async (e) => {
    for (const f of e.target.files) await uploadFile(f, 'media');
    renderMedia();
  });
  $('#planBtn')?.addEventListener('click', async (e) => busyBtn(e.target, async () => {
    await save();
    replaceStory(await api('POST', `/api/stories/${id}/plan`));
    renderScenes();
  }));
  $('#imgBtn')?.addEventListener('click', async (e) => busyBtn(e.target, async () => {
    await save();
    toast('Generating images… this can take a minute.');
    replaceStory(await api('POST', `/api/stories/${id}/images`));
    renderMedia();
    renderScenes();
  }));

  async function busyBtn(btn, fn) {
    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Working…';
    try {
      await fn();
    } catch (err) {
      toast(err.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = old;
    }
  }

  // ---------- Uploads (background, music, media) ----------
  async function uploadFile(file, role) {
    const fd = new FormData();
    fd.append('role', role);
    fd.append('file', file);
    toast(`Uploading ${file.name}…`);
    const res = await fetch(`/api/stories/${id}/upload`, { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) return toast(data.error || 'Upload failed', true);
    replaceStory(data);
    syncUploads();
  }
  let upRole = null;
  function syncUploads() {
    const bgRow = $('#bgRow');
    if (bgRow) {
      bgRow.innerHTML = S.background
        ? `<span class="small">🎮 ${esc(S.background.name)}</span><button class="btn sm" data-up="background">Replace</button><button class="btn sm ghost danger" data-rmup="background">Remove</button>`
        : '<span class="muted small">Animated gradient (default).</span><button class="btn sm" data-up="background">⬆ Upload gameplay / b-roll</button>';
    }
    $('#musicRow').innerHTML = S.music
      ? `<span class="small">🎵 ${esc(S.music.name)}</span><button class="btn sm" data-up="music">Replace</button><button class="btn sm ghost danger" data-rmup="music">Remove</button>`
      : '<button class="btn sm" data-up="music">⬆ Upload music</button>';
    $('#musicVol').hidden = !S.music;
    $$('[data-up]').forEach((b) => b.addEventListener('click', () => {
      upRole = b.dataset.up;
      const input = $('#upIn');
      input.accept = upRole === 'music' ? 'audio/*,video/*' : 'video/*';
      input.click();
    }));
    $$('[data-rmup]').forEach((b) => b.addEventListener('click', async () => {
      replaceStory(await api('DELETE', `/api/stories/${id}/upload/${b.dataset.rmup}`));
      syncUploads();
    }));
    renderPreview();
  }
  $('#upIn').addEventListener('change', async (e) => {
    if (e.target.files[0] && upRole) await uploadFile(e.target.files[0], upRole);
    e.target.value = '';
  });

  // ---------- AI writing ----------
  $('#writeBtn')?.addEventListener('click', (e) => busyBtn(e.target, async () => {
    await save();
    replaceStory(await api('POST', `/api/stories/${id}/write`, { prompt: $('#idea').value }));
    // Re-render fields with the new text.
    for (const el of $$('[data-f]')) {
      const v = S[el.dataset.f];
      if (v === undefined) continue;
      if (el.type === 'checkbox') el.checked = Boolean(v);
      else el.value = v;
    }
    renderMsgs();
    renderScenes();
    estimate();
    renderPreview();
    toast('Written. Edit anything you like, then generate the video.');
  }));

  // ---------- Preview & render ----------
  let chatV = Date.now();
  function refreshChat() {
    chatV = Date.now();
    if (tab === 'preview') renderPreview();
  }
  function renderPreview() {
    $$('.pv-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    const box = $('#pvBox');
    if (tab === 'final') {
      box.innerHTML = P.output
        ? `<video class="final-video" src="/files/${id}/${P.output.file}?v=${P.output.version}" controls playsinline></video>
           <div class="row" style="justify-content:center"><a class="btn primary" href="/files/${id}/${P.output.file}?download=1">⬇ Download MP4</a><a class="btn" href="#/thumbnail?src=${encodeURIComponent(`p:${id}:${P.output.file}`)}">🖼 Make thumbnail</a><button class="btn" data-yt-project="${id}" data-yt-file="${P.output.file}" data-yt-title="${esc(S.title || P.name)}">▶ YouTube</button></div>
           <span class="muted small">1080×1920 · ${fmtTime(P.output.duration)}</span>`
        : `<div class="empty" style="width:320px">${BUSY.includes(P.status) ? 'Rendering…' : 'Click <b>Generate video</b> to render.'}</div>`;
      return;
    }
    const bg = S.background ? `<video src="/files/${id}/${S.background.file}" muted autoplay loop playsinline style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover"></video>` : '';
    let inner = '';
    if (kind === 'video') {
      inner = `<div style="position:absolute;left:6%;right:6%;top:50%;transform:translateY(-50%);background:#fff;border-radius:14px;padding:14px 16px;color:#1a1a1b;font-family:'Segoe UI',sans-serif">
        <div class="row" style="gap:8px"><span style="width:30px;height:30px;border-radius:50%;background:#ff4500;color:#fff;display:grid;place-items:center;font-weight:800;font-size:13px">r/</span><b style="font-size:13px">${esc(S.username)}</b></div>
        <div style="font-weight:700;font-size:17px;margin-top:8px;line-height:1.25">${esc(S.title)}</div></div>`;
    } else if (kind === 'text') {
      inner = `<img src="/api/stories/${id}/chat-preview.png?v=${chatV}" style="position:absolute;left:5.5%;top:4%;width:89%" alt="" />`;
    } else {
      const first = S.media[0];
      inner = first ? (first.kind === 'image' ? `<img src="/files/${id}/${first.file}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover" />` : `<video src="/files/${id}/${first.file}" muted autoplay loop playsinline style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover"></video>`) : '<div class="pv-empty" style="top:0;height:100%">Add clips or images</div>';
      inner += `<div style="position:absolute;left:8%;right:8%;bottom:28%;text-align:center;font-family:'Arial Black';color:#fff;font-size:20px;text-shadow:0 0 3px #000,0 0 3px #000">CAPTIONS APPEAR HERE</div>`;
    }
    box.innerHTML = `<div class="phone-frame"><div class="canvas" style="background:linear-gradient(160deg,#1d2b6b,#5b2a86,#0b5e7a)">${bg}${inner}</div></div><span class="muted small" style="max-width:320px;text-align:center">A rough preview. Voice, timing and captions are added when you generate the video.</span>`;
  }
  $$('.pv-tabs button').forEach((b) => b.addEventListener('click', () => {
    tab = b.dataset.tab;
    renderPreview();
  }));

  function renderBar() {
    const bar = $('#renderBar');
    bar.innerHTML = BUSY.includes(P.status)
      ? `<b class="small" style="white-space:nowrap">${esc(P.step || 'Rendering')}…</b><div class="progress"><div style="width:${P.progress || 0}%"></div></div><span class="muted small">${P.progress || 0}%</span>`
      : `<span class="muted small">${P.status === 'error' ? `<span style="color:var(--err)">Last render failed: ${esc(P.error)}</span>` : ''}</span><span style="flex:1"></span>
         ${P.output ? `<a class="btn" href="/files/${id}/${P.output.file}?download=1">⬇ Download</a>` : ''}
         <button class="btn primary" id="renderBtn">✨ ${P.output ? 'Re-generate video' : 'Generate video'}</button>`;
    $('#renderBtn')?.addEventListener('click', async () => {
      await save();
      try {
        P = { ...(await api('POST', `/api/stories/${id}/render`)), story: S };
        renderBar();
        watch();
      } catch (err) {
        toast(err.message, true);
      }
    });
  }
  function watch() {
    poll(async () => {
      const fresh = await api('GET', `/api/stories/${id}`);
      const was = P.status;
      Object.assign(P, { status: fresh.status, step: fresh.step, progress: fresh.progress, error: fresh.error, output: fresh.output });
      renderBar();
      if (!BUSY.includes(P.status)) {
        if (P.status === 'ready' && BUSY.includes(was)) {
          tab = 'final';
          toast('🎉 Your video is ready!');
        }
        renderPreview();
        return false;
      }
      return true;
    }, 1500);
  }

  renderMsgs();
  renderMedia();
  renderScenes();
  syncUploads();
  estimate();
  renderBar();
  renderPreview();
  if (BUSY.includes(P.status)) watch();
}
