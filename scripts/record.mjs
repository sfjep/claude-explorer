// Record a hero loop of claude-explorer driving the demo dataset.
// Boots its own server, runs Playwright through a scripted browse,
// captures WebM, and (if ffmpeg is on PATH) converts to optimized GIF.
//
// One-time prerequisites:
//   pnpm install                          # pulls playwright as dev dep
//   pnpm exec playwright install chromium # downloads the browser
//   apt install ffmpeg   # (or equivalent) for the GIF conversion step
//
// Usage:
//   pnpm record
//
// Output:
//   media/hero.gif       (if ffmpeg is available)
//   media/hero.webm      (always, the raw recording)

import { spawn, exec } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, rm, readdir, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const seedTarget = '/tmp/claude-explorer-demo';
const videoDir = resolve(root, '.video-tmp');
const mediaDir = resolve(root, 'media');
const finalWebm = resolve(mediaDir, 'hero.webm');
const finalGif = resolve(mediaDir, 'hero.gif');

const VIEWPORT = { width: 1280, height: 800 };
const PORT = 4567;

// ---------------------------------------------------------------------------
// 1. Seed demo data + boot server
// ---------------------------------------------------------------------------
console.log('Seeding demo data...');
await import('./seed-demo.mjs');

console.log('Booting server...');
const server = spawn('node', ['server.mjs'], {
  cwd: root,
  env: { ...process.env, CLAUDE_HOME: seedTarget, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});

async function shutdown() {
  if (!server.killed) server.kill('SIGTERM');
  await sleep(150);
}
process.on('SIGINT', () => shutdown().then(() => process.exit(130)));
process.on('SIGTERM', () => shutdown().then(() => process.exit(143)));

async function waitForServer() {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`http://localhost:${PORT}/`);
      if (r.ok) return;
    } catch {}
    await sleep(120);
  }
  throw new Error(`Server did not boot on port ${PORT}`);
}
await waitForServer();
// Warm the token-usage cache so /sessions and /projects don't lag mid-record.
await fetch(`http://localhost:${PORT}/sessions`).catch(() => {});

// ---------------------------------------------------------------------------
// 2. Drive the browser
// ---------------------------------------------------------------------------
if (existsSync(videoDir)) await rm(videoDir, { recursive: true, force: true });
await mkdir(videoDir, { recursive: true });
await mkdir(mediaDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: VIEWPORT,
  recordVideo: { dir: videoDir, size: VIEWPORT },
});
const page = await context.newPage();

console.log('Recording...');
// Loop is ~7-8s, designed to read well at 12fps.
await page.goto(`http://localhost:${PORT}/`);
await sleep(1700);

await page.click('header.topbar nav a[href="/sessions"]');
await sleep(1500);

// First session row
await page.click('table.list tbody tr:first-of-type a');
await sleep(1400);
await page.evaluate(() => window.scrollBy({ top: 360, behavior: 'smooth' }));
await sleep(1300);

await page.goBack();
await sleep(500);
await page.click('header.topbar nav a[href="/projects"]');
await sleep(1500);

// Drill into first project
await page.click('table.list tbody tr:first-of-type a');
await sleep(1500);

await context.close();
await browser.close();
await shutdown();

// ---------------------------------------------------------------------------
// 3. Move WebM into media/, optionally convert to GIF
// ---------------------------------------------------------------------------
const files = await readdir(videoDir);
const webm = files.find(f => f.endsWith('.webm'));
if (!webm) {
  console.error('No .webm file produced. Aborting.');
  process.exit(1);
}
await rename(resolve(videoDir, webm), finalWebm);
await rm(videoDir, { recursive: true, force: true });
console.log(`WebM:  ${finalWebm}`);

const execp = promisify(exec);
async function hasFfmpeg() {
  try { await execp('ffmpeg -version'); return true; } catch { return false; }
}

if (await hasFfmpeg()) {
  console.log('Converting to GIF...');
  const palette = resolve(mediaDir, '.palette.png');
  const filterCommon = 'fps=12,scale=1024:-1:flags=lanczos';
  await execp(`ffmpeg -y -i "${finalWebm}" -vf "${filterCommon},palettegen" "${palette}"`);
  await execp(`ffmpeg -y -i "${finalWebm}" -i "${palette}" -filter_complex "${filterCommon}[x];[x][1:v]paletteuse" "${finalGif}"`);
  await rm(palette, { force: true });
  console.log(`GIF:   ${finalGif}`);
  console.log('');
  console.log('Embed in README.md by uncommenting the line:');
  console.log('  ![claude-explorer overview](./media/hero.gif)');
} else {
  console.log('');
  console.log('ffmpeg not found on PATH. WebM is saved at media/hero.webm.');
  console.log('Install ffmpeg (e.g. `sudo apt install ffmpeg`) and rerun');
  console.log('`pnpm record` to produce media/hero.gif.');
}
process.exit(0);
