---
type: session
tool: Spinner
category: 🎬 Scene Studio
status: shipped
updated: 2026-06-14
lang: en
source: next phase spinner unity phase4.md
tags: [session, spinner, unity, atlas]
---

# Spinner → Unity export — Phase 4 (baked overlays + shared atlas)

> [!info] Translated summary
> Outcome log for [`next phase spinner unity phase4.md`](../../next%20phase%20spinner%20unity%20phase4.md).

## Shipped ✅ (2026-06-14)
- **Symbol land/win Spine overlays BAKED into the prefab `Fx`** — autowired + bound at
  bake time, not spawned at runtime. (Supersedes the Phase 3 §A3 runtime overlay pool.)
- **Single shared-atlas export** — one draw call, no per-symbol texture duplication.
- **Static / blur hidden behind the playing overlay** — when an overlay plays, the
  static + blur frames are hidden.

Goal of this phase was getting the per-symbol land/win Spine animations *actually
playing* in both the Scene Studio web preview and the Unity export, plus finishing
leftover items.

Next → [[Spinner Unity Phase 5]]. Related: [[Spinner Design]] · [[Spinner Unity Phase 3]]
