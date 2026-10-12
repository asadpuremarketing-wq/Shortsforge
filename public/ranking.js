// Video Ranking: rank up to 7 videos into one countdown video with a live phone preview.
import { $, $$, app, esc, fmtTime, api, toast, getStatus, getVoices, voiceOptions, onCleanup, poll } from './core.js';
import { makeRich, setRich, colorSelection, serialize, richHTML, plainText, paletteHTML, syncPalette } from './richtext.js';

const DEFAULT_EXTRAS = { rankPop: true, transition: 'flash', sfx: true, announce: false, announceVoice: '', musicVolume: 0.15, watermark: '', markColor: '#ffffff', endText: '', endColor: '#ffffff', endDuration: 2.5 };

const MAX = 7;
const SIZES = [14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 36, 40, 44, 48];
const TARGETS = [
  [15, '15 seconds'],
  [30, '30 seconds'],
  [45, '45 seconds'],
  [60, '60 seconds (classic Shorts)'],
  [90, '90 seconds'],
  [120, '2 minutes'],
  [180, '3 minutes (Shorts max)'],
];
const BUSY_ITEM = ['downloading', 'processing', 'analyzing'];
const BUSY_PROJECT = ['queued', 'processing'];

const I = {
  up: '<svg viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12l7 7 7-7"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  arrow: '<svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  chevron: '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>',
  alignL: '<svg viewBox="0 0 24 24"><path d="M4 6h16M4 10h10M4 14h16M4 18h10"/></svg>',
  alignC: '<svg viewBox="0 0 24 24"><path d="M4 6h16M7 10h10M4 14h16M7 18h10"/></svg>',
  alignR: '<svg viewBox="0 0 24 24"><path d="M4 6h16M10 10h10M4 14h16M10 18h10"/></svg>',
};

// ---------- Fonts (shared with the renderer so the preview matches the output) ----------

let fontsPromise;
function loadFonts() {
  fontsPromise ||= api('GET', '/api/fonts').then((fonts) => {
    const css = fonts
      .filter((f) => !/^(Arial|Arial Black|Impact|Segoe UI Black)$/.test(f.family)) // already installed on Windows
      .map((f) => `@font-face { font-family: "${f.family}"; src: url("/fonts/${f.file}"); }`)
      .join('\n');
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    return fonts;
  });
  return fontsPromise;
}

const strokeShadow = (color, px) => {
  if (!(px > 0)) return 'none';
  const out = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    out.push(`${(Math.cos(a) * px).toFixed(2)}px ${(Math.sin(a) * px).toFixed(2)}px 0 ${color}`);
  }
  return out.join(',');
};

const itemLength = (it) => Math.max(0.5, (it.trimEnd ?? it.duration) - (it.trimStart || 0));

// ---------- Landing page ----------

export async function viewRankingHome() {
  const projects = (await api('GET', '/api/projects')).filter((p) => p.type === 'ranking');
  app.innerHTML = `
    <div class="stack" style="gap:26px">
      <div class="spread">
        <div class="stack" style="gap:6px"><h1>Video Ranking</h1><span class="muted">Rank up to ${MAX} TikTok, Instagram or YouTube videos into one countdown video, ready to upload.</span></div>
        <button class="btn primary big" id="new">+ New ranking video</button>
      </div>
      <div class="tool-grid">
        <div class="tool-card"><b>1. Add videos</b><span>Paste links or upload files, and put them in rank order (#1 = best).</span></div>
        <div class="tool-card"><b>2. Style it</b><span>Title, fonts, colors and rank labels, with a live preview.</span></div>
        <div class="tool-card"><b>3. Auto best moments</b><span>Each video is trimmed to its most exciting part to fit your target length.</span></div>
        <div class="tool-card"><b>4. Download</b><span>Get a finished 1080×1920 MP4 for YouTube Shorts, TikTok or Reels.</span></div>
      </div>
      <div class="stack">
        <h2>Recently created</h2>
        ${
          projects.length
            ? `<div class="project-list">${projects
                .map(
                  (p) => `
              <div class="project-card">
                <a href="#/ranking/${p.id}" class="stack" style="gap:10px;text-decoration:none">
                  <div class="thumbs">${p.output?.thumb ? `<img src="/files/${p.id}/${p.output.thumb}?v=${p.output.version}" alt="" />` : '<div class="ph"></div>'}</div>
                  <div class="spread"><b>${esc(p.name)}</b>${p.output ? '<span class="pill ok"><span class="dot"></span>Rendered</span>' : '<span class="pill">Draft</span>'}</div>
                  <span class="muted small">${p.ranking.items.length} videos · ${new Date(p.createdAt).toLocaleDateString()}</span>
                </a>
                <button class="btn sm" data-style="${p.id}" title="Same title style, rank style, effects and music, with no videos">＋ New with this style</button>
              </div>`,
                )
                .join('')}</div>`
            : '<div class="empty">No ranking videos yet.</div>'
        }
      </div>
    </div>`;
  $('#new').addEventListener('click', async () => {
    const p = await api('POST', '/api/rankings', { name: 'Untitled ranking' });
    location.hash = `#/ranking/${p.id}`;
  });
  $$('[data-style]').forEach((b) =>
    b.addEventListener('click', async () => {
      const p = await api('POST', '/api/rankings', { fromId: b.dataset.style });
      location.hash = `#/ranking/${p.id}`;
    }),
  );
}

// ---------- Editor ----------

export async function viewRankingEditor(id) {
  const [P0, fonts, s, voices] = await Promise.all([api('GET', `/api/rankings/${id}`), loadFonts(), getStatus(), getVoices()]);
  let P = P0;
  const R = P.ranking;
  R.extras = { ...DEFAULT_EXTRAS, ...R.extras };
  // Color settings added later: fill them in for older projects.
  R.ranks = { strokeColor: '#000000', popColor: R.ranks.labelColor, ...R.ranks };
  const ui = { dragTitle: false, collapsed: new Set(), dirtyTrim: new Set(), resetAuto: new Set(), tab: P.output ? 'final' : 'preview' };

  const fontOptions = (sel) => fonts.map((f) => `<option value="${esc(f.family)}" style="font-family:'${esc(f.family)}'" ${f.family === sel ? 'selected' : ''}>${esc(f.family)}</option>`).join('');
  const sizeOptions = (sel) => SIZES.map((n) => `<option value="${n}" ${n === sel ? 'selected' : ''}>${n}px</option>`).join('');
  const swatch = (bind, value) => `<label class="swatch" style="background:${esc(value)}"><input type="color" data-bind="${bind}" value="${esc(value)}" /></label>`;
  const toggle = (bind, checked, label) => `<label class="toggle-row"><span class="switch"><input type="checkbox" data-bind="${bind}" ${checked ? 'checked' : ''} /><span></span></span>${label}</label>`;

  app.innerHTML = `
    <div class="rk">
      <div class="rk-main">
        <div class="page-head">
          <div class="row" style="gap:14px;flex:1;min-width:0">
            <h1>Video Ranking</h1>
            <input type="text" id="pname" value="${esc(P.name)}" style="max-width:320px;padding:8px 12px" title="Project name" />
          </div>
          <div class="row" style="gap:8px"><button class="btn sm" id="newStyle" title="Start a new ranking with this title style, rank style, effects and music">＋ New with this style</button><a class="btn sm" href="#/ranking">🕘 Recently Created</a></div>
        </div>
        <div class="content">

          <section class="panel">
            <div class="panel-head"><h2>Video Ranking Title</h2>${toggle('ui.dragTitle', ui.dragTitle, '<span class="muted">Drag Title</span>')}</div>
            <div class="toolbar">
              <div class="tgroup"><select data-bind="title.font">${fontOptions(R.title.font)}</select><select data-bind="title.size" data-num>${sizeOptions(R.title.size)}</select></div>
              <div class="tgroup"><button class="tbtn" data-toggle="title.bold" title="Bold">B</button><button class="tbtn" data-toggle="title.italic" title="Italic"><i>I</i></button></div>
              <div class="tgroup">
                <button class="tbtn" data-align="left" title="Align left">${I.alignL}</button>
                <button class="tbtn" data-align="center" title="Center">${I.alignC}</button>
                <button class="tbtn" data-align="right" title="Align right">${I.alignR}</button>
              </div>
              <div class="tgroup"><button class="tbtn" id="undoBtn" title="Undo (Ctrl+Z)">↶</button><button class="tbtn" id="redoBtn" title="Redo (Ctrl+Y)">↷</button></div>
              ${s.llm ? '<button class="btn sm ai-btn" id="suggestTitle">✨ Suggest titles</button>' : ''}
            </div>
            <div class="title-edit rich" id="titleText"></div>
            <div class="color-grid">
              <div class="cfield"><span class="label">Text color <span class="hint">· select words first to color only them</span></span>${paletteHTML('title', R.title.color)}</div>
              <div class="cfield"><span class="label">Outline color</span>${paletteHTML('title.strokeColor', R.title.strokeColor)}</div>
              <div class="cfield"><span class="label">Background box <button class="btn sm" id="bgNone" style="margin-left:6px">None</button></span>${paletteHTML('title.bg', R.title.bg || '#000000')}</div>
            </div>
            <div class="stack" style="gap:8px">
              <span class="label">Outline thickness</span>
              <div class="slider-box" style="max-width:460px"><input type="range" min="0" max="6" step="0.5" data-bind="title.strokeWidth" data-num value="${R.title.strokeWidth}" /><output data-out="title.strokeWidth">${R.title.strokeWidth}</output></div>
            </div>
          </section>

          <section class="panel">
            <div class="panel-head"><h2>Rank Numbers</h2>${toggle('ranks.show', R.ranks.show, '<span class="muted">Show</span>')}</div>
            <div class="toolbar">
              <div class="tgroup"><select data-bind="ranks.font">${fontOptions(R.ranks.font)}</select><select data-bind="ranks.size" data-num>${sizeOptions(R.ranks.size)}</select></div>
            </div>
            <div class="color-grid">
              <div class="cfield"><span class="label">Number color</span>${paletteHTML('ranks.numberColor', R.ranks.numberColor)}</div>
              <div class="cfield"><span class="label">Label color <span class="hint">· all ranks; each rank can override below</span></span>${paletteHTML('ranks.labelColor', R.ranks.labelColor)}</div>
              <div class="cfield"><span class="label">Outline color</span>${paletteHTML('ranks.strokeColor', R.ranks.strokeColor || '#000000')}</div>
              <div class="cfield"><span class="label">Big pop-up number color</span>${paletteHTML('ranks.popColor', R.ranks.popColor || R.ranks.labelColor)}</div>
            </div>
            <div class="stack" style="gap:8px">
              <span class="label">Outline thickness</span>
              <div class="slider-box" style="max-width:460px"><input type="range" min="0" max="6" step="0.5" data-bind="ranks.strokeWidth" data-num value="${R.ranks.strokeWidth}" /><output data-out="ranks.strokeWidth">${R.ranks.strokeWidth}</output></div>
            </div>
            <span class="muted small">Tip: drag the rank list in the preview to move it. Each label appears when its video starts playing.</span>
          </section>

          <section class="panel">
            <div class="panel-head"><h2>General Setting</h2></div>
            <div class="two">
              <div class="stack" style="gap:8px"><span class="label">Video height</span><div class="input-box"><input type="number" min="20" max="100" data-bind="general.videoHeight" data-num value="${R.general.videoHeight}" /><span class="unit">%</span></div></div>
              <div class="stack" style="gap:8px"><span class="label">Background</span><div class="input-box">${swatch('general.background', R.general.background)}<input type="text" data-bind="general.background" data-hex value="${esc(R.general.background)}" /></div></div>
              <div class="stack" style="gap:8px"><span class="label">Target video length</span><div class="input-box"><select data-bind="general.targetLength" data-num>${(TARGETS.some(([v]) => v === R.general.targetLength) ? TARGETS : [...TARGETS, [R.general.targetLength, `${R.general.targetLength} seconds`]].sort((a, b) => a[0] - b[0])).map(([v, l]) => `<option value="${v}" ${v === R.general.targetLength ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
              <div class="stack" style="gap:8px"><span class="label">Video fit</span><div class="seg" id="fitSeg"><button data-v="cover">Fill</button><button data-v="contain">Fit whole video</button></div></div>
            </div>
            <div class="row" style="gap:24px">
              ${toggle('general.captions', R.general.captions, 'Enable Caption')}
              <select data-bind="general.captionStyle" id="capStyle" style="width:auto" ${R.general.captions ? '' : 'hidden'}>${Object.entries(s.captionStyles)
                .filter(([k]) => k !== 'none')
                .map(([k, v]) => `<option value="${k}" ${k === R.general.captionStyle ? 'selected' : ''}>${esc(v)}</option>`)
                .join('')}</select>
            </div>
          </section>

          <section class="panel">
            <div class="panel-head"><h2>Playback Order</h2>${toggle('playback.custom', R.playback.custom, '<span class="muted">Custom Playback Order</span>')}</div>
            <div id="orderRow" ${R.playback.custom ? '' : 'hidden'}>
              <div class="seg" id="orderSeg"><button data-v="countdown">Countdown (last → #1)</button><button data-v="ascending">In order (#1 → last)</button></div>
            </div>
            <span class="muted small" id="orderHelp"></span>
          </section>

          <section class="panel">
            <div class="panel-head"><h2>Effects &amp; Audio</h2></div>
            <div class="two">
              <div class="stack" style="gap:8px"><span class="label">Transition between ranks</span><div class="seg" id="transSeg"><button data-v="none">Cut</button><button data-v="flash">White flash</button><button data-v="dip">Dip to black</button></div></div>
              <div class="stack" style="gap:12px;justify-content:flex-end">
                ${toggle('extras.rankPop', R.extras.rankPop, 'Big rank number pop-up')}
                ${toggle('extras.sfx', R.extras.sfx, 'Whoosh sound on transitions')}
              </div>
            </div>
            <div class="two">
              <div class="stack" style="gap:8px">
                ${toggle('extras.announce', R.extras.announce, 'Voice says "Number 3!" at each rank')}
                <select data-bind="extras.announceVoice" id="annVoice" ${R.extras.announce ? '' : 'hidden'}><option value="">Auto voice</option>${voiceOptions(voices, R.extras.announceVoice)}</select>
              </div>
              <div class="stack" style="gap:8px">
                <span class="label">Background music</span>
                <div class="row" id="musicRow"></div>
                <div class="slider-box" id="musicVol"><span class="small muted">Volume</span><input type="range" min="0" max="0.6" step="0.01" data-bind="extras.musicVolume" data-num value="${R.extras.musicVolume}" /><output data-out="extras.musicVolume">${Math.round(R.extras.musicVolume * 100)}</output></div>
                <input type="file" id="musicIn" accept="audio/*,video/*" hidden />
              </div>
            </div>
            <div class="two">
              <div class="cfield"><label class="field">Watermark<input type="text" data-bind="extras.watermark" value="${esc(R.extras.watermark)}" placeholder="@yourchannel" maxlength="40" /></label>${paletteHTML('extras.markColor', R.extras.markColor || '#ffffff')}</div>
              <div class="cfield"><span class="label">End screen text <span class="hint">· select words to color them</span></span><div class="rich" id="endText"></div>${paletteHTML('end', R.extras.endColor || '#ffffff')}</div>
            </div>
          </section>

          <div class="stack" id="items" style="gap:14px"></div>
        </div>
        <div class="render-bar" id="renderBar"></div>
      </div>

      <aside class="rk-preview">
        <div class="pv-tabs"><button data-tab="preview">Preview</button><button data-tab="final">Final video</button></div>
        <div id="tabPreview" class="stack" style="align-items:center;gap:14px">
          <div class="phone-frame">
            <div class="canvas" id="canvas">
              <video class="pv-video" id="pv" playsinline preload="metadata"></video>
              <div class="pv-empty" id="pvEmpty">Add videos to see the preview</div>
              <div class="pv-title" id="pvTitle"></div>
              <div class="pv-pop" id="pvPop"></div>
              <div class="pv-mark" id="pvMark"></div>
              <div class="pv-flash" id="pvFlash"></div>
              <div class="pv-ranks" id="pvRanks"></div>
            </div>
          </div>
          <div class="pv-controls"><button class="btn sm" id="pvPlay">▶ Play preview</button><button class="btn sm ghost" id="pvMute" title="Sound">🔊</button><span class="muted small" id="pvTime"></span></div>
          <span class="muted small" style="max-width:340px;text-align:center">The preview plays each video's selected moment in playback order. Captions are added in the final render.</span>
        </div>
        <div id="tabFinal" class="stack" style="align-items:center;gap:14px"></div>
      </aside>
    </div>`;

  // ---------- Settings bindings ----------

  const getPath = (path) => path.split('.').reduce((o, k) => o?.[k], { ...R, ui });
  const setPath = (path, value) => {
    const [section, key] = path.split('.');
    if (section === 'ui') ui[key] = value;
    else R[section][key] = value;
  };

  function syncExtras() {
    $$('#transSeg button').forEach((b) => b.classList.toggle('selected', R.extras.transition === b.dataset.v));
    $('#annVoice').hidden = !R.extras.announce;
    $('#musicRow').innerHTML = R.music
      ? `<span class="small" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">🎵 ${esc(R.music.name)}</span><button class="btn sm" id="musicPick">Replace</button><button class="btn sm ghost danger" id="musicDel">Remove</button>`
      : '<button class="btn sm" id="musicPick">⬆ Upload music</button><span class="muted small">Loops under the video, fades out at the end.</span>';
    $('#musicVol').hidden = !R.music;
  }

  function syncToolbar() {
    syncExtras();
    $$('[data-toggle]').forEach((b) => b.classList.toggle('on', Boolean(getPath(b.dataset.toggle))));
    $$('[data-align]').forEach((b) => b.classList.toggle('on', R.title.align === b.dataset.align));
    $$('#fitSeg button').forEach((b) => b.classList.toggle('selected', R.general.fit === b.dataset.v));
    $$('#orderSeg button').forEach((b) => b.classList.toggle('selected', R.playback.order === b.dataset.v));
    $('#bgNone').classList.toggle('on', !R.title.bg);
    $('#bgNone').textContent = R.title.bg ? 'Remove' : 'None';
    $('#capStyle').hidden = !R.general.captions;
    $('#orderRow').hidden = !R.playback.custom;
    const countdown = !R.playback.custom || R.playback.order === 'countdown';
    $('#orderHelp').textContent = countdown ? `Countdown: rank ${Math.max(R.items.length, 2)} plays first and #1 plays last, which keeps viewers watching to the end.` : '#1 plays first.';
    const ta = $('#titleText');
    ta.style.fontFamily = `"${R.title.font}"`;
    ta.style.fontSize = `${Math.round(R.title.size * 1.15)}px`;
    ta.style.fontWeight = R.title.bold ? 700 : 400;
    ta.style.fontStyle = R.title.italic ? 'italic' : 'normal';
    ta.style.textAlign = R.title.align;
    ta.style.color = R.title.color;
    ta.dataset.base = R.title.color;
    $('#endText').style.color = R.extras.endColor || '#ffffff';
    $('#endText').dataset.base = R.extras.endColor || '#ffffff';
    $$('.swatch').forEach((sw) => (sw.style.background = sw.querySelector('input').value));
    $$('.palette').forEach((pal) => syncPalette(pal, paletteColor(pal.dataset.target)));
    // No background box: don't show any color as selected.
    if (!R.title.bg) $$('.palette[data-target="title.bg"] .dot.on').forEach((d) => d.classList.remove('on'));
  }

  // ---------- Colors ----------

  /** The current color a palette shows: its setting, or for a rank label its own color / the shared one. */
  function paletteColor(target) {
    if (target === 'title') return R.title.color;
    if (target === 'end') return R.extras.endColor || '#ffffff';
    if (target === 'title.bg') return R.title.bg || '#000000';
    if (target.startsWith('label:')) {
      const it = R.items.find((x) => x.id === target.slice(6));
      return it?.color || R.ranks.labelColor;
    }
    return getPath(target) || '#ffffff';
  }

  /**
   * Apply a color from a palette. For text boxes (title, end text, rank labels): if words are selected,
   * color just those words; otherwise change the whole text's color.
   */
  function applyColor(target, hex) {
    if (target === 'title') {
      if (!colorSelection($('#titleText'), hex)) R.title.color = hex;
    } else if (target === 'end') {
      if (!colorSelection($('#endText'), hex)) R.extras.endColor = hex;
    } else if (target.startsWith('label:')) {
      const it = R.items.find((x) => x.id === target.slice(6));
      const box = $(`[data-label="${it?.id}"]`);
      if (!it || !box) return;
      if (!colorSelection(box, hex)) {
        it.color = hex === R.ranks.labelColor ? '' : hex;
        box.style.color = hex;
        box.dataset.base = hex;
        it.label = serialize(box, hex);
      }
      drawPreview();
      syncToolbar();
      scheduleSave();
      recordHistory();
      return;
    } else {
      setPath(target, hex);
      if (target === 'ranks.labelColor') {
        // Labels without their own color follow the shared one.
        for (const it of R.items) {
          if (it.color) continue;
          const box = $(`[data-label="${it.id}"]`);
          if (box) (box.style.color = hex), (box.dataset.base = hex);
        }
      }
    }
    changed();
  }

  // Keep the text selection when a color dot is clicked.
  const onDotDown = (e) => {
    if (e.target.closest('.palette .dot[data-color]')) e.preventDefault();
  };
  const onDotClick = (e) => {
    const dot = e.target.closest('.palette .dot[data-color]');
    if (dot) applyColor(dot.closest('.palette').dataset.target, dot.dataset.color);
  };
  const onPick = (e) => {
    const pick = e.target.closest('.palette .custom input');
    if (pick) applyColor(pick.closest('.palette').dataset.target, pick.value);
  };
  app.addEventListener('mousedown', onDotDown);
  app.addEventListener('click', onDotClick);
  app.addEventListener('input', onPick);
  onCleanup(() => {
    app.removeEventListener('mousedown', onDotDown);
    app.removeEventListener('click', onDotClick);
    app.removeEventListener('input', onPick);
  });

  const changed = () => {
    syncToolbar();
    drawPreview();
    scheduleSave();
    recordHistory();
  };

  // ---------- Undo / redo (settings, labels and rank order) ----------

  const snapshot = () => JSON.stringify({ title: R.title, general: R.general, ranks: R.ranks, playback: R.playback, extras: R.extras, items: R.items.map((it) => [it.id, it.label || '', it.color || '']) });
  const history = [snapshot()];
  let hPos = 0;
  let hTimer;
  function recordHistory() {
    clearTimeout(hTimer);
    hTimer = setTimeout(() => {
      const snap = snapshot();
      if (snap === history[hPos]) return;
      history.splice(hPos + 1);
      history.push(snap);
      if (history.length > 100) history.shift();
      hPos = history.length - 1;
      syncHistoryButtons();
    }, 400);
  }
  function syncHistoryButtons() {
    $('#undoBtn').disabled = hPos <= 0;
    $('#redoBtn').disabled = hPos >= history.length - 1;
  }
  function restore(snap) {
    const s0 = JSON.parse(snap);
    for (const k of ['title', 'general', 'ranks', 'playback', 'extras']) R[k] = s0[k];
    const byId = new Map(R.items.map((it) => [it.id, it]));
    const ordered = s0.items.map(([iid, label, color]) => {
      const it = byId.get(iid);
      if (it) Object.assign(it, { label, color: color || '' });
      return it;
    }).filter(Boolean);
    R.items = [...ordered, ...R.items.filter((it) => !ordered.includes(it))];
    // Push restored values back into every bound control.
    $$('[data-bind]').forEach((el) => {
      const bind = el.dataset.bind;
      const v = bind === 'title.bgColor' ? R.title.bg || '#000000' : getPath(bind);
      if (v === undefined) return;
      if (el.type === 'checkbox') el.checked = Boolean(v);
      else el.value = v;
      const out = $(`[data-out="${bind}"]`);
      if (out) out.textContent = bind === 'extras.musicVolume' ? Math.round(v * 100) : v;
    });
    setRich($('#titleText'), R.title.text, R.title.color);
    setRich($('#endText'), R.extras.endText, R.extras.endColor || '#ffffff');
    syncToolbar();
    renderItems();
    drawPreview();
    idleFrame();
    scheduleSave();
    syncHistoryButtons();
  }
  function undo() {
    if (hPos > 0) restore(history[--hPos]);
  }
  function redo() {
    if (hPos < history.length - 1) restore(history[++hPos]);
  }
  const onKey = (e) => {
    if (!(e.ctrlKey || e.metaKey) || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) {
      e.preventDefault();
      undo();
    } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
      e.preventDefault();
      redo();
    }
  };
  document.addEventListener('keydown', onKey);
  onCleanup(() => document.removeEventListener('keydown', onKey));

  async function suggestTitles(btn) {
    btn.disabled = true;
    btn.textContent = '…';
    try {
      await save();
      const { titles } = await api('POST', `/api/rankings/${id}/suggest-title`);
      $('#titleIdeas')?.remove();
      $('#titleText').insertAdjacentHTML('afterend', `<div class="row" id="titleIdeas" style="gap:6px">${titles.map((t) => `<button class="btn sm" data-pick-title="${esc(t)}">${esc(t)}</button>`).join('')}</div>`);
    } catch (err) {
      toast(err.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = '✨ Suggest titles';
    }
  }

  // Music upload
  app.addEventListener('change', onMusic);
  onCleanup(() => app.removeEventListener('change', onMusic));
  async function onMusic(e) {
    if (e.target.id !== 'musicIn' || !e.target.files[0]) return;
    const fd = new FormData();
    fd.append('music', e.target.files[0]);
    toast('Uploading music…');
    const res = await fetch(`/api/rankings/${id}/music`, { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) return toast(data.error || 'Upload failed', true);
    R.music = data.ranking.music;
    syncExtras();
    toast('Music added.');
  }

  app.addEventListener('input', onInput);
  app.addEventListener('change', onInput);
  onCleanup(() => {
    app.removeEventListener('input', onInput);
    app.removeEventListener('change', onInput);
  });
  function onInput(e) {
    const el = e.target;
    if (el.id === 'pname') {
      P.name = el.value;
      return scheduleSave();
    }
    const bind = el.dataset?.bind;
    if (!bind) return;
    if (bind === 'title.bgColor') {
      R.title.bg = el.value;
      return changed();
    }
    let v = el.type === 'checkbox' ? el.checked : el.value;
    if (el.dataset.num !== undefined) {
      v = Number(v);
      if (!Number.isFinite(v)) return;
      if (bind === 'general.videoHeight') v = Math.min(100, Math.max(20, v));
    }
    if (el.dataset.hex !== undefined) {
      if (!/^#[0-9a-f]{6}$/i.test(v)) return;
      $$(`[data-bind="${bind}"]`).forEach((x) => x !== el && (x.value = v));
    } else if (el.type === 'color') {
      $$(`[data-bind="${bind}"]`).forEach((x) => x !== el && (x.value = v));
    }
    setPath(bind, v);
    const out = $(`[data-out="${bind}"]`);
    if (out) out.textContent = bind === 'extras.musicVolume' ? Math.round(v * 100) : v;
    if (bind === 'general.targetLength') return save(); // server re-picks best moments
    if (bind.startsWith('ui.')) return drawPreview();
    changed();
  }

  app.addEventListener('click', onClick);
  onCleanup(() => app.removeEventListener('click', onClick));
  function onClick(e) {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.toggle) {
      setPath(t.dataset.toggle, !getPath(t.dataset.toggle));
      changed();
    } else if (t.dataset.align) {
      R.title.align = t.dataset.align;
      changed();
    } else if (t.id === 'bgNone') {
      R.title.bg = '';
      changed();
    } else if (t.closest('#fitSeg')) {
      R.general.fit = t.dataset.v;
      changed();
    } else if (t.closest('#orderSeg')) {
      R.playback.order = t.dataset.v;
      changed();
    } else if (t.closest('#transSeg')) {
      R.extras.transition = t.dataset.v;
      changed();
    } else if (t.id === 'newStyle') {
      save().then(() => api('POST', '/api/rankings', { fromId: id })).then((p) => (location.hash = `#/ranking/${p.id}`));
    } else if (t.id === 'undoBtn') undo();
    else if (t.id === 'redoBtn') redo();
    else if (t.id === 'musicPick') $('#musicIn').click();
    else if (t.id === 'musicDel') {
      api('DELETE', `/api/rankings/${id}/music`).then((fresh) => {
        R.music = fresh.ranking.music;
        syncExtras();
      });
    } else if (t.id === 'suggestTitle') suggestTitles(t);
    else if (t.dataset.pickTitle !== undefined) {
      R.title.text = t.dataset.pickTitle;
      setRich($('#titleText'), R.title.text, R.title.color);
      $('#titleIdeas')?.remove();
      changed();
    } else if (t.dataset.tab) {
      ui.tab = t.dataset.tab;
      renderTabs();
    }
  }

  // ---------- Saving ----------

  let saveTimer = null;
  let saving = Promise.resolve();
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 600);
  }
  function save() {
    clearTimeout(saveTimer);
    saveTimer = null;
    const payload = {
      name: P.name,
      ranking: {
        title: R.title,
        general: R.general,
        ranks: R.ranks,
        playback: R.playback,
        extras: R.extras,
        items: R.items.map((it) => {
          const x = { id: it.id, label: it.label || '', color: it.color || '' };
          if (ui.resetAuto.has(it.id)) x.auto = true;
          else if (ui.dirtyTrim.has(it.id)) Object.assign(x, { trimStart: it.trimStart, trimEnd: it.trimEnd });
          return x;
        }),
      },
    };
    ui.resetAuto.clear();
    const sentTrims = new Set(ui.dirtyTrim);
    saving = saving
      .then(() => api('PUT', `/api/rankings/${id}`, payload))
      .then((fresh) => {
        sentTrims.forEach((x) => ui.dirtyTrim.delete(x));
        merge(fresh);
      })
      .catch((err) => toast(err.message, true));
    return saving;
  }
  onCleanup(() => {
    if (saveTimer) save();
  });

  /** Take server state (statuses, auto trims, output) without clobbering what the user is editing. */
  function merge(fresh) {
    const before = R.items.map((i) => `${i.id}:${i.status}`).join();
    const wasBusy = BUSY_PROJECT.includes(P.status);
    const local = new Map(R.items.map((i) => [i.id, i]));
    R.items = fresh.ranking.items.map((si) => {
      const li = local.get(si.id);
      if (!li) return si;
      const keepTrim = ui.dirtyTrim.has(si.id) ? { trimStart: li.trimStart, trimEnd: li.trimEnd, auto: false } : {};
      return { ...si, label: li.label || si.label, color: li.color ?? si.color, ...keepTrim };
    });
    Object.assign(P, { status: fresh.status, step: fresh.step, progress: fresh.progress, error: fresh.error, output: fresh.output });
    if (R.items.map((i) => `${i.id}:${i.status}`).join() !== before) {
      renderItems();
      idleFrame();
    } else R.items.forEach(updateMoment);
    if (wasBusy && P.status === 'ready') {
      ui.tab = 'final';
      toast('🎉 Your ranking video is ready!');
    } else if (wasBusy && P.status === 'error') toast(`Render failed: ${P.error}`, true);
    syncToolbar();
    drawPreview();
    renderBar();
    renderTabs();
    ensurePolling();
  }

  let polling = false;
  const needsPoll = () => BUSY_PROJECT.includes(P.status) || R.items.some((i) => BUSY_ITEM.includes(i.status));
  function ensurePolling() {
    if (polling || !needsPoll()) return;
    polling = true;
    poll(async () => {
      merge(await api('GET', `/api/rankings/${id}`));
      polling = needsPoll();
      return polling;
    }, 1500);
  }

  // ---------- Rank cards ----------

  const itemsBox = $('#items');

  function statusBlock(it) {
    if (it.status === 'downloading') return '<div class="row small"><div class="spinner" style="width:18px;height:18px;border-width:2px"></div>Downloading from link…</div>';
    if (it.status === 'processing' || it.status === 'analyzing') return '<div class="row small"><div class="spinner" style="width:18px;height:18px;border-width:2px"></div>Analyzing for the best moment…</div>';
    if (it.status === 'error') return `<div class="banner err small"><div>${esc(it.error || 'Something went wrong.')}</div></div>`;
    return `
      <div class="stack" style="gap:8px">
        <span class="label">Best moment <span class="muted" style="font-weight:450">(drag the yellow box or its edges to change it)</span></span>
        <div class="moment" data-moment="${it.id}"><div class="bars"></div><div class="win"><div class="h l"></div><div class="h r"></div></div></div>
        <div class="moment-info"><span data-info></span><span data-mode class="badge"></span><button class="btn sm" data-act="auto">↺ Auto-pick</button><button class="btn sm" data-act="play">▶ Preview</button></div>
        ${it.ai?.reason ? `<span class="small" style="color:#a9c0ff">🤖 AI saw: ${esc(it.ai.reason)} (payoff at ${fmtTime(it.ai.peak, true)})</span>` : ''}
      </div>`;
  }

  function itemCard(it, i) {
    const n = R.items.length;
    return `
      <div class="rank-card ${ui.collapsed.has(it.id) ? 'collapsed' : ''}" data-id="${it.id}">
        <div class="rc-head" data-act="collapse">
          <div class="num">${i + 1}</div>
          <div class="name">Video Rank ${i + 1}${plainText(it.label) ? ` <span class="muted" style="font-weight:450">· ${esc(plainText(it.label))}</span>` : ''}</div>
          <button class="icon-btn" data-act="up" title="Move up" ${i === 0 ? 'disabled' : ''}>${I.up}</button>
          <button class="icon-btn" data-act="down" title="Move down" ${i === n - 1 ? 'disabled' : ''}>${I.down}</button>
          <button class="icon-btn" data-act="del" title="Remove">${I.trash}</button>
        </div>
        <div class="rc-body">
          <div class="rc-vid">${it.status === 'ready' ? `<video src="/files/${id}/${it.file}#t=${it.trimStart || 0}" muted preload="metadata" playsinline></video>` : ''}</div>
          <div class="rc-fields">
            <div class="two" style="grid-template-columns:1fr 120px">
              <div class="field">Label next to #${i + 1} <span class="hint">· select words to color them</span><div class="rich" data-label="${it.id}"></div></div>
              <label class="field">Rank<select data-rank="${it.id}">${R.items.map((_, k) => `<option value="${k}" ${k === i ? 'selected' : ''}>#${k + 1}</option>`).join('')}</select></label>
            </div>
            ${paletteHTML(`label:${it.id}`, it.color || R.ranks.labelColor)}
            ${statusBlock(it)}
            <span class="muted small" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">Source: ${it.url ? `<a href="${esc(it.url)}" target="_blank" rel="noreferrer">${esc(it.url)}</a>` : esc(it.sourceName || '')}${it.duration ? ` · ${fmtTime(it.duration)}` : ''}</span>
          </div>
        </div>
      </div>`;
  }

  function addCard(n) {
    return `
      <div class="rank-card add">
        <div class="rc-head"><div class="num">${n + 1}</div><div class="name">Add Video Rank ${n + 1}</div><span class="muted small">${n}/${MAX} videos</span></div>
        <div class="rc-body" style="flex-direction:column;gap:12px">
          <span class="label">Video Link</span>
          <div class="link-row">
            <div class="input-box"><input type="text" id="linkIn" placeholder="Paste TikTok, Instagram, or YouTube video link" /></div>
            <button class="go-btn" id="linkGo" title="Add">${I.arrow}</button>
          </div>
          <div class="or">or</div>
          <div class="row"><button class="btn" id="uploadBtn">⬆ Upload videos</button><span class="muted small">Pick several at once; they're added as the next ranks in order. Paste several links (one per line) to add them all.</span><input type="file" id="uploadIn" accept="video/*" multiple hidden /></div>
          <div id="upState"></div>
        </div>
      </div>`;
  }

  function renderItems() {
    const active = document.activeElement;
    const focusLabel = active?.dataset?.label;
    itemsBox.innerHTML = R.items.map(itemCard).join('') + (R.items.length < MAX ? addCard(R.items.length) : `<div class="muted small" style="text-align:center">Maximum of ${MAX} videos reached.</div>`);
    R.items.forEach(updateMoment);
    // Each label is a colorable text box.
    for (const it of R.items) {
      const box = $(`[data-label="${it.id}"]`);
      if (!box) continue;
      makeRich(box, {
        value: it.label || '',
        base: it.color || R.ranks.labelColor,
        placeholder: 'e.g. Rooftop slip',
        onChange: (markup) => {
          it.label = markup;
          const name = $(`[data-id="${it.id}"] .name`);
          const plain = plainText(markup);
          name.innerHTML = `Video Rank ${R.items.indexOf(it) + 1}${plain ? ` <span class="muted" style="font-weight:450">· ${esc(plain)}</span>` : ''}`;
          drawPreview();
          scheduleSave();
          recordHistory();
        },
      });
    }
    $$('.rc-vid video', itemsBox).forEach((v) => v.addEventListener('mouseenter', () => v.play().catch(() => {})));
    $$('.rc-vid video', itemsBox).forEach((v) => v.addEventListener('mouseleave', () => v.pause()));
    $$('.palette', itemsBox).forEach((pal) => syncPalette(pal, paletteColor(pal.dataset.target)));
    if (focusLabel) {
      // Put the caret back at the end of the label being typed in.
      const el = $(`[data-label="${focusLabel}"]`);
      if (el) {
        el.focus();
        const r = document.createRange();
        r.selectNodeContents(el);
        r.collapse(false);
        getSelection().removeAllRanges();
        getSelection().addRange(r);
      }
    }
  }

  function updateMoment(it) {
    const box = $(`[data-moment="${it.id}"]`);
    if (!box || !it.duration) return;
    const bars = $('.bars', box);
    const bins = it.analysis?.bins || [];
    // Downsample to at most 90 bars.
    const nBars = Math.min(90, Math.max(1, bins.length));
    if (bars.childElementCount !== nBars) {
      let html = '';
      for (let b = 0; b < nBars; b++) {
        const from = Math.floor((b / nBars) * bins.length);
        const to = Math.max(from + 1, Math.floor(((b + 1) / nBars) * bins.length));
        const v = bins.length ? Math.max(...bins.slice(from, to)) : 0.3;
        html += `<i data-t="${((b + 0.5) / nBars) * it.duration}" style="height:${Math.round(8 + v * 92)}%"></i>`;
      }
      bars.innerHTML = html;
    }
    $$('i', bars).forEach((el) => {
      const t = Number(el.dataset.t);
      el.classList.toggle('hot', t >= it.trimStart && t <= it.trimEnd);
    });
    const win = $('.win', box);
    win.style.left = `${(it.trimStart / it.duration) * 100}%`;
    win.style.width = `${((it.trimEnd - it.trimStart) / it.duration) * 100}%`;
    const card = box.closest('.rank-card');
    $('[data-info]', card).textContent = `${fmtTime(it.trimStart, true)} – ${fmtTime(it.trimEnd, true)} · ${itemLength(it).toFixed(1)}s`;
    const mode = $('[data-mode]', card);
    const auto = it.auto !== false;
    mode.textContent = auto ? '✨ Auto best moment' : '✋ Manual';
    mode.className = `badge ${auto ? 'blue' : ''}`;
    $('[data-act="auto"]', card).hidden = auto;
  }

  function move(from, to) {
    if (to < 0 || to >= R.items.length || from === to) return;
    const [it] = R.items.splice(from, 1);
    R.items.splice(to, 0, it);
    renderItems();
    syncToolbar();
    drawPreview();
    idleFrame();
    save();
    recordHistory();
  }

  itemsBox.addEventListener('click', async (e) => {
    const card = e.target.closest('.rank-card');
    const itemId = card?.dataset.id;
    const idx = R.items.findIndex((x) => x.id === itemId);
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (e.target.closest('#linkGo')) return addLinks($('#linkIn').value);
    if (e.target.closest('#uploadBtn')) return $('#uploadIn').click();
    if (!act || idx < 0) return;
    if (act === 'collapse') {
      if (e.target.closest('button')) return;
      ui.collapsed.has(itemId) ? ui.collapsed.delete(itemId) : ui.collapsed.add(itemId);
      card.classList.toggle('collapsed');
    } else if (act === 'up') move(idx, idx - 1);
    else if (act === 'down') move(idx, idx + 1);
    else if (act === 'del') {
      if (!confirm(`Remove rank #${idx + 1}?`)) return;
      await saving;
      try {
        merge(await api('DELETE', `/api/rankings/${id}/items/${itemId}`));
      } catch (err) {
        toast(err.message, true);
      }
    } else if (act === 'auto') {
      ui.resetAuto.add(itemId);
      ui.dirtyTrim.delete(itemId);
      save();
    } else if (act === 'play') playSequence([idx]);
  });

  itemsBox.addEventListener('change', (e) => {
    if (e.target.dataset.rank) move(R.items.findIndex((x) => x.id === e.target.dataset.rank), Number(e.target.value));
    if (e.target.id === 'uploadIn') uploadFiles([...e.target.files]);
  });
  itemsBox.addEventListener('keydown', (e) => {
    if (e.target.id === 'linkIn' && e.key === 'Enter') addLinks(e.target.value);
  });
  itemsBox.addEventListener('paste', (e) => {
    if (e.target.id !== 'linkIn') return;
    const text = e.clipboardData.getData('text');
    if (/\s/.test(text.trim())) {
      e.preventDefault();
      addLinks(text);
    }
  });

  // Dragging the best-moment window.
  let mdrag = null;
  itemsBox.addEventListener('pointerdown', (e) => {
    const box = e.target.closest('.moment');
    if (!box) return;
    const it = R.items.find((x) => x.id === box.dataset.moment);
    const rect = box.getBoundingClientRect();
    const toT = (x) => Math.min(it.duration, Math.max(0, ((x - rect.left) / rect.width) * it.duration));
    const t = toT(e.clientX);
    const len = it.trimEnd - it.trimStart;
    if (e.target.classList.contains('h')) mdrag = { it, toT, kind: e.target.classList.contains('l') ? 'l' : 'r' };
    else if (e.target.closest('.win')) mdrag = { it, toT, kind: 'move', offset: t - it.trimStart, len };
    else {
      // Click outside the window: center it there.
      const start = Math.min(Math.max(0, t - len / 2), it.duration - len);
      setTrim(it, start, start + len);
      mdrag = { it, toT, kind: 'move', offset: t - start, len };
    }
    box.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  itemsBox.addEventListener('pointermove', (e) => {
    if (!mdrag) return;
    const { it, toT, kind } = mdrag;
    const t = toT(e.clientX);
    if (kind === 'l') setTrim(it, Math.min(t, it.trimEnd - 1), it.trimEnd);
    else if (kind === 'r') setTrim(it, it.trimStart, Math.max(t, it.trimStart + 1));
    else {
      const start = Math.min(Math.max(0, t - mdrag.offset), it.duration - mdrag.len);
      setTrim(it, start, start + mdrag.len);
    }
  });
  itemsBox.addEventListener('pointerup', () => {
    if (!mdrag) return;
    const v = $(`[data-id="${mdrag.it.id}"] .rc-vid video`);
    if (v) v.currentTime = mdrag.it.trimStart;
    mdrag = null;
    save();
  });
  function setTrim(it, start, end) {
    it.trimStart = +start.toFixed(2);
    it.trimEnd = +end.toFixed(2);
    it.auto = false;
    ui.dirtyTrim.add(it.id);
    updateMoment(it);
    renderBar();
    updateTime();
  }

  // ---------- Adding videos ----------

  async function addLinks(text) {
    const urls = String(text || '').split(/\s+/).map((u) => u.trim()).filter(Boolean);
    if (!urls.length) return toast('Paste a TikTok, Instagram or YouTube link first.');
    await saving;
    for (const url of urls) {
      if (R.items.length >= MAX) {
        toast(`A ranking can have up to ${MAX} videos.`, true);
        break;
      }
      try {
        merge(await api('POST', `/api/rankings/${id}/items`, { url }));
      } catch (err) {
        toast(err.message, true);
      }
    }
    const input = $('#linkIn');
    if (input) input.value = '';
  }

  async function uploadFiles(files) {
    await saving;
    for (const file of files) {
      if (R.items.length >= MAX) {
        toast(`A ranking can have up to ${MAX} videos.`, true);
        break;
      }
      const fresh = await new Promise((resolve) => {
        const fd = new FormData();
        fd.append('video', file);
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `/api/rankings/${id}/items`);
        xhr.upload.onprogress = (e) => {
          const st = $('#upState');
          if (st && e.lengthComputable) st.innerHTML = `<div class="stack" style="gap:6px"><span class="small">Uploading ${esc(file.name)}… ${Math.round((e.loaded / e.total) * 100)}%</span><div class="progress"><div style="width:${(e.loaded / e.total) * 100}%"></div></div></div>`;
        };
        xhr.onload = () => {
          const data = JSON.parse(xhr.responseText || '{}');
          if (xhr.status >= 400) {
            toast(data.error || 'Upload failed', true);
            resolve(null);
          } else resolve(data);
        };
        xhr.onerror = () => {
          toast('Upload failed.', true);
          resolve(null);
        };
        xhr.send(fd);
      });
      if (fresh) merge(fresh);
    }
  }

  // ---------- Live preview ----------

  const canvas = $('#canvas');
  const pv = $('#pv');
  const player = { playing: false, seq: [], k: 0, revealed: null, end: 0 };
  const readyIdx = () => R.items.map((it, i) => (it.status === 'ready' ? i : -1)).filter((i) => i >= 0);
  const playOrder = () => {
    const idx = readyIdx();
    return R.playback.custom && R.playback.order === 'ascending' ? idx : idx.reverse();
  };

  function drawPreview() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const sc = w / 360;
    canvas.style.background = R.general.background;
    const boxH = (h * R.general.videoHeight) / 100;
    const top = (h - boxH) / 2;
    pv.style.top = `${top}px`;
    pv.style.height = `${boxH}px`;
    pv.style.objectFit = R.general.fit === 'contain' ? 'contain' : 'cover';
    const empty = $('#pvEmpty');
    empty.hidden = readyIdx().length > 0;
    empty.style.top = `${top}px`;
    empty.style.height = `${boxH}px`;
    pv.style.visibility = empty.hidden ? 'visible' : 'hidden';

    const t = R.title;
    const el = $('#pvTitle');
    const pad = (48 / 1080) * w;
    Object.assign(el.style, {
      left: `${pad}px`,
      right: `${pad}px`,
      top: `${t.y * h}px`,
      fontFamily: `"${t.font}"`,
      fontSize: `${t.size * sc}px`,
      fontWeight: t.bold ? 700 : 400,
      fontStyle: t.italic ? 'italic' : 'normal',
      color: t.color,
      textAlign: t.align,
      textShadow: t.bg ? 'none' : strokeShadow(t.strokeColor, t.strokeWidth * sc),
    });
    el.innerHTML = t.bg ? `<span style="background:${esc(t.bg)};padding:${(14 / 1080) * w}px;box-decoration-break:clone;-webkit-box-decoration-break:clone">${richHTML(t.text)}</span>` : richHTML(t.text);
    el.classList.toggle('draggable', ui.dragTitle);

    const mark = $('#pvMark');
    mark.textContent = R.extras.watermark || '';
    mark.style.color = R.extras.markColor || '#ffffff';
    Object.assign(mark.style, { right: `${(36 / 1080) * w}px`, bottom: `${(36 / 1080) * w}px`, fontSize: `${(40 / 1080) * w}px` });
    const pop = $('#pvPop');
    Object.assign(pop.style, { fontFamily: `"${R.ranks.font}"`, fontSize: `${(240 / 1080) * w}px`, color: R.ranks.popColor || R.ranks.labelColor, textShadow: strokeShadow('#000', (12 / 1080) * w) });

    const k = R.ranks;
    const rl = $('#pvRanks');
    rl.hidden = !k.show;
    const lh = k.size * sc * 1.45;
    Object.assign(rl.style, { left: `${k.x * w}px`, top: `${k.y * h}px`, fontFamily: `"${k.font}"`, fontSize: `${k.size * sc}px`, color: k.numberColor, textShadow: strokeShadow(k.strokeColor || '#000', k.strokeWidth * sc) });
    const count = Math.max(R.items.length, 1);
    rl.innerHTML = Array.from({ length: count }, (_, i) => {
      const it = R.items[i];
      const show = it?.label && (!player.revealed || player.revealed.has(i));
      return `<div style="height:${lh}px;line-height:${lh}px">${i + 1}.${show ? ` <span style="color:${esc(it.color || k.labelColor)}">${richHTML(it.label)}</span>` : ''}</div>`;
    }).join('');
  }

  /** When idle, show the first clip that would play, at its selected start. */
  function idleFrame() {
    if (player.playing) return;
    const first = playOrder()[0];
    if (first === undefined) {
      pv.removeAttribute('src');
      return;
    }
    const it = R.items[first];
    const src = `/files/${id}/${it.file}`;
    if (!pv.src.endsWith(src)) pv.src = src;
    const seek = () => (pv.currentTime = it.trimStart || 0);
    pv.readyState >= 1 ? seek() : pv.addEventListener('loadedmetadata', seek, { once: true });
    updateTime();
  }

  function playSequence(seq) {
    if (!seq.length) return toast('Add a video first.');
    if (ui.tab !== 'preview') {
      ui.tab = 'preview';
      renderTabs();
    }
    Object.assign(player, { playing: true, seq, k: 0, revealed: new Set() });
    $('#pvPlay').textContent = '⏸ Stop';
    startCurrent();
  }
  const restartAnim = (el, cls) => {
    el.classList.remove(cls);
    void el.offsetWidth; // reflow so the CSS animation runs again
    el.classList.add(cls);
  };
  function startCurrent() {
    const i = player.seq[player.k];
    if (i === undefined) return stopPlay();
    const it = R.items[i];
    player.revealed.add(i);
    if (R.extras.rankPop) {
      const pop = $('#pvPop');
      pop.textContent = `#${i + 1}`;
      restartAnim(pop, 'go');
    }
    if (player.k > 0 && R.extras.transition !== 'none') {
      const fl = $('#pvFlash');
      fl.style.background = R.extras.transition === 'dip' ? '#000' : '#fff';
      restartAnim(fl, 'go');
    }
    player.end = it.trimEnd;
    drawPreview();
    const src = `/files/${id}/${it.file}`;
    const go = () => {
      pv.currentTime = it.trimStart || 0;
      pv.play().catch(() => {});
    };
    if (!pv.src.endsWith(src)) {
      pv.src = src;
      pv.addEventListener('loadedmetadata', go, { once: true });
    } else go();
  }
  function stopPlay() {
    player.playing = false;
    player.revealed = null;
    pv.pause();
    $('#pvPlay').textContent = '▶ Play preview';
    drawPreview();
    idleFrame();
  }
  const nextClip = () => {
    if (!player.playing) return;
    player.k++;
    startCurrent();
  };
  pv.addEventListener('timeupdate', () => {
    if (player.playing && pv.currentTime >= player.end - 0.12) nextClip();
    updateTime();
  });
  // A clip can end slightly before its listed length (common with TikTok files): move on instead of freezing.
  pv.addEventListener('ended', nextClip);
  pv.addEventListener('error', () => {
    if (!player.playing) return;
    toast('A clip could not be played in the preview; skipping it. The final video is not affected.', true);
    nextClip();
  });
  // Watchdog: if playback stops advancing for 2 seconds, skip to the next clip.
  let lastT = -1;
  let stuckFor = 0;
  const watchdog = setInterval(() => {
    if (!player.playing) return (stuckFor = 0);
    if (Math.abs(pv.currentTime - lastT) < 0.01 && !pv.seeking) stuckFor += 0.5;
    else stuckFor = 0;
    lastT = pv.currentTime;
    if (stuckFor >= 2) {
      stuckFor = 0;
      nextClip();
    }
  }, 500);
  onCleanup(() => clearInterval(watchdog));
  function updateTime() {
    const order = playOrder();
    const total = order.reduce((n, i) => n + itemLength(R.items[i]), 0);
    let elapsed = 0;
    if (player.playing && player.seq.length === order.length) {
      for (let k = 0; k < player.k; k++) elapsed += itemLength(R.items[player.seq[k]]);
      const it = R.items[player.seq[player.k]];
      if (it) elapsed += Math.max(0, pv.currentTime - (it.trimStart || 0));
    }
    $('#pvTime').textContent = `${fmtTime(elapsed)} / ${fmtTime(total)}`;
  }
  $('#pvPlay').addEventListener('click', () => (player.playing ? stopPlay() : playSequence(playOrder())));
  $('#pvMute').addEventListener('click', () => {
    pv.muted = !pv.muted;
    $('#pvMute').textContent = pv.muted ? '🔇' : '🔊';
  });

  // Drag the title (when enabled) and the rank list in the preview.
  let pdrag = null;
  canvas.addEventListener('pointerdown', (e) => {
    const rect = canvas.getBoundingClientRect();
    if (e.target.closest('#pvTitle') && ui.dragTitle) pdrag = { kind: 'title', rect, dy: e.clientY - rect.top - R.title.y * rect.height };
    else if (e.target.closest('#pvRanks')) pdrag = { kind: 'ranks', rect, dx: e.clientX - rect.left - R.ranks.x * rect.width, dy: e.clientY - rect.top - R.ranks.y * rect.height };
    else return;
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!pdrag) return;
    const { rect } = pdrag;
    const clamp = (v, max) => +Math.min(max, Math.max(0, v)).toFixed(3);
    if (pdrag.kind === 'title') R.title.y = clamp((e.clientY - rect.top - pdrag.dy) / rect.height, 0.95);
    else {
      R.ranks.x = clamp((e.clientX - rect.left - pdrag.dx) / rect.width, 0.9);
      R.ranks.y = clamp((e.clientY - rect.top - pdrag.dy) / rect.height, 0.95);
    }
    drawPreview();
  });
  canvas.addEventListener('pointerup', () => {
    if (!pdrag) return;
    pdrag = null;
    scheduleSave();
  });

  // ---------- Tabs, render bar ----------

  function renderTabs() {
    $$('.pv-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === ui.tab));
    $('#tabPreview').hidden = ui.tab !== 'preview';
    const fin = $('#tabFinal');
    fin.hidden = ui.tab !== 'final';
    if (ui.tab !== 'final') return;
    if (player.playing) stopPlay();
    const sig = `${P.output?.version}|${P.status}`;
    if (fin.dataset.sig === sig) return;
    fin.dataset.sig = sig;
    if (P.output) {
      fin.innerHTML = `
        <video class="final-video" src="/files/${id}/${P.output.file}?v=${P.output.version}" controls playsinline></video>
        <div class="row" style="justify-content:center">
          <a class="btn primary" href="/files/${id}/${P.output.file}?download=1">⬇ Download MP4</a>
          <button class="btn" data-yt-project="${id}" data-yt-file="${P.output.file}" data-yt-title="${esc(plainText(R.title.text))}">▶ Upload to YouTube</button>
        </div>
        <span class="muted small">1080×1920 · ${fmtTime(P.output.duration)}${BUSY_PROJECT.includes(P.status) ? ' · a new version is rendering…' : ''}</span>`;
    } else {
      fin.innerHTML = `<div class="empty" style="width:320px">${BUSY_PROJECT.includes(P.status) ? 'Rendering… it will appear here when done.' : 'Click <b>Generate video</b> to render the final video.'}</div>`;
    }
  }

  function renderBar() {
    const bar = $('#renderBar');
    const ready = R.items.filter((i) => i.status === 'ready');
    const total = ready.reduce((n, it) => n + itemLength(it), 0);
    const busy = BUSY_PROJECT.includes(P.status);
    const waiting = R.items.some((i) => BUSY_ITEM.includes(i.status));
    const failed = R.items.some((i) => i.status === 'error');
    const summary = `${R.items.length} video${R.items.length === 1 ? '' : 's'} · ${fmtTime(total)} total`;
    bar.innerHTML = busy
      ? `<b class="small" style="white-space:nowrap">${esc(P.step || 'Rendering')}…</b><div class="progress"><div style="width:${P.progress || 0}%"></div></div><span class="muted small">${P.progress || 0}%</span>`
      : `<span class="muted small">${summary}${waiting ? ' · waiting for videos…' : ''}${failed ? ' · remove failed videos to render' : ''}</span>
         <span style="flex:1"></span>
         ${P.output ? `<a class="btn" href="/files/${id}/${P.output.file}?download=1">⬇ Download</a>` : ''}
         <button class="btn primary" id="renderBtn" ${!ready.length || waiting || failed ? 'disabled' : ''}>✨ ${P.output ? 'Re-generate video' : 'Generate video'}</button>`;
    $('#renderBtn')?.addEventListener('click', async () => {
      await save();
      try {
        merge(await api('POST', `/api/rankings/${id}/render`));
      } catch (err) {
        toast(err.message, true);
      }
    });
  }

  // ---------- Initial paint ----------

  makeRich($('#titleText'), {
    value: R.title.text,
    base: R.title.color,
    multiline: true,
    placeholder: 'Ranking Best Parkour Fails',
    onChange: (markup) => {
      R.title.text = markup;
      drawPreview();
      scheduleSave();
      recordHistory();
    },
  });
  makeRich($('#endText'), {
    value: R.extras.endText,
    base: R.extras.endColor || '#ffffff',
    placeholder: 'Follow for Part 2!',
    onChange: (markup) => {
      R.extras.endText = markup;
      scheduleSave();
      recordHistory();
    },
  });
  syncToolbar();
  syncHistoryButtons();
  renderItems();
  renderBar();
  renderTabs();
  // Fonts load asynchronously; redraw once they're in so the preview metrics are right.
  document.fonts.ready.then(drawPreview);
  drawPreview();
  idleFrame();
  const ro = new ResizeObserver(drawPreview);
  ro.observe(canvas);
  onCleanup(() => {
    ro.disconnect();
    pv.pause();
  });
  ensurePolling();
}
