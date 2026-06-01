// Copy-on-write resolution for per-orientation layer transforms.
//
// `transforms.portrait === null` means "inherit from landscape".
// First mutation in portrait copies landscape into portrait, then mutates.
// "Reset portrait" sets portrait back to null.

/** @typedef {import('./sceneModel.js').Transform} Transform */
/** @typedef {import('./sceneModel.js').SceneLayer} SceneLayer */
/** @typedef {import('./sceneModel.js').Orientation} Orientation */

/**
 * Resolve the effective transform for the active orientation.
 * `portrait === null` falls back to landscape.
 * @param {SceneLayer} layer
 * @param {Orientation} orientation
 * @returns {Transform}
 */
export function resolveTransform(layer, orientation) {
  if (orientation === 'landscape') return layer.transforms.landscape;
  return layer.transforms.portrait ?? layer.transforms.landscape;
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
export function patchTransform(layer, orientation, patch) {
  if (orientation === 'landscape') {
    return {
      ...layer,
      transforms: {
        ...layer.transforms,
        landscape: { ...layer.transforms.landscape, ...patch }
      }
    };
  }
  // portrait edit — copy from landscape if currently inheriting
  const base = layer.transforms.portrait ?? layer.transforms.landscape;
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
