// Pure utilities shared across modules. No filesystem, no HTML composition.
// Configuration loading and the default-hide list also live here because
// every module needs to ask "is this path hidden?" early.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

export const HOME = process.env.CLAUDE_HOME || join(homedir(), '.claude');
export const PORT = process.env.PORT ? Number(process.env.PORT) : 4567;

// Single-user, runs on localhost. The defaults below hide credentials and
// noise (caches, telemetry, internals), not personal files. The user wrote
// those, they're allowed to read them.
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

export let CONFIG = { hide: [], label: {}, theme: 'dark' };
try {
  const raw = await readFile(join(HOME, 'claude-explorer.config.json'), 'utf8');
  CONFIG = { ...CONFIG, ...JSON.parse(raw) };
} catch { /* zero-config default */ }

const HIDE_PATTERNS = [...DEFAULT_HIDE, ...(CONFIG.hide || [])];

export function isHidden(relPath) {
  // relPath is relative to HOME, may be a file or dir (with trailing /).
  const tries = [relPath, relPath + '/'];
  for (const p of tries) {
    for (const pat of HIDE_PATTERNS) {
      if (matchGlob(p, pat)) return true;
    }
  }
  return false;
}

export function matchGlob(s, pat) {
  if (pat.endsWith('/')) return s === pat || s.startsWith(pat);
  if (pat.includes('*')) {
    const re = new RegExp('^' + pat.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
    return re.test(s);
  }
  return s === pat || s.startsWith(pat + '/');
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------
export function fmtSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

export function fmtDate(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return Math.floor(diff / 60_000) + 'm ago';
  if (diff < 86_400_000) return Math.floor(diff / 3_600_000) + 'h ago';
  if (diff < 604_800_000) return Math.floor(diff / 86_400_000) + 'd ago';
  return d.toISOString().slice(0, 10);
}

// Token counts: raw with thousands separators under 10k, then k / M / B.
export function fmtTokens(n) {
  if (!n) return '0';
  if (n < 10_000) return n.toLocaleString('en-US');
  if (n < 1_000_000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  if (n < 1_000_000_000) return (n / 1_000_000).toFixed(2).replace(/\.?0+$/, '') + 'M';
  return (n / 1_000_000_000).toFixed(2).replace(/\.?0+$/, '') + 'B';
}

// ---------------------------------------------------------------------------
// HTML / text safety
// ---------------------------------------------------------------------------
export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Caps that prevent rendering pathological events from blowing up the page
// or the heap.
export const MAX_TEXT_BLOCK = 20000;
export const MAX_THINKING = 4000;
export const MAX_TOOL_INPUT = 1500;
export const MAX_TOOL_RESULT = 1200;
export const MAX_BUFFER_HARD_CAP = 2000;

export function capText(s, cap) {
  if (!s) return '';
  return s.length > cap ? s.slice(0, cap) + '\n\n[... truncated, full text in raw JSONL]' : s;
}

// Filter Claude Code's CLI plumbing wrappers from user messages.
export function stripCommandWrappers(text) {
  return text
    .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g, '')
    .replace(/<command-name>[\s\S]*?<\/command-name>/g, '')
    .replace(/<command-message>[\s\S]*?<\/command-message>/g, '')
    .replace(/<command-args>[\s\S]*?<\/command-args>/g, '')
    .replace(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/g, (_, c) => c.trim() ? `\n[stdout] ${c.trim()}\n` : '')
    .trim();
}

export const RENDERED_TYPES = new Set(['user', 'assistant', 'system']);
