---
type: architecture
title: Repo Browser
updated: 2026-06-29
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

In the React app the equivalent state lives in `RepoBrowserContext.jsx` (provider
wraps the whole Shell, so any tool can `useRepoBrowser()`) — note the **unbounded
blob+tree caches** flagged in [[Tool Review]]. Pure helpers live in
`utils/repoBrowser.js`: `detectProvider`, `authHeaders`, `fetchRepos` (with a
`canWrite` flag), `fetchTree`, `fetchBranches`, `listDir`, `authBlobUrl`, `rawUrl`,
`commitFile`, `runPool`.

> [!note] Now also backs Scene Studio remote workspaces
> Since 2026-06-29 this layer powers [[Session 2026-06-29 Scene Studio Remote Workspace|Scene Studio's remote workspace]]:
> a read-only repo-backed `FileSystemDirectoryHandle` (`engine/repoHandle.js`) is
> built from a `fetchTree` result and lazily resolves files via `authBlobUrl`, so the
> auth/cache flow is shared with the Content Browser.

Related: [[Repo Content Browser]] · [[Scene Studio]] · [[Gotchas]]
