// JSONL session handling: streaming render with a sliding-window buffer,
// per-event rendering, and token-usage aggregation with mtime-keyed cache.

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { marked } from 'marked';
import {
  HOME,
  RENDERED_TYPES,
  MAX_TEXT_BLOCK,
  MAX_THINKING,
  MAX_TOOL_INPUT,
  MAX_TOOL_RESULT,
  MAX_BUFFER_HARD_CAP,
  escapeHtml,
  stripCommandWrappers,
} from './util.js';

const DEFAULT_OPTS = Object.freeze({
  caps: { text: MAX_TEXT_BLOCK, thinking: MAX_THINKING, toolInput: MAX_TOOL_INPUT, toolResult: MAX_TOOL_RESULT },
  openDetails: false,
});
const FULL_OPTS = Object.freeze({
  caps: { text: Infinity, thinking: Infinity, toolInput: Infinity, toolResult: Infinity },
  openDetails: true,
});

function detailsTag(opts) {
  return opts.openDetails ? '<details open' : '<details';
}

function cap(s, max) {
  if (!s) return { s: '', truncated: false };
  if (s.length > max) return { s: s.slice(0, max), truncated: true };
  return { s, truncated: false };
}

function expandBtn(truncated) {
  return truncated ? '<button type="button" class="evt-expand">Show full</button>' : '';
}

function truncMarker(truncated) {
  return truncated ? '<p class="evt__truncated">[... truncated]</p>' : '';
}

// ---------------------------------------------------------------------------
// Usage aggregation
// ---------------------------------------------------------------------------
export function emptyUsage() {
  return { turns: 0, input: 0, output: 0, cacheCreate: 0, cacheRead: 0, model: null };
}

export function totalIn(u) {
  return (u.input || 0) + (u.cacheCreate || 0) + (u.cacheRead || 0);
}

export function addUsage(target, src) {
  target.turns += src.turns;
  target.input += src.input;
  target.output += src.output;
  target.cacheCreate += src.cacheCreate;
  target.cacheRead += src.cacheRead;
  if (!target.model && src.model) target.model = src.model;
  return target;
}

// In-memory cache of per-session usage totals. Keyed by absolute path +
// mtime, so it auto-invalidates when Claude appends turns to an active
// session. Memory footprint is trivial (one small object per session).
const _usageCache = new Map();

// Stream a JSONL session, sum the usage object on every assistant event.
// Discards everything else, keeping memory O(1) regardless of file size.
export async function getSessionUsage(absPath, mtime) {
  const key = `${absPath}:${mtime}`;
  if (_usageCache.has(key)) return _usageCache.get(key);
  const usage = emptyUsage();
  try {
    const stream = createReadStream(absPath, { encoding: 'utf8' });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line || !line.trim()) continue;
      let evt;
      try { evt = JSON.parse(line); } catch { continue; }
      if (!evt || evt.type !== 'assistant') continue;
      const u = evt.message && evt.message.usage;
      if (!u) continue;
      usage.turns++;
      usage.input += u.input_tokens || 0;
      usage.output += u.output_tokens || 0;
      usage.cacheCreate += u.cache_creation_input_tokens || 0;
      usage.cacheRead += u.cache_read_input_tokens || 0;
      if (!usage.model && evt.message.model) usage.model = evt.message.model;
    }
  } catch {}
  _usageCache.set(key, usage);
  return usage;
}

// Fan out getSessionUsage across many sessions in parallel. Mutates each
// session in place to add `.usage`. Idempotent thanks to the cache.
export async function attachSessionUsage(sessions) {
  await Promise.all(sessions.map(async (s) => {
    if (s.usage) return;
    const abs = join(HOME, 'projects', s.projectSlug, s.id + '.jsonl');
    s.usage = await getSessionUsage(abs, s.mtime);
  }));
}

// Sum usage across every session belonging to a given project slug.
export function aggregateProjectUsage(projectSlug, sessions) {
  const acc = emptyUsage();
  for (const s of sessions) {
    if (s.projectSlug === projectSlug && s.usage) addUsage(acc, s.usage);
  }
  return acc;
}

// ---------------------------------------------------------------------------
// Per-event rendering
// ---------------------------------------------------------------------------
function renderUserEvent(evt, meta, opts) {
  const { caps } = opts;
  const content = evt.message && evt.message.content;
  let textParts = [];
  let toolResults = [];
  if (typeof content === 'string') {
    const stripped = stripCommandWrappers(content);
    if (stripped) textParts.push(stripped);
  } else if (Array.isArray(content)) {
    for (const c of content) {
      if (c.type === 'text') {
        const stripped = stripCommandWrappers(c.text || '');
        if (stripped) textParts.push(stripped);
      } else if (c.type === 'tool_result') {
        toolResults.push(c);
      }
    }
  }
  let html = '';
  if (textParts.length > 0) {
    const { s, truncated } = cap(textParts.join('\n\n'), caps.text);
    html += `<div class="evt evt--user">${meta}<div class="evt__role">user</div><div class="evt__body">${marked.parse(s)}${truncMarker(truncated)}</div>${expandBtn(truncated)}</div>`;
  }
  for (const tr of toolResults) {
    const summary = typeof tr.content === 'string' ? tr.content : JSON.stringify(tr.content);
    const { s, truncated } = cap(summary, caps.toolResult);
    html += `${detailsTag(opts)} class="evt evt--tool-result"><summary><span class="evt__role">tool result</span> <span class="evt__tag">${escapeHtml(tr.tool_use_id || '').slice(-8)}</span></summary><pre>${escapeHtml(s)}${truncated ? '\n\n[... truncated]' : ''}</pre>${expandBtn(truncated)}</details>`;
  }
  return html;
}

function renderAssistantEvent(evt, meta, opts) {
  const { caps } = opts;
  const content = evt.message && evt.message.content;
  if (!Array.isArray(content)) return '';
  let html = '';
  for (const c of content) {
    if (c.type === 'text') {
      const { s, truncated } = cap(c.text || '', caps.text);
      html += `<div class="evt evt--assistant">${meta}<div class="evt__role">assistant</div><div class="evt__body">${marked.parse(s)}${truncMarker(truncated)}</div>${expandBtn(truncated)}</div>`;
    } else if (c.type === 'thinking') {
      const { s, truncated } = cap(c.thinking || c.text || '', caps.thinking);
      html += `${detailsTag(opts)} class="evt evt--thinking"><summary><span class="evt__role">thinking</span></summary><div class="evt__body">${marked.parse(s)}${truncMarker(truncated)}</div>${expandBtn(truncated)}</details>`;
    } else if (c.type === 'tool_use') {
      const inp = JSON.stringify(c.input || {}, null, 2);
      const { s, truncated } = cap(inp, caps.toolInput);
      html += `${detailsTag(opts)} class="evt evt--tool-use"><summary><span class="evt__role">tool</span> <code>${escapeHtml(c.name || '?')}</code></summary><pre>${escapeHtml(s)}${truncated ? '\n[... truncated]' : ''}</pre>${expandBtn(truncated)}</details>`;
    }
  }
  return html;
}

function renderSystemEvent(evt, meta, opts) {
  const { caps } = opts;
  const stripped = stripCommandWrappers(evt.content || '');
  if (!stripped) return '';
  const { s, truncated } = cap(stripped, caps.text);
  return `<div class="evt evt--system">${meta}<pre>${escapeHtml(s)}${truncated ? '\n\n[... truncated]' : ''}</pre>${expandBtn(truncated)}</div>`;
}

function renderEventBlocks(evt, opts) {
  if (!RENDERED_TYPES.has(evt.type)) return '';
  const ts = evt.timestamp ? new Date(evt.timestamp).toLocaleString() : '';
  const meta = `<div class="evt__meta">${escapeHtml(ts)}</div>`;
  if (evt.type === 'system') return renderSystemEvent(evt, meta, opts);
  if (evt.type === 'user') return renderUserEvent(evt, meta, opts);
  if (evt.type === 'assistant') return renderAssistantEvent(evt, meta, opts);
  return '';
}

function wrapEvent(evt, blocksHTML) {
  if (!blocksHTML) return '';
  if (!evt.uuid) return blocksHTML;
  return `<div class="evt-group" data-uuid="${escapeHtml(evt.uuid)}">${blocksHTML}</div>`;
}

function renderSessionEvent(evt, opts = DEFAULT_OPTS) {
  return wrapEvent(evt, renderEventBlocks(evt, opts));
}

// Re-render a single event by uuid with no truncation. Streams the JSONL,
// stops at the first match. Returns the .evt-group HTML (or '' if not found).
export async function renderSingleEventByUuid(absPath, uuid) {
  if (!uuid) return '';
  const stream = createReadStream(absPath, { encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      if (!line || !line.trim()) continue;
      let evt;
      try { evt = JSON.parse(line); } catch { continue; }
      if (!evt || evt.uuid !== uuid) continue;
      const html = wrapEvent(evt, renderEventBlocks(evt, FULL_OPTS));
      rl.close();
      stream.destroy();
      return html;
    }
  } catch {}
  return '';
}

// ---------------------------------------------------------------------------
// Whole-session render
// ---------------------------------------------------------------------------
//
// Streams the JSONL line-by-line. Keeps a sliding window of the last `limit`
// renderable events so memory stays O(limit), not O(file size). Multi-megabyte
// sessions with image attachments or huge tool outputs no longer drag the
// whole file into memory.
//
// Token usage is summed across every assistant event (not just the ones in
// the buffer) so the totals are accurate even when the transcript is
// truncated.
export async function renderSession(absPath, { limit = 500 } = {}) {
  const cap = limit === 'all' ? MAX_BUFFER_HARD_CAP : Math.min(Number(limit) || 500, MAX_BUFFER_HARD_CAP);
  const stream = createReadStream(absPath, { encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  const buffer = [];
  let total = 0;
  const usage = emptyUsage();

  for await (const line of rl) {
    if (!line || !line.trim()) continue;
    let evt;
    try { evt = JSON.parse(line); } catch { continue; }
    if (!evt) continue;

    if (evt.type === 'assistant' && evt.message && evt.message.usage) {
      const u = evt.message.usage;
      usage.turns++;
      usage.input += u.input_tokens || 0;
      usage.output += u.output_tokens || 0;
      usage.cacheCreate += u.cache_creation_input_tokens || 0;
      usage.cacheRead += u.cache_read_input_tokens || 0;
      if (!usage.model && evt.message.model) usage.model = evt.message.model;
    }

    if (!RENDERED_TYPES.has(evt.type)) continue;
    total++;
    buffer.push(evt);
    if (buffer.length > cap) buffer.shift();
  }

  const omitted = total - buffer.length;
  let html = '';
  if (omitted > 0) {
    html += `<div class="session-truncate">${
      limit === 'all'
        ? `Showing the most recent ${buffer.length} of ${total} events (capped at ${MAX_BUFFER_HARD_CAP}).`
        : `Showing the most recent ${buffer.length} of ${total} events. <a href="?limit=all">Show more</a>.`
    }</div>`;
  }
  for (const e of buffer) html += renderSessionEvent(e);
  return { html, total, shown: buffer.length, usage };
}
