// Discovery: walks ~/.claude/ and returns a typed nav object. Each section
// is empty (length 0) if there's nothing to show. Routes and the topbar
// inspect the result to decide what to render.

import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync, createReadStream } from 'node:fs';
import { join } from 'node:path';
import { HOME, isHidden, stripCommandWrappers } from './util.js';
import { pageBlurb } from './markdown.js';

// Sorted list of *.md files (without extension) under a directory.
async function listMd(dir) {
  try {
    const files = await readdir(dir);
    return files.filter(f => f.endsWith('.md')).map(f => f.replace(/\.md$/, '')).sort();
  } catch { return []; }
}

// Decode Claude Code's project path encoding: a leading "-" is the
// filesystem root "/"; remaining "-" characters are path separators. So
// a slug like "-home-alice-code-myapp" decodes to "/home/alice/code/myapp".
export function decodeProjectSlug(slug) {
  if (!slug.startsWith('-')) return slug;
  return '/' + slug.slice(1).replace(/-/g, '/');
}

// Build the @import tree starting from a given markdown file.
async function buildImportGraph(file, seen) {
  if (seen.has(file)) return { file, imports: [], cycle: true };
  seen.add(file);
  const node = { file, imports: [] };
  try {
    const content = await readFile(join(HOME, file), 'utf8');
    for (const line of content.split('\n').slice(0, 50)) {
      const m = line.trim().match(/^@(\S+\.md)$/);
      if (m && !isHidden(m[1])) node.imports.push(await buildImportGraph(m[1], seen));
    }
  } catch {}
  return node;
}

// Root *.md instructions plus the @import graph anchored at CLAUDE.md.
async function discoverInstructions() {
  const out = { files: [], graph: null };
  try {
    const entries = await readdir(HOME);
    const mdFiles = entries.filter(f => f.endsWith('.md')).filter(f => !isHidden(f));
    for (const f of mdFiles) {
      const blurb = await pageBlurb(join(HOME, f), 120);
      out.files.push({ slug: f.replace(/\.md$/, ''), file: f, blurb });
    }
    // CLAUDE.md first, then alphabetical.
    out.files.sort((a, b) => {
      if (a.file === 'CLAUDE.md') return -1;
      if (b.file === 'CLAUDE.md') return 1;
      return a.file.localeCompare(b.file);
    });
    if (mdFiles.includes('CLAUDE.md')) out.graph = await buildImportGraph('CLAUDE.md', new Set());
  } catch {}
  return out;
}

// Per-project metadata: decoded path, session count, memory file count, mtime.
async function discoverProjects() {
  const dir = join(HOME, 'projects');
  const out = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory() || isHidden(`projects/${e.name}`)) continue;
      const projDir = join(dir, e.name);
      let sessionCount = 0, memoryCount = 0, lastTouched = 0;
      try {
        for (const x of await readdir(projDir, { withFileTypes: true })) {
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
      out.push({ slug: e.name, decodedPath: decodeProjectSlug(e.name), sessionCount, memoryCount, lastTouched });
    }
  } catch {}
  out.sort((a, b) => b.lastTouched - a.lastTouched || a.decodedPath.localeCompare(b.decodedPath));
  return out;
}

async function discoverPlans() {
  const dir = join(HOME, 'plans');
  const out = [];
  try {
    for (const f of await readdir(dir)) {
      if (!f.endsWith('.md') || isHidden(`plans/${f}`)) continue;
      let mtime = 0;
      try { mtime = (await stat(join(dir, f))).mtimeMs; } catch {}
      const blurb = await pageBlurb(join(dir, f), 140);
      out.push({ slug: f.replace(/\.md$/, ''), file: f, mtime, blurb });
    }
  } catch {}
  out.sort((a, b) => b.mtime - a.mtime);
  return out;
}

// From plugins/installed_plugins.json (Claude Code's own manifest).
async function discoverPlugins() {
  const out = [];
  try {
    const raw = await readFile(join(HOME, 'plugins', 'installed_plugins.json'), 'utf8');
    const data = JSON.parse(raw);
    for (const [name, instances] of Object.entries(data?.plugins || {})) {
      const inst = Array.isArray(instances) ? instances[0] : instances;
      out.push({
        name,
        scope: inst?.scope || 'user',
        version: inst?.version || 'unknown',
        installPath: inst?.installPath || '',
      });
    }
  } catch {}
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

// Pull skill description from the SKILL.md frontmatter.
function extractSkillDescription(md) {
  const m = md.match(/^description:\s*(.+)$/m);
  if (!m) return null;
  let d = m[1].trim();
  if ((d.startsWith('"') && d.endsWith('"')) || (d.startsWith("'") && d.endsWith("'"))) d = d.slice(1, -1);
  return d.length > 160 ? d.slice(0, 157) + '...' : d;
}

// Walk skills/ accepting both flat and nested layouts:
//   skills/<name>/SKILL.md
//   skills/<group>/<name>/SKILL.md
// A directory may be both: a parent skill (gstack/SKILL.md) AND a collection
// hosting child skills (gstack/qa/SKILL.md). Surface both.
// Top-level symlinks (e.g. `browse -> gstack/browse`) are skipped: their
// canonical form shows up under the parent.
async function discoverSkills() {
  const dir = join(HOME, 'skills');
  const out = [];
  try {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      if (!e.isDirectory() || isHidden(`skills/${e.name}`)) continue;
      const child = join(dir, e.name);
      try {
        const md = await readFile(join(child, 'SKILL.md'), 'utf8');
        out.push({ slug: e.name, description: extractSkillDescription(md) });
      } catch {}
      try {
        for (const s of await readdir(child, { withFileTypes: true })) {
          if (!s.isDirectory() || s.name.startsWith('.')) continue;
          try {
            const md = await readFile(join(child, s.name, 'SKILL.md'), 'utf8');
            out.push({ slug: `${e.name}/${s.name}`, description: extractSkillDescription(md) });
          } catch {}
        }
      } catch {}
    }
  } catch {}
  out.sort((a, b) => a.slug.localeCompare(b.slug));
  return out;
}

// Optional Karpathy-style wiki layer at $CLAUDE_HOME/wiki/. Scans arbitrary
// section directories underneath and treats index.md / log.md as special.
async function discoverWiki() {
  const wikiDir = join(HOME, 'wiki');
  if (!existsSync(wikiDir)) return null;
  const out = { sections: {}, hasIndex: false, hasLog: false };
  try {
    for (const e of await readdir(wikiDir, { withFileTypes: true })) {
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

// Pull a useful title from the first chunk of a JSONL session. Preference:
//   1. ai-title (Claude Code generates this once a session is substantive)
//   2. custom-title (set by user via /title or similar)
//   3. first real user message, truncated, as a fallback
//
// Many short or interrupted sessions never get titled by Claude Code, but
// they almost always have a first user prompt that says what the user came
// to do. Reading 50KB is enough to skip past the command-caveat boilerplate
// and reach actual user content.
async function readSessionTitle(absPath) {
  return new Promise((resolve) => {
    const stream = createReadStream(absPath, { encoding: 'utf8', start: 0, end: 50000 });
    let buf = '';
    stream.on('data', chunk => { buf += chunk; });
    stream.on('end', () => {
      let custom = null, ai = null, firstUserText = null;
      for (const line of buf.split('\n')) {
        if (!line.trim()) continue;
        try {
          const evt = JSON.parse(line);
          if (evt.type === 'ai-title' && typeof evt.aiTitle === 'string') ai = evt.aiTitle;
          else if (evt.type === 'custom-title' && typeof evt.customTitle === 'string') custom = evt.customTitle;
          else if (!firstUserText && evt.type === 'user' && evt.message) {
            const content = evt.message.content;
            let text = '';
            if (typeof content === 'string') text = content;
            else if (Array.isArray(content)) {
              for (const c of content) if (c.type === 'text') { text = c.text || ''; break; }
            }
            text = stripCommandWrappers(text).trim();
            // Skip system-reminder noise and trivially short blurts.
            if (text.length > 8 && !text.startsWith('<system-reminder>')) firstUserText = text;
          }
        } catch {}
      }
      const fallback = firstUserText
        ? firstUserText.slice(0, 100).replace(/\s+/g, ' ') + (firstUserText.length > 100 ? '...' : '')
        : null;
      resolve(ai || custom || fallback);
    });
    stream.on('error', () => resolve(null));
  });
}

// Flat list of every JSONL session across all projects, most-recent first.
// Title is fetched only for the top N most recent (cheap O(20KB * N) IO).
// Token usage is left null here and filled by attachSessionUsage on demand.
async function discoverSessions() {
  const TITLE_FETCH = 60;
  const projectsDir = join(HOME, 'projects');
  const out = [];
  try {
    for (const p of await readdir(projectsDir, { withFileTypes: true })) {
      if (!p.isDirectory() || isHidden(`projects/${p.name}`)) continue;
      const projDir = join(projectsDir, p.name);
      let entries;
      try { entries = await readdir(projDir, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        if (!e.isFile() || !e.name.endsWith('.jsonl')) continue;
        try {
          const s = await stat(join(projDir, e.name));
          out.push({
            id: e.name.replace(/\.jsonl$/, ''),
            projectSlug: p.name,
            decodedPath: decodeProjectSlug(p.name),
            size: s.size,
            mtime: s.mtimeMs,
            title: null,
          });
        } catch {}
      }
    }
  } catch {}
  out.sort((a, b) => b.mtime - a.mtime);
  await Promise.all(out.slice(0, TITLE_FETCH).map(async (s) => {
    s.title = await readSessionTitle(join(projectsDir, s.projectSlug, s.id + '.jsonl'));
  }));
  return out;
}

// Top-level discovery. Each branch runs in parallel.
export async function discover() {
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
