// Spine 4.2 asset loader.
//
// Yggdrasil's pipeline exports:
//   *.json        — skeleton data (JSON form, Spine 4.2)
//   *.atlas.txt   — atlas (Unity convention: .txt suffix so Unity imports as text)
//   *.png         — single atlas page texture
//
// We load all three from blob URLs (quick mode) or scaffold-relative paths,
// stitch them through Spine's core classes, and return a fully-constructed
// `Spine` DisplayObject ready to drop into a Pixi scene graph.

import {
  Spine,
  SkeletonJson,
  TextureAtlas,
  AtlasAttachmentLoader,
  SpineTexture
} from '@esotericsoftware/spine-pixi-v8';
import { Texture } from 'pixi.js';

async function loadText(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch ${url}: ${r.status}`);
  return await r.text();
}

async function loadJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch ${url}: ${r.status}`);
  return await r.json();
}

async function loadPixiTexture(url) {
  // Same approach as png layers — go through HTMLImageElement so data: URLs
  // work without Assets-system mime sniffing.
  const img = new Image();
  img.crossOrigin = 'anonymous';
  await new Promise((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('texture load failed'));
    img.src = url;
  });
  return Texture.from(img);
}

/**
 * Build a Spine instance from three resolved URLs.
 *
 * @param {string} skeletonUrl  blob: or relative URL for the .json
 * @param {string} atlasUrl     blob: or relative URL for the .atlas / .atlas.txt
 * @param {string} textureUrl   blob: or relative URL for the .png
 * @returns {Promise<Spine>}
 */
export async function buildSpineFromUrls(skeletonUrl, atlasUrl, textureUrl) {
  const [skeletonJson, atlasText, pixiTexture] = await Promise.all([
    loadJson(skeletonUrl),
    loadText(atlasUrl),
    loadPixiTexture(textureUrl)
  ]);

  // TextureAtlas parses the atlas text. Pages are listed by filename; we
  // assign the loaded Pixi texture to every page (Yggdrasil atlases ship
  // with a single page in practice).
  const atlas = new TextureAtlas(atlasText);
  const spineTex = SpineTexture.from(pixiTexture.source);
  for (const page of atlas.pages) page.setTexture(spineTex);

  // SkeletonJson reads the skeleton data given the atlas attachment loader.
  const loader = new AtlasAttachmentLoader(atlas);
  const skelLoader = new SkeletonJson(loader);
  // Spine 4.2 JSON uses default scale = 1; expose if needed later.
  skelLoader.scale = 1;
  const skeletonData = skelLoader.readSkeletonData(skeletonJson);

  return new Spine(skeletonData);
}

/**
 * Inspect a Spine instance to list its animations and skins.
 * Used by the Inspector to show pickers.
 */
export function describeSpine(spine) {
  if (!spine?.skeleton) return null;
  const animations = spine.skeleton.data.animations || [];
  const animationDurations = {};
  for (const a of animations) {
    if (a?.name) animationDurations[a.name] = Number(a.duration) || 0;
  }
  return {
    animations: animations.map((a) => a.name),
    animationDurations,
    skins: spine.skeleton.data.skins.map((s) => s.name)
  };
}

/**
 * Compute a stable bounding box for a Spine instance and stash it on the
 * object as `__baseBounds`. Selection drawing and hit-testing read from
 * this cache so they don't jitter as the animation plays.
 *
 * Strategy: pick the largest available source of bounds in this order:
 *   1) `spine.skeleton.getBounds()` after a forced world-transform pass
 *      with the default skin in setup pose
 *   2) `spine.getLocalBounds()` as fallback
 *   3) a small default rect so the user can still see *something* selected
 */
export function snapshotSpineBounds(spine) {
  if (!spine || !spine.skeleton) return;
  try {
    // Drive the animation state forward by one tick so attachments end up
    // at their first-keyframe positions instead of setup pose (which for
    // most Yggdrasil rigs is empty / invisible).
    if (spine.state) {
      try { spine.state.update(0); } catch {}
      try { spine.state.apply(spine.skeleton); } catch {}
    }
    if (typeof spine.skeleton.updateWorldTransform === 'function') {
      try { spine.skeleton.updateWorldTransform(0); } catch {}
    } else if (typeof spine.skeleton.update === 'function') {
      try { spine.skeleton.update(0); } catch {}
    }

    let bx, by, bw, bh;
    if (typeof spine.skeleton.getBoundsRect === 'function') {
      const r = spine.skeleton.getBoundsRect();
      bx = r.x; by = r.y; bw = r.width; bh = r.height;
    } else {
      const lb = spine.getLocalBounds();
      bx = lb.x; by = lb.y; bw = lb.width; bh = lb.height;
    }
    if (!bw || !bh || !isFinite(bw) || !isFinite(bh) || bw < 2 || bh < 2) {
      // Still nothing visible — try sampling several frames across the
      // active animation and take the union of bounds. Handy when the
      // attachments only appear partway through the timeline.
      const fallback = sampleSpineBoundsAcrossActiveTrack(spine);
      if (fallback) {
        bx = fallback.x; by = fallback.y; bw = fallback.width; bh = fallback.height;
      } else {
        bx = -50; by = -50; bw = 100; bh = 100;
      }
    }
    spine.__baseBounds = { x: bx, y: by, width: bw, height: bh };
  } catch {
    spine.__baseBounds = { x: -50, y: -50, width: 100, height: 100 };
  }
}

/**
 * Walk the currently-playing animation in N sample steps and return the
 * union of bounds across them. Falls back to null if nothing measurable.
 */
function sampleSpineBoundsAcrossActiveTrack(spine, steps = 10) {
  try {
    const track = spine.state?.tracks?.[0];
    const anim = track?.animation;
    if (!anim?.duration) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const dt = anim.duration / steps;
    for (let i = 0; i <= steps; i++) {
      try {
        spine.state.update(dt);
        spine.state.apply(spine.skeleton);
        spine.skeleton.updateWorldTransform?.(0);
      } catch {}
      let r;
      try { r = spine.skeleton.getBoundsRect(); } catch {}
      if (!r) {
        try { r = spine.getLocalBounds(); } catch {}
      }
      if (r && r.width > 0 && r.height > 0 && isFinite(r.width) && isFinite(r.height)) {
        minX = Math.min(minX, r.x);
        minY = Math.min(minY, r.y);
        maxX = Math.max(maxX, r.x + r.width);
        maxY = Math.max(maxY, r.y + r.height);
      }
    }
    if (!isFinite(minX)) return null;
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  } catch { return null; }
}

/**
 * Apply an animation track and skin to a Spine instance.
 *
 * @param {Spine} spine
 * @param {{animation?: string|null, loop?: boolean, skin?: string|null}} opts
 */
export function applySpineState(spine, { animation, loop = true, skin } = {}) {
  if (!spine) return;
  if (typeof skin === 'string' && skin) {
    try { spine.skeleton.setSkinByName(skin); spine.skeleton.setupPoseSlots(); } catch { /* skin missing */ }
  }
  if (animation === null || animation === '') {
    spine.state.clearTracks();
    spine.skeleton.setupPose();
  } else if (typeof animation === 'string') {
    try { spine.state.setAnimation(0, animation, !!loop); }
    catch { /* animation missing */ }
  }
}

/**
 * Heuristic: when the user drops multiple files at once, group anything
 * that looks like a Spine triple (.json + .atlas[.txt] + .png with matching
 * base name) into one "spine drop". Returns:
 *   { spineGroups: [{ basename, json, atlas, texture }], looseFiles: [File] }
 */
export function groupSpineFiles(files) {
  const arr = Array.from(files);
  const consumed = new Set();
  const spineGroups = [];

  const kindOf = (name) => {
    if (/\.json$/i.test(name)) return 'json';
    if (/\.atlas(\.txt)?$/i.test(name)) return 'atlas';
    if (/\.png$/i.test(name)) return 'png';
    return null;
  };
  const baseOf = (name) => name.replace(/\.atlas\.txt$/i, '').replace(/\.(json|atlas|png)$/i, '');

  const jsons = arr.filter((f) => kindOf(f.name) === 'json');
  const atlases = arr.filter((f) => kindOf(f.name) === 'atlas');
  const pngs = arr.filter((f) => kindOf(f.name) === 'png');

  const byBase = (list) => {
    const m = new Map();
    for (const f of list) m.set(baseOf(f.name), f);
    return m;
  };
  const atlasByBase = byBase(atlases);
  const pngByBase = byBase(pngs);

  // Yggdrasil pattern: multiple .json files share ONE atlas + texture. If
  // a .json has no exact-name partner, fall back to the lone atlas+png pair
  // in the drop (when there is exactly one).
  const loneAtlas = atlases.length === 1 ? atlases[0] : null;
  const lonePng = pngs.length === 1 ? pngs[0] : null;

  for (const json of jsons) {
    const base = baseOf(json.name);
    let atlas = atlasByBase.get(base);
    let texture = pngByBase.get(base);
    if (!atlas && loneAtlas) atlas = loneAtlas;
    if (!texture && lonePng) texture = lonePng;
    if (atlas && texture) {
      spineGroups.push({ basename: base, json, atlas, texture });
      consumed.add(json); consumed.add(atlas); consumed.add(texture);
    }
  }
  const looseFiles = arr.filter((f) => !consumed.has(f));
  return { spineGroups, looseFiles };
}
