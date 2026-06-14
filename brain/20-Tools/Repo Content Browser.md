---
type: tool
tool: Repo Content Browser
category: 🏗️ Asset Pipeline
status: shipped
priority: P1
updated: 2026-06-14
tags: [asset-pipeline, github, gitlab]
---

# Repo Content Browser

Thin wrapper over the [[Repo Browser]] layer: GH/GL auth + auto-detect, art+sound
modes, global cross-repo search, lightbox. Source: `RepoContentBrowserTool.jsx`
(81 L + context). Uses `needsFiles: false`.

- **Good**: thin wrapper; GH/GL auto-detect; art/sound modes; global search.
- **Wanted (P1)**: **unbounded blob+tree caches** (`RepoBrowserContext.jsx:37-38`,
  cleared only on disconnect); token in memory only; no branch/date filters.

Absorbs the retired Content/Sound browsers via `TOOL_ALIASES`. See [[Repo Browser]].
