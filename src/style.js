// All CSS lives here as a single string. Imported once by view.js and
// inlined into the layout shell.
export const CSS = `
:root {
  --bg: #0d0d0c;
  --bg-soft: #131312;
  --bg-sidebar: #0a0a09;
  --bg-raised: #1a1a18;
  --border: #222220;
  --border-soft: #1a1a18;
  --text: #e6e5dd;
  --text-muted: #8a8a82;
  --text-dim: #5a5a54;
  --heading: #ffffff;
  --link: #b8a8ff;
  --link-hover: #d4c8ff;
  --accent: #b8a8ff;
  --code-bg: #1a1a18;
  --selection: #2a2440;
  --user-tint: #1a1f2a;
  --asst-tint: #1c1a22;
  --tool-tint: #14110d;
}
* { box-sizing: border-box; }
::selection { background: var(--selection); }
html, body { margin: 0; padding: 0; }
body {
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, "Inter", "SF Pro Text", system-ui, sans-serif;
  font-size: 15px;
  line-height: 1.7;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
a { color: var(--link); text-decoration: none; }
a:hover { color: var(--link-hover); }

.topbar {
  position: sticky; top: 0; z-index: 10;
  background: rgba(13, 13, 12, 0.85);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--border);
  padding: 0 2rem;
  height: 56px;
  display: flex;
  align-items: center;
  gap: 2rem;
}
.topbar .brand {
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 0.8rem;
  color: var(--text-muted);
  letter-spacing: 0.02em;
}
.topbar .brand a { color: var(--text-muted); }
.topbar .brand a:hover { color: var(--text); }
.topbar nav { display: flex; gap: 1.5rem; flex: 1; }
.topbar nav a {
  color: var(--text-muted);
  font-size: 0.875rem;
  font-weight: 500;
  padding: 0.25rem 0;
  border-bottom: 1.5px solid transparent;
  transition: color 120ms, border-color 120ms;
}
.topbar nav a:hover { color: var(--text); }
.topbar nav a.active { color: var(--heading); border-bottom-color: var(--accent); }
.topbar .privacy {
  font-size: 0.75rem;
  color: var(--text-muted);
  padding: 0.2rem 0.6rem;
  border: 1px solid var(--border);
  border-radius: 999px;
}

.layout { display: grid; grid-template-columns: 240px 1fr; min-height: calc(100vh - 56px); }
.layout--full { grid-template-columns: 1fr; }
@media (max-width: 800px) {
  .layout { grid-template-columns: 1fr; }
  .sidebar { display: none; }
}

.sidebar {
  background: var(--bg-sidebar);
  border-right: 1px solid var(--border);
  padding: 2rem 1rem 4rem 1.5rem;
  position: sticky;
  top: 56px;
  align-self: start;
  max-height: calc(100vh - 56px);
  overflow-y: auto;
  font-size: 0.875rem;
}
.sidebar h3 {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--text-dim);
  font-weight: 600;
  margin: 1.25rem 0 0.5rem 0.5rem;
}
.sidebar h3:first-child { margin-top: 0; }
.sidebar ul { list-style: none; padding: 0; margin: 0; }
.sidebar li a {
  display: block;
  padding: 0.3rem 0.5rem;
  border-radius: 5px;
  color: var(--text-muted);
  margin-left: -0.25rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sidebar li a:hover { background: var(--bg-raised); color: var(--text); }
.sidebar li a.active { background: var(--bg-raised); color: var(--heading); }

main { padding: 3.5rem 4rem; max-width: 760px; width: 100%; }
main.wide { max-width: 1320px; padding: 3.5rem 5rem; }
@media (max-width: 1100px) { main, main.wide { padding: 2.5rem 2rem; } }

main h1, main h2, main h3, main h4 {
  color: var(--heading);
  font-weight: 600;
  letter-spacing: -0.01em;
  line-height: 1.3;
}
main h1 { font-size: 1.875rem; margin: 0 0 1.25rem; letter-spacing: -0.02em; }
main h2 { font-size: 1.25rem; margin-top: 2.5rem; }
main h3 { font-size: 1.0625rem; margin-top: 2rem; }
main h4 { font-size: 0.95rem; margin-top: 1.5rem; }
main p { margin: 0 0 1rem; }
main ul, main ol { padding-left: 1.5rem; margin: 0 0 1rem; }
main li { margin-bottom: 0.25rem; }
main code {
  background: var(--code-bg);
  border: 1px solid var(--border-soft);
  padding: 0.1rem 0.4rem;
  border-radius: 4px;
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 0.85em;
}
main pre {
  background: var(--code-bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 1rem 1.25rem;
  overflow-x: auto;
  font-size: 0.85em;
  line-height: 1.55;
}
main pre code { background: none; border: 0; padding: 0; }
main blockquote {
  border-left: 2px solid var(--accent);
  padding: 0.25rem 0 0.25rem 1.25rem;
  margin: 1rem 0;
  color: var(--text-muted);
}
main hr { border: 0; border-top: 1px solid var(--border); margin: 2.5rem 0; }
main table { border-collapse: collapse; margin: 1.25rem 0; font-size: 0.9rem; }
main th, main td {
  border: 1px solid var(--border);
  padding: 0.5rem 0.85rem;
  text-align: left;
}
main th { background: var(--bg-soft); color: var(--heading); font-weight: 600; }

.crumb {
  font-size: 0.8rem;
  color: var(--text-dim);
  margin-bottom: 1rem;
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
}
.crumb a { color: var(--text-muted); }

.hero { margin: 0.5rem 0 3rem; max-width: 720px; }
.hero h1 { font-size: 2.5rem; letter-spacing: -0.025em; margin: 0 0 0.75rem; font-family: ui-monospace, "SF Mono", Menlo, monospace; font-weight: 600; }
.hero p { color: var(--text-muted); font-size: 1.0625rem; line-height: 1.6; margin: 0; }

section.row { margin-bottom: 3rem; }
.row__head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 1rem; }
.row__head h2 { margin: 0; font-size: 0.85rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.12em; color: var(--text-muted); }
.row__more { font-size: 0.8rem; color: var(--text-dim); }
.row__more:hover { color: var(--text); }

.card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 0.875rem; }
.card {
  background: var(--bg-soft);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 1.1rem 1.25rem;
  transition: border-color 120ms, transform 120ms, background 120ms;
  display: block;
  color: inherit;
}
.card:hover { border-color: var(--accent); transform: translateY(-1px); background: var(--bg-raised); color: inherit; }
.card h4 { color: var(--heading); margin: 0 0 0.35rem; font-size: 0.95rem; font-weight: 600; }
.card p { color: var(--text-muted); font-size: 0.85rem; margin: 0; line-height: 1.55; }
.card .meta { color: var(--text-dim); font-size: 0.75rem; margin-top: 0.6rem; font-family: ui-monospace, monospace; }

.import-tree { background: var(--bg-soft); border: 1px solid var(--border); border-radius: 10px; padding: 1rem 1.25rem; margin: 1rem 0 2rem; font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 0.85rem; }
.import-tree ul { list-style: none; padding-left: 1.25rem; margin: 0.25rem 0; }
.import-tree li { padding: 0.1rem 0; }
.import-tree li:before { content: "\\2514 "; color: var(--text-dim); }

table.list { width: 100%; border-collapse: collapse; margin-top: 1rem; }
table.list th, table.list td { padding: 0.6rem 0.75rem; border-bottom: 1px solid var(--border-soft); text-align: left; font-size: 0.875rem; }
table.list th { color: var(--text-dim); font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.08em; font-weight: 600; }
table.list td { color: var(--text); }
table.list tr:hover td { background: var(--bg-soft); }
table.list .num { font-family: ui-monospace, monospace; color: var(--text-muted); text-align: right; }
table.list .when { font-family: ui-monospace, monospace; color: var(--text-dim); white-space: nowrap; }

/* Session viewer */
.session-meta { background: var(--bg-soft); border: 1px solid var(--border); border-radius: 10px; padding: 0.85rem 1.1rem; margin: 1rem 0 1.5rem; font-size: 0.85rem; color: var(--text-muted); display: flex; gap: 1.5rem; flex-wrap: wrap; }
.session-meta strong { color: var(--text); font-weight: 600; }
.session-truncate { background: var(--bg-soft); border: 1px solid var(--border); border-radius: 8px; padding: 0.6rem 1rem; margin-bottom: 1rem; font-size: 0.85rem; color: var(--text-muted); }

.usage-card { background: var(--bg-soft); border: 1px solid var(--border); border-radius: 10px; padding: 1rem 1.25rem; margin: 0 0 1.5rem; }
.usage-card__head { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-dim); font-weight: 600; margin-bottom: 0.85rem; display: flex; justify-content: space-between; align-items: baseline; }
.usage-card__model { color: var(--text-muted); font-family: ui-monospace, monospace; text-transform: none; letter-spacing: 0; font-weight: 500; font-size: 0.75rem; }
.usage-card__grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 1rem; }
.usage-card__label { font-size: 0.7rem; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 0.2rem; }
.usage-card__num { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 1.15rem; color: var(--heading); font-weight: 500; }

.evt { margin: 0.85rem 0; padding: 0.85rem 1.1rem; border-radius: 10px; border: 1px solid var(--border-soft); position: relative; }
.evt--user { background: var(--user-tint); border-color: rgba(184, 168, 255, 0.12); }
.evt--assistant { background: var(--asst-tint); border-color: rgba(184, 168, 255, 0.18); }
.evt--system { background: var(--bg-soft); }
.evt--tool-use, .evt--tool-result, .evt--thinking { background: var(--tool-tint); padding: 0.5rem 0.85rem; }
.evt__role { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-muted); margin-bottom: 0.25rem; font-weight: 600; }
.evt__meta { font-size: 0.7rem; color: var(--text-dim); position: absolute; right: 1rem; top: 0.85rem; font-family: ui-monospace, monospace; }
.evt__body { color: var(--text); }
.evt__body p:first-child { margin-top: 0; }
.evt__body p:last-child { margin-bottom: 0; }
.evt__tag { font-family: ui-monospace, monospace; font-size: 0.75rem; color: var(--text-dim); }
details.evt summary { cursor: pointer; font-size: 0.8rem; color: var(--text-muted); }
details.evt summary:hover { color: var(--text); }
details.evt[open] summary { margin-bottom: 0.5rem; }
details.evt pre { font-size: 0.8em; }
`;
