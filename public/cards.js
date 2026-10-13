// Gallery cards for projects (Home, Library, Video Ranking landing).
import { esc, fmtTime } from './core.js';
import { icon } from './icons.js';

export function projectHref(p) {
  if (p.type === 'ranking') return `#/ranking/${p.id}`;
  if (p.type === 'transcript') return `#/t/${p.id}`;
  if (p.type === 'story') return `#/story/${p.story.kind}/${p.id}`;
  return `#/p/${p.id}`;
}

const STORY_KIND = { video: 'Video Story', text: 'Text Story', commentary: 'Commentary' };
export function typeLabel(p) {
  if (p.type === 'story') return STORY_KIND[p.story?.kind] || 'Story';
  return { ranking: 'Video Ranking', transcript: 'Transcript', clips: 'Auto Clipping' }[p.type || 'clips'];
}
const TYPE_ICON = { ranking: 'list', transcript: 'type', clips: 'scissors', story: 'phone' };

function statusOf(p) {
  if (['queued', 'processing'].includes(p.status)) return ['Rendering', 'busy'];
  if (p.status === 'error') return ['Failed', 'err'];
  if (p.status === 'partial') return ['Needs a look', 'warn'];
  if (p.output || p.status === 'ready') return ['Ready', 'ok'];
  return ['Draft', 'draft'];
}

function details(p) {
  if (p.type === 'ranking') return `${p.ranking.items.length} video${p.ranking.items.length === 1 ? '' : 's'}`;
  if (p.type === 'transcript') return `${fmtTime(p.source?.duration)} audio`;
  if (p.type === 'story') return p.output ? fmtTime(p.output.duration) : 'Not rendered';
  return `${p.clips?.length || 0} clips`;
}

const shortDate = (t) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/** A project as a poster: cover frame, status badge, length, name and details. */
export function posterCard(p, { action = '' } = {}) {
  const href = projectHref(p);
  const thumb = p.output?.thumb
    ? `/files/${p.id}/${p.output.thumb}?v=${p.output.version}`
    : (() => {
        const c = p.clips?.find((x) => x.thumb);
        return c ? `/files/${p.id}/${c.thumb}?v=${c.version}` : null;
      })();
  const [label, cls] = statusOf(p);
  const dur = p.output?.duration ? fmtTime(p.output.duration) : '';
  return `
    <article class="poster-card">
      <a class="poster" href="${href}" aria-label="Open ${esc(p.name)}">
        ${thumb ? `<img src="${thumb}" alt="" loading="lazy" />` : `<div class="poster-ph">${icon(TYPE_ICON[p.type || 'clips'] || 'film', 30)}</div>`}
        <span class="st-badge ${cls}">${cls === 'busy' ? '<span class="pulse"></span>' : ''}${label}</span>
        ${dur ? `<span class="dur">${dur}</span>` : ''}
        <span class="poster-open">${icon('eye', 16)} Open</span>
      </a>
      <div class="poster-body">
        <a class="pt" href="${href}">${esc(p.name)}</a>
        <span class="meta">${typeLabel(p)} · ${details(p)} · ${shortDate(p.updatedAt || p.createdAt)}</span>
        ${action}
      </div>
    </article>`;
}

/** The dashed "create new" tile that sits first in a gallery. */
export function newTile(label, id, sub = '') {
  return `
    <button type="button" class="poster-card new-tile" id="${id}">
      <span class="poster">
        <span class="new-ic">${icon('plus', 26)}</span>
        <b>${esc(label)}</b>
        ${sub ? `<span class="meta">${esc(sub)}</span>` : ''}
      </span>
    </button>`;
}
