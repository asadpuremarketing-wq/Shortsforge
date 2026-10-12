// Thumbnail maker: pick a frame from any video (or an image / AI image), add bold text, download PNG.
import { $, $$, app, esc, api, toast, getStatus, onCleanup } from './core.js';

export async function viewThumbnail(params) {
  const [projects, fonts, s] = await Promise.all([api('GET', '/api/projects'), api('GET', '/api/fonts'), getStatus()]);
  // Every finished video in the library can be a source.
  const sources = [];
  for (const p of projects) {
    if (p.output?.file) sources.push({ src: `p:${p.id}:${p.output.file}`, name: p.name, duration: p.output.duration });
    for (const c of p.clips || []) if (c.file && c.status === 'ready') sources.push({ src: `p:${p.id}:${c.file}`, name: `${p.name} · ${c.title}`, duration: c.duration });
  }
  const o = { src: params.get('src') || sources[0]?.src || '', t: 1, format: 'youtube', text: 'YOU WON’T BELIEVE THIS', font: 'Archivo Black', size: 12, color: '#ffffff', accent: '#ffe500', stroke: '#000000', pos: 'bottom', dark: 0.45, zoom: 1 };
  let duration = sources.find((x) => x.src === o.src)?.duration || 0;

  app.innerHTML = `
    <div class="stack" style="gap:20px">
      <div class="stack" style="gap:6px"><h1>Thumbnail Maker</h1><span class="muted">Pick a frame, add bold text, and download a YouTube thumbnail (1280×720) or a Shorts cover (1080×1920).</span></div>
      <div class="grid-2">
        <div class="stack">
          <section class="panel">
            <div class="panel-head"><h2>Image</h2></div>
            <label class="field">From your videos<select id="src"><option value="">— choose —</option>${sources.map((x) => `<option value="${esc(x.src)}" ${x.src === o.src ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
            <div class="row"><button class="btn sm" id="upBtn">⬆ Upload image or video</button>${s.images ? '<input type="text" id="aiPrompt" placeholder="Describe an AI background…" style="flex:1;min-width:180px" /><button class="btn sm ai-btn" id="aiBtn">🎨 Generate</button>' : ''}</div>
            <input type="file" id="upIn" accept="image/*,video/*" hidden />
            <div class="stack" style="gap:6px" id="timeRow"><span class="label">Frame</span><div class="slider-box"><input type="range" id="t" min="0" max="${Math.max(1, duration)}" step="0.1" value="${o.t}" /><output id="tOut">${o.t}s</output></div></div>
            <div class="stack" style="gap:6px"><span class="label">Zoom</span><div class="slider-box"><input type="range" data-o="zoom" min="1" max="2" step="0.05" value="1" /></div></div>
          </section>
          <section class="panel">
            <div class="panel-head"><h2>Text</h2></div>
            <textarea data-o="text" rows="2">${esc(o.text)}</textarea>
            <div class="toolbar">
              <div class="tgroup"><select data-o="font">${fonts.map((f) => `<option ${f.family === o.font ? 'selected' : ''}>${esc(f.family)}</option>`).join('')}</select></div>
              <div class="tgroup" style="gap:8px;padding:4px 10px"><span class="small muted">Text</span><label class="swatch" style="background:${o.color}"><input type="color" data-o="color" value="${o.color}" /></label><span class="small muted">2nd line</span><label class="swatch" style="background:${o.accent}"><input type="color" data-o="accent" value="${o.accent}" /></label><span class="small muted">Outline</span><label class="swatch" style="background:${o.stroke}"><input type="color" data-o="stroke" value="${o.stroke}" /></label></div>
            </div>
            <div class="two">
              <div class="stack" style="gap:6px"><span class="label">Size</span><div class="slider-box"><input type="range" data-o="size" min="5" max="22" step="0.5" value="${o.size}" /></div></div>
              <div class="stack" style="gap:6px"><span class="label">Darken</span><div class="slider-box"><input type="range" data-o="dark" min="0" max="0.9" step="0.05" value="${o.dark}" /></div></div>
            </div>
            <div class="row"><div class="seg" id="posSeg"><button data-v="top">Top</button><button data-v="center">Center</button><button data-v="bottom">Bottom</button></div>
            <div class="seg" id="fmtSeg"><button data-v="youtube">YouTube 16:9</button><button data-v="short">Shorts 9:16</button></div></div>
          </section>
        </div>
        <div class="stack" style="position:sticky;top:20px;align-items:center">
          <img id="out" alt="Thumbnail preview" style="max-width:100%;max-height:72vh;border-radius:12px;border:1px solid var(--line);background:#000" />
          <a class="btn primary" id="dl">⬇ Download PNG</a>
        </div>
      </div>
    </div>`;

  const url = (extra = '') => `/api/thumbnail/render.png?${new URLSearchParams({ ...o, t: String(o.t) })}${extra}`;
  let timer;
  const refresh = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      $('#out').src = url();
      $('#dl').href = url('&download=1');
    }, 200);
    $$('#posSeg button').forEach((b) => b.classList.toggle('selected', b.dataset.v === o.pos));
    $$('#fmtSeg button').forEach((b) => b.classList.toggle('selected', b.dataset.v === o.format));
    $('#timeRow').hidden = !duration;
    $$('.swatch').forEach((sw) => (sw.style.background = sw.querySelector('input').value));
  };
  const onInput = (e) => {
    const k = e.target.dataset?.o;
    if (k) {
      o[k] = e.target.value;
      refresh();
    }
  };
  app.addEventListener('input', onInput);
  onCleanup(() => app.removeEventListener('input', onInput));
  $('#t').addEventListener('input', (e) => {
    o.t = Number(e.target.value);
    $('#tOut').textContent = `${o.t}s`;
    refresh();
  });
  $('#src').addEventListener('change', (e) => {
    o.src = e.target.value;
    duration = sources.find((x) => x.src === o.src)?.duration || 0;
    $('#t').max = Math.max(1, duration);
    refresh();
  });
  $$('#posSeg button').forEach((b) => b.addEventListener('click', () => ((o.pos = b.dataset.v), refresh())));
  $$('#fmtSeg button').forEach((b) => b.addEventListener('click', () => ((o.format = b.dataset.v), refresh())));
  $('#upBtn').addEventListener('click', () => $('#upIn').click());
  $('#upIn').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const fd = new FormData();
    fd.append('file', f);
    const res = await fetch('/api/thumbnail/source', { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) return toast(data.error || 'Upload failed', true);
    o.src = data.src;
    duration = data.duration;
    $('#t').max = Math.max(1, duration);
    refresh();
  });
  $('#aiBtn')?.addEventListener('click', async (e) => {
    const btn = e.target;
    btn.disabled = true;
    btn.textContent = 'Generating…';
    try {
      const data = await api('POST', '/api/thumbnail/ai', { prompt: $('#aiPrompt').value, format: o.format });
      o.src = data.src;
      duration = 0;
      refresh();
    } catch (err) {
      toast(err.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = '🎨 Generate';
    }
  });
  refresh();
}
