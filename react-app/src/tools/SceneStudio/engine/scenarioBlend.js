// Scene Studio — Direct-mode crossfade pose blend.
//
// During a SAME-SCENE crossfade hand-off, two timelines on the same layer set
// coexist. This module evaluates each layer's transform-channel pose from both
// timelines and blends the opted-in channels, baking the result into a static
// preview scene (empty flow) the PixiViewport can render directly. Non-opted
// channels snap to the incoming timeline (a cut), matching §9.
//
// Scope: transform channels (position / scale / rotation / alpha / tint).
// Spine/video skeletal/playback animation isn't cross-blended — only the
// container transform is. That covers the common case (e.g. a tint crossfade).

import { evalChannel, channelFirstKeyTime, clipLocalSeconds } from './animation/keyframes.js';
import { deriveFlowGraph } from './sceneModel.js';
import { resolveTransform } from './orientationManager.js';

const TRANSFORM_CHANNELS = ['position', 'scale', 'rotation', 'alpha', 'tint'];
const lerp = (a, b, f) => a + (b - a) * f;

// Routed through orientationManager's resolveTransform (not a local landscape/
// portrait ?? fallback) so a portrait layer with no override gets the SAME
// centre-relative inherited pose the live editor renders. A local duplicate
// here previously read the raw landscape transform, so a portrait crossfade's
// blend endpoints disagreed with what was actually on stage.
function baseTransform(layer, orientation, stage) {
  const t = resolveTransform(layer, orientation, stage);
  return t || { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, alpha: 1, tint: { r: 1, g: 1, b: 1 } };
}

/** Fold a layer's clips at time `t` into per-channel values (mirrors applyPngChannels). */
function resolveChannelValues(tracks, layerId, t) {
  const out = {};
  for (const track of tracks || []) {
    if (track.layerId !== layerId || !track.clips?.length) continue;
    const clips = track.clips.filter((c) => c.start <= t && c.channels).sort((a, b) => a.start - b.start);
    if (!clips.length) continue;
    for (const name of TRANSFORM_CHANNELS) {
      let val;
      for (const clip of clips) {
        const ch = clip.channels[name];
        if (!ch) continue;
        if (clip.clearAfterEnd === true && t >= clip.start + clip.duration) continue;
        const speed = clip.speed > 0 ? clip.speed : 1;
        const rawLocal = Math.max(0, t - clip.start) * speed;
        const firstT = channelFirstKeyTime(ch);
        if (firstT != null && rawLocal < firstT - 1e-6) continue;
        const localT = clipLocalSeconds(clip, t, { clampPastEnd: true });
        const v = evalChannel(ch, localT, name);
        if (v != null) val = v;
      }
      if (val !== undefined) out[name] = val;
    }
  }
  return out;
}

/**
 * Resolve a layer's flat transform (base pose overridden by channel values) at
 * `t`. `baseOverride` substitutes the layer's authored base pose — used by the
 * direct-mode pose carry so a hold/crossfade segment starts from the pose the
 * previous segment ended on instead of the setup pose.
 */
export function resolveLayerTransform(tracks, layer, t, orientation, baseOverride = null, stage = null) {
  const base = baseOverride || baseTransform(layer, orientation, stage);
  const ch = resolveChannelValues(tracks, layer.id, t);
  return {
    ...base,
    x: ch.position?.x ?? base.x,
    y: ch.position?.y ?? base.y,
    scaleX: ch.scale?.x ?? base.scaleX,
    scaleY: ch.scale?.y ?? base.scaleY,
    rotation: ch.rotation ?? base.rotation,
    alpha: ch.alpha ?? (base.alpha ?? 1),
    tint: ch.tint ?? (base.tint ?? { r: 1, g: 1, b: 1 })
  };
}

/**
 * Blend two flat transforms by `f` (0=A → 1=B); opted-in channels lerp, others
 * HOLD A (the outgoing/carried pose) for the whole overlap window. Holding A
 * instead of snapping to B is what makes an alpha-only crossfade change
 * nothing but alpha: an unmasked position/scale/rotation would otherwise jump
 * to the incoming timeline's pose the instant the overlap begins. Once the
 * overlap ends, the incoming timeline plays alone and its own authored pose
 * takes over — this only governs the shared window.
 */
export function blendTransforms(A, B, f, mask = {}) {
  const at = A.tint || { r: 1, g: 1, b: 1 };
  const bt = B.tint || { r: 1, g: 1, b: 1 };
  return {
    ...B,
    x: mask.position ? lerp(A.x, B.x, f) : A.x,
    y: mask.position ? lerp(A.y, B.y, f) : A.y,
    scaleX: mask.scale ? lerp(A.scaleX, B.scaleX, f) : A.scaleX,
    scaleY: mask.scale ? lerp(A.scaleY, B.scaleY, f) : A.scaleY,
    rotation: mask.rotation ? lerp(A.rotation, B.rotation, f) : A.rotation,
    alpha: mask.alpha ? lerp(A.alpha ?? 1, B.alpha ?? 1, f) : (A.alpha ?? 1),
    tint: mask.tint
      ? { r: lerp(at.r, bt.r, f), g: lerp(at.g, bt.g, f), b: lerp(at.b, bt.b, f) }
      : at
  };
}

/**
 * Bake carried poses into a layer array as the new base transforms for the
 * given orientation. Layers without a carried pose pass through untouched;
 * timeline channels still override on top (a carried pose is only the BASE).
 */
export function bakeCarriedPoses(layers, poses, orientation) {
  if (!poses) return layers;
  return (layers || []).map((layer) => {
    const pose = poses[layer.id];
    if (!pose) return layer;
    const transforms = { ...(layer.transforms || {}) };
    transforms[orientation] = { ...transforms[orientation], ...pose };
    return { ...layer, transforms };
  });
}

/**
 * Bake a static preview scene whose layer poses are the blended result of two
 * timelines from the SAME scene. `sceneData` is the origin scene's data (minus
 * assets); `assets` is the shared pool. `carryPoses` ({layerId: pose}) seeds
 * both sides' base poses so layers a timeline doesn't key blend from/to the
 * carried pose instead of snapping to the setup pose.
 */
export function buildBlendedScene(sceneData, assets, outTracks, outT, inTracks, inT, f, mask, carryPoses = null) {
  const orientation = sceneData.stage?.activeOrientation || 'landscape';
  const stage = sceneData.stage || null;
  const layers = (sceneData.layers || []).map((layer) => {
    const carried = carryPoses?.[layer.id] || null;
    const A = resolveLayerTransform(outTracks, layer, outT, orientation, carried, stage);
    const B = resolveLayerTransform(inTracks, layer, inT, orientation, carried, stage);
    const blended = blendTransforms(A, B, f, mask || {});
    const transforms = { ...(layer.transforms || {}) };
    transforms[orientation] = { ...transforms[orientation], ...blended };
    return { ...layer, transforms };
  });
  return {
    ...sceneData,
    assets: assets || [],
    layers,
    // Flags this as a baked blend (empty flow, transform-channels-only) for
    // pixiApp's T4 driven-alpha gate — without it every spinner/winseq would
    // read as "never driven" (0 tracks) and vanish during every crossfade.
    __isBakedBlend: true,
    flow: deriveFlowGraph({ tracks: [], markers: [], nodes: [], edges: [] })
  };
}
