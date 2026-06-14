// Spinner Timeline track codegen + plumbing (Unity feedback round 2, item #3).
// Run: node --test src/tools/SceneStudio/unity/spinnerTrack.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  yggSpinnerClipSource,
  yggSpinnerTrackSource,
  runtimeTimelineAsmdefSource,
  timelineAsmdefSource,
  timelineBuilderSource,
  spinnerSource,
  scenePlayerSource,
  spineAutoWireSource,
  SCRIPT_PATHS
} from './csharp.js';

// Balanced delimiters are a cheap proxy for "this C# at least parses".
function delimDelta(s) {
  let curly = 0, paren = 0, brack = 0;
  for (const c of s) {
    if (c === '{') curly++; else if (c === '}') curly--;
    else if (c === '(') paren++; else if (c === ')') paren--;
    else if (c === '[') brack++; else if (c === ']') brack--;
  }
  return { curly, paren, brack };
}

test('YggSpinnerClip is in its own same-named file (Unity ScriptableObject rule)', () => {
  const clip = yggSpinnerClipSource();
  assert.deepEqual(delimDelta(clip), { curly: 0, paren: 0, brack: 0 });
  assert.match(clip, /class YggSpinnerClip : PlayableAsset, ITimelineClipAsset/);
  assert.match(clip, /class YggSpinnerClipBehaviour : PlayableBehaviour/);
  // REGRESSION GUARD: the track file must NOT define YggSpinnerClip — sharing a
  // file gives "No script asset for YggSpinnerClip" and the clip deserializes empty.
  const track = yggSpinnerTrackSource();
  assert.doesNotMatch(track, /class YggSpinnerClip\b/);
  assert.equal(SCRIPT_PATHS.spinnerClip, 'Assets/YggSceneStudio/Runtime/Timeline/YggSpinnerClip.cs');
});

test('YggSpinnerTrack source is delimiter-balanced and has track + mixer', () => {
  const src = yggSpinnerTrackSource();
  assert.deepEqual(delimDelta(src), { curly: 0, paren: 0, brack: 0 });
  assert.match(src, /class YggSpinnerTrack : TrackAsset/);
  assert.match(src, /class YggSpinnerMixerBehaviour : PlayableBehaviour/);
  assert.match(src, /\[TrackClipType\(typeof\(YggSpinnerClip\)\)\]/);
  assert.match(src, /\[TrackBindingType\(typeof\(YggSpinner\)\)\]/);
  // The mixer must drive the spinner so scrubbing moves reels.
  assert.match(src, /spinner\.SetClips\(/);
  assert.match(src, /spinner\.Evaluate\(\(float\)playable\.GetTime\(\)\)/);
  assert.match(src, /namespace Ygg\.SceneStudio/);
});

test('ResolveTrack is bounds-safe against malformed/short clip boards', () => {
  const s = spinnerSource();
  // Per-reel indexers guarded so a bad clip can't crash the whole PlayableGraph.
  assert.match(s, /r<R&&r<cfg\.initialBoard\.Length/);
  assert.match(s, /target!=null&&r<target\.Length/);
  assert.match(s, /r>=cfg\.strips\.Length\|\|cfg\.strips\[r\]\?\.cells==null/);
  assert.match(s, /r<R&&r<b\.Length/); // EvalWaysWins
});

test('phase 3 §A1: no procedural scale-punch in web or Unity', () => {
  const s = spinnerSource();
  // The land/win Sin-based punch must be gone (Unity).
  assert.doesNotMatch(s, /0\.12f \* Mathf\.Sin/);
  assert.doesNotMatch(s, /0\.18f \* Mathf\.Sin/);
});

test('phase 4 §A3: YggSpinner BINDS baked overlays (no runtime spawn) + autowire', () => {
  const s = spinnerSource();
  assert.match(s, /class SpinnerSymbolAnimBinding/);
  assert.match(s, /public SpinnerSymbolAnimBinding\[\] symbolAnimBindings/);
  assert.match(s, /void BuildOverlays\(\)/);
  assert.match(s, /bool DriveOverlay\(/);
  // Overlays are BAKED + bound by name, never instantiated at runtime.
  assert.match(s, /parent\.Find\("Anim_" \+ b\.symbolId \+ "_" \+ b\.kind\)/);
  // Static/blur hidden behind a playing overlay.
  assert.match(s, /overlayShowing \? 0f/);
  assert.doesNotMatch(s, /NewSkeletonGraphicGameObject|NewSkeletonAnimationGameObject/);
  // Autowire assigns the overlay SkeletonDataAsset by name.
  assert.match(spineAutoWireSource(), /WireSpinnerOverlays/);
});

test('phase 3 §D/§F: spine clip mix set by fuzzy field-matching (version-robust) + forced ease', () => {
  const b = timelineBuilderSource();
  // Fields set by enumerating actual serialized props (no hard-coded names that
  // can silently no-op on a different spine-timeline version).
  assert.match(b, /ApplySpineClipTemplate\(soClip, cue\)/);
  assert.match(b, /static void ApplySpineClipTemplate/);
  assert.match(b, /n\.Contains\("useblend"\)/);
  assert.match(b, /n\.Contains\("eventthreshold"\)/);
  assert.match(b, /cue\.mixDuration >= 0f \? cue\.mixDuration : 0f/);
  // Ease-in/out forced to the requested value (0 default) so no auto-blend feeds the mix.
  assert.match(b, /clip\.easeInDuration = cue\.easeIn > 0f \? cue\.easeIn : 0/);
  assert.match(b, /clip\.easeOutDuration = cue\.easeOut > 0f \? cue\.easeOut : 0/);
});

test('phase 3 §E: leading "hold" empty clip + no starting anim on cued spine layers', () => {
  const b = timelineBuilderSource();
  assert.match(b, /hold\.displayName = "hold"/);
  // Autowire suppresses starting animation when the layer is timeline-driven.
  assert.match(spineAutoWireSource(), /node\.spineHasCues \? "" : node\.spineAnim/);
});

test('runtime Timeline asmdef is gated, runtime (not editor-only), refs Unity.Timeline', () => {
  const a = JSON.parse(runtimeTimelineAsmdefSource());
  assert.equal(a.name, 'Ygg.SceneStudio.Runtime.Timeline');
  assert.deepEqual(a.includePlatforms, []); // runtime, NOT Editor-only
  assert.ok(a.references.includes('Unity.Timeline'));
  assert.ok(a.references.includes('Ygg.SceneStudio.Runtime'));
  assert.deepEqual(a.defineConstraints, ['YGG_HAS_TIMELINE']);
  assert.ok(a.versionDefines.some((v) => v.name === 'com.unity.timeline'));
});

test('editor Timeline asmdef references the runtime Timeline assembly', () => {
  const e = JSON.parse(timelineAsmdefSource());
  assert.ok(e.references.includes('Ygg.SceneStudio.Runtime.Timeline'));
  assert.ok(e.references.includes('Unity.Timeline'));
  assert.deepEqual(e.defineConstraints, ['YGG_HAS_TIMELINE']);
});

test('SCRIPT_PATHS registers the new track script + asmdef', () => {
  assert.equal(SCRIPT_PATHS.spinnerTrack, 'Assets/YggSceneStudio/Runtime/Timeline/YggSpinnerTrack.cs');
  assert.equal(SCRIPT_PATHS.runtimeTimelineAsmdef, 'Assets/YggSceneStudio/Runtime/Timeline/Ygg.SceneStudio.Runtime.Timeline.asmdef');
});

test('timeline builder creates the spinner track from descriptor cues', () => {
  const b = timelineBuilderSource();
  assert.deepEqual(delimDelta(b), { curly: 0, paren: 0, brack: 0 });
  assert.match(b, /TryBuildSpinnerTrack\(player, timeline, director\)/);
  assert.match(b, /CreateTrack<YggSpinnerTrack>/);
  assert.match(b, /CreateClip<YggSpinnerClip>/);
  assert.match(b, /SetGenericBinding\(track, spinner\)/);
  assert.match(b, /player\.spinnerHandledByTimeline = built > 0/);
  // Parses spinnerCues out of the descriptor JSON (no new serialized field).
  assert.match(b, /class DescSpinnerCues \{ public DescSpinnerCue\[\] spinnerCues; \}/);
});

test('auto-build is opt-in (gated on autoBuildTimeline) and warns loudly on missing spine-timeline', () => {
  const b = timelineBuilderSource();
  assert.match(b, /if \(!player\.autoBuildTimeline\) continue;/);
  // Loud warning, not a quiet Debug.Log, when spine cues would be dropped.
  assert.match(b, /Debug\.LogWarning\("\[Ygg\] This scene has Spine animation cues but the spine-timeline extension is NOT installed/);
});

test('YggScenePlayer gains spinnerHandledByTimeline + autoBuildTimeline and gates the runtime loop', () => {
  const p = scenePlayerSource();
  assert.match(p, /public bool spinnerHandledByTimeline;/);
  assert.match(p, /public bool autoBuildTimeline;/);
  // Runtime Evaluate loop steps aside when the track drives the spinner.
  assert.match(p, /if \(!\(directorDriven && spinnerHandledByTimeline\)\)/);
});

test('YggSpinner is scrub-safe: SetClips + no edit-mode instantiation', () => {
  const s = spinnerSource();
  assert.match(s, /public void SetClips\(SpinnerClipData\[\] clips\)/);
  assert.match(s, /!BindBakedHierarchy\(\) && Application\.isPlaying\) BuildRuntime\(\)/);
});

test('phase 5 §A: presentWin drives per-reel win timing (model + C#)', () => {
  const s = spinnerSource();
  // Clip data + mixer + structures carry the present-win params.
  assert.match(s, /public float reelWinStagger;/);
  assert.match(s, /public float\[\] perReelWinDelay;/);
  // Per-reel win start array + presentWin override in ResolveTrack.
  assert.match(s, /winStartByReel/);
  assert.match(s, /clip\.action=="presentWin"&&stops\.Count>0/);
  // EvaluateInternal reads the per-reel win start.
  assert.match(s, /st\.winStartByReel!=null&&r<st\.winStartByReel\.Length\?st\.winStartByReel\[r\]:st\.winStartAt/);
  // Timeline clip asset + builder carry the new fields.
  assert.match(yggSpinnerClipSource(), /public float reelWinStagger;/);
  const b = timelineBuilderSource();
  assert.match(b, /asset\.reelWinStagger = c\.reelWinStagger;/);
  assert.match(b, /public float reelWinStagger;/);
});

test('phase 5 §B: single machine mask + native 1:1 (no per-reel mask, no FitScale)', () => {
  const s = spinnerSource();
  // One machine mask container; reels no longer create their own mask.
  assert.match(s, /Transform NewMaskContainer\(Transform parent\)/);
  assert.match(s, /board\.Find\("Mask"\)/);
  // Native sizing replaces fit-shrink.
  assert.match(s, /void SetNativeSize\(Transform tr, Sprite s\)/);
  assert.doesNotMatch(s, /float FitScale\(Sprite/);
  assert.doesNotMatch(s, /cell\.fitS|cell\.fitB/);
  // EnsureReel must NOT add a per-reel RectMask2D anymore.
  const ensureReel = s.slice(s.indexOf('Transform EnsureReel'), s.indexOf('Transform EnsureCell'));
  assert.doesNotMatch(ensureReel, /RectMask2D|SpriteMask/);
});

test('phase 5 §C: runtime result-injection API (SetResultBoard / Spin / self-drive)', () => {
  const s = spinnerSource();
  assert.match(s, /public void SetResultBoard\(string\[\]\[\] board\)/);
  assert.match(s, /public void Spin\(\)/);
  assert.match(s, /public void Spin\(string\[\]\[\] board\)/);
  assert.match(s, /SpinnerClipData\[\] InjectBoard\(SpinnerClipData\[\] clips\)/);
  assert.match(s, /SpinnerClipData\[\] BuildDefaultCycle\(\)/);
  // Injection overrides the stopSpin board; wins derive from it via ResolveTrack.
  assert.match(s, /c\.action == "stopSpin"/);
  // Self-drive clock so no Timeline is needed.
  assert.match(s, /void Update\(\)\s*\{\s*if \(!_runtimePlaying\) return;/);
  assert.match(s, /public bool IsSpinning => _runtimePlaying;/);
});

test('phase 5: per-reel Fx overlays (same symbol can win on several reels at once)', () => {
  const s = spinnerSource();
  // BuildOverlays detects the per-reel layout and keys overlays by reel.
  assert.match(s, /_perReelFx = _fxRoot\.Find\("Reel_0"\) != null;/);
  assert.match(s, /_perReelFx \? r \+ ":" : ""/);
  // DriveOverlay takes the reel index and positions per-reel overlays at local x=0.
  assert.match(s, /bool DriveOverlay\(int reel, string symbolId, string kind/);
  assert.match(s, /float ox = _perReelFx \? 0f : colX;/);
});

test('win-anim cutoff fix: per-symbol baked durations size the win/land window', () => {
  const s = spinnerSource();
  // Per-symbol real Spine lengths are baked into SpinnerSymbolData.
  assert.match(s, /public float winDur, landDur;/);
  // EvaluateInternal sizes the win/land window per-symbol (not a fixed default).
  assert.match(s, /static float WinDurFor\(SpinnerConfigData cfg,string sid\)/);
  assert.match(s, /static float LandDurFor\(SpinnerConfigData cfg,string sid\)/);
  assert.match(s, /float winLen=WinDurFor\(cfg,sid\),landLen=LandDurFor\(cfg,sid\)/);
  assert.match(s, /t<ws\+winLen/);
  assert.match(s, /t<st\.landAt\[r\]\+landLen/);
  // Real duration preferred; config default only when the baked value is 0.
  assert.match(s, /s\.winDur>0f\?s\.winDur:cfg\.winAnimDuration/);
  assert.match(s, /s\.landDur>0f\?s\.landDur:cfg\.landAnimDuration/);
  // The fragile runtime-reflection extension is GONE — baked durations replace it.
  assert.doesNotMatch(s, /WinExtensionT/);
  assert.doesNotMatch(s, /public float dur;/);
  // Config default fallback remains sensible (2s, not the old 1s).
  assert.match(s, /winAnimDuration = 2f;/);
});
