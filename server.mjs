// claude-explorer: a local HTTP viewer for ~/.claude/.
// Auto-discovers what's there; renders only what exists.
// Read-only, localhost-only, zero-config out of the box.

import { createServer } from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync, createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { join, posix, basename, extname } from 'node:path';
import { homedir } from 'node:os';
import { marked } from 'marked';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const HOME = process.env.CLAUDE_HOME || join(homedir(), '.claude');
const PORT = process.env.PORT ? Number(process.env.PORT) : 4567;

// Defaults the user can extend via claude-explorer.config.json at $CLAUDE_HOME.
// This tool is single-user, runs on localhost. The defaults below are about
// hiding credentials and noise (caches, telemetry, internals), not about
// shielding personal files. The user wrote those — they're allowed to read them.
const DEFAULT_HIDE = [
  '.credentials*',
  '*.bak',
  '*.bak.*',
  'cache/',
  'debug/',
  'telemetry/',
  'shell-snapshots/',
  'paste-cache/',
  'session-env/',
  'downloads/',
  'file-history/',
  'backups/',
  'history.jsonl',
  'mcp-needs-auth-cache.json',
  'stats-cache.json',
];

let CONFIG = { hide: [], label: {}, theme: 'dark' };
try {
  const raw = await readFile(join(HOME, 'claude-explorer.config.json'), 'utf8');
  CONFIG = { ...CONFIG, ...JSON.parse(raw) };
} catch { /* zero-config default */ }

const HIDE_PATTERNS = [...DEFAULT_HIDE, ...(CONFIG.hide || [])];

function isHidden(relPath) {
  // relPath is relative to HOME, may be a file or dir (with trailing /).
  const tries = [relPath, relPath + '/'];
  for (const p of tries) {
    for (const pat of HIDE_PATTERNS) {
      if (matchGlob(p, pat)) return true;
    }
  }
  return false;
}

function matchGlob(s, pat) {
  if (pat.endsWith('/')) {
    return s === pat || s.startsWith(pat);
  }
  if (pat.includes('*')) {
    const re = new RegExp('^' + pat.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
    return re.test(s);
  }
  return s === pat || s.startsWith(pat + '/');
}

// ---------------------------------------------------------------------------
// Discovery layer
// ---------------------------------------------------------------------------
//
// discover() walks $CLAUDE_HOME and returns a typed nav object.
// Each section is empty (length 0) if there's nothing to show — the
// topbar uses that to decide which tabs to render.

async function listMd(dir) {
  try {
    const files = await readdir(dir);
    return files.filter(f => f.endsWith('.md')).map(f => f.replace(/\.md$/, '')).sort();
  } catch { return []; }
}

async function pageBlurb(absPath, max = 140) {
  try {
    const md = await readFile(absPath, 'utf8');
    const lines = md.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim();
      if (!t) continue;
      if (t.startsWith('#') || t.startsWith('---') || t.startsWith('**') || t.startsWith('>') || t.startsWith('|') || t.startsWith('-') || t.startsWith('*')) continue;
      let blurb = t;
      for (let j = i + 1; j < lines.length && lines[j].trim(); j++) blurb += ' ' + lines[j].trim();
      blurb = blurb.replace(/`([^`]+)`/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
      return blurb.length > max ? blurb.slice(0, max - 3) + '...' : blurb;
    }
  } catch {}
  return null;
}

// Decode Claude Code's project path encoding: a leading "-" is the
// filesystem root "/"; remaining "-" characters are path separators. So
// a slug like "-home-alice-code-myapp" decodes to "/home/alice/code/myapp".
function decodeProjectSlug(slug) {
  if (!slug.startsWith('-')) return slug;
  return '/' + slug.slice(1).replace(/-/g, '/');
}

async function discoverInstructions() {
  // Root *.md files. Builds @import graph from CLAUDE.md if present.
  const out = { files: [], graph: null };
  try {
    const entries = await readdir(HOME);
    const mdFiles = entries.filter(f => f.endsWith('.md')).filter(f => !isHidden(f));
    for (const f of mdFiles) {
      const abs = join(HOME, f);
      const blurb = await pageBlurb(abs, 120);
      out.files.push({ slug: f.replace(/\.md$/, ''), file: f, blurb });
    }
    out.files.sort((a, b) => {
      // CLAUDE.md first (it's the entrypoint), then alphabetical.
      if (a.file === 'CLAUDE.md') return -1;
      if (b.file === 'CLAUDE.md') return 1;
      return a.file.localeCompare(b.file);
    });

    // Build @import graph starting from CLAUDE.md.
    if (mdFiles.includes('CLAUDE.md')) {
      out.graph = await buildImportGraph('CLAUDE.md', new Set());
    }
  } catch {}
  return out;
}

async function buildImportGraph(file, seen) {
  if (seen.has(file)) return { file, imports: [], cycle: true };
  seen.add(file);
  const node = { file, imports: [] };
  try {
    const content = await readFile(join(HOME, file), 'utf8');
    const lines = content.split('\n').slice(0, 50); // imports near top
    for (const line of lines) {
      const m = line.trim().match(/^@(\S+\.md)$/);
      if (m && !isHidden(m[1])) {
        node.imports.push(await buildImportGraph(m[1], seen));
      }
    }
  } catch {}
  return node;
}

async function discoverProjects() {
  const dir = join(HOME, 'projects');
  const out = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (isHidden(`projects/${e.name}`)) continue;
      const projDir = join(dir, e.name);
      let sessionCount = 0;
      let memoryCount = 0;
      let lastTouched = 0;
      try {
        const inside = await readdir(projDir, { withFileTypes: true });
        for (const x of inside) {
          if (x.isFile() && x.name.endsWith('.jsonl')) {
            sessionCount++;
            try {
              const s = await stat(join(projDir, x.name));
              if (s.mtimeMs > lastTouched) lastTouched = s.mtimeMs;
            } catch {}
          } else if (x.isDirectory() && x.name === 'memory') {
            try {
              const mem = await readdir(join(projDir, 'memory'));
              memoryCount = mem.filter(f => f.endsWith('.md')).length;
            } catch {}
          }
        }
      } catch {}
      out.push({
        slug: e.name,
        decodedPath: decodeProjectSlug(e.name),
        sessionCount,
        memoryCount,
        lastTouched,
      });
    }
  } catch {}
  // Sort by lastTouched desc, then by name.
  out.sort((a, b) => b.lastTouched - a.lastTouched || a.decodedPath.localeCompare(b.decodedPath));
  return out;
}

async function discoverPlans() {
  const dir = join(HOME, 'plans');
  const out = [];
  try {
    const files = await readdir(dir);
    for (const f of files) {
      if (!f.endsWith('.md')) continue;
      if (isHidden(`plans/${f}`)) continue;
      let mtime = 0, blurb = null;
      try { mtime = (await stat(join(dir, f))).mtimeMs; } catch {}
      blurb = await pageBlurb(join(dir, f), 140);
      out.push({ slug: f.replace(/\.md$/, ''), file: f, mtime, blurb });
    }
  } catch {}
  out.sort((a, b) => b.mtime - a.mtime);
  return out;
}

async function discoverPlugins() {
  // From plugins/installed_plugins.json (Claude Code's own manifest).
  const out = [];
  try {
    const raw = await readFile(join(HOME, 'plugins', 'installed_plugins.json'), 'utf8');
    const data = JSON.parse(raw);
    if (data && data.plugins) {
      for (const [name, instances] of Object.entries(data.plugins)) {
        const inst = Array.isArray(instances) ? instances[0] : instances;
        out.push({
          name,
          scope: inst?.scope || 'user',
          version: inst?.version || 'unknown',
          installPath: inst?.installPath || '',
        });
      }
    }
  } catch {}
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

async function discoverSkills() {
  const dir = join(HOME, 'skills');
  const out = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (isHidden(`skills/${e.name}`)) continue;
      // Direct: skills/<name>/SKILL.md
      try {
        const md = await readFile(join(dir, e.name, 'SKILL.md'), 'utf8');
        out.push({ slug: e.name, description: extractSkillDescription(md) });
        continue;
      } catch {}
      // Nested: skills/<group>/<name>/SKILL.md
      try {
        const sub = await readdir(join(dir, e.name), { withFileTypes: true });
        for (const s of sub) {
          if (!s.isDirectory()) continue;
          try {
            const md = await readFile(join(dir, e.name, s.name, 'SKILL.md'), 'utf8');
            out.push({ slug: `${e.name}/${s.name}`, description: extractSkillDescription(md) });
          } catch {}
        }
      } catch {}
    }
  } catch {}
  out.sort((a, b) => a.slug.localeCompare(b.slug));
  return out;
}

function extractSkillDescription(md) {
  const m = md.match(/^description:\s*(.+)$/m);
  if (!m) return null;
  let d = m[1].trim();
  if ((d.startsWith('"') && d.endsWith('"')) || (d.startsWith("'") && d.endsWith("'"))) {
    d = d.slice(1, -1);
  }
  return d.length > 160 ? d.slice(0, 157) + '...' : d;
}

async function discoverWiki() {
  const wikiDir = join(HOME, 'wiki');
  if (!existsSync(wikiDir)) return null;
  // Scan wiki/<section>/*.md for arbitrary section directories.
  // index.md and log.md at root are special.
  const out = { sections: {}, hasIndex: false, hasLog: false };
  try {
    const entries = await readdir(wikiDir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isFile()) {
        if (e.name === 'index.md') out.hasIndex = true;
        else if (e.name === 'log.md') out.hasLog = true;
      } else if (e.isDirectory()) {
        const pages = await listMd(join(wikiDir, e.name));
        if (pages.length > 0) out.sections[e.name] = pages;
      }
    }
  } catch {}
  return out;
}

// Read just enough of a JSONL session to find its title event. Both
// "ai-title" (aiTitle) and "custom-title" (customTitle) appear early in
// transcripts, so a 20KB head is plenty.
async function readSessionTitle(absPath) {
  return new Promise((resolve) => {
    const stream = createReadStream(absPath, { encoding: 'utf8', start: 0, end: 20000 });
    let buf = '';
    stream.on('data', chunk => { buf += chunk; });
    stream.on('end', () => {
      let custom = null, ai = null;
      for (const line of buf.split('\n')) {
        if (!line.trim()) continue;
        try {
          const evt = JSON.parse(line);
          if (evt.type === 'ai-title' && typeof evt.aiTitle === 'string') ai = evt.aiTitle;
          else if (evt.type === 'custom-title' && typeof evt.customTitle === 'string') custom = evt.customTitle;
        } catch {}
      }
      resolve(ai || custom || null);
    });
    stream.on('error', () => resolve(null));
  });
}

async function discoverSessions() {
  const projectsDir = join(HOME, 'projects');
  const out = [];
  try {
    const projDirs = await readdir(projectsDir, { withFileTypes: true });
    for (const p of projDirs) {
      if (!p.isDirectory()) continue;
      if (isHidden(`projects/${p.name}`)) continue;
      const projDir = join(projectsDir, p.name);
      let entries;
      try { entries = await readdir(projDir, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        if (!e.isFile() || !e.name.endsWith('.jsonl')) continue;
        const abs = join(projDir, e.name);
        try {
          const s = await stat(abs);
          out.push({
            id: e.name.replace(/\.jsonl$/, ''),
            projectSlug: p.name,
            decodedPath: decodeProjectSlug(p.name),
            size: s.size,
            mtime: s.mtimeMs,
            title: null, // populated below for the most-recent slice
          });
        } catch {}
      }
    }
  } catch {}
  out.sort((a, b) => b.mtime - a.mtime);
  // Read titles only for the most recent 60 sessions to keep discovery cheap.
  const TITLE_FETCH = 60;
  await Promise.all(out.slice(0, TITLE_FETCH).map(async (s) => {
    s.title = await readSessionTitle(join(projectsDir, s.projectSlug, s.id + '.jsonl'));
  }));
  return out;
}

async function discover() {
  const [instructions, projects, sessions, plans, plugins, skills, wiki] = await Promise.all([
    discoverInstructions(),
    discoverProjects(),
    discoverSessions(),
    discoverPlans(),
    discoverPlugins(),
    discoverSkills(),
    discoverWiki(),
  ]);
  return { instructions, projects, sessions, plans, plugins, skills, wiki };
}

// ---------------------------------------------------------------------------
// Tab availability
// ---------------------------------------------------------------------------
function availableTabs(nav) {
  const tabs = [];
  if (nav.instructions.files.length > 0) tabs.push({ slug: 'instructions', label: 'Instructions' });
  if (nav.projects.length > 0) tabs.push({ slug: 'projects', label: 'Projects' });
  if (nav.sessions && nav.sessions.length > 0) tabs.push({ slug: 'sessions', label: 'Sessions' });
  if (nav.skills.length > 0) tabs.push({ slug: 'skills', label: 'Skills' });
  if (nav.plans.length > 0) tabs.push({ slug: 'plans', label: 'Plans' });
  if (nav.plugins.length > 0) tabs.push({ slug: 'plugins', label: 'Plugins' });
  if (nav.wiki && Object.keys(nav.wiki.sections).length > 0) tabs.push({ slug: 'wiki', label: 'Wiki' });
  return tabs;
}

// ---------------------------------------------------------------------------
// Markdown rendering with link rewriting
// ---------------------------------------------------------------------------
function fileToUrl(absPath) {
  // Map absolute filesystem path -> URL, so wikilinks resolve.
  // Root .md files
  if (absPath.startsWith(HOME + '/') && !absPath.slice(HOME.length + 1).includes('/')) {
    if (absPath.endsWith('.md')) {
      const slug = basename(absPath, '.md');
      return `/instructions/${slug}`;
    }
  }
  // Wiki
  const wikiDir = join(HOME, 'wiki');
  if (absPath.startsWith(wikiDir + '/')) {
    const rel = absPath.slice(wikiDir.length + 1);
    if (rel === 'index.md') return '/wiki';
    if (rel === 'log.md') return '/wiki/log';
    if (rel.endsWith('.md')) return '/wiki/' + rel.replace(/\.md$/, '');
  }
  // Plans
  if (absPath.startsWith(join(HOME, 'plans') + '/') && absPath.endsWith('.md')) {
    return '/plans/' + basename(absPath, '.md');
  }
  // Skills
  if (absPath.startsWith(join(HOME, 'skills') + '/') && absPath.endsWith('/SKILL.md')) {
    const slug = absPath.slice(join(HOME, 'skills').length + 1, -'/SKILL.md'.length);
    return `/skills/${slug}`;
  }
  // Project memory
  const projectsDir = join(HOME, 'projects');
  if (absPath.startsWith(projectsDir + '/')) {
    const rel = absPath.slice(projectsDir.length + 1);
    const parts = rel.split('/');
    if (parts.length >= 3 && parts[1] === 'memory' && rel.endsWith('.md')) {
      const projectSlug = parts[0];
      const memFile = parts.slice(2).join('/').replace(/\.md$/, '');
      return `/projects/${projectSlug}/memory/${memFile}`;
    }
  }
  return null;
}

function rewriteLinks(html, sourceFile) {
  const sourceDir = sourceFile.substring(0, sourceFile.lastIndexOf('/'));
  return html.replace(/href="([^"]+)"/g, (match, href) => {
    if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#') || href.startsWith('/')) {
      return match;
    }
    if (!href.endsWith('.md') && !href.includes('.md#')) return match;
    let [path, hash = ''] = href.split('#');
    if (hash) hash = '#' + hash;
    const abs = posix.normalize(join(sourceDir, path));
    const url = fileToUrl(abs);
    if (!url) return match;
    return `href="${url}${hash}"`;
  });
}

function renderMarkdown(md, sourceFile) {
  return rewriteLinks(marked.parse(md), sourceFile);
}

function pageTitle(md, fallback) {
  const m = md.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : fallback;
}

// ---------------------------------------------------------------------------
// Session JSONL renderer
// ---------------------------------------------------------------------------
const RENDERED_TYPES = new Set(['user', 'assistant', 'system']);

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function stripCommandWrappers(text) {
  // Filter Claude Code's CLI plumbing from user messages.
  return text
    .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g, '')
    .replace(/<command-name>[\s\S]*?<\/command-name>/g, '')
    .replace(/<command-message>[\s\S]*?<\/command-message>/g, '')
    .replace(/<command-args>[\s\S]*?<\/command-args>/g, '')
    .replace(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/g, (_, c) => c.trim() ? `\n[stdout] ${c.trim()}\n` : '')
    .trim();
}

// Caps to prevent rendering pathological events (huge tool inputs, multi-MB
// pasted file contents) from blowing up the page or the heap.
const MAX_TEXT_BLOCK = 20000;       // marked.parse() input cap, per text block
const MAX_THINKING = 4000;
const MAX_TOOL_INPUT = 1500;
const MAX_TOOL_RESULT = 1200;
const MAX_BUFFER_HARD_CAP = 2000;   // even with ?limit=all, never buffer more

function capText(s, cap) {
  if (!s) return '';
  return s.length > cap ? s.slice(0, cap) + '\n\n[... truncated, full text in raw JSONL]' : s;
}

function renderSessionEvent(evt) {
  const t = evt.type;
  if (!RENDERED_TYPES.has(t)) return '';
  const ts = evt.timestamp ? new Date(evt.timestamp).toLocaleString() : '';
  const meta = `<div class="evt__meta">${escapeHtml(ts)}</div>`;

  if (t === 'system') {
    const stripped = stripCommandWrappers(evt.content || '');
    if (!stripped) return '';
    return `<div class="evt evt--system">${meta}<pre>${escapeHtml(capText(stripped, MAX_TEXT_BLOCK))}</pre></div>`;
  }

  const msg = evt.message || {};
  const content = msg.content;

  if (t === 'user') {
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
      const combined = capText(textParts.join('\n\n'), MAX_TEXT_BLOCK);
      html += `<div class="evt evt--user">${meta}<div class="evt__role">user</div><div class="evt__body">${marked.parse(combined)}</div></div>`;
    }
    for (const tr of toolResults) {
      const summary = typeof tr.content === 'string' ? tr.content : JSON.stringify(tr.content);
      const trimmed = summary.length > MAX_TOOL_RESULT ? summary.slice(0, MAX_TOOL_RESULT) + '\n\n[truncated]' : summary;
      html += `<details class="evt evt--tool-result"><summary><span class="evt__role">tool result</span> <span class="evt__tag">${escapeHtml(tr.tool_use_id || '').slice(-8)}</span></summary><pre>${escapeHtml(trimmed)}</pre></details>`;
    }
    return html;
  }

  if (t === 'assistant') {
    if (!Array.isArray(content)) return '';
    let html = '';
    for (const c of content) {
      if (c.type === 'text') {
        const text = capText(c.text || '', MAX_TEXT_BLOCK);
        html += `<div class="evt evt--assistant">${meta}<div class="evt__role">assistant</div><div class="evt__body">${marked.parse(text)}</div></div>`;
      } else if (c.type === 'thinking') {
        const text = capText(c.thinking || c.text || '', MAX_THINKING);
        html += `<details class="evt evt--thinking"><summary><span class="evt__role">thinking</span></summary><div class="evt__body">${marked.parse(text)}</div></details>`;
      } else if (c.type === 'tool_use') {
        const inp = JSON.stringify(c.input || {}, null, 2);
        const inpTrimmed = inp.length > MAX_TOOL_INPUT ? inp.slice(0, MAX_TOOL_INPUT) + '\n[truncated]' : inp;
        html += `<details class="evt evt--tool-use"><summary><span class="evt__role">tool</span> <code>${escapeHtml(c.name || '?')}</code></summary><pre>${escapeHtml(inpTrimmed)}</pre></details>`;
      }
    }
    return html;
  }
  return '';
}

// Streams a JSONL session line-by-line. Keeps a sliding window of the last
// `limit` renderable events so memory stays O(limit), not O(file size).
// Multi-megabyte sessions with image attachments or huge tool outputs no
// longer drag the whole file into memory.
async function renderSession(absPath, { limit = 500 } = {}) {
  const cap = limit === 'all' ? MAX_BUFFER_HARD_CAP : Math.min(Number(limit) || 500, MAX_BUFFER_HARD_CAP);
  const stream = createReadStream(absPath, { encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  const buffer = [];   // sliding window of renderable events
  let total = 0;       // count of renderable events seen, for the truncate banner
  const usage = { turns: 0, input: 0, output: 0, cacheCreate: 0, cacheRead: 0, model: null };

  for await (const line of rl) {
    if (!line || !line.trim()) continue;
    let evt;
    try { evt = JSON.parse(line); } catch { continue; }
    if (!evt) continue;

    // Aggregate token usage from every assistant event, even ones that get
    // shifted out of the sliding render buffer. This is the only pass over
    // the file, so we have to count here.
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
    const banner = limit === 'all'
      ? `Showing the most recent ${buffer.length} of ${total} events (capped at ${MAX_BUFFER_HARD_CAP}).`
      : `Showing the most recent ${buffer.length} of ${total} events. <a href="?limit=all">Show more</a>.`;
    html += `<div class="session-truncate">${banner}</div>`;
  }
  for (const e of buffer) html += renderSessionEvent(e);
  return { html, total, shown: buffer.length, usage };
}

// Format a token count as either a raw number with thousands separators
// (under 10k) or with a k/M suffix (above).
function fmtTokens(n) {
  if (!n) return '0';
  if (n < 10_000) return n.toLocaleString('en-US');
  if (n < 1_000_000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  if (n < 1_000_000_000) return (n / 1_000_000).toFixed(2).replace(/\.?0+$/, '') + 'M';
  return (n / 1_000_000_000).toFixed(2).replace(/\.?0+$/, '') + 'B';
}

// In-memory cache of usage totals per JSONL session, keyed by path+mtime so
// it auto-invalidates when Claude appends turns to an active session.
const _usageCache = new Map();

function emptyUsage() {
  return { turns: 0, input: 0, output: 0, cacheCreate: 0, cacheRead: 0, model: null };
}

function totalIn(u) {
  return (u.input || 0) + (u.cacheCreate || 0) + (u.cacheRead || 0);
}

function addUsage(target, src) {
  target.turns += src.turns;
  target.input += src.input;
  target.output += src.output;
  target.cacheCreate += src.cacheCreate;
  target.cacheRead += src.cacheRead;
  if (!target.model && src.model) target.model = src.model;
  return target;
}

// Stream a JSONL session, sum the usage object on every assistant event.
// Discards everything else, keeping memory O(1) regardless of file size.
async function getSessionUsage(absPath, mtime) {
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
async function attachSessionUsage(sessions) {
  await Promise.all(sessions.map(async (s) => {
    if (s.usage) return;
    const abs = join(HOME, 'projects', s.projectSlug, s.id + '.jsonl');
    s.usage = await getSessionUsage(abs, s.mtime);
  }));
}

// Sum usage across every session belonging to a given project slug.
function aggregateProjectUsage(projectSlug, sessions) {
  const acc = emptyUsage();
  for (const s of sessions) {
    if (s.projectSlug === projectSlug && s.usage) addUsage(acc, s.usage);
  }
  return acc;
}

function renderUsageCard(usage) {
  if (!usage || !usage.turns) return '';
  const totalIn = usage.input + usage.cacheCreate + usage.cacheRead;
  return `<div class="usage-card">
  <div class="usage-card__head">Tokens${usage.model ? ` <span class="usage-card__model">${escapeHtml(usage.model)}</span>` : ''}</div>
  <div class="usage-card__grid">
    <div><div class="usage-card__label">turns</div><div class="usage-card__num">${fmtTokens(usage.turns)}</div></div>
    <div><div class="usage-card__label">input</div><div class="usage-card__num">${fmtTokens(usage.input)}</div></div>
    <div><div class="usage-card__label">output</div><div class="usage-card__num">${fmtTokens(usage.output)}</div></div>
    <div><div class="usage-card__label">cache write</div><div class="usage-card__num">${fmtTokens(usage.cacheCreate)}</div></div>
    <div><div class="usage-card__label">cache read</div><div class="usage-card__num">${fmtTokens(usage.cacheRead)}</div></div>
    <div><div class="usage-card__label">total in</div><div class="usage-card__num">${fmtTokens(totalIn)}</div></div>
  </div>
</div>`;
}

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------
const CSS = `
:root {
  --bg: #0d0d0c;
  --bg-soft: #131312;
  --bg-sidebar: #0a0a09;
  --bg-raised: #1a1a18;
  --border: #222220;
  --border-soft: #1a1a18;
  --text: #e6e5dd;
  --text-muted: #8a8a82;
  --text-dim: #5a5a54;
  --heading: #ffffff;
  --link: #b8a8ff;
  --link-hover: #d4c8ff;
  --accent: #b8a8ff;
  --code-bg: #1a1a18;
  --selection: #2a2440;
  --user-tint: #1a1f2a;
  --asst-tint: #1c1a22;
  --tool-tint: #14110d;
}
* { box-sizing: border-box; }
::selection { background: var(--selection); }
html, body { margin: 0; padding: 0; }
body {
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, "Inter", "SF Pro Text", system-ui, sans-serif;
  font-size: 15px;
  line-height: 1.7;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
a { color: var(--link); text-decoration: none; }
a:hover { color: var(--link-hover); }

.topbar {
  position: sticky; top: 0; z-index: 10;
  background: rgba(13, 13, 12, 0.85);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--border);
  padding: 0 2rem;
  height: 56px;
  display: flex;
  align-items: center;
  gap: 2rem;
}
.topbar .brand {
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 0.8rem;
  color: var(--text-muted);
  letter-spacing: 0.02em;
}
.topbar .brand a { color: var(--text-muted); }
.topbar .brand a:hover { color: var(--text); }
.topbar nav { display: flex; gap: 1.5rem; flex: 1; }
.topbar nav a {
  color: var(--text-muted);
  font-size: 0.875rem;
  font-weight: 500;
  padding: 0.25rem 0;
  border-bottom: 1.5px solid transparent;
  transition: color 120ms, border-color 120ms;
}
.topbar nav a:hover { color: var(--text); }
.topbar nav a.active { color: var(--heading); border-bottom-color: var(--accent); }
.topbar .privacy {
  font-size: 0.75rem;
  color: var(--text-muted);
  padding: 0.2rem 0.6rem;
  border: 1px solid var(--border);
  border-radius: 999px;
}

.layout { display: grid; grid-template-columns: 240px 1fr; min-height: calc(100vh - 56px); }
.layout--full { grid-template-columns: 1fr; }
@media (max-width: 800px) {
  .layout { grid-template-columns: 1fr; }
  .sidebar { display: none; }
}

.sidebar {
  background: var(--bg-sidebar);
  border-right: 1px solid var(--border);
  padding: 2rem 1rem 4rem 1.5rem;
  position: sticky;
  top: 56px;
  align-self: start;
  max-height: calc(100vh - 56px);
  overflow-y: auto;
  font-size: 0.875rem;
}
.sidebar h3 {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--text-dim);
  font-weight: 600;
  margin: 1.25rem 0 0.5rem 0.5rem;
}
.sidebar h3:first-child { margin-top: 0; }
.sidebar ul { list-style: none; padding: 0; margin: 0; }
.sidebar li a {
  display: block;
  padding: 0.3rem 0.5rem;
  border-radius: 5px;
  color: var(--text-muted);
  margin-left: -0.25rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sidebar li a:hover { background: var(--bg-raised); color: var(--text); }
.sidebar li a.active { background: var(--bg-raised); color: var(--heading); }

main { padding: 3.5rem 4rem; max-width: 760px; width: 100%; }
main.wide { max-width: 1320px; padding: 3.5rem 5rem; }
@media (max-width: 1100px) { main, main.wide { padding: 2.5rem 2rem; } }

main h1, main h2, main h3, main h4 {
  color: var(--heading);
  font-weight: 600;
  letter-spacing: -0.01em;
  line-height: 1.3;
}
main h1 { font-size: 1.875rem; margin: 0 0 1.25rem; letter-spacing: -0.02em; }
main h2 { font-size: 1.25rem; margin-top: 2.5rem; }
main h3 { font-size: 1.0625rem; margin-top: 2rem; }
main h4 { font-size: 0.95rem; margin-top: 1.5rem; }
main p { margin: 0 0 1rem; }
main ul, main ol { padding-left: 1.5rem; margin: 0 0 1rem; }
main li { margin-bottom: 0.25rem; }
main code {
  background: var(--code-bg);
  border: 1px solid var(--border-soft);
  padding: 0.1rem 0.4rem;
  border-radius: 4px;
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 0.85em;
}
main pre {
  background: var(--code-bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 1rem 1.25rem;
  overflow-x: auto;
  font-size: 0.85em;
  line-height: 1.55;
}
main pre code { background: none; border: 0; padding: 0; }
main blockquote {
  border-left: 2px solid var(--accent);
  padding: 0.25rem 0 0.25rem 1.25rem;
  margin: 1rem 0;
  color: var(--text-muted);
}
main hr { border: 0; border-top: 1px solid var(--border); margin: 2.5rem 0; }
main table { border-collapse: collapse; margin: 1.25rem 0; font-size: 0.9rem; }
main th, main td {
  border: 1px solid var(--border);
  padding: 0.5rem 0.85rem;
  text-align: left;
}
main th { background: var(--bg-soft); color: var(--heading); font-weight: 600; }

.crumb {
  font-size: 0.8rem;
  color: var(--text-dim);
  margin-bottom: 1rem;
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
}
.crumb a { color: var(--text-muted); }

.hero { margin: 0.5rem 0 3rem; max-width: 720px; }
.hero h1 { font-size: 2.5rem; letter-spacing: -0.025em; margin: 0 0 0.75rem; font-family: ui-monospace, "SF Mono", Menlo, monospace; font-weight: 600; }
.hero p { color: var(--text-muted); font-size: 1.0625rem; line-height: 1.6; margin: 0; }

section.row { margin-bottom: 3rem; }
.row__head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 1rem; }
.row__head h2 { margin: 0; font-size: 0.85rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.12em; color: var(--text-muted); }
.row__more { font-size: 0.8rem; color: var(--text-dim); }
.row__more:hover { color: var(--text); }

.card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 0.875rem; }
.card {
  background: var(--bg-soft);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 1.1rem 1.25rem;
  transition: border-color 120ms, transform 120ms, background 120ms;
  display: block;
  color: inherit;
}
.card:hover { border-color: var(--accent); transform: translateY(-1px); background: var(--bg-raised); color: inherit; }
.card h4 { color: var(--heading); margin: 0 0 0.35rem; font-size: 0.95rem; font-weight: 600; }
.card p { color: var(--text-muted); font-size: 0.85rem; margin: 0; line-height: 1.55; }
.card .meta { color: var(--text-dim); font-size: 0.75rem; margin-top: 0.6rem; font-family: ui-monospace, monospace; }

.import-tree { background: var(--bg-soft); border: 1px solid var(--border); border-radius: 10px; padding: 1rem 1.25rem; margin: 1rem 0 2rem; font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 0.85rem; }
.import-tree ul { list-style: none; padding-left: 1.25rem; margin: 0.25rem 0; }
.import-tree li { padding: 0.1rem 0; }
.import-tree li:before { content: "└ "; color: var(--text-dim); }

table.list { width: 100%; border-collapse: collapse; margin-top: 1rem; }
table.list th, table.list td { padding: 0.6rem 0.75rem; border-bottom: 1px solid var(--border-soft); text-align: left; font-size: 0.875rem; }
table.list th { color: var(--text-dim); font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.08em; font-weight: 600; }
table.list td { color: var(--text); }
table.list tr:hover td { background: var(--bg-soft); }
table.list .num { font-family: ui-monospace, monospace; color: var(--text-muted); text-align: right; }
table.list .when { font-family: ui-monospace, monospace; color: var(--text-dim); white-space: nowrap; }

/* Session viewer */
.session-meta { background: var(--bg-soft); border: 1px solid var(--border); border-radius: 10px; padding: 0.85rem 1.1rem; margin: 1rem 0 1.5rem; font-size: 0.85rem; color: var(--text-muted); display: flex; gap: 1.5rem; flex-wrap: wrap; }
.session-meta strong { color: var(--text); font-weight: 600; }
.session-truncate { background: var(--bg-soft); border: 1px solid var(--border); border-radius: 8px; padding: 0.6rem 1rem; margin-bottom: 1rem; font-size: 0.85rem; color: var(--text-muted); }

.usage-card { background: var(--bg-soft); border: 1px solid var(--border); border-radius: 10px; padding: 1rem 1.25rem; margin: 0 0 1.5rem; }
.usage-card__head { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-dim); font-weight: 600; margin-bottom: 0.85rem; display: flex; justify-content: space-between; align-items: baseline; }
.usage-card__model { color: var(--text-muted); font-family: ui-monospace, monospace; text-transform: none; letter-spacing: 0; font-weight: 500; font-size: 0.75rem; }
.usage-card__grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 1rem; }
.usage-card__label { font-size: 0.7rem; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 0.2rem; }
.usage-card__num { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 1.15rem; color: var(--heading); font-weight: 500; }

.evt { margin: 0.85rem 0; padding: 0.85rem 1.1rem; border-radius: 10px; border: 1px solid var(--border-soft); position: relative; }
.evt--user { background: var(--user-tint); border-color: rgba(184, 168, 255, 0.12); }
.evt--assistant { background: var(--asst-tint); border-color: rgba(184, 168, 255, 0.18); }
.evt--system { background: var(--bg-soft); }
.evt--tool-use, .evt--tool-result, .evt--thinking { background: var(--tool-tint); padding: 0.5rem 0.85rem; }
.evt__role { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-muted); margin-bottom: 0.25rem; font-weight: 600; }
.evt__meta { font-size: 0.7rem; color: var(--text-dim); position: absolute; right: 1rem; top: 0.85rem; font-family: ui-monospace, monospace; }
.evt__body { color: var(--text); }
.evt__body p:first-child { margin-top: 0; }
.evt__body p:last-child { margin-bottom: 0; }
.evt__tag { font-family: ui-monospace, monospace; font-size: 0.75rem; color: var(--text-dim); }
details.evt summary { cursor: pointer; font-size: 0.8rem; color: var(--text-muted); }
details.evt summary:hover { color: var(--text); }
details.evt[open] summary { margin-bottom: 0.5rem; }
details.evt pre { font-size: 0.8em; }
`;

// ---------------------------------------------------------------------------
// Layout shell
// ---------------------------------------------------------------------------
function topbarHTML(activeSlug, tabs, safeMode) {
  const link = (slug, label) => `<a href="${slug === 'home' ? '/' : '/' + slug}"${activeSlug === slug ? ' class="active"' : ''}>${label}</a>`;
  const safeBadge = safeMode ? `<span class="privacy" title="Hides items marked private in config">safe view</span>` : '';
  return `
<header class="topbar">
  <div class="brand"><a href="/">~/.claude</a></div>
  <nav>${tabs.map(t => link(t.slug, t.label)).join('')}</nav>
  ${safeBadge}
</header>`;
}

function sidebarHTML(nav, activeSection, activeSlug) {
  const item = (href, label) => {
    const active = href.endsWith('/' + activeSlug) || href === '/' + activeSection + '/' + activeSlug;
    return `<li><a href="${href}"${active ? ' class="active"' : ''}>${label}</a></li>`;
  };

  if (activeSection === 'instructions') {
    return `<aside class="sidebar"><h3>Instructions</h3><ul>${nav.instructions.files.map(f => item(`/instructions/${f.slug}`, f.file)).join('')}</ul></aside>`;
  }
  if (activeSection === 'projects') {
    return `<aside class="sidebar"><h3>Projects</h3><ul>${nav.projects.map(p => item(`/projects/${p.slug}`, p.decodedPath)).join('')}</ul></aside>`;
  }
  if (activeSection === 'wiki') {
    let html = `<aside class="sidebar"><h3>Wiki</h3><ul>`;
    if (nav.wiki.hasIndex) html += item('/wiki', 'Index');
    if (nav.wiki.hasLog) html += item('/wiki/log', 'Log');
    html += `</ul>`;
    for (const [section, pages] of Object.entries(nav.wiki.sections)) {
      html += `<h3>${escapeHtml(section)}</h3><ul>`;
      html += pages.map(p => item(`/wiki/${section}/${p}`, p)).join('');
      html += `</ul>`;
    }
    html += `</aside>`;
    return html;
  }
  if (activeSection === 'skills') {
    return `<aside class="sidebar"><h3>Skills</h3><ul>${nav.skills.map(s => item(`/skills/${s.slug}`, s.slug)).join('')}</ul></aside>`;
  }
  if (activeSection === 'plans') {
    return `<aside class="sidebar"><h3>Plans</h3><ul>${nav.plans.map(p => item(`/plans/${p.slug}`, p.slug)).join('')}</ul></aside>`;
  }
  if (activeSection === 'plugins') {
    return `<aside class="sidebar"><h3>Plugins</h3><ul>${nav.plugins.map(p => item(`/plugins/${encodeURIComponent(p.name)}`, p.name)).join('')}</ul></aside>`;
  }
  return '';
}

function shell({ title, section, slug, nav, content, crumbs, wide, safeMode }) {
  const tabs = availableTabs(nav);
  const sidebar = section && !wide ? sidebarHTML(nav, section, slug) : '';
  const layoutClass = sidebar ? 'layout' : 'layout layout--full';
  const crumbHTML = crumbs ? `<div class="crumb">${crumbs}</div>` : '';
  const mainClass = wide ? 'wide' : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — claude-explorer</title>
<style>${CSS}</style>
</head>
<body>
${topbarHTML(section || 'home', tabs, safeMode)}
<div class="${layoutClass}">
  ${sidebar}
  <main class="${mainClass}">${crumbHTML}${content}</main>
</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function fmtSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}
function fmtDate(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const now = Date.now();
  const diff = now - ms;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return Math.floor(diff / 60_000) + 'm ago';
  if (diff < 86_400_000) return Math.floor(diff / 3_600_000) + 'h ago';
  if (diff < 604_800_000) return Math.floor(diff / 86_400_000) + 'd ago';
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Synthesized index pages
// ---------------------------------------------------------------------------
function homePage(nav) {
  const tabs = availableTabs(nav);
  const sections = [];
  if (nav.instructions.files.length > 0) {
    sections.push(`
<section class="row">
  <div class="row__head"><h2>Instructions</h2><a class="row__more" href="/instructions">See all</a></div>
  <div class="card-grid">
    ${nav.instructions.files.slice(0, 6).map(f => `<a class="card" href="/instructions/${f.slug}"><h4>${escapeHtml(f.file)}</h4><p>${escapeHtml(f.blurb || 'Open file.')}</p></a>`).join('')}
  </div>
</section>`);
  }
  if (nav.projects.length > 0) {
    sections.push(`
<section class="row">
  <div class="row__head"><h2>Projects</h2><a class="row__more" href="/projects">See all</a></div>
  <div class="card-grid">
    ${nav.projects.slice(0, 8).map(p => `<a class="card" href="/projects/${p.slug}"><h4>${escapeHtml(p.decodedPath)}</h4><p>${p.sessionCount} session${p.sessionCount === 1 ? '' : 's'}, ${p.memoryCount} memor${p.memoryCount === 1 ? 'y' : 'ies'}</p><div class="meta">${fmtDate(p.lastTouched)}</div></a>`).join('')}
  </div>
</section>`);
  }
  if (nav.sessions && nav.sessions.length > 0) {
    sections.push(`
<section class="row">
  <div class="row__head"><h2>Recent sessions</h2><a class="row__more" href="/sessions">See all ${nav.sessions.length}</a></div>
  <div class="card-grid">
    ${nav.sessions.slice(0, 6).map(s => `<a class="card" href="/projects/${s.projectSlug}/sessions/${s.id}"><h4>${escapeHtml(s.title || '<untitled>')}</h4><p>${escapeHtml(s.decodedPath)}</p><div class="meta">${fmtDate(s.mtime)} · ${fmtSize(s.size)}</div></a>`).join('')}
  </div>
</section>`);
  }
  if (nav.skills.length > 0) {
    sections.push(`
<section class="row">
  <div class="row__head"><h2>Skills</h2><a class="row__more" href="/skills">See all</a></div>
  <div class="card-grid">
    ${nav.skills.slice(0, 8).map(s => `<a class="card" href="/skills/${s.slug}"><h4>${escapeHtml(s.slug)}</h4><p>${escapeHtml((s.description || 'Slash command').slice(0, 100))}</p></a>`).join('')}
  </div>
</section>`);
  }
  if (nav.plans.length > 0) {
    sections.push(`
<section class="row">
  <div class="row__head"><h2>Plans</h2><a class="row__more" href="/plans">See all</a></div>
  <div class="card-grid">
    ${nav.plans.slice(0, 6).map(p => `<a class="card" href="/plans/${p.slug}"><h4>${escapeHtml(p.slug)}</h4><p>${escapeHtml((p.blurb || 'Plan').slice(0, 100))}</p><div class="meta">${fmtDate(p.mtime)}</div></a>`).join('')}
  </div>
</section>`);
  }
  if (nav.wiki && Object.keys(nav.wiki.sections).length > 0) {
    sections.push(`
<section class="row">
  <div class="row__head"><h2>Wiki</h2><a class="row__more" href="/wiki">Open</a></div>
  <div class="card-grid">
    ${Object.entries(nav.wiki.sections).map(([s, pages]) => `<a class="card" href="/wiki/${s}"><h4>${escapeHtml(s)}</h4><p>${pages.length} page${pages.length === 1 ? '' : 's'}</p></a>`).join('')}
  </div>
</section>`);
  }
  return `
<div class="hero">
  <h1>~/.claude</h1>
  <p>A local view of your Claude Code home: instructions, per-project memory, sessions, plans, skills, and anything else.</p>
</div>
${sections.join('\n')}
`;
}

function instructionsIndex(nav) {
  let importHTML = '';
  if (nav.instructions.graph) {
    const renderNode = (n) => {
      if (!n) return '';
      const link = `<a href="/instructions/${n.file.replace(/\.md$/, '')}">${escapeHtml(n.file)}</a>`;
      if (n.cycle) return `<li>${link} <em>(cycle)</em></li>`;
      const kids = n.imports.length > 0 ? `<ul>${n.imports.map(renderNode).join('')}</ul>` : '';
      return `<li>${link}${kids}</li>`;
    };
    importHTML = `<div class="import-tree"><div style="font-size:0.7rem;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:0.4rem;">@import graph</div><ul>${renderNode(nav.instructions.graph)}</ul></div>`;
  }
  return `
<div class="hero">
  <h1>Instructions</h1>
  <p>Markdown files at the root of <code>~/.claude/</code>. CLAUDE.md and anything it loads via @imports.</p>
</div>
${importHTML}
<div class="card-grid">
  ${nav.instructions.files.map(f => `<a class="card" href="/instructions/${f.slug}"><h4>${escapeHtml(f.file)}</h4><p>${escapeHtml(f.blurb || 'Open file.')}</p></a>`).join('')}
</div>
`;
}

function projectsIndex(nav) {
  const rows = nav.projects.map(p => {
    const u = aggregateProjectUsage(p.slug, nav.sessions);
    return `<tr>
    <td><a href="/projects/${p.slug}">${escapeHtml(p.decodedPath)}</a></td>
    <td class="num">${p.sessionCount}</td>
    <td class="num">${p.memoryCount}</td>
    <td class="num">${u.turns || '—'}</td>
    <td class="num">${u.input || u.cacheCreate || u.cacheRead ? fmtTokens(totalIn(u)) : '—'}</td>
    <td class="num">${u.output ? fmtTokens(u.output) : '—'}</td>
    <td class="when">${fmtDate(p.lastTouched)}</td>
  </tr>`;
  }).join('');
  return `
<div class="hero">
  <h1>Projects</h1>
  <p>Per-project memory, session transcripts, and history. One folder under <code>~/.claude/projects/</code> per working directory you've used Claude Code in.</p>
</div>
<table class="list">
<thead><tr><th>Path</th><th class="num">Sessions</th><th class="num">Memory</th><th class="num">Turns</th><th class="num">In</th><th class="num">Out</th><th class="when">Last touched</th></tr></thead>
<tbody>${rows}</tbody>
</table>
`;
}

async function projectDetail(slug, nav) {
  const proj = nav.projects.find(p => p.slug === slug);
  if (!proj) return null;
  const projDir = join(HOME, 'projects', slug);
  // Memory
  let memoryHTML = '';
  const memoryDir = join(projDir, 'memory');
  if (existsSync(memoryDir)) {
    let memFiles = [];
    try { memFiles = (await readdir(memoryDir)).filter(f => f.endsWith('.md')); } catch {}
    const indexFile = memFiles.find(f => f.toUpperCase() === 'MEMORY.MD');
    if (indexFile) {
      try {
        const md = await readFile(join(memoryDir, indexFile), 'utf8');
        memoryHTML += `<h2>Memory index</h2>${rewriteLinks(marked.parse(md), join(memoryDir, indexFile))}`;
      } catch {}
    }
    const otherFiles = memFiles.filter(f => f !== indexFile).sort();
    if (otherFiles.length > 0) {
      memoryHTML += `<h3>All memory files</h3><div class="card-grid">`;
      for (const f of otherFiles) {
        const blurb = (await pageBlurb(join(memoryDir, f), 110)) || '';
        memoryHTML += `<a class="card" href="/projects/${slug}/memory/${f.replace(/\.md$/, '')}"><h4>${escapeHtml(f)}</h4><p>${escapeHtml(blurb)}</p></a>`;
      }
      memoryHTML += `</div>`;
    }
  }
  // Sessions
  let sessions = [];
  try {
    const all = await readdir(projDir);
    for (const f of all) {
      if (!f.endsWith('.jsonl')) continue;
      const abs = join(projDir, f);
      try {
        const s = await stat(abs);
        sessions.push({ id: f.replace(/\.jsonl$/, ''), size: s.size, mtime: s.mtimeMs });
      } catch {}
    }
  } catch {}
  sessions.sort((a, b) => b.mtime - a.mtime);
  let sessionsHTML = '';
  if (sessions.length > 0) {
    sessionsHTML = `<h2>Sessions</h2><table class="list"><thead><tr><th>Session ID</th><th class="num">Size</th><th class="when">Modified</th></tr></thead><tbody>${sessions.map(s => `<tr><td><a href="/projects/${slug}/sessions/${s.id}"><code>${s.id.slice(0, 8)}</code></a></td><td class="num">${fmtSize(s.size)}</td><td class="when">${fmtDate(s.mtime)}</td></tr>`).join('')}</tbody></table>`;
  }
  return `
<div class="hero">
  <h1>${escapeHtml(proj.decodedPath)}</h1>
  <p>${proj.sessionCount} session${proj.sessionCount === 1 ? '' : 's'}, ${proj.memoryCount} memor${proj.memoryCount === 1 ? 'y' : 'ies'}.</p>
</div>
${memoryHTML}
${sessionsHTML}
`;
}

function sessionsIndex(nav) {
  const grandTotal = emptyUsage();
  for (const s of nav.sessions) if (s.usage) addUsage(grandTotal, s.usage);

  const rows = nav.sessions.map(s => {
    const u = s.usage || emptyUsage();
    return `<tr>
    <td><a href="/projects/${s.projectSlug}/sessions/${s.id}">${escapeHtml(s.title || '<untitled>')}</a></td>
    <td><a href="/projects/${s.projectSlug}" style="color:var(--text-muted);">${escapeHtml(s.decodedPath)}</a></td>
    <td class="num">${u.turns ? u.turns : '—'}</td>
    <td class="num">${u.input || u.cacheCreate || u.cacheRead ? fmtTokens(totalIn(u)) : '—'}</td>
    <td class="num">${u.output ? fmtTokens(u.output) : '—'}</td>
    <td class="num">${fmtSize(s.size)}</td>
    <td class="when">${fmtDate(s.mtime)}</td>
  </tr>`;
  }).join('');

  const totalsBanner = grandTotal.turns ? `
<div class="usage-card">
  <div class="usage-card__head">All sessions</div>
  <div class="usage-card__grid">
    <div><div class="usage-card__label">sessions</div><div class="usage-card__num">${nav.sessions.length}</div></div>
    <div><div class="usage-card__label">turns</div><div class="usage-card__num">${fmtTokens(grandTotal.turns)}</div></div>
    <div><div class="usage-card__label">input</div><div class="usage-card__num">${fmtTokens(grandTotal.input)}</div></div>
    <div><div class="usage-card__label">output</div><div class="usage-card__num">${fmtTokens(grandTotal.output)}</div></div>
    <div><div class="usage-card__label">cache write</div><div class="usage-card__num">${fmtTokens(grandTotal.cacheCreate)}</div></div>
    <div><div class="usage-card__label">cache read</div><div class="usage-card__num">${fmtTokens(grandTotal.cacheRead)}</div></div>
    <div><div class="usage-card__label">total in</div><div class="usage-card__num">${fmtTokens(totalIn(grandTotal))}</div></div>
  </div>
</div>` : '';

  return `
<div class="hero">
  <h1>Sessions</h1>
  <p>Every Claude Code conversation transcript across all projects, sorted by most recent.</p>
</div>
${totalsBanner}
<table class="list">
<thead><tr><th>Title</th><th>Project</th><th class="num">Turns</th><th class="num">In</th><th class="num">Out</th><th class="num">Size</th><th class="when">Modified</th></tr></thead>
<tbody>${rows}</tbody>
</table>
`;
}

function plansIndex(nav) {
  return `
<div class="hero">
  <h1>Plans</h1>
  <p>Plan-mode artifacts saved under <code>~/.claude/plans/</code>.</p>
</div>
<table class="list">
<thead><tr><th>Name</th><th>Preview</th><th class="when">Modified</th></tr></thead>
<tbody>
${nav.plans.map(p => `<tr><td><a href="/plans/${p.slug}">${escapeHtml(p.slug)}</a></td><td style="color:var(--text-muted);font-size:0.85rem;">${escapeHtml((p.blurb || '').slice(0, 120))}</td><td class="when">${fmtDate(p.mtime)}</td></tr>`).join('')}
</tbody>
</table>
`;
}

function pluginsIndex(nav) {
  return `
<div class="hero">
  <h1>Plugins</h1>
  <p>Installed Claude Code plugins from <code>~/.claude/plugins/installed_plugins.json</code>.</p>
</div>
<div class="card-grid">
${nav.plugins.map(p => `<a class="card" href="/plugins/${encodeURIComponent(p.name)}"><h4>${escapeHtml(p.name.split('@')[0])}</h4><p>${escapeHtml(p.name.includes('@') ? p.name.split('@')[1] : '')}</p><div class="meta">${escapeHtml(p.scope)} · ${escapeHtml(p.version)}</div></a>`).join('')}
</div>
`;
}

function pluginDetail(slug, nav) {
  const p = nav.plugins.find(x => x.name === slug);
  if (!p) return null;
  return `
<div class="hero">
  <h1>${escapeHtml(p.name)}</h1>
  <p>Plugin metadata.</p>
</div>
<table class="list">
<tbody>
<tr><td>scope</td><td><code>${escapeHtml(p.scope)}</code></td></tr>
<tr><td>version</td><td><code>${escapeHtml(p.version)}</code></td></tr>
<tr><td>installPath</td><td><code>${escapeHtml(p.installPath)}</code></td></tr>
</tbody>
</table>
`;
}

function skillsIndex(nav) {
  return `
<div class="hero">
  <h1>Skills</h1>
  <p>Slash commands available in every session. Defined in <code>~/.claude/skills/</code>.</p>
</div>
<div class="card-grid">
  ${nav.skills.map(s => `<a class="card" href="/skills/${s.slug}"><h4>${escapeHtml(s.slug)}</h4><p>${escapeHtml((s.description || 'Open SKILL.md').slice(0, 140))}</p></a>`).join('')}
</div>
`;
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------
async function handleRequest(req) {
  const url = new URL(req.url || '/', 'http://localhost');
  const path = decodeURIComponent(url.pathname);
  const safeMode = url.searchParams.get('view') === 'safe';
  const limit = url.searchParams.get('limit') === 'all' ? 'all' : Number(url.searchParams.get('limit')) || 500;

  const nav = await discover();

  const html = (status, content, opts = {}) => ({
    status,
    body: shell({ ...opts, content, nav, safeMode }),
  });
  const notFound = (section) => html(404, '<h1>Not found</h1><p>That page does not exist.</p>', { title: 'Not found', section });

  // Static favicon (no-op)
  if (path === '/favicon.ico') return { status: 204, body: '' };

  // Home
  if (path === '/' || path === '/home') {
    return html(200, homePage(nav), { title: 'Home', section: 'home', wide: true });
  }

  const parts = path.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
  const [head, ...rest] = parts;

  // Instructions
  if (head === 'instructions') {
    if (rest.length === 0) {
      return html(200, instructionsIndex(nav), { title: 'Instructions', section: 'instructions', wide: true });
    }
    const slug = rest[0];
    const file = nav.instructions.files.find(f => f.slug === slug);
    if (!file) return notFound('instructions');
    try {
      const abs = join(HOME, file.file);
      const md = await readFile(abs, 'utf8');
      return html(200, renderMarkdown(md, abs), {
        title: pageTitle(md, file.file),
        section: 'instructions',
        slug,
        crumbs: `<a href="/instructions">instructions</a> / ${escapeHtml(file.file)}`,
      });
    } catch { return notFound('instructions'); }
  }

  // Projects
  if (head === 'projects') {
    if (rest.length === 0) {
      await attachSessionUsage(nav.sessions);
      return html(200, projectsIndex(nav), { title: 'Projects', section: 'projects', wide: true });
    }
    const slug = rest[0];
    if (rest.length === 1) {
      const detail = await projectDetail(slug, nav);
      if (!detail) return notFound('projects');
      return html(200, detail, {
        title: nav.projects.find(p => p.slug === slug)?.decodedPath || slug,
        section: 'projects',
        slug,
        crumbs: `<a href="/projects">projects</a> / ${escapeHtml(slug)}`,
      });
    }
    if (rest[1] === 'memory' && rest.length >= 3) {
      const memFile = rest.slice(2).join('/') + '.md';
      const abs = join(HOME, 'projects', slug, 'memory', memFile);
      try {
        const md = await readFile(abs, 'utf8');
        return html(200, renderMarkdown(md, abs), {
          title: memFile,
          section: 'projects',
          slug,
          crumbs: `<a href="/projects">projects</a> / <a href="/projects/${slug}">${escapeHtml(slug)}</a> / memory / ${escapeHtml(memFile)}`,
        });
      } catch { return notFound('projects'); }
    }
    if (rest[1] === 'sessions' && rest.length >= 3) {
      const sessionId = rest[2];
      const abs = join(HOME, 'projects', slug, sessionId + '.jsonl');
      if (!existsSync(abs)) return notFound('projects');
      let sessionMeta = '';
      try {
        const s = await stat(abs);
        sessionMeta = `<div class="session-meta"><span><strong>Session</strong> <code>${escapeHtml(sessionId)}</code></span><span><strong>Size</strong> ${fmtSize(s.size)}</span><span><strong>Modified</strong> ${fmtDate(s.mtimeMs)}</span></div>`;
      } catch {}
      const proj = nav.projects.find(p => p.slug === slug);
      const projPath = proj ? proj.decodedPath : slug;
      const { html: events, total, shown, usage } = await renderSession(abs, { limit });
      const content = `<div class="hero"><h1>Session</h1><p>Transcript from <code>${escapeHtml(projPath)}</code>.</p></div>${sessionMeta}${renderUsageCard(usage)}${events || '<p style="color:var(--text-muted);">No renderable events in this session.</p>'}`;
      return html(200, content, {
        title: `Session ${sessionId.slice(0, 8)}`,
        section: 'projects',
        slug,
        crumbs: `<a href="/projects">projects</a> / <a href="/projects/${slug}">${escapeHtml(slug)}</a> / sessions / ${escapeHtml(sessionId.slice(0, 8))}`,
      });
    }
    return notFound('projects');
  }

  // Sessions (global, across all projects)
  if (head === 'sessions') {
    if (rest.length === 0) {
      await attachSessionUsage(nav.sessions);
      return html(200, sessionsIndex(nav), { title: 'Sessions', section: 'sessions', wide: true });
    }
    return notFound('sessions');
  }

  // Skills
  if (head === 'skills') {
    if (rest.length === 0) {
      return html(200, skillsIndex(nav), { title: 'Skills', section: 'skills', wide: true });
    }
    const slug = rest.join('/');
    const abs = join(HOME, 'skills', slug, 'SKILL.md');
    try {
      const md = await readFile(abs, 'utf8');
      return html(200, renderMarkdown(md, abs), {
        title: slug,
        section: 'skills',
        slug,
        crumbs: `<a href="/skills">skills</a> / ${escapeHtml(slug)}`,
      });
    } catch { return notFound('skills'); }
  }

  // Plans
  if (head === 'plans') {
    if (rest.length === 0) {
      return html(200, plansIndex(nav), { title: 'Plans', section: 'plans', wide: true });
    }
    const slug = rest[0];
    const abs = join(HOME, 'plans', slug + '.md');
    try {
      const md = await readFile(abs, 'utf8');
      return html(200, renderMarkdown(md, abs), {
        title: slug,
        section: 'plans',
        slug,
        crumbs: `<a href="/plans">plans</a> / ${escapeHtml(slug)}`,
      });
    } catch { return notFound('plans'); }
  }

  // Plugins
  if (head === 'plugins') {
    if (rest.length === 0) {
      return html(200, pluginsIndex(nav), { title: 'Plugins', section: 'plugins', wide: true });
    }
    const detail = pluginDetail(rest[0], nav);
    if (!detail) return notFound('plugins');
    return html(200, detail, { title: rest[0], section: 'plugins', slug: rest[0], crumbs: `<a href="/plugins">plugins</a> / ${escapeHtml(rest[0])}` });
  }

  // Wiki
  if (head === 'wiki') {
    if (!nav.wiki || Object.keys(nav.wiki.sections).length === 0) return notFound('home');
    const wikiDir = join(HOME, 'wiki');
    if (rest.length === 0) {
      const abs = join(wikiDir, 'index.md');
      try {
        const md = await readFile(abs, 'utf8');
        return html(200, renderMarkdown(md, abs), { title: 'Wiki', section: 'wiki', slug: 'index', crumbs: '<a href="/wiki">wiki</a> / index' });
      } catch { return notFound('wiki'); }
    }
    if (rest.length === 1 && rest[0] === 'log') {
      const abs = join(wikiDir, 'log.md');
      try {
        const md = await readFile(abs, 'utf8');
        return html(200, renderMarkdown(md, abs), { title: 'Wiki log', section: 'wiki', slug: 'log', crumbs: '<a href="/wiki">wiki</a> / log' });
      } catch { return notFound('wiki'); }
    }
    // Section index: /wiki/<section> -> list of pages in that subdirectory
    if (rest.length === 1 && nav.wiki.sections[rest[0]]) {
      const section = rest[0];
      const pages = nav.wiki.sections[section];
      const cards = await Promise.all(pages.map(async p => {
        const abs = join(wikiDir, section, p + '.md');
        const blurb = (await pageBlurb(abs, 120)) || '';
        return `<a class="card" href="/wiki/${section}/${p}"><h4>${escapeHtml(p)}</h4><p>${escapeHtml(blurb)}</p></a>`;
      }));
      const content = `<div class="hero"><h1>${escapeHtml(section)}</h1><p>${pages.length} page${pages.length === 1 ? '' : 's'} in <code>wiki/${escapeHtml(section)}/</code>.</p></div><div class="card-grid">${cards.join('')}</div>`;
      return html(200, content, {
        title: section,
        section: 'wiki',
        slug: section,
        crumbs: `<a href="/wiki">wiki</a> / ${escapeHtml(section)}`,
        wide: true,
      });
    }
    const abs = join(wikiDir, rest.join('/') + '.md');
    try {
      const md = await readFile(abs, 'utf8');
      return html(200, renderMarkdown(md, abs), {
        title: rest[rest.length - 1],
        section: 'wiki',
        slug: rest.join('/'),
        crumbs: `<a href="/wiki">wiki</a> / ${rest.map(escapeHtml).join(' / ')}`,
      });
    } catch { return notFound('wiki'); }
  }

  return notFound('home');
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------
const server = createServer(async (req, res) => {
  try {
    const { status, body } = await handleRequest(req);
    res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
    res.end(body);
  } catch (e) {
    console.error(e);
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('Server error: ' + e.message);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`claude-explorer:  http://localhost:${PORT}`);
  console.log(`reading from:     ${HOME}`);
  if (CONFIG.hide && CONFIG.hide.length > 0) console.log(`config hide:      ${CONFIG.hide.length} extra patterns`);
});
