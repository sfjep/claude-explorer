// claude-explorer: a local HTTP viewer for ~/.claude/.
// Auto-discovers what's there; renders only what exists.
// Read-only, localhost-only, zero-config out of the box.
//
// This file is just routing + boot. The real work lives in src/:
//   util.js      - config, formatters, escape/cap, glob
//   markdown.js  - blurb extraction, link rewriting
//   discover.js  - filesystem walking, returns the nav object
//   session.js   - JSONL streaming, render, token aggregation
//   style.js     - the CSS string
//   view.js      - layout shell, sidebar, all page templates

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { HOME, PORT, CONFIG, escapeHtml, fmtSize, fmtDate } from './src/util.js';
import { renderMarkdown, pageBlurb, pageTitle } from './src/markdown.js';
import { discover } from './src/discover.js';
import { renderSession, attachSessionUsage } from './src/session.js';
import {
  shell,
  homePage,
  instructionsIndex,
  projectsIndex,
  projectDetail,
  sessionsIndex,
  plansIndex,
  pluginsIndex,
  pluginDetail,
  skillsIndex,
  renderUsageCard,
} from './src/view.js';

// ---------------------------------------------------------------------------
// Route dispatch
// ---------------------------------------------------------------------------
async function handleRequest(req) {
  const url = new URL(req.url || '/', 'http://localhost');
  const path = decodeURIComponent(url.pathname);
  const safeMode = url.searchParams.get('view') === 'safe';
  const limitParam = url.searchParams.get('limit');
  const limit = limitParam === 'all' ? 'all' : Number(limitParam) || 500;

  const nav = await discover();

  const html = (status, content, opts = {}) => ({
    status,
    body: shell({ ...opts, content, nav, safeMode }),
  });
  const notFound = (section) => html(404, '<h1>Not found</h1><p>That page does not exist.</p>', { title: 'Not found', section });

  if (path === '/favicon.ico') return { status: 204, body: '' };
  if (path === '/' || path === '/home') {
    return html(200, homePage(nav), { title: 'Home', section: 'home', wide: true });
  }

  const parts = path.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
  const [head, ...rest] = parts;

  if (head === 'instructions') return await routeInstructions(rest, nav, html, notFound);
  if (head === 'projects') return await routeProjects(rest, nav, limit, html, notFound);
  if (head === 'sessions') return await routeSessions(rest, nav, html, notFound);
  if (head === 'skills') return await routeSkills(rest, nav, html, notFound);
  if (head === 'plans') return await routePlans(rest, nav, html, notFound);
  if (head === 'plugins') return await routePlugins(rest, nav, html, notFound);
  if (head === 'wiki') return await routeWiki(rest, nav, html, notFound);

  return notFound('home');
}

// ---------------------------------------------------------------------------
// Per-section route handlers
// ---------------------------------------------------------------------------
async function routeInstructions(rest, nav, html, notFound) {
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

async function routeProjects(rest, nav, limit, html, notFound) {
  if (rest.length === 0) {
    await attachSessionUsage(nav.sessions);
    return html(200, projectsIndex(nav), { title: 'Projects', section: 'projects', wide: true });
  }
  const slug = rest[0];
  if (rest.length === 1) {
    await attachSessionUsage(nav.sessions);
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
    const { html: events, usage } = await renderSession(abs, { limit });
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

async function routeSessions(rest, nav, html, notFound) {
  if (rest.length === 0) {
    await attachSessionUsage(nav.sessions);
    return html(200, sessionsIndex(nav), { title: 'Sessions', section: 'sessions', wide: true });
  }
  return notFound('sessions');
}

async function routeSkills(rest, nav, html, notFound) {
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

async function routePlans(rest, nav, html, notFound) {
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

async function routePlugins(rest, nav, html, notFound) {
  if (rest.length === 0) {
    return html(200, pluginsIndex(nav), { title: 'Plugins', section: 'plugins', wide: true });
  }
  const detail = pluginDetail(rest[0], nav);
  if (!detail) return notFound('plugins');
  return html(200, detail, {
    title: rest[0],
    section: 'plugins',
    slug: rest[0],
    crumbs: `<a href="/plugins">plugins</a> / ${escapeHtml(rest[0])}`,
  });
}

async function routeWiki(rest, nav, html, notFound) {
  if (!nav.wiki || Object.keys(nav.wiki.sections).length === 0) return notFound('home');
  const wikiDir = join(HOME, 'wiki');

  if (rest.length === 0) {
    try {
      const abs = join(wikiDir, 'index.md');
      const md = await readFile(abs, 'utf8');
      return html(200, renderMarkdown(md, abs), { title: 'Wiki', section: 'wiki', slug: 'index', crumbs: '<a href="/wiki">wiki</a> / index' });
    } catch { return notFound('wiki'); }
  }
  if (rest.length === 1 && rest[0] === 'log') {
    try {
      const abs = join(wikiDir, 'log.md');
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
  // Fall through: /wiki/<section>/<page>
  try {
    const abs = join(wikiDir, rest.join('/') + '.md');
    const md = await readFile(abs, 'utf8');
    return html(200, renderMarkdown(md, abs), {
      title: rest[rest.length - 1],
      section: 'wiki',
      slug: rest.join('/'),
      crumbs: `<a href="/wiki">wiki</a> / ${rest.map(escapeHtml).join(' / ')}`,
    });
  } catch { return notFound('wiki'); }
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
