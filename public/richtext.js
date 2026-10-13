// Rich text with per-word colors. Stored as plain text plus [c=#rrggbb]words[/c] runs, which the
// renderer turns into subtitle color tags. Text outside a run uses the field's base color.
import { esc } from './core.js';

const RUN = /\[c=(#[0-9a-f]{6})\]([\s\S]*?)\[\/c\]/gi;
export const PRESETS = ['#ffffff', '#ffe500', '#ff9500', '#ff3b30', '#ff2d95', '#af52de', '#3b6cff', '#00d1ff', '#34c759', '#000000'];

export const plainText = (s) => String(s || '').replace(RUN, '$2');

/** Markup → HTML for the editor and the preview. */
export function richHTML(s) {
  s = String(s || '');
  let out = '';
  let last = 0;
  for (const m of s.matchAll(RUN)) {
    out += esc(s.slice(last, m.index));
    out += `<span style="color:${m[1]}">${esc(m[2])}</span>`;
    last = m.index + m[0].length;
  }
  return (out + esc(s.slice(last))).replace(/\n/g, '<br>');
}

const toHex = (c) => {
  if (!c) return null;
  if (/^#[0-9a-f]{6}$/i.test(c)) return c.toLowerCase();
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c);
  return m ? `#${[m[1], m[2], m[3]].map((n) => (+n).toString(16).padStart(2, '0')).join('')}` : null;
};

/** Editor DOM → markup. Words colored the same as the base color are stored plain (they follow the base). */
export function serialize(el, base) {
  const runs = [];
  const push = (t, c) => {
    if (!t) return;
    const last = runs[runs.length - 1];
    if (last && last.c === c) last.t += t;
    else runs.push({ t, c });
  };
  const walk = (node, color) => {
    for (const n of node.childNodes) {
      if (n.nodeType === 3) push(n.nodeValue.replace(/ /g, ' '), color);
      else if (n.nodeName === 'BR') push('\n', color);
      else if (n.nodeType === 1) {
        if (/^(DIV|P)$/.test(n.nodeName) && runs.length && !runs[runs.length - 1].t.endsWith('\n')) push('\n', color);
        walk(n, toHex(n.style?.color) || toHex(n.getAttribute('color')) || color);
      }
    }
  };
  walk(el, null);
  const b = toHex(base);
  const safe = (t) => t.replace(/[[\]]/g, (ch) => (ch === '[' ? '(' : ')')); // brackets would look like markup
  return runs
    .map((r) => (!r.c || r.c === b || !r.t.trim() ? safe(r.t) : `[c=${r.c}]${safe(r.t)}[/c]`))
    .join('')
    .replace(/\n+$/, '');
}

// Remember the last selection inside a rich editor, so clicking a color (which can steal focus) still colors it.
let saved = null;
document.addEventListener('selectionchange', () => {
  const sel = getSelection();
  if (!sel.rangeCount) return;
  const r = sel.getRangeAt(0);
  const node = r.commonAncestorContainer;
  const ed = (node.nodeType === 1 ? node : node.parentElement)?.closest?.('[data-rich]');
  if (ed) saved = { el: ed, range: r.cloneRange() };
});
document.addEventListener('mousedown', (e) => {
  if (!e.target.closest?.('[data-rich], .palette, .emoji-pop, [data-emoji-for], .color-pop, [data-color-for]')) saved = null;
});

/** Turn `el` into a colorable text box. onChange(markup) fires on every edit. */
export function makeRich(el, { value, base, multiline = false, placeholder = '', onChange }) {
  el.contentEditable = 'true';
  el.spellcheck = false;
  el.dataset.rich = '1';
  el.dataset.base = base;
  el.dataset.placeholder = placeholder;
  el.style.color = base;
  el.innerHTML = richHTML(value);
  el.addEventListener('input', () => onChange(serialize(el, el.dataset.base)));
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !multiline) e.preventDefault();
  });
  el.addEventListener('paste', (e) => {
    e.preventDefault();
    const t = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, multiline ? t : t.replace(/\s*\n\s*/g, ' '));
  });
}

/** Re-render a rich box from markup (after undo, AI suggestions, etc.). */
export function setRich(el, value, base) {
  el.dataset.base = base;
  el.style.color = base;
  el.innerHTML = richHTML(value);
}

/** Color the words selected inside `el`. Returns false when nothing in `el` is selected. */
export function colorSelection(el, hex) {
  if (!saved || saved.el !== el || saved.range.collapsed) return false;
  el.focus();
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(saved.range);
  document.execCommand('styleWithCSS', false, true);
  document.execCommand('foreColor', false, hex);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}

/** Insert text (e.g. an emoji) at the caret inside `el`, or at the end if the caret isn't there. */
export function insertAtCaret(el, text) {
  el.focus();
  const sel = getSelection();
  sel.removeAllRanges();
  if (saved && saved.el === el) sel.addRange(saved.range);
  else {
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(false);
    sel.addRange(r);
  }
  document.execCommand('insertText', false, text);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

export const EMOJIS = ['🔥', '😂', '🤣', '😭', '💀', '😱', '🤯', '😳', '👀', '😎', '🥶', '😤', '🙌', '👏', '💪', '🏆', '🥇', '🥈', '🥉', '⭐', '💯', '✅', '❌', '⚠️', '❤️', '💔', '⚡', '🎯', '🚀', '💥', '🤡', '🐐', '👑', '💰', '🎉', '🙏', '🤔', '😬', '🫣', '👇'];

/** A row of preset color dots plus a custom picker. `target` says what the color applies to. */
export function paletteHTML(target, current) {
  return `<div class="palette" data-target="${esc(target)}">${PRESETS.map((c) => `<button type="button" class="dot" data-color="${c}" style="background:${c}" title="${c}"></button>`).join('')}<label class="dot custom" title="Pick any color" style="background:${esc(current)}"><input type="color" value="${esc(current)}" /></label></div>`;
}

/** Mark the dot that matches `current` and show it in the custom swatch. */
export function syncPalette(pal, current) {
  if (!pal) return;
  const hex = toHex(current) || '#ffffff';
  pal.querySelectorAll('.dot[data-color]').forEach((d) => d.classList.toggle('on', d.dataset.color === hex));
  const custom = pal.querySelector('.custom');
  custom.style.background = hex;
  custom.querySelector('input').value = hex;
}
