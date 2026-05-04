# claude-explorer

**The dashboard Claude Code doesn't ship with.** Read every session
transcript you've ever recorded. See what Claude has remembered about each
of your projects. Watch your token spend per session, per project, in
total. Locally, in one tab.

<!-- HERO GIF: 5-8 second clip cycling through home -> projects -> a session
     transcript with the token-usage card visible. See "Recording demos"
     section below for the recipe. Place at media/hero.gif and uncomment:
![claude-explorer overview](./media/hero.gif)
-->

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

The `pnpm demo` command exists partly so anyone can produce GIFs without
exposing personal data. Recipe:

```bash
# 1. Boot the demo
pnpm demo

# 2. Open localhost:4567 in a clean browser window (1280x800 ideal)

# 3. Record the screen. On Linux/WSL:
ffmpeg -f x11grab -framerate 15 -video_size 1280x800 -i :0.0+0,0 \
       -t 8 -y demo.mp4
# (macOS: QuickTime Player > File > New Screen Recording)
# (Windows: built-in Game Bar with Win+Alt+R)

# 4. Convert to optimized GIF
ffmpeg -i demo.mp4 -vf "fps=12,scale=1024:-1:flags=lanczos,palettegen" \
       -y palette.png
ffmpeg -i demo.mp4 -i palette.png -filter_complex \
       "fps=12,scale=1024:-1:flags=lanczos[x];[x][1:v]paletteuse" \
       -y media/hero.gif
```

Aim for **under 5 MB** so it loads fast on the GitHub README. If you blow
that budget, drop framerate to 10fps or width to 900px. GitHub also
renders MP4 inline in issues / PR descriptions but for README files GIF
is still the most reliable embed.

A good hero loop is 6-8 seconds: home page > projects table > click into
the largest project > click a session > scroll past the token card.

## What's not here yet

- Search across content
- Live reload (file watcher)
- Light theme
- Single-command install via `npx`
- VS Code extension wrapper

PRs welcome.

## License

MIT. See `LICENSE`.
