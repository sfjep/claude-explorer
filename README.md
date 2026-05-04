# claude-explorer

**The dashboard Claude Code doesn't ship with.** Read every session
transcript you've ever recorded. See what Claude has remembered about each
of your projects. Watch your token spend per session, per project, in
total. Locally, in one tab.

![claude-explorer overview](./media/hero.gif)

## Try it without your real data

```
git clone git@github.com:sfjep/claude-explorer.git
cd claude-explorer
pnpm install
pnpm demo
```

Open `http://localhost:4567`. You'll see a fully-populated demo: two fake
projects with realistic session transcripts, token totals, auto-memory,
plans, skills, plugins, and a Karpathy-style wiki. Nothing in your real
`~/.claude/` is touched.

To run against your actual home directory:

```
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

## Recording demos

`pnpm record` produces a hero GIF/WebM by driving the demo through
Playwright. Reproducible, no manual cursor jitter, no exposing real data.

```
pnpm install                          # pulls playwright as a dev dep
pnpm exec playwright install chromium # one-time browser download
sudo apt install ffmpeg               # (or brew/etc.) optional, needed for GIF
pnpm record
```

Output:

- `media/hero.webm` (always)
- `media/hero.gif` (only if ffmpeg is on PATH)

The script seeds the dummy `~/.claude/`, boots the server pointed at it,
opens a 1280x800 headless Chromium, navigates Home → Sessions → first
session → scroll → Projects → first project, captures ~7 seconds, then
converts to a 12fps 1024px-wide palette-optimized GIF.

To embed the GIF in this README, uncomment the line near the top of the
file once `media/hero.gif` exists:

```
![claude-explorer overview](./media/hero.gif)
```

Aim for **under 5 MB** so it loads fast on GitHub. If you blow that
budget after a UI change, drop framerate to 10fps or width to 900px in
`scripts/record.mjs`.

If you'd rather record manually (e.g. to capture cursor movement), the
fallback is any screen recorder against `pnpm demo` running on
`http://localhost:4567`. ScreenToGif (Windows) or QuickTime + ffmpeg
(macOS) both work.

## What's not here yet

- Search across content
- Live reload (file watcher)
- Light theme
- Single-command install via `npx`
- VS Code extension wrapper

PRs welcome.

## License

MIT. See `LICENSE`.
