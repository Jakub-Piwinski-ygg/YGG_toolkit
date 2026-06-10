# Agent Skills — research session notes (2026-06-10)

Record of a Claude Code skill-discovery session run for this repo. Goal: find
skills that help (a) rewrite/port the toolkit's tools, (b) make the code work
better and be coded better, (c) make the website look very good with strong
UI/UX, and (d) inspire new tools.

All 9 skills below are **installed globally** at `~\.agents\skills\` (symlinked
into Claude Code), so they are active in every Claude Code session on this
machine — nothing extra to do per-project. All passed security scans
(Gen: Safe, Socket: 0 alerts) at install time.

Skills marketplace: https://skills.sh/ · search via `npx skills find <query>` ·
update all via `npx skills update`.

---

## Installed skills and how they benefit this repo

### 1. `vercel-react-best-practices`
- **Source**: `vercel-labs/agent-skills@vercel-react-best-practices` (official Vercel, ~185K installs)
- **What**: React/Next.js performance and architecture guidelines from Vercel Engineering. Auto-triggers when writing, reviewing, or refactoring React code.
- **Benefit here**: Keeps the `react-app/` rewrite idiomatic as tools get reworked — render performance in heavy components (`SlotMachineTool`, `ResultsGrid`), correct memoization around the runner-registry pattern, avoiding unnecessary re-renders when settings state syncs via refs.

### 2. `frontend-design` (Anthropic)
- **Source**: `anthropics/skills@frontend-design` (official Anthropic, 100K+ installs)
- **What**: Guidance for distinctive, intentional visual design — aesthetic direction, typography, color systems, avoiding "templated default" looks.
- **Benefit here**: The single biggest lever for "make the website look very good." Applies when restyling the shell (Header/Sidebar/ToolPanel), defining a stronger identity in `styles/tokens.css`, and designing backlog UI (lightbox, category tabs) so the toolkit feels like a designed product, not a dev utility.

### 3. `web-design-guidelines` (Vercel)
- **Source**: `vercel-labs/agent-skills@web-design-guidelines` (official Vercel, 100K+ installs)
- **What**: Audit-style skill — reviews UI code against Web Interface Guidelines (accessibility, interaction states, focus handling, layout). Invoke explicitly: *"review my UI"*, *"check accessibility"*, *"audit design"*.
- **Benefit here**: Run it across `react-app/src/components/` to get a concrete punch-list: keyboard navigation in ToolTabs/FileList, focus traps for a future lightbox, hover/active/disabled states on RUN/CLEAR, drag-and-drop affordances in Dropzone.

### 4. `framer-motion`
- **Source**: `mindrally/skills@framer-motion` (~1K installs)
- **What**: Expert patterns for performant Framer Motion animations in React.
- **Benefit here**: The app already uses Framer Motion (tab switches, card reveals, button taps). This skill helps level up motion across all 13 tools without jank — proper `AnimatePresence` exit handling, layout animations for the ResultsGrid, spring tuning, and avoiding animation-triggered re-renders during WASM-heavy runs.

### 5. `ui-ux-designer`
- **Source**: `sickn33/antigravity-awesome-skills@ui-ux-designer` (~1.7K installs)
- **What**: UX-designer role skill — user flows, information architecture, wireframes, design systems, accessibility heuristics.
- **Benefit here**: Most useful for structural UX questions in the backlog: the Art Tools vs Content Browser category-tab split, the "promote output to working dir" chained-workflow flow, and Content Browser navigation (breadcrumbs, search, send-to-tools).

### 6. `designing-beautiful-websites`
- **Source**: `tristanmanchester/agent-skills@designing-beautiful-websites` (~1.6K installs)
- **What**: Opinionated visual-design guidance — palettes, depth, texture, polish. Overlaps with `frontend-design`; treat as a second opinion.
- **Benefit here**: Alternative aesthetic direction when restyling; useful to compare against the Anthropic skill's output before committing to a visual refresh.

### 7. `image-manipulation-image-magick`
- **Source**: `github/awesome-copilot@image-manipulation-image-magick` (official GitHub repo, ~9.1K installs)
- **What**: ImageMagick operations knowledge — resizing, conversion, batch processing, metadata.
- **Benefit here**: Almost every art tool is an ImageMagick WASM pipeline (Blur, Gaussian Blur, Scaler, Gradient Map, Outline, RGBA combiner). Helps get CLI arguments and multi-step pipelines right when rewriting tools, and reduces trial-and-error against the `wasm-imagemagick` API.

### 8. `image-processing`
- **Source**: `jezweb/claude-skills@image-processing` (~1.8K installs)
- **What**: General web-image workflows (resize, crop, trim, format conversion, optimization, thumbnails) using Pillow.
- **Benefit here**: Mainly an **idea source for new tools**: trim-whitespace, sprite-sheet slicing, palette extraction, batch optimization, OG-image generation are all candidates for future `ART_TOOLS` entries. Also handy for one-off local image tasks during development.

### 9. `web-performance-optimization`
- **Source**: `sickn33/antigravity-awesome-skills@web-performance-optimization` (~2.2K installs)
- **What**: Loading speed, Core Web Vitals, bundle size, caching, runtime performance.
- **Benefit here**: Targets the toolkit's heavy spots — CDN-loaded WASM (2+ MB), the Slot Machine blur precompute, lazy thumbnail loading in Content Browser, and keeping the Vite bundle lean for GitHub Pages deployment.

---

## Built-in Claude Code skills worth using alongside (no install needed)

- `/code-review` — finds correctness bugs in the current diff before committing.
- `/simplify` — applies reuse/simplification/efficiency cleanups to changed code.
- `/verify` and `/run` — launches the app to confirm a change actually works.

These cover most of what third-party "refactoring" skills offer; the
low-install refactoring skills found during research were skipped as redundant.

---

## Suggested first uses

1. **UI audit**: "Review the React app's UI against web design guidelines" → punch-list from skill #3.
2. **Visual refresh**: restyle the shell with `frontend-design` guiding tokens/typography (skill #2), compare with #6.
3. **Backlog items with UX support**: category tabs and output-promotion flow designed with #5, animated with #4.
4. **Tool rewrites**: any ImageMagick-pipeline rework leans on #7, React structure on #1, then `/code-review` + `/verify`.
