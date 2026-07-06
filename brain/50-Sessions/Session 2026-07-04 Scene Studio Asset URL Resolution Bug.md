---
type: session
tool: Scene Studio
category: 🎬 Scene Studio
status: shipped
updated: 2026-07-04
lang: en
source: react-app/SCENE_STUDIO_PHASE_STATUS.md
tags: [session, scene-studio, spinner, bugfix, asset-pipeline]
---

# Session 2026-07-04 (round 7) — the actual root cause: `resolveAssetUrl` never handled `blob:` URLs

> [!success] Shipped (2026-07-04)
> Follow-up to [[Session 2026-07-04 Scene Studio Spinner Blur Downsample Speedup]].
> Blur generation was faster, but the artist reported the blurred result
> still never visibly appeared — not in the wizard preview, not in the
> timeline, not in Direct mode. This is the real, app-wide root cause behind
> the entire "blur doesn't work" saga across today's rounds.

## The bug

`resolveAssetUrl` in `engine/persist.js` is the **single shared resolver**
every asset kind in Scene Studio goes through — Spine skeleton/atlas/texture,
plain PNG layers, and the spinner's static/blur symbol textures alike
(confirmed via grep: it's the only asset-URL resolution function in the
engine, called from `pixiApp.js` and `spinnerRuntime.js`). It only
special-cased `data:` URLs:

```js
if (src.startsWith('data:')) return { url: src };
if (!rootHandle) return null;
// falls through to treating `src` as a relative project-folder path
```

The wizard's `generateBlurs` produces a blur PNG via `URL.createObjectURL(blob)`
— a `blob:` URL, not `data:`. That fell straight through to the
relative-path branch, which obviously never matched anything, so the
function returned `null`. `spinnerRuntime.js`'s texture loader treats a
`null` resolve as "couldn't load" and falls back gracefully —
`textures.set(sym.id, { tex, blurTex: blurTex || tex || Texture.WHITE })`
— which means **the blur texture silently became the static texture**. No
error anywhere in the chain. The blur sprite crossfades in via alpha exactly
as designed; it's just showing the identical unblurred image underneath, so
nothing visibly changes during a spin. This is why it looked broken
everywhere at once (wizard preview, timeline, Direct) — they all build the
spinner object through the same code path.

This bug predates every fix from today's earlier rounds and affects **any**
generated or blob-sourced asset anywhere in Scene Studio, not just spinner
blur — spinner blur is just the one feature that happens to generate
blob:-backed PNGs at runtime today.

## The fix

`resolveAssetUrl` now recognizes `blob:` and `https?:` as directly-loadable
URLs too, alongside `data:` (`/^(data:|blob:|https?:)/`). New
`engine/persist.test.mjs` (3 tests, pure logic — no DOM needed since the
early-return paths never touch `rootHandle`) covers: direct URLs resolve
without a `rootHandle`, relative paths still require one, non-string `src`
returns `null`.

## Why this one is higher-confidence than the prior rounds

Every other blur-related fix today touched DOM/Pixi/WASM code with zero test
coverage — pure hypothesis until verified in a browser I don't have access
to. This one is plain, synchronous string-matching logic, fully covered by a
new unit test, and the failure mode traced end-to-end (confirmed via reading
every call site, not guessed). Still hasn't been watched running in an
actual browser, but the confidence level here is meaningfully different from
the container-extraction and canvas-sizing changes in earlier rounds.

## Files

| Area | File |
|---|---|
| `resolveAssetUrl` recognizes `blob:`/`https?:` | `engine/persist.js` |
| New tests | `engine/persist.test.mjs` |

Related: [[Spinner Design]], [[Session 2026-07-04 Scene Studio Spinner Blur Downsample Speedup]], [[Scene Studio]].

Polish changelog (canonical): `react-app/SCENE_STUDIO_PHASE_STATUS.md`.
