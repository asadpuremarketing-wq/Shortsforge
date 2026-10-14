// Shared helpers for every view.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const app = $('#app');

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const fmtTime = (t, precise) => {
  t = Math.max(0, t || 0);
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${precise ? s.toFixed(1).padStart(4, '0') : String(Math.floor(s)).padStart(2, '0')}`;
};
export const parseTime = (str) => {
  const parts = String(str).trim().split(':').map(Number);
  if (parts.some(isNaN)) return NaN;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
};


export async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

let toastTimer;
export function toast(msg, isErr) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast${isErr ? ' err' : ''}`;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), isErr ? 6000 : 3000);
}


// ---------- Shared state ----------

let status = null;
let voicesCache = null;
export async function getStatus(force) {
  if (!status || force) status = await api('GET', '/api/status');
  return status;
}
export async function getVoices(force) {
  if (!voicesCache || force) voicesCache = await api('GET', '/api/voices');
  return voicesCache;
}

export function resetVoices() {
  voicesCache = null;
}

export function voiceOptions(groups, selected) {
  return groups
    .filter((g) => g.voices.length)
    .map((g) => `<optgroup label="${esc(g.label)}">${g.voices.map((v) => `<option value="${esc(v.id)}" ${v.id === selected ? 'selected' : ''}>${esc(v.name)}${v.detail ? ` (${esc(v.detail)})` : ''}</option>`).join('')}</optgroup>`)
    .join('');
}

// ---------- Cleanup + polling (reset on every route change) ----------

let cleanups = [];
export function onCleanup(fn) {
  cleanups.push(fn);
}
export function runCleanups() {
  cleanups.forEach((fn) => fn());
  cleanups = [];
}

export function poll(fn, ms) {
  let stopped = false;
  let timer;
  const tick = async () => {
    if (stopped) return;
    let again = true;
    try {
      again = (await fn()) !== false;
    } catch (err) {
      console.warn(err);
    }
    if (!stopped && again) timer = setTimeout(tick, ms);
  };
  timer = setTimeout(tick, ms);
  const stop = () => {
    stopped = true;
    clearTimeout(timer);
  };
  onCleanup(stop);
  return stop;
}

// ---------- Upload to YouTube (shared dialog) ----------

export async function openYouTubeUpload({ projectId, file, title }) {
  const yt = await api('GET', '/api/youtube/status');
  if (!yt.connected) {
    if (confirm('Connect your YouTube channel first (in Settings). Open Settings now?')) location.hash = '#/settings';
    return;
  }
  const dlg = document.createElement('dialog');
  dlg.className = 'yt-dialog';
  dlg.innerHTML = `
    <form method="dialog" class="stack">
      <h2>Upload to YouTube${yt.channel ? ` <span class="muted small">· ${esc(yt.channel)}</span>` : ''}</h2>
      <label class="field">Title<input type="text" name="title" maxlength="100" value="${esc(title || '')}" required /></label>
      <label class="field">Description<textarea name="description" rows="4" placeholder="#Shorts is added automatically."></textarea></label>
      <label class="field">Tags (comma separated)<input type="text" name="tags" placeholder="ranking, fails, funny" /></label>
      <label class="field">Visibility<select name="privacy"><option value="private">Private (check it first)</option><option value="unlisted">Unlisted</option><option value="public">Public</option></select></label>
      <div class="row" style="justify-content:flex-end"><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn primary" value="ok" id="ytGo">⬆ Upload</button></div>
      <div id="ytState" class="small"></div>
    </form>`;
  document.body.appendChild(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  dlg.querySelector('#ytGo').addEventListener('click', async (e) => {
    e.preventDefault();
    const f = new FormData(dlg.querySelector('form'));
    const btn = e.target;
    btn.disabled = true;
    btn.textContent = 'Uploading…';
    try {
      const out = await api('POST', '/api/youtube/upload', {
        projectId,
        file,
        title: f.get('title'),
        description: f.get('description'),
        tags: String(f.get('tags') || '').split(',').map((t) => t.trim()).filter(Boolean),
        privacy: f.get('privacy'),
      });
      dlg.querySelector('#ytState').innerHTML = `✅ Uploaded: <a href="${out.url}" target="_blank" rel="noreferrer">${out.url}</a>`;
      btn.hidden = true;
    } catch (err) {
      dlg.querySelector('#ytState').innerHTML = `<span style="color:var(--err)">${esc(err.message)}</span>`;
      btn.disabled = false;
      btn.textContent = '⬆ Upload';
    }
  });
  dlg.showModal();
}

// ---------- Confirmation dialog (replaces the browser's confirm()) ----------

/**
 * Ask before doing something destructive. Resolves true when confirmed.
 * confirmDialog({ title, body, confirmLabel = 'Delete', danger = true })
 */
export function confirmDialog({ title, body = '', confirmLabel = 'Delete', danger = true }) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'confirm-dialog';
    dlg.innerHTML = `
      <div class="cd-icon ${danger ? 'danger' : ''}"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12.5A1.5 1.5 0 0 0 8.5 21h7a1.5 1.5 0 0 0 1.5-1.5L18 7M9 7V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V7"/></svg></div>
      <h3>${esc(title)}</h3>
      ${body ? `<p>${body}</p>` : ''}
      <div class="cd-actions"><button class="btn cd-cancel" value="cancel">Cancel</button><button class="btn ${danger ? 'danger-solid' : 'primary'} cd-confirm" value="ok">${esc(confirmLabel)}</button></div>`;
    document.body.appendChild(dlg);
    const done = (ok) => {
      dlg.close();
      dlg.remove();
      resolve(ok);
    };
    dlg.querySelector('.cd-cancel').addEventListener('click', () => done(false));
    dlg.querySelector('.cd-confirm').addEventListener('click', () => done(true));
    dlg.addEventListener('cancel', (e) => {
      e.preventDefault();
      done(false);
    });
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg) done(false); // click on the backdrop
    });
    dlg.showModal();
    dlg.querySelector('.cd-cancel').focus();
  });
}
