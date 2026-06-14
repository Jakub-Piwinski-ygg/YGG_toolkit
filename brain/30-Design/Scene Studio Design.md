---
type: design
tool: Scene Studio
category: 🎬 Scene Studio
status: in-progress
updated: 2026-06-12
source: react-app/SCENE_STUDIO.md
tags: [design, scene-studio, pixi]
---

# Scene Studio — Design

> [!info] Canonical source
> Full 1680-line design doc: [`react-app/SCENE_STUDIO.md`](../../react-app/SCENE_STUDIO.md).
> This note is the navigable summary + section map. Phase changelog lives in
> [[Scene Studio Phase Status]].

## TL;DR

A stateful, Pixi-rendered scene editor for slot-game art previews. Artists compose
from PNG / Spine / video assets, animate PNG properties with multi-keyframe channels
(auto-key inspector), drive sequencing with a timeline that can pause on clicks or
named signals, then export landscape (1920×1080) and portrait (1080×2160) previews
— hero PNGs (consumed by [[Asset Checker]]), PNG sequences, and WebM.

It is the **single source of truth** for `scene.json`, the flow model, the module
layout, and the phased plan. **GlowForge is not part of Scene Studio** — it ships as
its own Art Tool; its PNG-sequence output imports as a `pngSequence` asset.

## Three orthogonal layers

1. **Composition** — layers + transforms.
2. **Animation** — per-property keyframe channels (x, y, scale, rotation, alpha,
   tint) with bezier/Hermite curves.
3. **Flow** — timeline sequencing (wait/signal/emit).

## Section map (anchors in the source)

| § | Topic |
|---|---|
| 0 | TL;DR |
| 1 | Goals and non-goals |
| 2 | Real-world scaffold context |
| 3 | Architecture — three orthogonal layers |
| 4 | `scene.json` schema |
| 5 | Flow timeline — MVP UI, future-proof model |
| 6 | Multi-orientation — copy-on-write transforms |
| 7 | Layer types |
| 8 | Sequence assets (pre-baked PNG sequences) |
| 9 | Render pipeline |
| 10 | Asset loading — scaffold & quick mode |
| 11 | Module layout |
| 12 | Open decisions / TBDs |
| 13 | Out of scope |
| 14 | Phase plan |
| 15 | Tech stack · 16 Glossary · 17 Review checklist |
| 18 | **Phase audit** — shipped vs doc |
| 19 | Timeline animation — keyframe channels + auto-key (Phase 3.7 *design*) |
| 20 | **Animation system — as-built** (supersedes §19) |

> [!tip] Read order for the animation system
> §20 (as-built) supersedes §19 (proposal) wherever they differ. When in doubt,
> §20 + the code win.

Related: [[Scene Studio]] · [[Spinner Design]] · [[Architecture]]
