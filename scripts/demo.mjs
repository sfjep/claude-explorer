// One-command demo: seed dummy ~/.claude/ at /tmp/claude-explorer-demo,
// then boot the server pointed at it. So a first-time evaluator can see
// every feature without touching their real Claude Code state.

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const target = '/tmp/claude-explorer-demo';

await import('./seed-demo.mjs');

const child = spawn('node', ['server.mjs'], {
  cwd: root,
  env: { ...process.env, CLAUDE_HOME: target },
  stdio: 'inherit',
});

const stop = () => child.kill('SIGINT');
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
