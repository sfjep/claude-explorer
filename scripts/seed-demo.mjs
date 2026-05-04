// Seed a believable dummy ~/.claude/ for demos and screenshots, so the
// README GIFs and the README's `pnpm demo` command can show off the
// explorer's killer features (per-project memory, session transcripts,
// token usage) without touching anyone's real data.
//
// Run via `pnpm demo` (which then boots the server pointed at /tmp/...)
// or directly: `node scripts/seed-demo.mjs [target-dir]`.

import { mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const TARGET = process.argv[2] || '/tmp/claude-explorer-demo';

// ---------------------------------------------------------------------------
// Synthetic content
// ---------------------------------------------------------------------------
const INSTRUCTIONS = {
  'CLAUDE.md': '@SOUL.md\n@USER.md\n@AGENTS.md\n',
  'SOUL.md': `# SOUL.md

Voice and values for the agent.

## Voice

Brevity is mandatory. A clear sentence beats a clear paragraph.

Never open with sycophancy. Banned: "Great question", "Absolutely!",
"I'd be happy to...". Start with the answer.

## Values

Disagreement is a feature. If a decision is bad, say so and say why.
Root cause or nothing. No fixes that paper over symptoms.
`,
  'USER.md': `# USER.md

A working model of the user. Refresh when bets shift.

## How I think

Build, measure, learn. First principles. Small items, fast iteration.

## What I'm building

A SaaS for indie podcasters. Two-sided marketplace: creators on one side,
sponsors on the other.

## Triggers

Consultant speak. Vague hedging. Three-paragraph answers when one
sentence works.
`,
  'AGENTS.md': `# AGENTS.md

Operational playbook.

## On every message

1. Load SOUL.md, USER.md, AGENTS.md via CLAUDE.md @imports.
2. Check the current repo's docs before assuming.
3. Verify before recommending: don't act on stale memory.

## Never

- No force push.
- No --no-verify on commits.
- No Co-Authored-By trailers in commit messages.
`,
};

const PROJECTS = [
  {
    slug: '-home-alice-code-podcraft',
    decoded: '/home/alice/code/podcraft',
    sessions: [
      {
        id: 'a1b2c3d4-1111-4222-9333-aaaaaaaaaaaa',
        title: 'Wire up Stripe Connect for sponsor payouts',
        ageDays: 0.1,
        turns: 38,
        userPrompt: "Set up Stripe Connect so sponsors can pay creators directly. We need split payments with a platform fee.",
      },
      {
        id: 'b2c3d4e5-2222-4333-9444-bbbbbbbbbbbb',
        title: 'Migrate audio uploads from S3 to R2',
        ageDays: 0.5,
        turns: 52,
        userPrompt: "Audio file uploads are getting expensive on S3. Let's migrate to Cloudflare R2 to cut egress costs.",
      },
      {
        id: 'c3d4e5f6-3333-4444-9555-cccccccccccc',
        title: 'Add waveform visualization to player',
        ageDays: 1.2,
        turns: 22,
        userPrompt: "Add a waveform visualization to the audio player. Use wavesurfer.js if it's clean.",
      },
      {
        id: 'd4e5f6a7-4444-4555-9666-dddddddddddd',
        title: 'Refactor inbox query to avoid N+1',
        ageDays: 3.4,
        turns: 14,
        userPrompt: "The /inbox endpoint is doing N+1 queries when loading episode metadata. Let's preload it.",
      },
    ],
    memory: [
      {
        name: 'MEMORY.md',
        content: `# Memory Index

## Project
- [project_two_sided.md](project_two_sided.md) — Podcraft is two-sided: creators ship episodes, sponsors buy ads
- [project_split_payments.md](project_split_payments.md) — Platform fee model, Stripe Connect

## Feedback
- [feedback_no_inline_styles.md](feedback_no_inline_styles.md) — All styling via Tailwind, no inline style props
- [feedback_use_drizzle.md](feedback_use_drizzle.md) — Use Drizzle ORM, never raw SQL
`,
      },
      {
        name: 'feedback_no_inline_styles.md',
        content: `---
name: no_inline_styles
description: All styling via Tailwind, no inline style props.
type: feedback
---

All styling goes through Tailwind classes. Never use inline style props.

**Why:** Inline styles bypass the design tokens; refactor pain compounds.

**How to apply:** If you catch yourself writing \`style={{ color: 'red' }}\`, stop and use a Tailwind class.
`,
      },
      {
        name: 'feedback_use_drizzle.md',
        content: `---
name: use_drizzle
description: Use Drizzle ORM, never raw SQL.
type: feedback
---

All database access through Drizzle ORM. No raw SQL queries.

**Why:** Type safety, migration tooling, query reuse.

**How to apply:** Anything that touches the database goes through src/db/ helpers.
`,
      },
    ],
  },
  {
    slug: '-home-alice-code-monolith',
    decoded: '/home/alice/code/monolith',
    sessions: [
      {
        id: 'e5f6a7b8-5555-4666-9777-eeeeeeeeeeee',
        title: 'Investigate slow login on Safari',
        ageDays: 5.2,
        turns: 28,
        userPrompt: "Login is slow on Safari only. Chrome is instant. What gives?",
      },
      {
        id: 'f6a7b8c9-6666-4777-9888-ffffffffffff',
        title: 'Add OpenTelemetry traces to the worker',
        ageDays: 7.1,
        turns: 45,
        userPrompt: "I want OTel spans on the background worker. We're flying blind on job latency.",
      },
      {
        id: 'a7b8c9d0-7777-4888-9999-aaaaaaaaaaaa',
        title: 'Untitled session',
        ageDays: 9.5,
        turns: 6,
        userPrompt: "Quick: how do I check what's on port 5432?",
      },
    ],
    memory: [
      {
        name: 'MEMORY.md',
        content: `# Memory Index

## Feedback
- [feedback_postgres_first.md](feedback_postgres_first.md) — Always reach for Postgres before any other store
`,
      },
      {
        name: 'feedback_postgres_first.md',
        content: `---
name: postgres_first
description: Always reach for Postgres before any other store.
type: feedback
---

Default to Postgres for any new persistence need. Don't introduce Redis,
DynamoDB, or anything else without strong evidence Postgres can't do it.

**Why:** One database to operate, one backup story, one query language.
`,
      },
    ],
  },
];

const PLANS = [
  {
    slug: 'migrate-audio-uploads-to-r2',
    title: 'Migrate audio uploads from S3 to R2',
    body: `# Plan: Migrate audio uploads from S3 to R2

## Context

Egress costs on S3 are eating ~$340/mo. Cloudflare R2 has zero egress
fees and is otherwise compatible with the S3 API. Migration is mostly
plumbing.

## Steps

1. Provision R2 bucket and credentials.
2. Update upload service to write to both stores during cutover.
3. Backfill existing 12k files via async copy job.
4. Cut reads over to R2 with a feature flag.
5. Stop dual-writes after one week of green metrics.
`,
  },
  {
    slug: 'stripe-connect-payouts',
    title: 'Stripe Connect for sponsor payouts',
    body: `# Plan: Stripe Connect for sponsor payouts

## Context

Sponsors need to pay creators directly with us taking a 10% platform fee.
Stripe Connect Express is the right primitive.

## Steps

1. Connect onboarding for creators.
2. Payment intent split (creator, platform fee).
3. Webhook handling for refunds and disputes.
4. Tax form 1099-K generation.
`,
  },
  {
    slug: 'opentelemetry-worker-traces',
    title: 'OTel traces on the worker',
    body: `# Plan: OTel traces on the background worker

## Context

We have no visibility into worker job latency. P99 is anywhere from 200ms
to 40s and we don't know why.

## Steps

1. Add @opentelemetry/sdk-node bootstrap to worker entry.
2. Auto-instrument pg, ioredis, http.
3. Manually span the per-job handler.
4. Wire up Honeycomb exporter.
`,
  },
];

const SKILLS = [
  {
    slug: 'commit',
    body: `---
name: commit
description: Stage and commit changes with a well-formed message.
---

Create a git commit for the current changes.

## Steps

1. Run \`git status\` and \`git diff\` to understand what changed.
2. Stage relevant files by name.
3. Write a concise commit message: imperative, present tense.
4. Body explains why, not what.
`,
  },
  {
    slug: 'review',
    body: `---
name: review
description: Pre-landing PR review against the base branch.
---

Review the diff against main for SQL safety, error handling,
and structural issues. Surface concerns; don't auto-fix.
`,
  },
  {
    slug: 'ship',
    body: `---
name: ship
description: Ship workflow: tests, version bump, commit, push, PR.
---

Run tests, bump VERSION, update CHANGELOG, commit, push, create PR.
`,
  },
];

const PLUGINS = {
  version: 2,
  plugins: {
    'frontend-design@claude-plugins-official': [{
      scope: 'user',
      installPath: '/home/alice/.claude/plugins/cache/claude-plugins-official/frontend-design/unknown',
      version: 'unknown',
      installedAt: '2026-04-13T16:57:35.088Z',
      lastUpdated: '2026-04-14T19:49:32.704Z',
    }],
  },
};

// ---------------------------------------------------------------------------
// Synthetic JSONL session content
// ---------------------------------------------------------------------------
function turnPair(uuid, prevUuid, turnIndex, userPrompt, ts) {
  const userEvt = {
    parentUuid: prevUuid,
    isSidechain: false,
    type: 'user',
    message: { role: 'user', content: turnIndex === 0 ? userPrompt : `Continuing turn ${turnIndex}.` },
    uuid: uuid + '-u',
    timestamp: ts,
    sessionId: uuid.split('-').slice(0, 5).join('-'),
  };
  const inputTokens = Math.floor(Math.random() * 50) + 5;
  const cacheRead = Math.floor(Math.random() * 80000) + 20000;
  const cacheCreate = Math.floor(Math.random() * 12000) + 800;
  const outputTokens = Math.floor(Math.random() * 1500) + 200;
  const assistantText = turnIndex === 0
    ? `Working on it. Let me start by checking the current state of the codebase, then plan the change. ${userPrompt}`
    : `Step ${turnIndex} done. Moving on.`;
  const asstEvt = {
    parentUuid: userEvt.uuid,
    isSidechain: false,
    type: 'assistant',
    message: {
      model: 'claude-opus-4-7',
      content: [{ type: 'text', text: assistantText }],
      usage: {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cache_creation_input_tokens: cacheCreate,
        cache_read_input_tokens: cacheRead,
      },
    },
    uuid: uuid + '-a',
    timestamp: new Date(new Date(ts).getTime() + 8000).toISOString(),
    sessionId: userEvt.sessionId,
  };
  return [userEvt, asstEvt];
}

function buildSessionJSONL(session) {
  const startMs = Date.now() - session.ageDays * 86400_000;
  const lines = [];
  lines.push(JSON.stringify({ type: 'permission-mode', permissionMode: 'auto', sessionId: session.id }));
  lines.push(JSON.stringify({ type: 'ai-title', aiTitle: session.title, sessionId: session.id }));
  let prev = null;
  for (let i = 0; i < session.turns; i++) {
    const ts = new Date(startMs + i * 12000).toISOString();
    const uuid = `${session.id.slice(0, 8)}-${String(i).padStart(4, '0')}`;
    const [u, a] = turnPair(uuid, prev, i, session.userPrompt, ts);
    lines.push(JSON.stringify(u));
    lines.push(JSON.stringify(a));
    prev = a.uuid;
  }
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Wiki content (optional showcase of the Karpathy memex layer)
// ---------------------------------------------------------------------------
const WIKI = {
  'index.md': `# Wiki Index

## Entities
- [stripe](entities/stripe.md) — payments processor; using Connect for marketplace flows
- [cloudflare-r2](entities/cloudflare-r2.md) — S3-compatible object store with zero egress

## Concepts
- [two-sided-marketplace](concepts/two-sided-marketplace.md) — chicken-and-egg dynamics

## Sources
- [karpathy-llm-wiki-pattern](sources/karpathy-llm-wiki-pattern.md) — the foundational gist
`,
  'log.md': `# Wiki Log

Append-only chronology.

2026-04-09 ingest: stripe.md filed after Connect onboarding research.
2026-04-12 note: decided to migrate to R2 over S3 for cost reasons.
2026-04-15 ingest: karpathy-llm-wiki-pattern source page from gist.
`,
  'entities/stripe.md': `# Stripe

Payments processor. We use Connect Express for marketplace payouts.

## Why this matters

Sponsors pay creators through us; we keep a platform fee. Connect handles
the whole accounting story: KYC, 1099s, payouts, refunds, disputes.
`,
  'entities/cloudflare-r2.md': `# Cloudflare R2

S3-compatible object storage with zero egress fees.

## Why this matters

We were paying ~$340/mo in S3 egress alone. R2 is the same API surface
with no egress charges, just storage costs.
`,
  'concepts/two-sided-marketplace.md': `# Two-sided marketplace

A platform with two distinct user populations whose value to each other
grows with platform size.

## Chicken-and-egg dynamics

Creators won't show up without sponsors; sponsors won't show up without
creators. The classic answer is to seed one side first, ideally the harder
one (sponsors), then let the other side flow in.
`,
  'sources/karpathy-llm-wiki-pattern.md': `# Karpathy: LLM Wiki Pattern

**Source:** https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f

## Thesis

The LLM does the bookkeeping; the human does the curating. Wikis used to
fail because maintenance was tedious. With an LLM, maintenance is cheap.

## Three layers

1. Raw sources (immutable).
2. Wiki (LLM-generated).
3. Schema/config (human-edited, steers the LLM).
`,
};

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------
async function writeAll(target) {
  if (existsSync(target)) await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });

  // Instructions
  for (const [name, body] of Object.entries(INSTRUCTIONS)) {
    await writeFile(join(target, name), body);
  }

  // Projects + sessions + memory
  await mkdir(join(target, 'projects'), { recursive: true });
  for (const proj of PROJECTS) {
    const projDir = join(target, 'projects', proj.slug);
    await mkdir(projDir, { recursive: true });
    for (const session of proj.sessions) {
      const path = join(projDir, session.id + '.jsonl');
      await writeFile(path, buildSessionJSONL(session));
    }
    if (proj.memory && proj.memory.length > 0) {
      const memDir = join(projDir, 'memory');
      await mkdir(memDir, { recursive: true });
      for (const m of proj.memory) await writeFile(join(memDir, m.name), m.content);
    }
  }

  // Plans
  await mkdir(join(target, 'plans'), { recursive: true });
  for (const p of PLANS) await writeFile(join(target, 'plans', p.slug + '.md'), p.body);

  // Skills
  await mkdir(join(target, 'skills'), { recursive: true });
  for (const s of SKILLS) {
    const skillDir = join(target, 'skills', s.slug);
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, 'SKILL.md'), s.body);
  }

  // Plugins
  await mkdir(join(target, 'plugins'), { recursive: true });
  await writeFile(join(target, 'plugins', 'installed_plugins.json'), JSON.stringify(PLUGINS, null, 2));

  // Wiki
  await mkdir(join(target, 'wiki'), { recursive: true });
  for (const [path, body] of Object.entries(WIKI)) {
    const full = join(target, 'wiki', path);
    await mkdir(full.substring(0, full.lastIndexOf('/')), { recursive: true });
    await writeFile(full, body);
  }
}

await writeAll(TARGET);
console.log(`Seeded demo data at ${TARGET}`);
console.log(`Run: CLAUDE_HOME=${TARGET} node server.mjs`);
