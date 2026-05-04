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

Not a system prompt. A constitution. This is who you are when you work
with me. Conflicts with polite defaults, this wins.

## Voice

**Brevity is mandatory.** A clear sentence beats a clear paragraph.
A clear word beats a clear sentence. If you can cut it without losing
meaning, cut it.

**Never open with sycophancy.** Banned openers: "Great question",
"Absolutely!", "I'd be happy to...", "What a fascinating...". Start
with the answer.

**No throat-clearing.** Don't tell me what you're about to do, then do
it, then summarize what you just did. The diff is the proof.

**No em-dashes.** Use commas, periods, parentheses.

## Values

**Disagreement is a feature.** If I'm about to ship something bad, say
so and say why. "You sure?" is not pushback. "This breaks under X" is.

**Root cause or nothing.** No fixes that paper over symptoms. If a test
fails, don't delete the test. If a hook blocks, don't \`--no-verify\`.

**Don't perform competence. Have it.** Don't list considerations to seem
thorough. State the thing. If you're uncertain, say "I don't know."

## What good output looks like

- The answer arrives in the first sentence.
- The work is done, not described.
- Non-obvious choices get one explanatory line.
- New abstractions appear only when they pay rent.

## What bad output looks like

- "Great question! Let me break this down for you."
- A six-bullet "summary of what I just did" at the end of every turn.
- Defensive try/catch around code that can't throw.
- Apologizing instead of fixing.
`,
  'USER.md': `# USER.md

A working model of Alice at work.

## How Alice thinks

Build, measure, learn. First principles. Break problems into small
items, ship fast iterations. Both fast/loose and rigorous: fast/loose
on features when the patterns are sound; rigorous on the patterns
themselves.

## What she's building

**Podcraft.** Two-sided marketplace for indie podcasters and ad
sponsors. Stripe Connect for payouts, Cloudflare R2 for audio, custom
waveform player. The bet for the next 12 months.

**Monolith.** Shared Rails core (auth, billing, uploads) that Podcraft
and three other internal tools sit on top of. Quiet, boring, load-
bearing.

## Strengths

- Product taste; knows what good looks like
- Moves fast with vision; speed without losing direction
- Strategy and market positioning

## Blind spots

- Empire building. Wants Podcraft to be too much at once.
- Skipped refactors when chasing an MVP.
- Test-driven development; aspires to it more than practices it.

## Triggers

- Sycophancy. "You're absolutely right" said reflexively.
- Consultant speak. "Leverage scalable value across key verticals."
- Negativity without a why.

## What energizes her

- "Have you thought about whether X improves the product?"
- "Linear does this by Y; you can differentiate by Z."
- Direct disagreement with data behind it.
`,
  'AGENTS.md': `# AGENTS.md

Operational playbook. Voice lives in SOUL.md, the model of Alice lives
in USER.md, this file is procedure.

## On every message

1. SOUL.md, USER.md, AGENTS.md are loaded via CLAUDE.md @imports.
2. If Alice mentions a project, check the current repo's docs before
   assuming.
3. Verify before recommending. Memory is a hypothesis, not a fact.

## Lookup chain

When looking up X, try in this order:

1. The current repo's own docs (\`docs/\`, \`CLAUDE.md\`, \`README.md\`).
2. \`~/.claude/wiki/\` for cross-project synthesis.
3. \`~/.claude/projects/<encoded-path>/memory/\` for conversation facts.
4. Source code. Grep first.
5. The web. Last resort.

## Never-do list

- **No force push** to any branch. Never to \`main\`.
- **No \`--no-verify\`** on commits. If a hook fails, fix the cause.
- **No \`git reset --hard\`** without confirming.
- **No co-author trailers** on commits.
- **No em-dashes** in any prose, comment, doc, or chat output.
- **No emoji** in files unless asked.
- **No silent constitutional edits.** SOUL.md, USER.md, AGENTS.md
  change only on explicit request.

## Failure handling

- Tool fails: report the actual error in one line. Don't retry blindly.
- Memory contradicts reality: trust reality. Update or delete the stale
  entry.
- Stuck after two real attempts: say what you tried, what failed, and
  what you'd try next. Ask before grinding.
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
        // Intentionally no ai-title: exercises the "first user message"
        // fallback that real, short Claude Code sessions rely on.
        id: 'a7b8c9d0-7777-4888-9999-aaaaaaaaaaaa',
        title: null,
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
  if (session.title) {
    lines.push(JSON.stringify({ type: 'ai-title', aiTitle: session.title, sessionId: session.id }));
  }
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

Catalog of pages. One-line summaries, organized by category. Updated on
every \`/ingest\` and on every new page filing.

## Projects (first-class anchor entities)

- [podcraft](projects/podcraft.md) — two-sided podcast/sponsor marketplace; Stripe Connect, R2 audio, waveform player
- [monolith](projects/monolith.md) — shared Rails core: auth, billing, uploads; powers Podcraft and three others

## Entities (people, companies, tools)

- [stripe](entities/stripe.md) — payments processor; Connect for marketplace flows
- [cloudflare-r2](entities/cloudflare-r2.md) — S3-compatible object store with zero egress
- [karpathy](entities/karpathy.md) — author of the LLM wiki/Memex pattern

## Concepts (ideas, frameworks, patterns)

- [two-sided-marketplace](concepts/two-sided-marketplace.md) — chicken-and-egg dynamics
- [boring-tech](concepts/boring-tech.md) — choose tools by predictability, not novelty

## Sources (ingested articles, threads)

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

## How this setup uses the pattern

- \`wiki/projects/\` — first-class anchor pages for each active bet
- \`wiki/entities/\` — people, companies, tools
- \`wiki/concepts/\` — frameworks, mental models, patterns
- \`wiki/sources/\` — ingested articles, papers, threads
- \`wiki/synthesis/\` — cross-cutting essays
- \`wiki/index.md\` — catalog
- \`wiki/log.md\` — append-only chronology
`,
  'entities/karpathy.md': `# Andrej Karpathy

ML researcher. Author of the LLM Wiki Pattern that grounds this wiki's
architecture.

## Why he's in this wiki

- Source of the three-layer wiki/Memex system. See
  [karpathy-llm-wiki-pattern](../sources/karpathy-llm-wiki-pattern.md).
- The pattern's claim — that LLMs make the bookkeeping cost of a
  personal knowledge graph finally tractable — is the load-bearing
  assumption behind the whole \`wiki/\` directory existing.
`,
  'concepts/boring-tech.md': `# Boring tech

The principle of choosing tools by predictability rather than novelty.
Coined as a phrase by Dan McKinley in *Choose Boring Technology* (2015).

## Why this matters

Every novel dependency adds operational surface area: a new failure
mode, a new monitoring story, a new pager rotation, a new on-call
runbook. Boring tech amortizes those costs across decades of community
operation. Postgres has thirty years of bug reports filed and fixed;
your shiny new database has six months.

## How it shows up here

- Postgres-first for any new persistence need
- Sidekiq over Redis Streams or Kafka for background work
- Vanilla server-rendered HTML before reaching for a SPA framework
`,
  'projects/podcraft.md': `# Podcraft

**Repo:** \`~/code/podcraft\`
**State:** alpha, ~12 paying creators
**Last touched:** today

---

## Elevator pitch

A two-sided marketplace for indie podcasters and their ad sponsors.
Creators publish episodes and a media kit; sponsors filter, book, and
pay through Stripe Connect. Platform takes a 10% fee.

## Problem, for whom

Indie podcasters can't sell ads at scale: every potential sponsor wants
a custom CPM negotiation, a custom audience pitch, a custom contract.
Time goes to selling, not making episodes. Sponsors face the inverse,
vetting hundreds of small shows manually.

## Current state

- **Stripe Connect** wired up for split payouts (10% platform fee)
- **R2 migration** in flight; cuts $340/mo of S3 egress
- **Waveform player** shipped last week (Wavesurfer.js)
- **Inbox N+1** flagged, fix queued

## Active bets

- Waveform-first listening UX; engagement signal richer than vanilla
  audio players
- 1099-K generation in-house; avoids a Stripe Express upgrade fee
- Episode-level rather than feed-level ad targeting

## Competitors / adjacent

- **Buzzsprout, Libsyn** — hosting only, no marketplace
- **Adopter, Podcorn** — marketplace, but creator-vetting heavy
- **Direct sponsor sales** — what most indie creators do today (slow,
  manual, single-deal)

## Open strategic questions

- Are 200 active creators and 50 sponsors enough for two-sided
  liquidity, or do we need 10x that?
- Do we expand to YouTube creators (different risk: bigger players,
  AdSense competition) or stay podcast-pure?

## Synthesis with other projects

[monolith](monolith.md) shares the auth and billing layer; could be
extracted to its own service if Podcraft scale demands it.
`,
  'projects/monolith.md': `# Monolith

**Repo:** \`~/code/monolith\`
**State:** in production, 4 years old
**Last touched:** ~5 days ago

---

## Elevator pitch

The shared Rails core that powers Podcraft and a handful of internal
tools. Auth, billing, file uploads, audit log, admin dashboard. Quiet,
boring, load-bearing.

## Problem, for whom

Internal: every product Alice ships needs the same plumbing — auth,
billing, file uploads. Building it three times would waste weeks. The
monolith is the answer: every product is a thin app on top of it.

External: not visible to end users. Pure infra.

## Current state

- Rails 7.2, Postgres, Sidekiq, Redis
- 4 active products on top
- ~140k LoC, ~1,200 test cases
- p99 worker latency 200ms-40s; OTel tracing in flight to find out why
- Safari login regression open since Tuesday

## Active bets

- **OpenTelemetry** for the background worker; current visibility into
  job latency is zero
- **[Postgres-first](../concepts/boring-tech.md)** for any new data:
  resist Redis, DynamoDB, anything else without strong evidence Postgres
  can't do it
- Boring tech: tools chosen by predictability, not novelty

## Open strategic questions

- Should the auth + billing layer be extracted into its own service so
  Podcraft can be a separate deployment?
- Migrate Sidekiq to Solid Queue now that Rails 8 is out, or defer
  until forced?

## Synthesis with other projects

Powers [podcraft](podcraft.md) and three internal tools. Auth and
billing are the most reused; uploads is podcast-specific in practice.
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
