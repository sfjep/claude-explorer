# claude-explorer

A local HTTP viewer for `~/.claude/`. Auto-discovers what's there, renders
only what exists, never assumes.

## Why

Claude Code stores a lot in your home directory that no current tool lets
you actually look at:

- **Per-project auto-memory**, the feedback files Claude has saved about
  how you work, scoped to each project you've used Claude Code in.
- **Session JSONL transcripts**, every conversation you've had, archived
  but readable only as raw JSON.
- **Plans** generated in plan mode, slowly accumulating in `~/.claude/plans/`.
- **Skills, plugins, instructions** you wrote or installed.

`claude-explorer` is a one-command browser for all of it. Local-only,
read-only, dark by default.

## Install and run

```
git clone <this repo>
cd claude-explorer
pnpm install   # or npm install
pnpm start
```

Open `http://localhost:4567`.

## Configuration

Zero config out of the box. For overrides, drop a
`claude-explorer.config.json` in your `$CLAUDE_HOME`:

```json
{
  "hide": ["sources/private/", "*-secret.md"],
  "label": {},
  "theme": "dark"
}
```

| Field   | Type         | Effect                                                      |
|---------|--------------|-------------------------------------------------------------|
| `hide`  | `string[]`   | Glob patterns added to the default-hide list                |
| `label` | `object`     | Reserved for future use (custom card labels)                |
| `theme` | `string`     | Reserved (`dark` is the only theme today)                   |

| Env var       | Default        | Effect                              |
|---------------|----------------|-------------------------------------|
| `CLAUDE_HOME` | `~/.claude`    | Root the server reads from          |
| `PORT`        | `4567`         | HTTP port (binds to `127.0.0.1`)    |

## What it shows

Tabs only appear if the corresponding content exists.

- **Instructions** — root `*.md` files in `$CLAUDE_HOME`. If `CLAUDE.md`
  uses `@imports`, the import graph is rendered as a tree.
- **Projects** — one row per project under `~/.claude/projects/`. Click
  through to see auto-memory entries and a list of session JSONLs;
  click a session to render the transcript as readable threads (user /
  assistant / tool calls / thinking blocks).
- **Skills** — every `SKILL.md` under `~/.claude/skills/` (including
  nested skill collections).
- **Plans** — every `*.md` under `~/.claude/plans/`, sorted by recency,
  with previews.
- **Plugins** — installed plugins from `plugins/installed_plugins.json`.
- **Wiki** — only if you have a `~/.claude/wiki/` directory. Renders
  whatever section subdirectories you've made (entities, concepts,
  sources, synthesis, etc.) plus `index.md` and `log.md`. Inspired by
  Karpathy's LLM wiki pattern:
  https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f

## Privacy

The server binds `127.0.0.1` only. It is not reachable from your network
without explicit reconfiguration.

Defaults hide credentials and noise (caches, telemetry, internals) so they
don't clutter the UI: `.credentials*`, `*.bak`, plus the `cache/`,
`debug/`, `telemetry/`, `shell-snapshots/`, `paste-cache/`, `session-env/`,
`downloads/`, `file-history/`, `backups/` directories. Personal markdown
files like USER.md are *not* hidden by default; this tool is single-user,
and you wrote them for yourself.

Add more patterns via the config file's `hide` field if you want.

A `?view=safe` query string toggles a "safe view" badge in the topbar,
intended as a future hook for screen-share scenarios where you want to
hide additional content.

## What's not here yet (v0.2)

- Search across content
- Live reload (file watcher)
- Light theme
- Single-command install via `npx`
- VS Code extension wrapper

PRs welcome.

## License

MIT. See `LICENSE`.
