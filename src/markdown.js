// Markdown helpers: read first-paragraph blurbs, render with link rewriting,
// extract titles. The link rewriter knows the URL space exposed by the
// server so wikilinks across files resolve correctly.

import { readFile } from 'node:fs/promises';
import { join, posix, basename } from 'node:path';
import { marked } from 'marked';
import { HOME } from './util.js';

// Read a markdown file and return a one-line preview taken from the first
// real prose paragraph (skips headings, separators, metadata, lists).
export async function pageBlurb(absPath, max = 140) {
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

// Pull the first H1 title from a markdown file, or fall back to a label.
export function pageTitle(md, fallback) {
  const m = md.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : fallback;
}

// Map an absolute filesystem path to the URL the server exposes for it.
// Used by rewriteLinks to translate wikilinks like
// [foo](../entities/foo.md) into proper /wiki/entities/foo URLs.
export function fileToUrl(absPath) {
  // Root *.md files
  if (absPath.startsWith(HOME + '/') && !absPath.slice(HOME.length + 1).includes('/')) {
    if (absPath.endsWith('.md')) return `/instructions/${basename(absPath, '.md')}`;
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
  // Project memory: projects/<slug>/memory/<file>.md -> /projects/<slug>/memory/<file>
  const projectsDir = join(HOME, 'projects');
  if (absPath.startsWith(projectsDir + '/')) {
    const rel = absPath.slice(projectsDir.length + 1);
    const parts = rel.split('/');
    if (parts.length >= 3 && parts[1] === 'memory' && rel.endsWith('.md')) {
      return `/projects/${parts[0]}/memory/${parts.slice(2).join('/').replace(/\.md$/, '')}`;
    }
  }
  return null;
}

// Rewrite relative .md links in already-rendered HTML so they point at the
// server's URL space instead of dead filesystem paths.
export function rewriteLinks(html, sourceFile) {
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
    return url ? `href="${url}${hash}"` : match;
  });
}

// Convenience: render a markdown string and rewrite its links in one go.
export function renderMarkdown(md, sourceFile) {
  return rewriteLinks(marked.parse(md), sourceFile);
}
