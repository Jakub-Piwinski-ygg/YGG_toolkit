---
type: meta
title: Agent Skills
updated: 2026-06-14
source: SKILLS.md
tags: [meta, skills, claude-code]
---

# Agent Skills (Claude Code)

> [!info] Canonical source
> Full research notes: [`SKILLS.md`](../../SKILLS.md). Marketplace:
> https://skills.sh/ · search `npx skills find <query>` · update `npx skills update`.

9 skills installed globally at `~\.agents\skills\` (active every session, all passed
security scans at install).

| # | Skill | Benefit here |
|---|---|---|
| 1 | `vercel-react-best-practices` | Keep the [[React App]] rewrite idiomatic — render perf, memoization around the [[Runner Registry Pattern]]. |
| 2 | `frontend-design` (Anthropic) | Biggest lever for "look very good" — shell restyle, `tokens.css` identity. |
| 3 | `web-design-guidelines` (Vercel) | UI audit punch-list — accessibility, focus, interaction states (P2 in [[Tool Review]]). |
| 4 | `framer-motion` | Level up motion across all tools without jank. |
| 5 | `ui-ux-designer` | Structural UX — category tabs, output-promotion flow, browser nav. |
| 6 | `designing-beautiful-websites` | Second-opinion visual direction vs #2. |
| 7 | `image-manipulation-image-magick` | Almost every art tool is a Magick pipeline — get CLI args right. |
| 8 | `image-processing` (Pillow) | Idea source for new tools (trim, slice, palette, optimize). |
| 9 | `web-performance-optimization` | WASM CDN load, lazy thumbs, lean Vite bundle. |

## Obsidian skills used to build this vault

- `obsidian-markdown` (wikilinks, callouts, properties) · `obsidian-bases` ([[Tools]])
  · `json-canvas` (Toolkit Map) · `obsidian-cli` (optional validation).

## Recommended additions (found via `find-skills`, 2026-06-14)

- **`mattpocock/skills@obsidian-vault`** (39.9K installs) — vault *organization*
  (MOCs, taxonomy, note atomicity). The structural complement to the kepano syntax skills.
- `addyosmani/agent-skills@documentation-and-adrs` (5.7K) — ADR format for design decisions.

## Built-in skills worth using

`/code-review` · `/simplify` · `/verify` · `/run`.
