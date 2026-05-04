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

// Inject a fake cursor so the WebM has a visible pointer. Playwright fires
// real DOM mouse events but does not render a cursor; this listens for
// mousemove/mousedown and animates a styled <div> in response.
await context.addInitScript(() => {
  const dot = document.createElement('div');
  dot.id = '__rec_cursor';
  dot.style.cssText = `
    position: fixed; pointer-events: none; z-index: 2147483647;
    left: 640px; top: 400px;
    width: 18px; height: 18px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.95);
    box-shadow:
      0 0 0 2px rgba(184, 168, 255, 1),
      0 0 0 6px rgba(184, 168, 255, 0.35),
      0 0 18px rgba(184, 168, 255, 0.6);
    transform: translate(-50%, -50%);
    transition: transform 90ms ease;
  `;
  const place = () => {
    if (document.body) document.body.appendChild(dot);
    else document.addEventListener('DOMContentLoaded', () => document.body.appendChild(dot));
  };
  place();
  window.addEventListener('mousemove', (e) => {
    dot.style.left = e.clientX + 'px';
    dot.style.top = e.clientY + 'px';
  }, true);
  window.addEventListener('mousedown', () => {
    dot.style.transform = 'translate(-50%, -50%) scale(0.55)';
  }, true);
  window.addEventListener('mouseup', () => {
    dot.style.transform = 'translate(-50%, -50%)';
  }, true);
});

const page = await context.newPage();

// Walk the cursor to a selector, then click. The 30-step move makes the
// fake cursor traverse smoothly instead of teleporting.
async function clickAt(selector) {
  const handle = page.locator(selector).first();
  await handle.waitFor({ state: 'visible' });
  const box = await handle.boundingBox();
  if (!box) throw new Error(`no bounding box for ${selector}`);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y, { steps: 30 });
  await sleep(160);
  await page.mouse.down();
  await sleep(90);
  await page.mouse.up();
}

console.log('Recording...');
// Loop is ~8s, designed to read well at 12fps with the visible cursor.
await page.goto(`http://localhost:${PORT}/`);
// Park the cursor in the middle so it's visible from frame 1.
await page.mouse.move(640, 400, { steps: 1 });
await sleep(1500);

await clickAt('header.topbar nav a[href="/sessions"]');
await sleep(1400);

await clickAt('table.list tbody tr:first-of-type a');
await sleep(1300);
await page.evaluate(() => window.scrollBy({ top: 380, behavior: 'smooth' }));
await sleep(1300);

await page.goBack();
await sleep(500);
await clickAt('header.topbar nav a[href="/projects"]');
await sleep(1400);

await clickAt('table.list tbody tr:first-of-type a');
await sleep(1600);

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
