# Spinner — Unity export phase 3 (kickoff / handoff)

> Paste this to start the next session. Captures Unity import-testing feedback
> from **2026-06-13** (after phase 2 shipped + the split-file/bounds fix).
> Companion docs: `next phase spinner unity phase2.md` (what shipped),
> `react-app/SPINNER.md`, `react-app/SCENE_STUDIO.md`, `TOOL_REVIEW.md`.

## ✅ IMPLEMENTED 2026-06-13 — all sections coded, build + 41 tests green

Everything below is implemented and passes JS tests + `npm run build`. The
generated C# can't compile in the toolkit, so it needs a Unity import to verify.

- **§A1 DONE** — procedural scale-punch removed (web `spinnerRuntime.js` + Unity
  `YggSpinner.Evaluate`). Land/win = Spine overlays only.
- **§A2 DONE (code)** — `normalizeSymbol` now preserves `loop` (overlay pool key
  bug) and carries the `offset`; web overlay honors loop + offset. Whether
  overlays render still needs browser verify with real spine assets.
- **§A3 DONE (foundation + best-effort runtime)** — symbol land/win spine triplets
  now EXPORT (added to `usedAssetIds`); `symbolAnimBindings` (spineName/anim/loop/
  offset + SkeletonDataAsset ref) serialize into `YggSpinner`; `YggSpineAutoWire`
  assigns the SkeletonDataAsset by name (`WireSpinnerOverlays`); `YggSpinner`
  spawns a pooled overlay per symbol:kind in `Fx` and drives it in `Evaluate`. ALL
  runtime spine calls are reflective + try/caught so a spine-API mismatch disables
  overlays instead of crashing. **HIGHEST verification risk** — see below.
- **§B DONE** — per-symbol land/win timing `offset` (wizard inputs, model, web
  runtime, Unity overlay drive). Default 0 = exact land/win moment.
- **§C DONE** — spinner clip "set duration" buttons: startSpin = spin-up,
  spin = 2s idle, stopSpin = until-all-landed (`spinnerStartSpinDuration` /
  `spinnerStopSpinDuration` / `SPINNER_DEFAULT_SPIN_DURATION` in `spinnerModel.js`).
- **§D DONE** — full Spine Animation State Clip parity fields (easeIn/out,
  defaultMixDuration, dontPause, dontEnd, clipEndMixOut, event/attachment/drawOrder
  threshold) in schema + inspector + export mapping. **§D1 mix fix**: builder now
  forces `defaultMixDuration=false` + `useBlendDuration=false` + explicit
  `mixDuration` (0 default).
- **§E DONE** — timeline-driven spine layers carry NO starting animation (prefab
  `skeleton*Yaml` + `spineAutoWire`, gated on `spineHasCues`); builder prepends a
  leading empty "hold" clip before the first real clip so scrub-back clears to
  setup pose.
- **§F DONE** — spine mix defaults to 0 (snap) on export + runtime `FireSpineCue`.

### Import-testing fix (2026-06-13) — spine atlas/texture missing on export

ROOT CAUSE (confirmed against the project): the 16 symbol skeletons in
`08_Symbols/Animations/` share ONE atlas+texture
(`Hp_Lp_SSybbols_Multiplier_Anticipation.atlas.txt`/`.png`). The skeletons'
SCENE-ASSET records had **empty `atlas`/`texture`** because
`SpinnerWizard.jsx#browserSpinePool` dropped `atlasPath`/`texturePath` when
converting a browser spine into a scene asset. The wizard's src-dedup then meant
re-creating a spinner re-used the already-broken scene records, so the first
wizard patch alone couldn't reach them. Same empty fields also blocked the WEB
overlay (`makeSpineOverlayFactory`) — so §A2 "overlays don't play" was the same bug.

FIX (self-heal + permanent repair — user-chosen):
- **`persist.js`** — `resolveSpineSiblings()` finds a skeleton's atlas+texture on
  disk from its `.json` folder (base-match, else the lone shared atlas/png), and
  `repairSceneSpineAssets()` writes them back onto the asset records.
- **`SceneStudioInner.jsx`** — a self-heal effect runs whenever a project root is
  connected: recovers + persists the atlas/texture on any spine asset missing them
  (once per src/session, no loop). Fixes export AND web preview at once.
- **`SpinnerWizard.jsx#browserSpinePool`** — now carries `atlas`/`texture` (stops
  new breakage).
- **`exportUnityPackage.js`** — still SKIPS a genuinely-incomplete spine (so it
  can't abort the whole import), with a message pointing at connecting the project
  root so auto-recovery can run.
- Needs a project folder connected (FS Access) for disk recovery; data-URL assets
  can't be recovered and still need re-picking.

### Import-testing fix #2 (2026-06-13) — mix=0 ignored + inspector restyle
User set Mix = 0 but the imported spine clip kept "Use Blend Duration" ticked with
a tiny auto mix (~0.0113), re-introducing the blend artifact. Cause: my hard-coded
`template.useBlendDuration` SerializedObject path silently no-ops on this
spine-timeline version (while `template.holdPrevious` happened to match), so
`useBlendDuration` stayed at its `true` default and the mix followed the clip's
auto blend-in. Fixes:
- **`csharp.js#TryBuildSpineTracks`** — replaced hard-coded `template.*` paths with
  `ApplySpineClipTemplate()`, which ENUMERATES the clip's actual serialized
  properties and sets them by name keyword (`useblend`, `mixduration`, `holdprev`,
  `customduration`/`defaultmix`, thresholds, alpha, clipin…). Version-robust.
- Also **force `clip.easeInDuration`/`easeOutDuration` to the requested value (0
  default)** — so even if `useBlendDuration` stays on, there is no auto-blend for it
  to follow and the mix is truly 0.
- **`InspectorPanel.jsx`** — spine clip inspector regrouped to mirror the Unity
  "Spine Animation State Clip": **Clip Timing** (start, duration, blend in, ease out,
  clip in, speed multiplier, time curve) → **Spine Animation State Clip** (animation,
  loop, don't pause, don't end, clip end mix out) → **Mixing Settings** (default mix
  duration, use blend duration, mix duration, hold previous, event/attachment/draw
  order threshold, alpha).
- NOTE: spine-timeline is NOT installed as readable source in the project (it's
  compiled), so exact field names can't be verified from disk — the fuzzy setter
  sidesteps that. The prior-session log "[Ygg] Built N Spine Timeline track(s)"
  confirms the builder DOES run there.

### Needs Unity-import verification (in rough risk order)
1. **§A3 runtime overlays** — the reflective `NewSkeletonGraphicGameObject` /
   `NewSkeletonAnimationGameObject` instantiation + `AnimationState` driving is the
   riskiest blind code. Confirm overlays spawn in `Fx`, get their SkeletonDataAsset
   from autowire, and play on land/win. Note: runtime-spawn is **play-mode only**
   (edit-mode scrub won't show them — `Application.isPlaying` guard); revisit if
   edit-mode preview is wanted. If a cell shows the same symbol on 2 reels at once,
   only one overlay (one per symbol:kind) is shown — expand to a pool if needed.
2. **§D spine `template.*` names** — `dontPause`/`dontEnd`/`clipEndMixOutDuration`/
   `clipInFromLastClip`/`eventThreshold` etc. are best-guess; `SetFloat/SetBool`
   no-op on unknown names, so wrong ones are harmless but won't apply. Verify
   against the installed spine-timeline version.
3. **§A2 web overlays** — confirm land/win spine anims actually render in the
   Scene Studio preview now.

---

## Where things stand (verified by a real Unity import, 2026-06-13)

Phase 2 + the round-after-import fix landed and **the spinner now appears and
runs in Unity, driven by a `YggSpinnerTrack` control track that scrubs**. The
`YggSpinnerClip` "No script asset" bug and the `ResolveTrack` `IndexOutOfRange`
crash are fixed (clip is its own file; all per-reel indexers are bounds-guarded).

The user applied two **manual** Unity fixes to get spine animations behaving —
both must become automatic in the export (see §E/§F). There are still some
Unity errors not yet captured — collect them at the start of this phase.

The work below splits into: **spinner symbol animations (most important)**,
**Spine clip parity round 2**, **timing helpers**, and **two spine export bugs**.

---

## §A — Spinner land/win SYMBOL animations (TOP PRIORITY)

Today neither the web preview nor Unity actually plays the per-symbol land/win
**Spine** animations, and an **unwanted procedural scale-punch** fires instead.

### A1. Remove the procedural scale-punch (UNWANTED)
The user explicitly does not want the scale-pop land/win fallback.
- **Web**: `engine/spinner/spinnerRuntime.js` — the `punch` added in phase 2 D2
  (landing/win `Math.sin` scale) should be removed (or made an explicit opt-in
  that defaults OFF). `cell.cellC.scale.set(1)` should be the norm.
- **Unity**: `csharp.js#spinnerSource` → `YggSpinner.Evaluate` — the `punch`
  block for `CellState.Landing`/`Win` (`1 + 0.12*Sin…`, `1 + 0.18*Sin…`) must go
  too. The user saw "old scale up land animation … despite it not being there in
  web Scene Studio" — that's this Unity punch.

### A2. Web: land/win Spine overlays still don't play
Phase 1 item #1 wired `createSpineContainer` into `spinnerRuntime.js`, but the
user reports land/win spine anims STILL don't render in the Scene Studio preview.
Re-investigate end to end with real assets:
- Are `sym.landAnim` / `sym.winAnim` actually set on the config (wizard step)?
- Is `createSpineContainer(assetId, anim, loop)` returning instances (pool
  non-empty)? Is `setTrackTime` driving them on scrub?
- Verify `spinnerEval.js` emits `state==='landing'`/`'win'` + correct `stateT`
  windows for the assigned symbols.

### A3. Unity: implement land/win Spine overlays (NEW — biggest gap)
`YggSpinner` has an `Fx` layer but **never spawns spine renderers** — there's "no
layer for animations under spinner at all, only some fx object". Land/win symbol
animations are simply not implemented on the Unity side. Needed:
- Export each spinner symbol's land/win **spine asset** (json/atlas/png triplet)
  into the package — the spinner export currently only ships symbol PNGs
  (`exportUnityPackage.js` spinner branch). Reuse the existing spine asset
  placement + `.meta` path.
- Bake (or runtime-spawn into `Fx`) `SkeletonGraphic` (UI) / `SkeletonAnimation`
  (world) instances pooled per land/win animation, mirroring the web overlay
  pool (`spinnerRuntime.js#spinePool`).
- Wire their `SkeletonDataAsset` on import (extend `YggSpineAutoWire`, or a
  spinner-specific pass) and drive `SetAnimation(track, anim, loop)` + track time
  from `YggSpinner.Evaluate` when a cell enters Landing/Win.
- This is the bulk of the phase. Design it to share the cue/threshold model with
  the Spine clip parity work (§D) where possible.

---

## §B — Land-animation timing offset (NEW feature)
Allow editing *when* the land animation plays relative to the land event.
- Default **0** = exact land moment; allow e.g. `-0.1s` (early) or `+0.1s` (late).
- Add a per-symbol (or per-event) `landAnimOffset` (and maybe `winAnimOffset`) to
  the spinner symbol model (`spinnerModel.js`) + evaluator (`spinnerEval.js`,
  shift the `stateT`/window) + C# `YggSpinner` + the Unity control-track clip.
- Editable in Scene Studio (wizard / inspector) AND on the Unity spinner clip.

---

## §C — Spinner clip timing helpers (Scene Studio)
Like the spine "set duration = 1 cycle" button, add compute-and-set buttons for
spinner action clips, and sensible default placement:
- **startSpin**: duration = ramp-to-full-speed time; the clip should cover the
  spin-up so that at its end the reels are at full speed (essentially "now
  spinning"). Button: "set duration = spin-up".
- **spin**: default ~**2s** (idle-like hold at full speed).
- **stopSpin**: duration = exact time until **all reels have landed AND all land
  animations have played** (`stopDuration + max reelStaggerStop + landAnimDuration`,
  accounting per-reel delays). Button: "set duration = until all landed".
- Implement the timing math in the evaluator/model so both the button and any
  Unity-side helper can call it (single source of truth).

---

## §D — Spine clip parity round 2 (full Spine Animation State Clip)
Scene Studio's spine clip inspector still doesn't match the Spine Animation State
Clip (reference screenshot 2026-06-13). Add the MISSING fields (we already have
loop, speed, mixDuration, holdPrevious, clipIn, alpha, useBlendDuration):

**Clip Timing**: Ease In Duration, Ease Out Duration, Speed Multiplier (= our
`speed`). **Blend Curves**: In, Out (Auto / Linear / manual curve). **Spine clip**:
Don't Pause with Director, Don't End with Clip, Clip End Mix Out Duration.
**Mixing Settings**: **Default Mix Duration** (bool), Use Blend Duration (have),
Mix Duration (have), Hold Previous (have), Event Threshold, Attachment Threshold,
Draw Order Threshold, Alpha (have).

- Build the inspector to mirror the screenshot layout (Clip Timing / Blend Curves
  / Spine Animation State Clip / Mixing Settings groups) **plus our own fields**.
- Map every new field through `bake.js#spineCuesForLayer` → `SpineCue` (C#) →
  `TryBuildSpineTracks` `template.*` and the runtime `FireSpineCue`.
- Reference screenshot fields: Start/End/Duration, Ease In/Out Duration, Clip In,
  Speed Multiplier, Blend Curves In/Out, Animation Reference, Loop, Don't Pause
  with Director, Don't End with Clip, Clip End Mix Out Duration, Default Mix
  Duration, Use Blend Duration, Mix Duration, Hold Previous, Event/Attachment/
  Draw Order Threshold, Alpha.

### D1. BUG — mixDuration not applied on export
Phase 2 mapped `mixDuration` but the imported clip shows **Use Blend Duration =
checked** with Mix Duration greyed (so our value is ignored). Fix the mapping in
`csharp.js#TryBuildSpineTracks`: to honor an explicit mix, set
`template.defaultMixDuration = false`, `template.useBlendDuration = false`, AND
`template.mixDuration = <value>` together (the spine-timeline default for a new
clip is evidently blend-duration). Verify exact property names against the
installed spine-timeline version while testing.

---

## §E — BUG: phantom starting animation on idle spine layers
A spine layer that's invisible in idle and only animates later in the timeline
still plays a **starting animation at all times** until its control track is
reached (then snaps). Setting Starting Animation to "none" fixes first play but
scrubbing back re-shows it. The user's manual fix = (1) no starting animation +
(2) control tracks with **no animation reference** ("hold" clips). Automate both:
- **Prefab**: `prefab.js#skeletonGraphicYaml`/`skeletonAnimationYaml` should NOT
  set `startingAnimation`/`_animationName` (leave empty) when the layer's first
  spine clip starts after t=0 (or always leave empty and let the timeline drive).
  `spineAutoWire` likewise should not re-assign a starting animation.
- **Timeline**: `TryBuildSpineTracks` should emit a leading **empty/hold clip**
  (no animation reference) before the first real clip — and ideally fill gaps —
  so scrubbing before/between clips clears to setup pose instead of bleeding the
  previous animation. (This is the "hold" track the user built by hand.)

## §F — BUG: spine blend/loop mix default
A blending error appeared until the user unchecked Loop and set **Mix Duration to
0** (Unity defaulted it non-zero). Make the export default the spine mix to **0**
(snap) unless the clip specifies otherwise — i.e. `defaultMixDuration=false` +
`mixDuration=0` when no explicit mix is set (tie this to §D1). Confirm the web
preview (`pixiApp.js`) uses the same 0-default so web and Unity match.

---

## Outstanding (collect at session start)
- The user noted "still some errors in Unity" not yet pasted — gather the console
  output first and fold any new ones into the list above.

## Key files
| File | Role |
|---|---|
| `engine/spinner/spinnerRuntime.js` | web reel renderer + land/win overlay pool; remove punch (§A1), fix overlays (§A2) |
| `engine/spinner/spinnerEval.js` + `.test.js` | land/win state + stateT; land offset (§B), stop-timing math (§C) |
| `engine/spinner/spinnerModel.js` | symbol model — land/win anim + offsets (§B) |
| `unity/csharp.js` | `YggSpinner` (remove punch §A1, spawn spine overlays §A3), `SpineCue`/`TryBuildSpineTracks`/`FireSpineCue` (§D/§E/§F), `skeleton*Yaml` via prefab |
| `unity/exportUnityPackage.js` | export symbol spine triplets (§A3); spine cue field plumbing (§D) |
| `unity/bake.js` | `spineCuesForLayer` (§D), `spinnerCuesForLayer` (§B/§C) |
| `unity/prefab.js` | `skeletonGraphicYaml`/`skeletonAnimationYaml` starting-anim fix (§E); spinner Fx overlay baking (§A3) |
| `components/InspectorPanel.jsx` | spine clip parity UI (§D); spinner clip "set duration" buttons (§C) |
| `unity/prefab.spinner.test.mjs`, `unity/spinnerTrack.test.mjs` | extend |

## Suggested order
1. §A1 remove unwanted procedural punch (quick, unblocks judging real anims).
2. §A2 fix web land/win spine overlays (validate anims play at all).
3. §A3 Unity land/win spine overlays (the big one).
4. §E + §F spine starting-anim + mix-default bugs (small, high annoyance).
5. §D spine clip parity round 2 + §D1 mix mapping fix.
6. §C timing helpers, §B land-anim offset.

## Acceptance
- No procedural scale-pop anywhere; land/win show ONLY assigned Spine anims.
- Web preview AND Unity play per-symbol land/win Spine animations on land/win.
- Land-anim timing offset editable (Scene Studio + Unity clip), default = land moment.
- Spinner clips have working "set duration" buttons (spin-up / 2s / until-landed).
- Spine clip inspector matches the Spine Animation State Clip + our fields; an
  explicit mix duration (incl. 0) round-trips into Unity correctly.
- Idle spine layers stay at setup pose until their first clip; scrubbing back does
  not bleed an animation; no starting animation auto-plays.
