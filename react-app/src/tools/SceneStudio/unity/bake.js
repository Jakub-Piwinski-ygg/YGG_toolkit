// Bake Scene Studio timeline animation into plain per-property key arrays.
//
// Every curve form (presets, cubic-bezier, custom points, per-key tangents,
// path-mode position) is handled by sampling through the engine's own
// evalChannel() at a fixed fps — guaranteed visual parity with the studio
// preview, at the cost of dense keys. Redundant intermediate samples on
// perfectly-linear segments are pruned afterwards.
//
// Output values stay in Scene-Studio space (pixels, y-down, radians).
// Space conversion to Unity happens in animClip.js / prefab.js.

import { evalChannel, clipLocalSeconds } from '../engine/animation/keyframes.js';
import { tracksForLayer } from '../engine/sceneModel.js';
import { normalizeSpinnerConfig, SPINNER_ACTIONS, targetBoardForClip } from '../engine/spinner/spinnerModel.js';

const PROPS = ['x', 'y', 'scaleX', 'scaleY', 'rotation', 'alpha', 'tintR', 'tintG', 'tintB'];

function baseValues(transform) {
  return {
    x: transform?.x ?? 0,
    y: transform?.y ?? 0,
    scaleX: transform?.scaleX ?? 1,
    scaleY: transform?.scaleY ?? 1,
    rotation: transform?.rotation ?? 0,
    alpha: typeof transform?.alpha === 'number' ? transform.alpha : 1,
    tintR: transform?.tint?.r ?? 1,
    tintG: transform?.tint?.g ?? 1,
    tintB: transform?.tint?.b ?? 1
  };
}

/** Find the clip governing scene-time t (latest-started clip that has begun). */
function activeClipAt(clips, t) {
  let active = null;
  for (const c of clips) {
    if (c.start <= t && (!active || c.start >= active.start)) active = c;
  }
  return active;
}

function sampleClip(clip, sceneTime, base, prev) {
  const local = clipLocalSeconds(clip, sceneTime, { clampPastEnd: true });
  const ch = clip.channels || {};
  const out = { ...prev };
  const pos = ch.position ? evalChannel(ch.position, local, 'position') : null;
  if (pos) { out.x = pos.x; out.y = pos.y; }
  const scale = ch.scale ? evalChannel(ch.scale, local, 'scale') : null;
  if (scale) { out.scaleX = scale.x; out.scaleY = scale.y; }
  const rot = ch.rotation ? evalChannel(ch.rotation, local, 'rotation') : null;
  if (rot != null) out.rotation = rot;
  const alpha = ch.alpha ? evalChannel(ch.alpha, local, 'alpha') : null;
  if (alpha != null) out.alpha = alpha;
  const tint = ch.tint ? evalChannel(ch.tint, local, 'tint') : null;
  if (tint) { out.tintR = tint.r; out.tintG = tint.g; out.tintB = tint.b; }
  return out;
}

/** Drop middle keys that sit exactly on the line between neighbours. */
function pruneLinear(keys, epsilon = 1e-4) {
  if (keys.length <= 2) return keys;
  const out = [keys[0]];
  for (let i = 1; i < keys.length - 1; i++) {
    const a = out[out.length - 1];
    const b = keys[i];
    const c = keys[i + 1];
    const span = c.t - a.t;
    if (span <= 1e-9) continue;
    const expect = a.v + (c.v - a.v) * ((b.t - a.t) / span);
    if (Math.abs(expect - b.v) > epsilon) out.push(b);
  }
  out.push(keys[keys.length - 1]);
  return out;
}

/**
 * Bake one layer. Returns { animated: boolean, props: { x: [{t,v}], … } }.
 * Props with no animation come back as empty arrays.
 *
 * @param {object} scene
 * @param {object} layer
 * @param {'landscape'|'portrait'} orientation
 * @param {number} fps        bake sampling rate
 */
export function bakeLayer(scene, layer, orientation, fps = 30) {
  const duration = Math.max(0.05, Number(scene.stage?.duration) || 5);
  const transform = orientation === 'portrait'
    ? (layer.transforms?.portrait ?? layer.transforms?.landscape)
    : layer.transforms?.landscape;
  const base = baseValues(transform);

  const clips = tracksForLayer(scene, layer.id)
    .flatMap((tr) => tr.clips || [])
    .filter((c) => c.channels && Object.keys(c.channels).length);
  if (!clips.length) {
    return { animated: false, base, props: Object.fromEntries(PROPS.map((p) => [p, []])) };
  }

  const step = 1 / Math.max(1, fps);
  const samples = [];
  let prev = { ...base };
  for (let t = 0; t <= duration + 1e-9; t += step) {
    const time = Math.min(t, duration);
    const clip = activeClipAt(clips, time);
    prev = clip ? sampleClip(clip, time, base, prev) : prev;
    samples.push({ t: time, v: { ...prev } });
    if (time >= duration) break;
  }
  // Make clip boundaries exact: add samples at every clip start.
  for (const c of clips) {
    if (c.start > 0 && c.start < duration && !samples.some((s) => Math.abs(s.t - c.start) < 1e-6)) {
      const clip = activeClipAt(clips, c.start);
      const v = clip ? sampleClip(clip, c.start, base, base) : base;
      samples.push({ t: c.start, v });
    }
  }
  samples.sort((a, b) => a.t - b.t);

  const props = {};
  let animated = false;
  for (const p of PROPS) {
    const keys = pruneLinear(samples.map((s) => ({ t: s.t, v: s.v[p] })),
      (p === 'alpha' || p.startsWith('tint') || p.startsWith('scale')) ? 1e-4 : 5e-3);
    const constant = keys.every((k) => Math.abs(k.v - keys[0].v) < 1e-6);
    props[p] = constant ? [] : keys;
    if (!constant) animated = true;
  }
  return { animated, base, props };
}

/**
 * Collect spinner action clips for a spinner-asset layer — consumed by the
 * generated YggSpinner component and the canvas descriptor JSON.
 * Returns null when the layer is not a spinner.
 */
export function spinnerCuesForLayer(scene, layer) {
  const asset = (scene.assets || []).find((a) => a.id === layer.assetId);
  if (!asset || asset.type !== 'spinner' || !asset.spinner) return null;
  const cfg = normalizeSpinnerConfig(asset.spinner);
  if (!cfg) return null;

  const actionSet = new Set(SPINNER_ACTIONS);
  const clips = tracksForLayer(scene, layer.id)
    .flatMap((tr) => tr.clips || [])
    .filter((c) => actionSet.has(c.action))
    .sort((a, b) => a.start - b.start);

  // Wrap string[] rows with { cells } so Unity JsonUtility can deserialize them
  // (JsonUtility does not support string[][] / jagged arrays directly).
  const row = (arr) => ({ cells: Array.isArray(arr) ? arr : [] });

  const configJson = JSON.stringify({
    symbols: cfg.symbols.map((s) => ({
      id: s.id, name: s.name, assetId: s.assetId || '', blurAssetId: s.blurAssetId || '',
      // Real per-symbol Spine anim lengths (seconds, 0 = unknown). Resolved in
      // the web runtime and persisted on the model; the C# evaluator uses them
      // (when > 0) so each win/land plays its full length, not a fixed default.
      winDur: s.winAnim?.duration > 0 ? s.winAnim.duration : 0,
      landDur: s.landAnim?.duration > 0 ? s.landAnim.duration : 0
    })),
    reels: cfg.grid.reels, rows: cfg.grid.rows,
    cellW: cfg.grid.cellW, cellH: cfg.grid.cellH, spacingX: cfg.grid.spacingX, spacingY: cfg.grid.spacingY,
    symbolScale: cfg.grid.symbolScale,
    direction: cfg.direction,
    strips: cfg.strips.map(row),
    initialBoard: cfg.initialBoard.map(row),
    startDuration: cfg.timing.startDuration, spinSpeed: cfg.timing.spinSpeed,
    stopDuration: cfg.timing.stopDuration,
    reelStaggerStart: cfg.timing.reelStaggerStart, reelStaggerStop: cfg.timing.reelStaggerStop,
    startEase: cfg.timing.startEase, stopEase: cfg.timing.stopEase,
    bounceCurve: cfg.bounce.curve, bounceAmplitude: cfg.bounce.amplitude, bounceDurationFrac: cfg.bounce.durationFrac,
    blurEnabled: cfg.blur.enabled, blurVLo: cfg.blur.vLo, blurVHi: cfg.blur.vHi,
    winDelay: cfg.events.winDelay, landAnimDuration: cfg.events.landAnimDuration, winAnimDuration: cfg.events.winAnimDuration
  });

  return {
    configJson,
    clips: clips.map((c) => {
      // Action params live under `c.spinner` on a normalized clip (see
      // normalizeSpinnerClipPayload); tolerate a flat clip too.
      const sp = c.spinner || c;
      // Outcome-driven stopSpin clips (T12 "Result" threshold) carry
      // `outcome`/`rerollSeed` instead of a fixed targetBoard — resolve to a
      // concrete board at bake time via the same path the web runtime uses,
      // so Unity doesn't just export `targetBoard: null` for these.
      const board = sp.targetBoard || (c.action === 'stopSpin' && sp.outcome ? targetBoardForClip(cfg, c) : null);
      return {
        action: c.action,
        start: c.start ?? 0,
        duration: c.duration ?? 0,
        targetBoard: board ? board.map(row) : null,
        matchEntrySpeed: sp.matchEntrySpeed !== false,
        perReelStartDelay: sp.perReelStartDelay || [],
        perReelStopDelay: sp.perReelStopDelay || [],
        // §A presentWin params (carried for the Unity spinner track + runtime).
        reelWinStagger: sp.reelWinStagger || 0,
        perReelWinDelay: sp.perReelWinDelay || []
      };
    })
  };
}

/**
 * Collect spine animation cues for a layer's clips — consumed by the
 * generated YggScenePlayer (and the editor Timeline builder).
 */
export function spineCuesForLayer(scene, layer) {
  if (!layer.spine) return [];
  const cues = [];
  for (const tr of tracksForLayer(scene, layer.id)) {
    for (const clip of tr.clips || []) {
      if (!clip.anim) continue;
      cues.push({
        layerId: layer.id,
        anim: clip.anim,
        start: clip.start,
        duration: clip.duration,
        speed: clip.speed ?? 1,
        loop: clip.loop !== false,
        mixDuration: clip.mixDuration,
        // Spine AnimationState track index this clip plays on (default 0). Same
        // clamp as engine/sceneModel.js normalizeClip. Consumed by prefab.js +
        // csharp.js — without this every cue silently exported as track 0.
        trackIndex: (() => {
          const n = Number(clip.track);
          return Number.isFinite(n) && n >= 0 ? Math.min(64, Math.floor(n)) : 0;
        })(),
        // Spine Animation State clip parity (Unity export round 2, item #4).
        holdPrevious: clip.holdPrevious === true,
        useBlendDuration: clip.useBlendDuration === true,
        clipIn: Number.isFinite(Number(clip.clipIn)) && Number(clip.clipIn) > 0 ? Number(clip.clipIn) : 0,
        alpha: Number.isFinite(Number(clip.alpha)) ? Math.min(1, Math.max(0, Number(clip.alpha))) : 1,
        // Spine clip parity round 2 (phase 3 §D).
        easeIn: Number.isFinite(Number(clip.easeIn)) && Number(clip.easeIn) > 0 ? Number(clip.easeIn) : 0,
        easeOut: Number.isFinite(Number(clip.easeOut)) && Number(clip.easeOut) > 0 ? Number(clip.easeOut) : 0,
        defaultMixDuration: clip.defaultMixDuration === true,
        dontPause: clip.dontPause === true,
        dontEnd: clip.dontEnd === true,
        clipEndMixOut: Number.isFinite(Number(clip.clipEndMixOut)) && Number(clip.clipEndMixOut) > 0 ? Number(clip.clipEndMixOut) : 0,
        eventThreshold: Number.isFinite(Number(clip.eventThreshold)) ? Math.min(1, Math.max(0, Number(clip.eventThreshold))) : 0,
        attachmentThreshold: Number.isFinite(Number(clip.attachmentThreshold)) ? Math.min(1, Math.max(0, Number(clip.attachmentThreshold))) : 0,
        drawOrderThreshold: Number.isFinite(Number(clip.drawOrderThreshold)) ? Math.min(1, Math.max(0, Number(clip.drawOrderThreshold))) : 0
      });
    }
  }
  cues.sort((a, b) => a.start - b.start);
  return cues;
}
