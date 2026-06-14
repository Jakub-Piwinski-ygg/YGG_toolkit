---
type: architecture
title: Repo Browser
updated: 2026-06-14
tags: [architecture, github, gitlab]
---

# Repo Browser

Shared GitHub / self-hosted GitLab browsing layer powering [[Repo Content Browser]]
(and historically the art/sound browsers). In the original monolith this lives in
the `_gh` state block (`index.html` L2325+).

## Key facts

- State: `provider`, `token`, `baseUrl`, `owner`, `repo`, `repos`, `branch`.
- **Provider auto-detect** from token prefix: `glpat-` → gitlab; `ghp_` /
  `github_pat_` → github; bare 20-char → gitlab.
- Default GitLab base: `https://gitlab.yggdrasil.lan` (internal build).
- **Cross-repo search**: prefix-filtered repo list (~170), 8-worker concurrent
  pool, cached, cancellable, live progress, click-through to match.
- Trees fetched via one recursive GitHub/GitLab Trees API call per repo — avoids
  n+1 directory listings.

> [!warning] Private media needs JS fetch + blob URL
> `<img src>` / `<audio src>` can't send `Authorization` / `PRIVATE-TOKEN`
> headers. For private assets: fetch with auth headers, wrap in
> `URL.createObjectURL(blob)`, cache the blob URL. See [[Gotchas]].

In the React app the equivalent state lives in `RepoBrowserContext.jsx` — note the
**unbounded blob+tree caches** flagged in [[Tool Review]].

Related: [[Repo Content Browser]] · [[Gotchas]]
