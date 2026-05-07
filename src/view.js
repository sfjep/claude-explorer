// HTML composition: layout shell, top nav, sidebar, and every index/detail
// page template. Pure functions over the nav object plus a few helpers.

import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { marked } from 'marked';
import { HOME, escapeHtml, fmtDate, fmtSize, fmtTokens } from './util.js';
import { pageBlurb, rewriteLinks } from './markdown.js';
import { addUsage, aggregateProjectUsage, emptyUsage, totalIn } from './session.js';
import { CSS } from './style.js';

// ---------------------------------------------------------------------------
// Tab availability
// ---------------------------------------------------------------------------
export function availableTabs(nav) {
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
// Layout pieces
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

export function shell({ title, section, slug, nav, content, crumbs, wide, safeMode }) {
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
<script>${EXPAND_SCRIPT}</script>
</body>
</html>`;
}

const EXPAND_SCRIPT = `
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.evt-expand');
  if (!btn) return;
  const group = btn.closest('[data-uuid]');
  if (!group) return;
  const uuid = group.dataset.uuid;
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Loading...';
  try {
    const url = location.pathname.replace(/\\/+$/, '') + '/event/' + encodeURIComponent(uuid);
    const res = await fetch(url);
    if (!res.ok) throw new Error(res.status);
    const html = await res.text();
    if (!html) throw new Error('empty');
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    const fresh = tmp.firstElementChild;
    if (fresh) group.replaceWith(fresh);
  } catch (err) {
    btn.disabled = false;
    btn.textContent = original + ' (retry)';
  }
});
`;

// ---------------------------------------------------------------------------
// Reusable widgets
// ---------------------------------------------------------------------------
export function renderUsageCard(usage) {
  if (!usage || !usage.turns) return '';
  return `<div class="usage-card">
  <div class="usage-card__head">Tokens${usage.model ? ` <span class="usage-card__model">${escapeHtml(usage.model)}</span>` : ''}</div>
  <div class="usage-card__grid">
    <div><div class="usage-card__label">turns</div><div class="usage-card__num">${fmtTokens(usage.turns)}</div></div>
    <div><div class="usage-card__label">input</div><div class="usage-card__num">${fmtTokens(usage.input)}</div></div>
    <div><div class="usage-card__label">output</div><div class="usage-card__num">${fmtTokens(usage.output)}</div></div>
    <div><div class="usage-card__label">cache write</div><div class="usage-card__num">${fmtTokens(usage.cacheCreate)}</div></div>
    <div><div class="usage-card__label">cache read</div><div class="usage-card__num">${fmtTokens(usage.cacheRead)}</div></div>
    <div><div class="usage-card__label">total in</div><div class="usage-card__num">${fmtTokens(totalIn(usage))}</div></div>
  </div>
</div>`;
}

// ---------------------------------------------------------------------------
// Index pages
// ---------------------------------------------------------------------------
export function homePage(nav) {
  const sections = [];
  if (nav.instructions.files.length > 0) {
    sections.push(`<section class="row">
  <div class="row__head"><h2>Instructions</h2><a class="row__more" href="/instructions">See all</a></div>
  <div class="card-grid">
    ${nav.instructions.files.slice(0, 6).map(f => `<a class="card" href="/instructions/${f.slug}" title="${escapeHtml(f.file)}"><h4>${escapeHtml(f.file)}</h4><p>${escapeHtml(f.blurb || 'Open file.')}</p></a>`).join('')}
  </div>
</section>`);
  }
  if (nav.projects.length > 0) {
    sections.push(`<section class="row">
  <div class="row__head"><h2>Projects</h2><a class="row__more" href="/projects">See all</a></div>
  <div class="card-grid">
    ${nav.projects.slice(0, 8).map(p => `<a class="card" href="/projects/${p.slug}" title="${escapeHtml(p.decodedPath)}"><h4>${escapeHtml(p.decodedPath)}</h4><p>${p.sessionCount} session${p.sessionCount === 1 ? '' : 's'}, ${p.memoryCount} memor${p.memoryCount === 1 ? 'y' : 'ies'}</p><div class="meta">${fmtDate(p.lastTouched)}</div></a>`).join('')}
  </div>
</section>`);
  }
  if (nav.sessions && nav.sessions.length > 0) {
    sections.push(`<section class="row">
  <div class="row__head"><h2>Recent sessions</h2><a class="row__more" href="/sessions">See all ${nav.sessions.length}</a></div>
  <div class="card-grid">
    ${nav.sessions.slice(0, 6).map(s => `<a class="card" href="/projects/${s.projectSlug}/sessions/${s.id}" title="${escapeHtml(s.title || '<untitled>')}"><h4>${escapeHtml(s.title || '<untitled>')}</h4><p>${escapeHtml(s.decodedPath)}</p><div class="meta">${fmtDate(s.mtime)} · ${fmtSize(s.size)}</div></a>`).join('')}
  </div>
</section>`);
  }
  if (nav.skills.length > 0) {
    sections.push(`<section class="row">
  <div class="row__head"><h2>Skills</h2><a class="row__more" href="/skills">See all</a></div>
  <div class="card-grid">
    ${nav.skills.slice(0, 8).map(s => `<a class="card" href="/skills/${s.slug}" title="${escapeHtml(s.slug)}"><h4>${escapeHtml(s.slug)}</h4><p>${escapeHtml((s.description || 'Slash command').slice(0, 100))}</p></a>`).join('')}
  </div>
</section>`);
  }
  if (nav.plans.length > 0) {
    sections.push(`<section class="row">
  <div class="row__head"><h2>Plans</h2><a class="row__more" href="/plans">See all</a></div>
  <div class="card-grid">
    ${nav.plans.slice(0, 6).map(p => `<a class="card" href="/plans/${p.slug}" title="${escapeHtml(p.slug)}"><h4>${escapeHtml(p.slug)}</h4><p>${escapeHtml((p.blurb || 'Plan').slice(0, 100))}</p><div class="meta">${fmtDate(p.mtime)}</div></a>`).join('')}
  </div>
</section>`);
  }
  if (nav.wiki && Object.keys(nav.wiki.sections).length > 0) {
    sections.push(`<section class="row">
  <div class="row__head"><h2>Wiki</h2><a class="row__more" href="/wiki">Open</a></div>
  <div class="card-grid">
    ${Object.entries(nav.wiki.sections).map(([s, pages]) => `<a class="card" href="/wiki/${s}"><h4>${escapeHtml(s)}</h4><p>${pages.length} page${pages.length === 1 ? '' : 's'}</p></a>`).join('')}
  </div>
</section>`);
  }
  return `<div class="hero">
  <h1>~/.claude</h1>
  <p>A local view of your Claude Code home: instructions, per-project memory, sessions, plans, skills, and anything else.</p>
</div>
${sections.join('\n')}`;
}

export function instructionsIndex(nav) {
  let importHTML = '';
  if (nav.instructions.graph) {
    // Link only root-level files (no `/` in path) since the instructions
    // route doesn't serve nested paths. Missing imports render with a tag.
    const renderNode = (n) => {
      if (!n) return '';
      const linkable = !n.missing && !n.file.includes('/');
      const label = linkable
        ? `<a href="/instructions/${n.file.replace(/\.md$/, '')}">${escapeHtml(n.file)}</a>`
        : escapeHtml(n.file);
      if (n.missing) return `<li>${label} <em>(not found)</em></li>`;
      if (n.cycle) return `<li>${label} <em>(cycle)</em></li>`;
      const kids = n.imports.length > 0 ? `<ul>${n.imports.map(renderNode).join('')}</ul>` : '';
      return `<li>${label}${kids}</li>`;
    };
    importHTML = `<div class="import-tree"><div style="font-size:0.7rem;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:0.4rem;">@import graph</div><ul>${renderNode(nav.instructions.graph)}</ul></div>`;
  }
  return `<div class="hero">
  <h1>Instructions</h1>
  <p>Markdown files at the root of <code>~/.claude/</code>. CLAUDE.md and anything it loads via @imports.</p>
</div>
${importHTML}
<div class="card-grid">
  ${nav.instructions.files.map(f => `<a class="card" href="/instructions/${f.slug}" title="${escapeHtml(f.file)}"><h4>${escapeHtml(f.file)}</h4><p>${escapeHtml(f.blurb || 'Open file.')}</p></a>`).join('')}
</div>`;
}

export function projectsIndex(nav) {
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
  return `<div class="hero">
  <h1>Projects</h1>
  <p>Per-project memory, session transcripts, and history. One folder under <code>~/.claude/projects/</code> per working directory you've used Claude Code in.</p>
</div>
<table class="list">
<thead><tr><th>Path</th><th class="num">Sessions</th><th class="num">Memory</th><th class="num">Turns</th><th class="num">In</th><th class="num">Out</th><th class="when">Last touched</th></tr></thead>
<tbody>${rows}</tbody>
</table>`;
}

// projectDetail is async (reads memory + lists sessions on disk).
export async function projectDetail(slug, nav) {
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
        memoryHTML += `<a class="card" href="/projects/${slug}/memory/${f.replace(/\.md$/, '')}" title="${escapeHtml(f)}"><h4>${escapeHtml(f)}</h4><p>${escapeHtml(blurb)}</p></a>`;
      }
      memoryHTML += `</div>`;
    }
  }

  // Sessions belonging to this project, with usage if attached upstream.
  const sessions = (nav.sessions || []).filter(s => s.projectSlug === slug);
  let sessionsHTML = '';
  if (sessions.length > 0) {
    sessionsHTML = `<h2>Sessions</h2><table class="list"><thead><tr><th>Title</th><th class="num">Turns</th><th class="num">In</th><th class="num">Out</th><th class="num">Size</th><th class="when">Modified</th></tr></thead><tbody>${sessions.map(s => {
      const u = s.usage || emptyUsage();
      return `<tr>
        <td><a href="/projects/${slug}/sessions/${s.id}">${escapeHtml(s.title || '<untitled>')}</a></td>
        <td class="num">${u.turns || '—'}</td>
        <td class="num">${u.input || u.cacheCreate || u.cacheRead ? fmtTokens(totalIn(u)) : '—'}</td>
        <td class="num">${u.output ? fmtTokens(u.output) : '—'}</td>
        <td class="num">${fmtSize(s.size)}</td>
        <td class="when">${fmtDate(s.mtime)}</td>
      </tr>`;
    }).join('')}</tbody></table>`;
  }

  return `<div class="hero">
  <h1>${escapeHtml(proj.decodedPath)}</h1>
  <p>${proj.sessionCount} session${proj.sessionCount === 1 ? '' : 's'}, ${proj.memoryCount} memor${proj.memoryCount === 1 ? 'y' : 'ies'}.</p>
</div>
${memoryHTML}
${sessionsHTML}`;
}

export function sessionsIndex(nav) {
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

  const totalsBanner = grandTotal.turns ? `<div class="usage-card">
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

  return `<div class="hero">
  <h1>Sessions</h1>
  <p>Every Claude Code conversation transcript across all projects, sorted by most recent.</p>
</div>
${totalsBanner}
<table class="list">
<thead><tr><th>Title</th><th>Project</th><th class="num">Turns</th><th class="num">In</th><th class="num">Out</th><th class="num">Size</th><th class="when">Modified</th></tr></thead>
<tbody>${rows}</tbody>
</table>`;
}

export function plansIndex(nav) {
  return `<div class="hero">
  <h1>Plans</h1>
  <p>Plan-mode artifacts saved under <code>~/.claude/plans/</code>.</p>
</div>
<table class="list">
<thead><tr><th>Name</th><th>Preview</th><th class="when">Modified</th></tr></thead>
<tbody>
${nav.plans.map(p => `<tr><td><a href="/plans/${p.slug}">${escapeHtml(p.slug)}</a></td><td style="color:var(--text-muted);font-size:0.85rem;">${escapeHtml((p.blurb || '').slice(0, 120))}</td><td class="when">${fmtDate(p.mtime)}</td></tr>`).join('')}
</tbody>
</table>`;
}

export function pluginsIndex(nav) {
  return `<div class="hero">
  <h1>Plugins</h1>
  <p>Installed Claude Code plugins from <code>~/.claude/plugins/installed_plugins.json</code>.</p>
</div>
<div class="card-grid">
${nav.plugins.map(p => `<a class="card" href="/plugins/${encodeURIComponent(p.name)}" title="${escapeHtml(p.name)}"><h4>${escapeHtml(p.name.split('@')[0])}</h4><p>${escapeHtml(p.name.includes('@') ? p.name.split('@')[1] : '')}</p><div class="meta">${escapeHtml(p.scope)} · ${escapeHtml(p.version)}</div></a>`).join('')}
</div>`;
}

export function pluginDetail(slug, nav) {
  const p = nav.plugins.find(x => x.name === slug);
  if (!p) return null;
  return `<div class="hero">
  <h1>${escapeHtml(p.name)}</h1>
  <p>Plugin metadata.</p>
</div>
<table class="list">
<tbody>
<tr><td>scope</td><td><code>${escapeHtml(p.scope)}</code></td></tr>
<tr><td>version</td><td><code>${escapeHtml(p.version)}</code></td></tr>
<tr><td>installPath</td><td><code>${escapeHtml(p.installPath)}</code></td></tr>
</tbody>
</table>`;
}

export function skillsIndex(nav) {
  return `<div class="hero">
  <h1>Skills</h1>
  <p>Slash commands available in every session. Defined in <code>~/.claude/skills/</code>.</p>
</div>
<div class="card-grid">
  ${nav.skills.map(s => `<a class="card" href="/skills/${s.slug}" title="${escapeHtml(s.slug)}"><h4>${escapeHtml(s.slug)}</h4><p>${escapeHtml((s.description || 'Open SKILL.md').slice(0, 140))}</p></a>`).join('')}
</div>`;
}
