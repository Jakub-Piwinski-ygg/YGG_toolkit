---
type: session
tool: Spinner
category: 🎬 Scene Studio
status: shipped
updated: 2026-06-14
lang: en
source: next phase spinner unity phase5.md
tags: [session, spinner, unity, runtime-api]
---

# Spinner → Unity export — Phase 5 (present-win, one mask, runtime API)

> [!info] Translated summary
> Outcome log for [`next phase spinner unity phase5.md`](../../next%20phase%20spinner%20unity%20phase5.md).
> Three confirmed builds (build + 49 tests green). Full detail in [[Scene Studio Phase Status]] (round 5).

## Shipped ✅ (2026-06-14)
- **§A "present win" clip** — new `presentWin` action (after `stopSpin`) controls *when*
  winning symbols play the win animation instead of auto `winDelay`. Per-reel
  `reelWinStagger` (0 = simultaneous, >0 = cascade) + optional `perReelWinDelay`.
  Evaluator computes `winStartByReel[]` per stop. Ported to Unity bake/csharp/timeline;
  fixed a bug where `bake.js` read flat `c.spinner` and lost target board/delays.
- **§B one machine mask + native 1:1** — symbols render at native px (overflow the cell);
  fit-shrink removed. One mask (RectMask2D / SpriteMask) covers `Statics+Blurs`; `Fx`
  is outside the mask so animations overflow the machine. Hierarchy:
  `Board > Mask > Statics/Blurs` + `Fx`.
- **§C runtime API** — `YggSpinner.SetResultBoard(string[][])` + `Spin()` / `Spin(board)`
  drive spin→stop→present-win from their own clock (`Update()`), no Timeline; wins
  computed from the injected board. Documented in `SPINNER.md` §6.

This completes the P0 Spinner → Unity export line. Remaining P0: Scene Studio's
browser-side exporters (hero PNG / PNG sequence / WebM) — see [[Tool Review]].

Related: [[Spinner Design]] · [[Spinner Unity Phase 4]] · [[Scene Studio Phase Status]]
