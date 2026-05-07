# claude-viewer

**The dashboard Claude Code doesn't ship with.** Read every session
transcript you've ever recorded. See what Claude has remembered about each
of your projects. Watch your token spend per session, per project, in
total. Locally, in one tab.

![claude-viewer overview](./media/hero.gif)

## Run

```
npx claude-viewer
```

Open `http://localhost:4567`. The server reads from `~/.claude/`, renders
only what's there, never writes.

To hack on it locally:

```
git clone git@github.com:sfjep/claude-viewer.git
cd claude-viewer
pnpm install   # or npm install
pnpm start
```

## What you actually get

Every tab appears only if the corresponding content exists.

- **Sessions.** Every JSONL transcript, across every project, sorted by
  most recent. Click into one to see the full conversation rendered as
  alternating user / assistant blocks with collapsible tool calls and
  thinking. A token-usage card at the top: turns, input, output, cache
  read, cache write, total in. Multi-megabyte transcripts stream so the
  page never crashes on your longest sessions.
- **Projects.** One row per project, with aggregate token totals across
  every session in that project. Drill in to see auto-memory feedback
  files and the per-project session list.
- **Instructions.** Root `*.md` files in `$CLAUDE_HOME`. If your
  `CLAUDE.md` uses `@imports`, the import graph renders as a tree, so
  you can see exactly what's being loaded into every Claude Code
  session.
- **Skills.** Every `SKILL.md` you've written or installed.
- **Plans.** Plan-mode artifacts under `~/.claude/plans/`.
- **Plugins.** Installed Claude Code plugins.
- **Wiki.** Only if you have a `~/.claude/wiki/` directory. Renders
  whatever section subdirectories you've made (entities, concepts,
  sources, synthesis). Inspired by Karpathy's LLM Memex pattern:
  https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f

## Configuration

Zero config out of the box. For overrides, drop a
`claude-viewer.config.json` in your `$CLAUDE_HOME`:

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

## Privacy

The server binds `127.0.0.1` only. Not reachable from your network without
explicit reconfiguration.

Defaults hide credentials and noise (caches, telemetry, internals):
`.credentials*`, `*.bak`, plus the `cache/`, `debug/`, `telemetry/`,
`shell-snapshots/`, `paste-cache/`, `session-env/`, `downloads/`,
`file-history/`, `backups/` directories. Personal markdown files like
USER.md are *not* hidden by default; this tool is single-user, and you
wrote them for yourself.

Add more patterns via the config file's `hide` field if you want extra
hidden.

## What's not here yet

- Search across content
- Live reload (file watcher)
- Light theme
- Single-command install via `npx`
- VS Code extension wrapper

PRs welcome.

## License

MIT. See `LICENSE`.
