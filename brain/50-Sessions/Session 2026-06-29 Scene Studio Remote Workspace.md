---
type: session
tool: Scene Studio
category: 🎬 Scene Studio
status: shipped
updated: 2026-06-29
lang: en
source: react-app/SCENE_STUDIO_PHASE_STATUS.md
tags: [session, scene-studio, github, gitlab, workspace, repo-browser]
---

# Session 2026-06-29 — Scene Studio Remote Workspace

> [!success] Shipped (2026-06-29)
> Scene Studio can now open a **GitHub / GitLab repo folder as its workspace**,
> alongside the existing local-folder pick. Assets resolve straight from the repo,
> with an optional pre-download warm-up and gated commit-back. Build green.

## Why

Artists' project art lives in the same GH / self-hosted GitLab repos the
[[Repo Content Browser]] already authenticates against. Until now Scene Studio
could only open a **local** folder (FS Access picker, or `webkitdirectory`
fallback). This session lets the "load workspace" gate connect to a repo, pick a
folder, and use it as the workspace — auto-loading a `project.json` / `scene.json`
if present, otherwise letting the user load their own project file from device
while every asset path still resolves against the repo.

## Key idea — a third handle kind

The whole Scene Studio loading layer is **handle-agnostic**: `linkProjectRoot(handle)`
accepts anything that quacks like a `FileSystemDirectoryHandle`, exactly as
`engine/virtualHandle.js` proved for the Firefox/Safari `File[]` fallback. So the
core is a **read-only repo-backed handle** whose `getFile()` fetches bytes lazily
over the network. `scanProjectAssets`, `loadProjectFromHandle`, `resolveAssetUrl`,
and `saveProject` all work against it **unchanged** (`writable:false` → save falls
to download). Tree traversal (`entries()`/`getDirectoryHandle`) is in-memory off the
one `fetchTree` call; only `getFile()` hits the network.

## Session log

### Remote workspace (the feature)
- **`engine/repoHandle.js`** (new) — `makeRepoRootHandle({provider, token, baseUrl,
  repo, subPath, tree, blobCache})` + `isRepoHandle`. Builds the nested dir/file
  node tree from the flat `fetchTree` output scoped to `subPath`; each file leaf's
  `getFile()` calls `authBlobUrl` (shared blob cache, keyed `fullName|path`) then
  wraps the blob in a `File`. Carries a serializable `repoMeta` descriptor (no token,
  no tree) for session restore. `create` options are rejected (read-only).
- **`components/RepoWorkspacePicker.jsx`** (new) — modal: connect → pick repo →
  **pick branch** → browse folders (`listDir`) → "Use this folder as workspace".
  Reuses `useRepoBrowser()` so auth is **shared with the Repo Content Browser**;
  keeps its OWN folder-nav cursor (not `rb.currentPath`). Branch switch refetches
  the tree for a repo copy with `defaultBranch` overridden.
- **`utils/repoBrowser.js`** — added `fetchBranches`, a `canWrite` flag in
  `fetchRepos` (GitHub `permissions.push`; GitLab `project_access.access_level ≥ 30`),
  and a `commitFile` helper (GH `PUT contents` w/ sha; GitLab `POST`/`PUT files`).
- **`WorkspaceLockOverlay.jsx`** — orange button renamed **"📁 Open LOCAL folder
  workspace"**; new white/orange **"🌐 Open REMOTE workspace"** button below it.
- **`SceneStudioInner.jsx`** — `handlePickRepoRoot` builds the handle and links it;
  repo-aware **session auto-restore** (rebuilds the handle from `repoMeta` + the
  stored token + a refetched tree); gated `handleCommit`.
- **`engine/sessionStore.js`** — persists `repoMeta` instead of the non-cloneable
  repo handle (a structured-clone of the closures would abort autosave).

### Follow-up polish (same session)
- **Disconnect / switch key** — "⏏ Disconnect" in the picker header (any step when
  connected) calls `rb.disconnect()`, clearing the token + storage so a different
  key can be entered.
- **Asset pre-download progress bar** — after confirming a folder, a progress overlay
  warms the blob cache for every asset (`runPool` 8-way + `authBlobUrl`) showing
  `done / total`, with **"Skip — load on demand"** which aborts and falls back to the
  lazy behaviour. `collectRepoMediaFiles` filters the tree to images / spine / video.
- **Wider explorer** — picker modal `720px → min(1140px, 94vw)`, repo/folder grid
  columns `150px → 230px` min, larger cards so repo/folder names show in full and the
  grid scrolls inside the modal with the confirm bar pinned.

### Also committed 2026-06-29
- **Access token fix** (`3cfb88f`) — preceded the remote-workspace work.

## Commit-back (gated)
Saving a repo workspace **downloads** `project.json` by default (read-only handle).
A **"⬆ commit"** toolbar button appears **only** when `repo.canWrite` is true — it
serializes via the shared `serializeProject` (extracted from `saveProject`) and
commits to `{subPath}/project.json` on the workspace branch. A read-only token's 403
reports cleanly and leaves the download path intact.

## Implementation map

| Concern | File |
|---|---|
| Repo-backed read-only handle + `isRepoHandle` | `engine/repoHandle.js` (new) |
| Connect / repo / branch / folder picker modal | `components/RepoWorkspacePicker.jsx` (new) |
| `fetchBranches`, `canWrite`, `commitFile` | `utils/repoBrowser.js` |
| LOCAL/REMOTE gate buttons | `components/WorkspaceLockOverlay.jsx` |
| Pick handler, prefetch bar, restore, commit | `SceneStudioInner.jsx` |
| `repoMeta` session round-trip | `engine/sessionStore.js` |
| Shared project serialization | `engine/persist.js` (`serializeProject`) |
| Commit button (gated on `canWrite`) | `components/StudioToolbar.jsx` |

## Notes / future
- Re-opening the picker after a workspace is already linked goes through **New project**
  → gate (no toolbar "switch to repo" button yet).
- Commit-back is `project.json` only; per-scene file commits + `.unitypackage` push are
  possible later.

Related: [[Scene Studio]] · [[Repo Content Browser]] · [[Repo Browser]] · [[Scene Studio Phase Status]]
