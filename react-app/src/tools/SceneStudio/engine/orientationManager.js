// Copy-on-write resolution for per-orientation layer transforms.
//
// `transforms.portrait === null` means "inherit from landscape".
// First mutation in portrait copies the (center-remapped) landscape transform
// into portrait, then mutates. "Reset portrait" sets portrait back to null.
//
// Inheritance is CENTER-RELATIVE (2026-07-02, PLAN_2026-07 M8): an inherited
// portrait keeps the object's pixel offset from the stage CENTRE rather than
// its absolute top-left position, so switching orientation (which usually has
// different dimensions) doesn't shove everything toward a corner. The stored
// model still uses a top-left origin — only the inheritance mapping and the
// inspector display are centre-relative, so there's no data migration.

/** @typedef {import('./sceneModel.js').Transform} Transform */
/** @typedef {import('./sceneModel.js').SceneLayer} SceneLayer */
/** @typedef {import('./sceneModel.js').Orientation} Orientation */

/** Remap a landscape transform onto the portrait stage, preserving offset
 *  from centre. Falls back to the raw landscape transform if stage dims are
 *  unavailable (keeps the old behaviour). */
function inheritedPortrait(landscape, stage) {
  const L = stage?.orientations?.landscape;
  const P = stage?.orientations?.portrait;
  if (!L || !P || !landscape) return landscape;
  return {
    ...landscape,
    x: P.w / 2 + ((landscape.x ?? 0) - L.w / 2),
    y: P.h / 2 + ((landscape.y ?? 0) - L.h / 2)
  };
}

/**
 * Resolve the effective transform for the active orientation.
 * `portrait === null` falls back to landscape, remapped centre-relative when
 * the stage dimensions are supplied.
 * @param {SceneLayer} layer
 * @param {Orientation} orientation
 * @param {object} [stage] scene.stage — enables centre-relative portrait inherit
 * @returns {Transform}
 */
export function resolveTransform(layer, orientation, stage = null) {
  if (orientation === 'landscape') return layer.transforms.landscape;
  if (layer.transforms.portrait) return layer.transforms.portrait;
  // Only top-level layers live in stage space, so only they get the centre
  // remap. A child's x/y is PARENT-local (0,0 = the parent's origin), which is
  // already orientation-independent — remapping it by the stage-centre delta
  // would shove it off the parent. Inherit child transforms verbatim.
  if (layer.parentId) return layer.transforms.landscape;
  return inheritedPortrait(layer.transforms.landscape, stage);
}

/**
 * Mutate a layer's transform for the given orientation, performing
 * copy-on-write if portrait is currently null.
 *
 * Returns a NEW layer object (immutable update).
 *
 * @param {SceneLayer} layer
 * @param {Orientation} orientation
 * @param {Partial<Transform>} patch
 * @returns {SceneLayer}
 */
export function patchTransform(layer, orientation, patch, stage = null) {
  if (orientation === 'landscape') {
    return {
      ...layer,
      transforms: {
        ...layer.transforms,
        landscape: { ...layer.transforms.landscape, ...patch }
      }
    };
  }
  // portrait edit — copy the (centre-remapped for top-level, verbatim for
  // children) landscape transform if currently inheriting, so the first edit
  // doesn't jump the object.
  const base = layer.transforms.portrait
    ?? (layer.parentId ? layer.transforms.landscape : inheritedPortrait(layer.transforms.landscape, stage));
  return {
    ...layer,
    transforms: {
      ...layer.transforms,
      portrait: { ...base, ...patch }
    }
  };
}

/**
 * Reset portrait override; layer falls back to landscape.
 * @param {SceneLayer} layer
 * @returns {SceneLayer}
 */
export function resetPortrait(layer) {
  return {
    ...layer,
    transforms: { ...layer.transforms, portrait: null }
  };
}

export function hasPortraitOverride(layer) {
  return layer.transforms.portrait != null;
}
