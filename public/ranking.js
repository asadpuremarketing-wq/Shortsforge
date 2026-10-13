// Video Ranking: rank up to 7 videos into one countdown video with a live phone preview.
import { $, $$, app, esc, fmtTime, api, toast, getStatus, getVoices, voiceOptions, onCleanup, poll } from './core.js';
import { icon } from './icons.js';
import { makeRich, setRich, colorSelection, serialize, richHTML, plainText, paletteHTML, syncPalette, insertAtCaret, EMOJIS } from './richtext.js';

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
  copy: '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/></svg>',
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
                <button class="btn sm" data-style="${p.id}" title="Same title style, rank style, effects and music, with no videos">${icon('plus', 16)} New with this style</button>
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
  const ui = { dragTitle: false, collapsed: new Set(), dirtyTrim: new Set(), resetAuto: new Set(), tab: 'preview' };

  const fontOptions = (sel) => fonts.map((f) => `<option value="${esc(f.family)}" style="font-family:'${esc(f.family)}'" ${f.family === sel ? 'selected' : ''}>${esc(f.family)}</option>`).join('');
  const sizeOptions = (sel) => SIZES.map((n) => `<option value="${n}" ${n === sel ? 'selected' : ''}>${n}px</option>`).join('');
  const swatch = (bind, value) => `<label class="swatch" style="background:${esc(value)}"><input type="color" data-bind="${bind}" value="${esc(value)}" /></label>`;
  const emojiButton = (target) => `<button type="button" class="btn sm emoji-btn" data-emoji-for="${esc(target)}" title="Insert an emoji at the cursor">${icon('smile', 16)} Emoji</button>`;
  const toggle = (bind, checked, label) => `<label class="toggle-row"><span class="switch"><input type="checkbox" data-bind="${bind}" ${checked ? 'checked' : ''} /><span></span></span>${label}</label>`;

  const colorBtn = (target, current, label) => `<button type="button" class="color-btn" data-color-for="${esc(target)}" title="${esc(label)}: click to change"><span class="sw" style="background:${esc(current)}"></span><span>${label}</span></button>`;
  const targetOptions = (TARGETS.some(([v]) => v === R.general.targetLength) ? TARGETS : [...TARGETS, [R.general.targetLength, `${R.general.targetLength} seconds`]].sort((a, b) => a[0] - b[0]))
    .map(([v, l]) => `<option value="${v}" ${v === R.general.targetLength ? 'selected' : ''}>${l}</option>`)
    .join('');
  const TABS = [
    ['videos', 'video', 'Videos'],
    ['title', 'type', 'Title'],
    ['ranks', 'list', 'Rank list'],
    ['look', 'palette', 'Look'],
    ['effects', 'sparkles', 'Effects & audio'],
  ];
  let section = (() => {
    try {
      return R.items.length ? localStorage.getItem('sf.rankTab') || 'videos' : 'videos';
    } catch {
      return 'videos';
    }
  })();

  app.innerHTML = `
    <div class="rk">
      <div class="rk-main">
        <div class="page-head rk-head">
          <div class="row" style="gap:12px;flex:1;min-width:0">
            <a href="#/ranking" class="back" title="All rankings">${icon('back', 18)}</a>
            <input type="text" id="pname" class="name-input" value="${esc(P.name)}" title="Rename this ranking" placeholder="Untitled ranking" />
            <span class="save-state" id="saveState">Saved</span>
          </div>
          <div class="row" style="gap:6px">
            <button class="tbtn" id="undoBtn" title="Undo (Ctrl+Z)">${icon('undo', 17)}</button>
            <button class="tbtn" id="redoBtn" title="Redo (Ctrl+Y)">${icon('redo', 17)}</button>
            <button class="btn sm" id="newStyle" title="Start a new ranking with this title style, rank style, effects and music">${icon('plus', 16)} New with this style</button>
          </div>
        </div>
        <nav class="rk-tabs" id="rkTabs">${TABS.map(([k, ic, name]) => `<button data-section="${k}">${icon(ic, 17)}${name}${k === 'videos' ? ' <span class="count" id="videoCount"></span>' : ''}</button>`).join('')}</nav>
        <div class="content">

          <section class="rk-section" data-for="videos">
            <div class="section-intro">
              <div><h2>Your ranked videos</h2><p>Add up to ${MAX} clips. #1 is the best: by default it plays last.</p></div>
              <div class="row" style="gap:10px">
                <label class="inline-field">Target length<select data-bind="general.targetLength" data-num>${targetOptions}</select></label>
                <button class="btn sm ghost danger" id="removeAll">Remove all</button>
              </div>
            </div>
            <div class="stack" id="items" style="gap:12px"></div>
          </section>

          <section class="rk-section" data-for="title">
            <div class="section-intro"><div><h2>Title</h2><p>Shown at the top for the whole video. Select words to color them separately.</p></div>${s.llm ? '<button class="btn sm ai-btn" id="suggestTitle">' + icon('wand', 16) + ' Suggest titles</button>' : ''}</div>
            <div class="panel">
              <div class="toolbar">
                <div class="tgroup"><select data-bind="title.font" title="Font">${fontOptions(R.title.font)}</select><select data-bind="title.size" data-num title="Size">${sizeOptions(R.title.size)}</select></div>
                <div class="tgroup"><button class="tbtn" data-toggle="title.bold" title="Bold">B</button><button class="tbtn" data-toggle="title.italic" title="Italic"><i>I</i></button></div>
                <div class="tgroup">
                  <button class="tbtn" data-align="left" title="Align left">${I.alignL}</button>
                  <button class="tbtn" data-align="center" title="Center">${I.alignC}</button>
                  <button class="tbtn" data-align="right" title="Align right">${I.alignR}</button>
                </div>
                ${emojiButton('title')}
              </div>
              <div class="title-edit rich" id="titleText"></div>
              <div class="color-row">
                ${colorBtn('title', R.title.color, 'Text')}
                ${colorBtn('title.strokeColor', R.title.strokeColor, 'Outline')}
                ${colorBtn('title.bg', R.title.bg || '#000000', 'Background box')}
                <button class="btn sm ghost" id="bgNone">No box</button>
              </div>
              <div class="setting-row"><span class="label">Outline thickness</span><div class="slider-box"><input type="range" min="0" max="6" step="0.5" data-bind="title.strokeWidth" data-num value="${R.title.strokeWidth}" /><output data-out="title.strokeWidth">${R.title.strokeWidth}</output></div></div>
              <div class="setting-row"><span class="label">Position</span>${toggle('ui.dragTitle', ui.dragTitle, 'Drag the title in the preview to move it')}</div>
            </div>
          </section>

          <section class="rk-section" data-for="ranks">
            <div class="section-intro"><div><h2>Rank list</h2><p>The numbers down the side. Each label appears when its clip starts. Drag the list in the preview to move it.</p></div>${toggle('ranks.show', R.ranks.show, 'Show')}</div>
            <div class="panel">
              <div class="toolbar"><div class="tgroup"><select data-bind="ranks.font" title="Font">${fontOptions(R.ranks.font)}</select><select data-bind="ranks.size" data-num title="Size">${sizeOptions(R.ranks.size)}</select></div></div>
              <div class="color-row">
                ${colorBtn('ranks.numberColor', R.ranks.numberColor, 'Numbers')}
                ${colorBtn('ranks.labelColor', R.ranks.labelColor, 'Labels')}
                ${colorBtn('ranks.strokeColor', R.ranks.strokeColor || '#000000', 'Outline')}
                ${colorBtn('ranks.popColor', R.ranks.popColor || R.ranks.labelColor, 'Pop-up number')}
              </div>
              <div class="setting-row"><span class="label">Outline thickness</span><div class="slider-box"><input type="range" min="0" max="6" step="0.5" data-bind="ranks.strokeWidth" data-num value="${R.ranks.strokeWidth}" /><output data-out="ranks.strokeWidth">${R.ranks.strokeWidth}</output></div></div>
              <div class="setting-row"><span class="label">Labels stay on screen</span>
                <div class="row" style="gap:10px">
                  <div class="seg" id="labelModeSeg"><button data-v="stay">Until the end</button><button data-v="during">While its clip plays</button><button data-v="seconds">For a few seconds</button></div>
                  <div class="input-box" id="labelSecsBox" style="width:120px"><input type="number" min="0.5" max="30" step="0.5" data-bind="ranks.labelSeconds" data-num value="${R.ranks.labelSeconds ?? 3}" /><span class="unit">sec</span></div>
                </div>
              </div>
              <span class="hint">Tip: each rank card on the Videos tab can have its own label color and font.</span>
            </div>
          </section>

          <section class="rk-section" data-for="look">
            <div class="section-intro"><div><h2>Look</h2><p>How the clips sit on the 9:16 canvas, and the order they play in.</p></div></div>
            <div class="panel">
              <div class="setting-row"><span class="label">Video size</span><div class="input-box" style="width:140px"><input type="number" min="20" max="100" data-bind="general.videoHeight" data-num value="${R.general.videoHeight}" /><span class="unit">% of height</span></div></div>
              <div class="setting-row"><span class="label">Video fit</span><div class="seg" id="fitSeg"><button data-v="cover">Fill (crop edges)</button><button data-v="contain">Fit whole video</button></div></div>
              <div class="setting-row"><span class="label">Background</span><div class="color-row">${colorBtn('general.background', R.general.background, 'Behind the video')}</div></div>
              <div class="setting-row"><span class="label">Captions</span><div class="row" style="gap:12px">${toggle('general.captions', R.general.captions, 'Add spoken-word captions')}<select data-bind="general.captionStyle" id="capStyle" style="width:auto" ${R.general.captions ? '' : 'hidden'}>${Object.entries(s.captionStyles)
                .filter(([k]) => k !== 'none')
                .map(([k, v]) => `<option value="${k}" ${k === R.general.captionStyle ? 'selected' : ''}>${esc(v)}</option>`)
                .join('')}</select></div></div>
              <div class="setting-row"><span class="label">Playback order</span>
                <div class="stack" style="gap:8px">
                  ${toggle('playback.custom', R.playback.custom, 'Choose the order myself')}
                  <div id="orderRow" ${R.playback.custom ? '' : 'hidden'}><div class="seg" id="orderSeg"><button data-v="countdown">Countdown (last → #1)</button><button data-v="ascending">In order (#1 → last)</button></div></div>
                  <span class="hint" id="orderHelp"></span>
                </div>
              </div>
            </div>
          </section>

          <section class="rk-section" data-for="effects">
            <div class="section-intro"><div><h2>Effects &amp; audio</h2><p>Extra polish between ranks, sound, and the ending.</p></div></div>
            <div class="panel">
              <div class="setting-row"><span class="label">Between ranks</span><div class="seg" id="transSeg"><button data-v="none">Cut</button><button data-v="flash">White flash</button><button data-v="dip">Dip to black</button></div></div>
              <div class="setting-row"><span class="label">Extras</span><div class="stack" style="gap:10px">
                ${toggle('extras.rankPop', R.extras.rankPop, 'Big rank number pops up')}
                ${toggle('extras.sfx', R.extras.sfx, 'Whoosh sound on each change')}
                ${toggle('extras.announce', R.extras.announce, 'A voice says "Number 3!"')}
                <select data-bind="extras.announceVoice" id="annVoice" style="max-width:320px" ${R.extras.announce ? '' : 'hidden'}><option value="">Auto voice</option>${voiceOptions(voices, R.extras.announceVoice)}</select>
              </div></div>
              <div class="setting-row"><span class="label">Background music</span><div class="stack" style="gap:8px">
                <div class="row" id="musicRow"></div>
                <div class="slider-box" id="musicVol"><span class="small muted">Volume</span><input type="range" min="0" max="0.6" step="0.01" data-bind="extras.musicVolume" data-num value="${R.extras.musicVolume}" /><output data-out="extras.musicVolume">${Math.round(R.extras.musicVolume * 100)}</output></div>
                <input type="file" id="musicIn" accept="audio/*,video/*" hidden />
              </div></div>
              <div class="setting-row"><span class="label">Watermark</span><div class="row" style="gap:10px"><input type="text" data-bind="extras.watermark" value="${esc(R.extras.watermark)}" placeholder="@yourchannel" maxlength="40" style="max-width:260px" />${colorBtn('extras.markColor', R.extras.markColor || '#ffffff', 'Color')}</div></div>
              <div class="setting-row"><span class="label">End screen</span><div class="stack" style="gap:8px;flex:1">
                <div class="rich" id="endText"></div>
                <div class="row" style="gap:8px">${colorBtn('end', R.extras.endColor || '#ffffff', 'Text color')}${emojiButton('end')}<span class="hint">Shown for 2.5 s after the last clip. Leave empty for no end screen.</span></div>
              </div></div>
            </div>
          </section>
        </div>
        <div class="render-bar" id="renderBar"></div>
      </div>

      <aside class="rk-preview">
        <div class="pv-tabs"><button data-tab="preview">Live preview</button><button data-tab="final">Final video <span class="dot-ready" id="finalDot" hidden></span></button></div>
        <div id="tabPreview" class="stack" style="align-items:center;gap:12px">
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
          <div class="pv-controls"><button class="btn sm primary" id="pvPlay">${icon('play', 14)} Play preview</button><button class="btn sm ghost icon-only" id="pvMute" title="Sound">${icon('volume', 17)}</button><span class="muted small" id="pvTime"></span></div>
          <span class="hint" style="max-width:330px;text-align:center"><span class="kbd">Space</span> play / stop · <span class="kbd">Ctrl</span>+<span class="kbd">Enter</span> generate · captions appear in the final video only</span>
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
      ? `<span class="small" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" class="music-name">${icon('music', 16)} ${esc(R.music.name)}</span><button class="btn sm" id="musicPick">Replace</button><button class="btn sm ghost danger" id="musicDel">Remove</button>`
      : `<button class="btn sm" id="musicPick">${icon('upload', 16)} Upload music</button><span class="muted small">Loops under the video, fades out at the end.</span>`;
    $('#musicVol').hidden = !R.music;
  }

  function syncToolbar() {
    syncExtras();
    $$('[data-toggle]').forEach((b) => b.classList.toggle('on', Boolean(getPath(b.dataset.toggle))));
    $$('[data-align]').forEach((b) => b.classList.toggle('on', R.title.align === b.dataset.align));
    $$('#fitSeg button').forEach((b) => b.classList.toggle('selected', R.general.fit === b.dataset.v));
    $$('#orderSeg button').forEach((b) => b.classList.toggle('selected', R.playback.order === b.dataset.v));
    $$('#labelModeSeg button').forEach((b) => b.classList.toggle('selected', (R.ranks.labelMode || 'stay') === b.dataset.v));
    $('#labelSecsBox').hidden = R.ranks.labelMode !== 'seconds';
    $('#bgNone').classList.toggle('on', !R.title.bg);
    $('#bgNone').textContent = R.title.bg ? 'Remove box' : 'No box';
    $$('.color-btn[data-color-for]').forEach((b) => {
      const target = b.dataset.colorFor;
      const none = target === 'title.bg' && !R.title.bg;
      b.querySelector('.sw').style.background = none ? 'repeating-linear-gradient(45deg,#c3cde3 0 4px,transparent 4px 8px)' : paletteColor(target);
      b.classList.toggle('is-none', none);
    });
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

  // ---------- Emoji picker ----------

  const richBoxFor = (target) => (target === 'title' ? $('#titleText') : target === 'end' ? $('#endText') : $(`[data-label="${target.slice(6)}"]`));
  function openEmojiPicker(btn) {
    $('.emoji-pop')?.remove();
    const pop = document.createElement('div');
    pop.className = 'emoji-pop';
    pop.innerHTML = EMOJIS.map((e) => `<button type="button" data-emo="${e}">${e}</button>`).join('');
    document.body.appendChild(pop);
    const r = btn.getBoundingClientRect();
    pop.style.left = `${Math.min(window.innerWidth - pop.offsetWidth - 12, r.left)}px`;
    pop.style.top = `${r.bottom + 6 + window.scrollY}px`;
    // Keep the caret in the text box while picking.
    pop.addEventListener('mousedown', (e) => e.preventDefault());
    pop.addEventListener('click', (e) => {
      const emo = e.target.closest('[data-emo]')?.dataset.emo;
      const box = richBoxFor(btn.dataset.emojiFor);
      if (emo && box) insertAtCaret(box, emo);
    });
    const close = (e) => {
      if (!pop.contains(e.target) && e.target !== btn) {
        pop.remove();
        document.removeEventListener('mousedown', close);
      }
    };
    setTimeout(() => document.addEventListener('mousedown', close));
    onCleanup(() => pop.remove());
  }
  const onEmojiBtn = (e) => {
    const btn = e.target.closest('[data-emoji-for]');
    if (btn) openEmojiPicker(btn);
  };
  const onEmojiDown = (e) => {
    if (e.target.closest('[data-emoji-for]')) e.preventDefault(); // don't steal the caret from the text box
  };
  app.addEventListener('click', onEmojiBtn);
  app.addEventListener('mousedown', onEmojiDown);
  onCleanup(() => {
    app.removeEventListener('click', onEmojiBtn);
    app.removeEventListener('mousedown', onEmojiDown);
  });

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

  const snapshot = () => JSON.stringify({ title: R.title, general: R.general, ranks: R.ranks, playback: R.playback, extras: R.extras, items: R.items.map((it) => [it.id, it.label || '', it.color || '', it.font || '']) });
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
    const ordered = s0.items.map(([iid, label, color, font]) => {
      const it = byId.get(iid);
      if (it) Object.assign(it, { label, color: color || '', font: font || '' });
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
      btn.innerHTML = `${icon('wand', 16)} Suggest titles`;
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
    } else if (t.id === 'removeAll') {
      if (!confirm(`Remove all ${R.items.length} videos from this ranking? Your title, colors and other settings are kept.`)) return;
      saving.then(() => api('DELETE', `/api/rankings/${id}/items`)).then(merge).catch((err) => toast(err.message, true));
    } else if (t.id === 'bgNone') {
      R.title.bg = '';
      changed();
    } else if (t.closest('#fitSeg')) {
      R.general.fit = t.dataset.v;
      changed();
    } else if (t.closest('#orderSeg')) {
      R.playback.order = t.dataset.v;
      changed();
    } else if (t.closest('#labelModeSeg')) {
      R.ranks.labelMode = t.dataset.v;
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
    } else if (t.dataset.section) showSection(t.dataset.section);
    else if (t.dataset.colorFor) openColorPicker(t);
  }

  // ---------- Sections (tabs) ----------

  function showSection(key) {
    section = key;
    $$('.rk-section').forEach((s) => (s.hidden = s.dataset.for !== key));
    $$('#rkTabs [data-section]').forEach((b) => b.classList.toggle('on', b.dataset.section === key));
    try {
      localStorage.setItem('sf.rankTab', key);
    } catch {
      /* private mode: fine */
    }
    window.scrollTo({ top: 0 });
  }

  // ---------- Color picker popover ----------

  function openColorPicker(btn) {
    closeColorPicker();
    const target = btn.dataset.colorFor;
    const current = paletteColor(target);
    const isText = target === 'title' || target === 'end' || target.startsWith('label:');
    const pop = document.createElement('div');
    pop.className = 'color-pop';
    pop.innerHTML = `
      ${isText ? '<div class="hint" style="margin-bottom:8px">Selected words only, or the whole text if nothing is selected.</div>' : ''}
      ${paletteHTML(target, current)}
      <div class="row" style="gap:8px;margin-top:10px"><span class="hint">Hex</span><input type="text" class="hex-in" value="${esc(current)}" maxlength="7" spellcheck="false" /></div>`;
    app.appendChild(pop); // inside #app so the palette click handlers apply
    syncPalette(pop.querySelector('.palette'), current);
    const r = btn.getBoundingClientRect();
    pop.style.left = `${Math.max(12, Math.min(window.innerWidth - pop.offsetWidth - 12, r.left))}px`;
    const below = r.bottom + 8 + pop.offsetHeight < window.innerHeight;
    pop.style.top = `${below ? r.bottom + 8 : r.top - pop.offsetHeight - 8}px`;
    const hex = pop.querySelector('.hex-in');
    hex.addEventListener('change', () => {
      const v = hex.value.trim().replace(/^([0-9a-f]{6})$/i, '#$1');
      if (/^#[0-9a-f]{6}$/i.test(v)) applyColor(target, v.toLowerCase());
      else toast('Use a hex color like #ff3b30', true);
    });
    // Picking a preset closes the popover; the custom wheel and hex box keep it open.
    pop.addEventListener('click', (e) => {
      if (e.target.closest('.dot[data-color]')) setTimeout(closeColorPicker, 0);
    });
  }
  function closeColorPicker() {
    $('.color-pop')?.remove();
  }
  const onOutsidePicker = (e) => {
    if (!e.target.closest('.color-pop, [data-color-for]')) closeColorPicker();
  };
  const onColorBtnDown = (e) => {
    if (e.target.closest('[data-color-for]')) e.preventDefault(); // keep the word selection in the text box
  };
  document.addEventListener('mousedown', onOutsidePicker);
  app.addEventListener('mousedown', onColorBtnDown);
  window.addEventListener('scroll', closeColorPicker, true);
  onCleanup(() => {
    document.removeEventListener('mousedown', onOutsidePicker);
    app.removeEventListener('mousedown', onColorBtnDown);
    window.removeEventListener('scroll', closeColorPicker, true);
    closeColorPicker();
  });

  // ---------- Keyboard shortcuts ----------

  const typing = () => {
    const a = document.activeElement;
    return a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable);
  };
  const onShortcut = (e) => {
    if (e.code === 'Space' && !typing() && !e.target.closest?.('button, video')) {
      e.preventDefault();
      $('#pvPlay')?.click();
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      $('#renderBtn')?.click();
    }
  };
  document.addEventListener('keydown', onShortcut);
  onCleanup(() => document.removeEventListener('keydown', onShortcut));

  // ---------- Saving ----------

  let saveTimer = null;
  let saving = Promise.resolve();
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 600);
    setSaveState('pending');
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
          const x = { id: it.id, label: it.label || '', color: it.color || '', font: it.font || '' };
          if (ui.resetAuto.has(it.id)) x.auto = true;
          else if (ui.dirtyTrim.has(it.id)) Object.assign(x, { trimStart: it.trimStart, trimEnd: it.trimEnd });
          return x;
        }),
      },
    };
    ui.resetAuto.clear();
    const sentTrims = new Set(ui.dirtyTrim);
    setSaveState('saving');
    saving = saving
      .then(() => api('PUT', `/api/rankings/${id}`, payload))
      .then((fresh) => {
        sentTrims.forEach((x) => ui.dirtyTrim.delete(x));
        merge(fresh);
        setSaveState(saveTimer ? 'pending' : 'saved');
      })
      .catch((err) => {
        setSaveState('error');
        toast(err.message, true);
      });
    return saving;
  }
  function setSaveState(state) {
    const el = $('#saveState');
    if (!el) return;
    el.dataset.state = state;
    el.textContent = { saving: 'Saving…', pending: 'Unsaved changes', saved: 'All changes saved', error: 'Not saved: check the server' }[state];
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
      return { ...si, label: li.label || si.label, color: li.color ?? si.color, font: li.font ?? si.font, ...keepTrim };
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
    if (it.status === 'downloading') return '<div class="rc-status"><div class="spinner sm"></div>Downloading from the link…</div>';
    if (it.status === 'processing' || it.status === 'analyzing') return '<div class="rc-status"><div class="spinner sm"></div>Finding the best moment…</div>';
    if (it.status === 'error') return `<div class="banner err small"><div><b>Couldn't use this video.</b> ${esc(it.error || 'Something went wrong.')} Remove it and try another link, or upload the file.</div></div>`;
    return `
      <div class="trim">
        <div class="trim-top"><span class="label">Trim</span><span data-mode class="badge"></span><span class="hint" data-info></span></div>
        <div class="moment" data-moment="${it.id}" title="Drag the yellow edges to trim · drag the middle to move · click elsewhere to jump the video there">
          <div class="bars"></div>
          <div class="win"><div class="h l" title="Drag to set the start"></div><div class="h r" title="Drag to set the end"></div></div>
          <div class="ph"></div>
        </div>
        <div class="trim-row">
          <div class="tpair"><label class="tfield">Start<input type="text" data-ts="start" /></label><button class="btn sm ghost" data-act="setStart" title="Start at the frame showing in the video">Set to playhead</button></div>
          <div class="tpair"><label class="tfield">End<input type="text" data-ts="end" /></label><button class="btn sm ghost" data-act="setEnd" title="End at the frame showing in the video">Set to playhead</button></div>
          <span class="grow"></span>
          <button class="btn sm" data-act="playTrim" title="Play just the trimmed part">${icon('play', 13)} Play trim</button>
          <button class="btn sm ghost" data-act="whole" title="Use the whole clip">${icon('expand', 15)} Whole clip</button>
          <button class="btn sm ghost" data-act="auto" title="Let ShortsForge pick the best moment again">${icon('refresh', 15)} Auto-pick</button>
        </div>
        ${it.ai?.reason ? `<span class="hint" style="color:#5b3fd9">${icon('sparkles', 14)} AI saw: ${esc(it.ai.reason)} (payoff at ${fmtTime(it.ai.peak, true)})</span>` : ''}
      </div>`;
  }

  function itemCard(it, i) {
    const n = R.items.length;
    const plain = plainText(it.label);
    const src = it.url ? `<a href="${esc(it.url)}" target="_blank" rel="noreferrer" title="${esc(it.url)}">${esc(new URL(it.url).hostname.replace(/^www\./, ''))} ↗</a>` : esc(it.sourceName || '');
    return `
      <div class="rank-card ${ui.collapsed.has(it.id) ? 'collapsed' : ''}" data-id="${it.id}">
        <div class="rc-head" data-act="collapse">
          <span class="grip" draggable="true" title="Drag to reorder">⋮⋮</span>
          <div class="num">${i + 1}</div>
          <div class="name">${plain ? esc(plain) : `<span class="muted">Rank #${i + 1}, no label yet</span>`}</div>
          ${it.status === 'ready' ? `<span class="chip">${itemLength(it).toFixed(1)}s</span>` : ''}
          <span class="rc-actions">
            <button class="icon-btn" data-act="up" title="Move up (better rank)" ${i === 0 ? 'disabled' : ''}>${I.up}</button>
            <button class="icon-btn" data-act="down" title="Move down" ${i === n - 1 ? 'disabled' : ''}>${I.down}</button>
            <button class="icon-btn" data-act="dup" title="Duplicate" ${n >= MAX || it.status !== 'ready' ? 'disabled' : ''}>${I.copy}</button>
            <button class="icon-btn danger" data-act="del" title="Remove">${I.trash}</button>
          </span>
          <span class="chev">${I.chevron}</span>
        </div>
        <div class="rc-body">
          <div class="rc-vid-wrap">
            <div class="rc-vid">${it.status === 'ready' ? `<video data-vid="${it.id}" src="/files/${id}/${it.file}" preload="metadata" playsinline title="Click to play / pause"></video><div class="vid-play">${icon('play', 22)}</div>` : '<div class="rc-vid-empty"></div>'}</div>
            ${it.status === 'ready' ? `<div class="vid-time" data-vtime="${it.id}">0:00.0</div>` : ''}
          </div>
          <div class="rc-fields">
            <div class="rich label-box" data-label="${it.id}"></div>
            <div class="label-tools">
              ${colorBtn(`label:${it.id}`, it.color || R.ranks.labelColor, 'Color')}
              ${emojiButton(`label:${it.id}`)}
              <select data-font="${it.id}" class="mini-select" title="Font for this label"><option value="">Font: same as list</option>${fonts.map((f) => `<option value="${esc(f.family)}" ${f.family === it.font ? 'selected' : ''}>${esc(f.family)}</option>`).join('')}</select>
              <span class="grow"></span>
              <span class="hint src">${src}${it.duration ? ` · ${fmtTime(it.duration)}` : ''}</span>
            </div>
            ${statusBlock(it)}
          </div>
        </div>
      </div>`;
  }

  function addCard(n) {
    const empty = n === 0;
    return `
      <div class="add-zone ${empty ? 'big' : ''}" id="addZone">
        ${empty ? `<div class="add-ic">${icon('film', 30)}</div><h3>Add the videos you want to rank</h3><p class="muted">Paste TikTok, YouTube or Instagram links, or drop video files here. The first one you add becomes #1.</p>` : `<div class="add-title"><b>Add rank #${n + 1}</b><span class="muted small">${n}/${MAX} videos</span></div>`}
        <div class="link-row">
          <div class="input-box"><input type="text" id="linkIn" placeholder="Paste a TikTok, YouTube or Instagram link (or several, one per line)" /></div>
          <button class="go-btn" id="linkGo" title="Add">${I.arrow}</button>
        </div>
        <div class="row" style="gap:10px;justify-content:${empty ? 'center' : 'flex-start'}"><button class="btn sm" id="uploadBtn">${icon('upload', 16)} Upload video files</button><span class="muted small">or drag files onto this page</span><input type="file" id="uploadIn" accept="video/*" multiple hidden /></div>
        <div id="upState"></div>
      </div>`;
  }

  function renderItems() {
    const active = document.activeElement;
    const focusLabel = active?.dataset?.label;
    itemsBox.innerHTML = R.items.map(itemCard).join('') + (R.items.length < MAX ? addCard(R.items.length) : `<div class="hint" style="text-align:center">That's the maximum of ${MAX} videos. Remove one to add another.</div>`);
    R.items.forEach(updateMoment);
    // Each label is a colorable text box.
    for (const it of R.items) {
      const box = $(`[data-label="${it.id}"]`);
      if (!box) continue;
      box.style.fontFamily = `"${it.font || R.ranks.font}", "Segoe UI Emoji"`;
      makeRich(box, {
        value: it.label || '',
        base: it.color || R.ranks.labelColor,
        placeholder: 'e.g. Rooftop slip 😱',
        onChange: (markup) => {
          // Look the rank up again: background refreshes replace the item objects.
          const cur = R.items.find((x) => x.id === it.id);
          if (!cur) return;
          cur.label = markup;
          const name = $(`[data-id="${it.id}"] .name`);
          const plain = plainText(markup);
          name.innerHTML = plain ? esc(plain) : `<span class="muted">Rank #${R.items.indexOf(cur) + 1}, no label yet</span>`;
          drawPreview();
          scheduleSave();
          recordHistory();
        },
      });
    }
    wireRankVideos();
    $('#removeAll').hidden = !R.items.length;
    $('#videoCount').textContent = R.items.length ? `${R.items.length}/${MAX}` : '';
    wireCardDrag();
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

  // ---------- Drag to reorder (grab the ⋮⋮ handle) ----------

  let draggingId = null;
  function wireCardDrag() {
    $$('.rank-card[data-id] .grip', itemsBox).forEach((grip) => {
      const card = grip.closest('.rank-card');
      grip.addEventListener('dragstart', (e) => {
        draggingId = card.dataset.id;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', draggingId);
        e.dataTransfer.setDragImage(card, 30, 30);
        setTimeout(() => card.classList.add('dragging'));
      });
      grip.addEventListener('dragend', () => {
        draggingId = null;
        $$('.rank-card', itemsBox).forEach((c) => c.classList.remove('dragging', 'drop-before', 'drop-after'));
      });
    });
  }
  itemsBox.addEventListener('dragover', (e) => {
    if (!draggingId) return;
    const card = e.target.closest('.rank-card[data-id]');
    if (!card || card.dataset.id === draggingId) return;
    e.preventDefault();
    const r = card.getBoundingClientRect();
    const after = e.clientY > r.top + r.height / 2;
    $$('.rank-card', itemsBox).forEach((c) => c.classList.remove('drop-before', 'drop-after'));
    card.classList.add(after ? 'drop-after' : 'drop-before');
  });
  itemsBox.addEventListener('drop', (e) => {
    if (!draggingId) return;
    const card = e.target.closest('.rank-card[data-id]');
    if (!card) return;
    e.preventDefault();
    const from = R.items.findIndex((x) => x.id === draggingId);
    let to = R.items.findIndex((x) => x.id === card.dataset.id);
    if (card.classList.contains('drop-after')) to += 1;
    if (from < to) to -= 1;
    draggingId = null;
    move(from, Math.max(0, Math.min(R.items.length - 1, to)));
  });

  // ---------- Drop video files anywhere on the editor ----------

  const rkEl = $('.rk');
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  rkEl.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    rkEl.classList.add('drop-files');
  });
  rkEl.addEventListener('dragleave', (e) => {
    if (e.target === rkEl || !rkEl.contains(e.relatedTarget)) rkEl.classList.remove('drop-files');
  });
  rkEl.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    rkEl.classList.remove('drop-files');
    const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('video/') || /\.(mp4|mov|webm|mkv|m4v)$/i.test(f.name));
    if (!files.length) return toast('Drop video files (MP4, MOV, WebM).', true);
    showSection('videos');
    uploadFiles(files);
  });

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
    $('[data-info]', card).textContent = `using ${itemLength(it).toFixed(1)}s of ${it.duration.toFixed(1)}s`;
    const chip = $('.rc-head .chip', card);
    if (chip) chip.textContent = `${itemLength(it).toFixed(1)}s`;
    const mode = $('[data-mode]', card);
    const auto = it.auto !== false;
    mode.innerHTML = auto ? `${icon('sparkles', 13)} Auto best moment` : `${icon('scissors', 13)} Trimmed by you`;
    mode.className = `badge ${auto ? 'blue' : ''}`;
    $('[data-act="auto"]', card).hidden = auto;
    // Keep the time boxes in sync unless the user is typing in them.
    for (const [key, val] of [['start', it.trimStart], ['end', it.trimEnd]]) {
      const input = $(`[data-ts="${key}"]`, card);
      if (input && document.activeElement !== input) input.value = fmtTime(val, true);
    }
  }

  // ---------- Per-rank video player (used for trimming) ----------

  const vidOf = (itemId) => $(`video[data-vid="${itemId}"]`);
  const playingTrim = new Set(); // items currently playing "trimmed part only"

  function setPlayhead(it, t) {
    const box = $(`[data-moment="${it.id}"]`);
    const ph = box && $('.ph', box);
    if (ph) ph.style.left = `${(Math.min(it.duration, Math.max(0, t)) / it.duration) * 100}%`;
    const label = $(`[data-vtime="${it.id}"]`);
    if (label) label.textContent = fmtTime(t, true);
  }

  /** Wire up each rank's video: click to play/pause, playhead follows, "play trimmed" stops at the end. */
  function wireRankVideos() {
    for (const it of R.items) {
      const v = vidOf(it.id);
      if (!v || v.dataset.wired) continue;
      v.dataset.wired = '1';
      v.addEventListener('loadedmetadata', () => {
        v.currentTime = it.trimStart || 0;
      });
      v.addEventListener('timeupdate', () => {
        const live = R.items.find((x) => x.id === it.id) || it;
        setPlayhead(live, v.currentTime);
        if (playingTrim.has(it.id) && v.currentTime >= live.trimEnd - 0.05) {
          v.pause();
          playingTrim.delete(it.id);
          v.currentTime = live.trimEnd;
        }
      });
      const playIcon = v.parentElement.querySelector('.vid-play');
      v.addEventListener('play', () => playIcon && (playIcon.hidden = true));
      v.addEventListener('pause', () => playIcon && (playIcon.hidden = false));
      v.addEventListener('click', () => {
        playingTrim.delete(it.id);
        v.paused ? v.play().catch(() => {}) : v.pause();
      });
      playIcon?.addEventListener('click', () => v.play().catch(() => {}));
    }
  }

  function playTrimmed(it) {
    const v = vidOf(it.id);
    if (!v) return;
    playingTrim.add(it.id);
    v.currentTime = it.trimStart;
    v.play().catch(() => {});
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
      if (e.target.closest('button, .grip, select, a')) return;
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
    else if (act === 'playTrim') playTrimmed(R.items[idx]);
    else if (act === 'setStart' || act === 'setEnd') {
      const it = R.items[idx];
      const v = vidOf(it.id);
      if (!v) return;
      const t = v.currentTime;
      if (act === 'setStart') setTrim(it, t, Math.max(it.trimEnd, t + MIN_LEN));
      else setTrim(it, Math.min(it.trimStart, t - MIN_LEN), t);
      save();
      recordHistory();
    } else if (act === 'whole') {
      setTrim(R.items[idx], 0, R.items[idx].duration);
      save();
      recordHistory();
    } else if (act === 'dup') {
      await saving;
      try {
        merge(await api('POST', `/api/rankings/${id}/items/${itemId}/duplicate`));
        toast(`Rank #${idx + 1} duplicated as #${idx + 2}.`);
      } catch (err) {
        toast(err.message, true);
      }
    }
  });

  itemsBox.addEventListener('change', (e) => {
    if (e.target.dataset.font !== undefined) {
      const it = R.items.find((x) => x.id === e.target.dataset.font);
      it.font = e.target.value;
      const box = $(`[data-label="${it.id}"]`);
      if (box) box.style.fontFamily = it.font ? `"${it.font}"` : '';
      drawPreview();
      save();
      recordHistory();
      return;
    }
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

  // ---------- Trimming ----------
  // Drag the yellow edges to set start/end (the video shows that exact frame while you drag),
  // drag the middle to move the whole selection, click outside it to jump the video there.
  const MIN_LEN = 0.5;
  let mdrag = null;
  itemsBox.addEventListener('pointerdown', (e) => {
    const box = e.target.closest('.moment');
    if (!box) return;
    const it = R.items.find((x) => x.id === box.dataset.moment);
    if (!it?.duration) return;
    const rect = box.getBoundingClientRect();
    const toT = (x) => Math.min(it.duration, Math.max(0, ((x - rect.left) / rect.width) * it.duration));
    const t = toT(e.clientX);
    const v = vidOf(it.id);
    v?.pause();
    playingTrim.delete(it.id);
    if (e.target.classList.contains('h')) mdrag = { it, toT, kind: e.target.classList.contains('l') ? 'l' : 'r' };
    else if (e.target.closest('.win')) mdrag = { it, toT, kind: 'move', offset: t - it.trimStart, len: it.trimEnd - it.trimStart };
    else {
      if (v) v.currentTime = t;
      setPlayhead(it, t);
      mdrag = { it, toT, kind: 'seek' };
    }
    box.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  itemsBox.addEventListener('pointermove', (e) => {
    if (!mdrag) return;
    const { it, toT, kind } = mdrag;
    const t = toT(e.clientX);
    const v = vidOf(it.id);
    if (kind === 'l') {
      setTrim(it, Math.min(t, it.trimEnd - MIN_LEN), it.trimEnd);
      if (v) v.currentTime = it.trimStart;
    } else if (kind === 'r') {
      setTrim(it, it.trimStart, Math.max(t, it.trimStart + MIN_LEN));
      if (v) v.currentTime = Math.max(0, it.trimEnd - 0.04);
    } else if (kind === 'move') {
      const start = Math.min(Math.max(0, t - mdrag.offset), it.duration - mdrag.len);
      setTrim(it, start, start + mdrag.len);
      if (v) v.currentTime = it.trimStart;
    } else if (v) {
      v.currentTime = t;
      setPlayhead(it, t);
    }
  });
  const endDrag = () => {
    if (!mdrag) return;
    const wasTrim = mdrag.kind !== 'seek';
    mdrag = null;
    if (wasTrim) {
      save();
      recordHistory();
    }
  };
  itemsBox.addEventListener('pointerup', endDrag);
  itemsBox.addEventListener('pointercancel', endDrag);

  function setTrim(it, start, end) {
    start = Math.max(0, Math.min(start, it.duration - MIN_LEN));
    end = Math.min(it.duration, Math.max(end, start + MIN_LEN));
    it.trimStart = +start.toFixed(2);
    it.trimEnd = +end.toFixed(2);
    it.auto = false;
    ui.dirtyTrim.add(it.id);
    updateMoment(it);
    renderBar();
    updateTime();
  }

  // Typing exact times: "12.5", "0:12.5" or "1:02".
  const parseTime = (s) => {
    const parts = String(s).trim().split(':').map(Number);
    if (!parts.length || parts.some((n) => !Number.isFinite(n))) return NaN;
    return parts.reduce((acc, n) => acc * 60 + n, 0);
  };
  itemsBox.addEventListener('change', (e) => {
    const key = e.target.dataset?.ts;
    if (!key) return;
    const it = R.items.find((x) => x.id === e.target.closest('.rank-card')?.dataset.id);
    const t = parseTime(e.target.value);
    if (!it || !Number.isFinite(t)) {
      if (it) updateMoment(it);
      return toast('Type a time like 12.5 or 0:12.5', true);
    }
    if (key === 'start') setTrim(it, t, Math.max(it.trimEnd, t + MIN_LEN));
    else setTrim(it, Math.min(it.trimStart, t - MIN_LEN), t);
    const v = vidOf(it.id);
    if (v) v.currentTime = key === 'start' ? it.trimStart : it.trimEnd - 0.04;
    updateMoment(it);
    save();
    recordHistory();
  });
  itemsBox.addEventListener('keydown', (e) => {
    if (e.target.dataset?.ts && e.key === 'Enter') e.target.blur();
  });

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
  const player = { playing: false, seq: [], k: 0, revealed: null, end: 0, startedAt: {} };
  /** Is rank i's label on screen right now in the preview? (All labels show while idle.) */
  function labelVisible(i) {
    if (!player.revealed) return true;
    if (!player.revealed.has(i)) return false;
    const mode = R.ranks.labelMode || 'stay';
    const current = player.seq[player.k];
    if (mode === 'during') return i === current;
    if (mode === 'seconds') return performance.now() - (player.startedAt[i] || 0) < (Number(R.ranks.labelSeconds) || 3) * 1000;
    return true;
  }
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
      const show = plainText(it?.label).trim() && labelVisible(i);
      const font = it?.font ? `font-family:'${esc(it.font)}';` : '';
      return `<div style="height:${lh}px;line-height:${lh}px">${i + 1}.${show ? ` <span style="${font}color:${esc(it.color || k.labelColor)}">${richHTML(it.label)}</span>` : ''}</div>`;
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
    $('#pvPlay').innerHTML = `${icon('stop', 13)} Stop`;
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
    player.startedAt[i] = performance.now();
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
    $('#pvPlay').innerHTML = `${icon('play', 14)} Play preview`;
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
    else if (player.playing && R.ranks.labelMode === 'seconds') drawPreview(); // labels time out mid-clip
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
    $('#pvMute').innerHTML = icon(pv.muted ? 'mute' : 'volume', 17);
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
    $('#finalDot').hidden = !P.output;
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
          <a class="btn primary" href="/files/${id}/${P.output.file}?download=1">${icon('download', 16)} Download MP4</a>
          <button class="btn" data-yt-project="${id}" data-yt-file="${P.output.file}" data-yt-title="${esc(plainText(R.title.text))}">${icon('youtube', 17)} Upload to YouTube</button>
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
    const unlabeled = R.items.filter((i) => i.status === 'ready' && !plainText(i.label).trim()).length;
    // One clear status line: the blocking problem first, then gentle hints, then the summary.
    let status;
    if (!R.items.length) status = '<span class="st muted">Add videos to get started</span>';
    else if (failed) status = `<span class="st err">${icon('alert', 16)} A video failed. Remove it to generate.</span>`;
    else if (waiting) status = '<span class="st warn"><span class="spinner xs"></span> Preparing videos…</span>';
    else if (unlabeled) status = `<span class="st warn">${unlabeled} rank${unlabeled > 1 ? 's have' : ' has'} no label <button class="link-btn" data-section="videos">add labels</button></span>`;
    else status = `<span class="st ok">${icon('check', 16)} Ready to generate</span>`;
    const summary = R.items.length ? `<span class="muted small">${R.items.length} video${R.items.length === 1 ? '' : 's'} · ${fmtTime(total)}</span>` : '';
    bar.innerHTML = busy
      ? `<div class="spinner xs"></div><b class="small" style="white-space:nowrap">${esc(P.step || 'Rendering')}…</b><div class="progress"><div style="width:${P.progress || 0}%"></div></div><span class="muted small">${P.progress || 0}% · you can keep editing</span>`
      : `${status}${summary}
         <span style="flex:1"></span>
         ${P.output ? `<a class="btn" href="/files/${id}/${P.output.file}?download=1">${icon('download', 16)} Last render</a>` : ''}
         <button class="btn primary big-cta" id="renderBtn" title="Ctrl+Enter" ${!ready.length || waiting || failed ? 'disabled' : ''}>${icon('sparkles', 18)} ${P.output ? 'Generate again' : 'Generate video'}</button>`;
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
  showSection(section);
  setSaveState('saved');
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
