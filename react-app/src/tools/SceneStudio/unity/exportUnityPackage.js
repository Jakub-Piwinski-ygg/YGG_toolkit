// Unity package export orchestrator (Scene Studio Phase 4.2).
//
// Pipeline: collect scene assets → resolve bytes (FS Access root or data
// URLs) → place into a Unity scaffold (Art/StaticArt, Art/Animations/<name>,
// Scenes/<scene>) → generate .meta import settings per category → bake the
// Scene Studio timeline into a .anim → emit a prefab per canvas + generated
// C# (player, editor, Timeline builder) → pack everything into a gzipped-tar
// .unitypackage.

import { buildLayerTree } from '../engine/sceneModel.js';
import { normalizeSpinnerConfig } from '../engine/spinner/spinnerModel.js';
import { resolveAssetFile } from '../engine/persist.js';
import { guidFor, pngSize, dataUrlToBytes, safeName } from './guid.js';
import { buildUnityPackage } from './tar.js';
import { folderMeta, textureMeta, textMeta, nativeMeta, monoMeta, defaultMeta, asmdefMeta } from './metaFiles.js';
import { bakeLayer, spineCuesForLayer, spinnerCuesForLayer } from './bake.js';
import { buildAnimationClip } from './animClip.js';
import { buildPrefab, UI_IMAGE_GUID } from './prefab.js';
import {
  SCRIPT_PATHS,
  scenePlayerSource,
  spinnerSource,
  yggSpinnerClipSource,
  yggSpinnerTrackSource,
  scenePlayerEditorSource,
  timelineBuilderSource,
  packageBootstrapSource,
  spineAutoWireSource,
  runtimeAsmdefSource,
  runtimeTimelineAsmdefSource,
  editorAsmdefSource,
  timelineAsmdefSource
} from './csharp.js';

export const DEFAULT_UNITY_SETTINGS = {
  packageName: '',
  variant: 'ui',                 // 'ui' | 'world'
  pixelsPerUnit: 100,
  bakeFps: 30,
  staticCompression: 'none',     // 'none' | 'lq' | 'normal' | 'hq'
  spineCompression: 'none',
  alphaIsTransparency: true,
  includeVideos: false,
  // Opt-in: when false the imported prefab never auto-builds a Unity Timeline
  // (use the inspector "Build Unity Timeline" button). Default off by design.
  autoBuildTimeline: false,
  // Stable script GUIDs from the official spine-unity UPM/unitypackage
  // distribution (verified against spine-runtimes 4.2; unchanged across
  // 4.x). Editable in the dialog for exotic installs.
  spineGraphicGuid: 'd85b887af7e6c3f45a2e2d2920d641bc',    // SkeletonGraphic.cs
  spineAnimationGuid: 'd247ba06193faa74d9335f5481b2b56c',  // SkeletonAnimation.cs
  perAssetCompression: {}        // assetId → compression override
};

const radToDeg = (r) => -(Number(r) || 0) * (180 / Math.PI);

async function bytesForSrc(src, rootHandle, sceneBasePath) {
  const embedded = dataUrlToBytes(src);
  if (embedded) return embedded;
  // Wizard-generated assets (e.g. spinner blur PNGs) live as in-memory
  // blob: URLs — fetch them directly so they get packaged instead of dropped.
  if (typeof src === 'string' && src.startsWith('blob:')) {
    try {
      const resp = await fetch(src);
      if (!resp.ok) return null;
      return new Uint8Array(await resp.arrayBuffer());
    } catch {
      return null;
    }
  }
  const file = await resolveAssetFile(src, rootHandle, sceneBasePath);
  if (!file) return null;
  return new Uint8Array(await file.arrayBuffer());
}

function lastSegment(p) {
  const segs = String(p || '').split(/[\\/]/).filter(Boolean);
  return segs[segs.length - 1] || 'asset';
}

/**
 * 4×4 white PNG used as the SpriteMask sprite for world-variant spinner reels.
 * Size must match SPINNER_MASK_PX in prefab.js (the baked mask scale divides
 * the column size by it).
 */
function whiteMaskPngBytes() {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 4;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 4, 4);
  return dataUrlToBytes(c.toDataURL('image/png'));
}

/** A scene view whose live `flow` is one specific timeline (for baking). */
export function sceneForTimeline(scene, tl) {
  return {
    ...scene,
    flow: { tracks: tl?.tracks || [], markers: tl?.markers || [], nodes: [], edges: [] }
  };
}

/** The scene's timelines, with a back-compat fallback to its legacy flow. */
export function timelinesOf(scene) {
  if (Array.isArray(scene.timelines) && scene.timelines.length) return scene.timelines;
  return [{
    id: scene.activeTimelineId || 'timeline_0',
    name: 'Timeline 1',
    tracks: scene.flow?.tracks || [],
    markers: scene.flow?.markers || []
  }];
}

/**
 * Build one Unity AnimationClip track from a layer's bake. Pure transform of
 * the baked key arrays into Unity attribute curves (UI vs world variant).
 * Returns null when nothing animates.
 */
function buildLayerAnimTrack(bake, { path, isRoot, ui, info, stage, ppu, spineGraphicGuid, warnings }) {
  if (!bake.animated) return null;
  const k = ui ? 1 : 1 / ppu;
  const offX = isRoot ? stage.w / 2 : 0;
  const offY = isRoot ? stage.h / 2 : 0;
  const track = { path, floats: [] };
  const posKeys = mergeVec(bake.props.x, bake.props.y, bake.base.x, bake.base.y);
  if (posKeys) {
    const conv2 = posKeys.map((kf) => ({ t: kf.t, v: { x: (kf.v.x - offX) * k, y: -(kf.v.y - offY) * k } }));
    if (ui) {
      track.floats.push({ attribute: 'm_AnchoredPosition.x', classID: 224, keys: conv2.map((kf) => ({ t: kf.t, v: kf.v.x })) });
      track.floats.push({ attribute: 'm_AnchoredPosition.y', classID: 224, keys: conv2.map((kf) => ({ t: kf.t, v: kf.v.y })) });
    } else {
      track.position = conv2;
    }
  }
  const scaleKeys = mergeVec(bake.props.scaleX, bake.props.scaleY, bake.base.scaleX, bake.base.scaleY);
  if (scaleKeys) track.scale = scaleKeys;
  if (bake.props.rotation.length) track.euler = bake.props.rotation.map((kf) => ({ t: kf.t, v: radToDeg(kf.v) }));
  if (bake.props.alpha.length) {
    track.floats.push(ui
      ? { attribute: 'm_Alpha', classID: 225, keys: bake.props.alpha }
      : { attribute: 'm_Color.a', classID: 212, keys: bake.props.alpha });
  }
  const tintAnimated = bake.props.tintR.length || bake.props.tintG.length || bake.props.tintB.length;
  if (tintAnimated) {
    if (!ui && info.kind === 'spine') {
      warnings.push(`"${path}": tint animation on a spine layer is not supported in the world variant — skipped.`);
    } else {
      const colorClassId = ui ? 114 : 212;
      const scriptGuid = ui ? (info.kind === 'spine' ? spineGraphicGuid : UI_IMAGE_GUID) : null;
      for (const [prop, comp] of [['tintR', 'r'], ['tintG', 'g'], ['tintB', 'b']]) {
        const keys = bake.props[prop].length ? bake.props[prop] : [{ t: 0, v: bake.base[prop] }];
        track.floats.push({ attribute: `m_Color.${comp}`, classID: colorClassId, scriptGuid, keys });
      }
    }
  }
  return (track.position || track.scale || track.euler || track.floats.length) ? track : null;
}

/**
 * Bake every layer for one timeline. `flatInfos` is the geometry-built list of
 * { layer, isRoot, path, info } captured once from the node tree. Returns the
 * per-timeline { animTracks, spineCues, spinnerCues }.
 */
export function bakeTimelineForCanvas(tlScene, flatInfos, { orientation, bakeFps, ui, stage, settings, warnings }) {
  const animTracks = [];
  const spineCues = [];
  const spinnerCues = [];
  for (const { layer, isRoot, path, info } of flatInfos) {
    const bake = bakeLayer(tlScene, layer, orientation, bakeFps);
    const track = buildLayerAnimTrack(bake, {
      path, isRoot, ui, info, stage, ppu: settings.pixelsPerUnit,
      spineGraphicGuid: settings.spineGraphicGuid, warnings
    });
    if (track) animTracks.push(track);
    for (const cue of spineCuesForLayer(tlScene, layer)) spineCues.push({ ...cue, target: path });
    if (info.kind === 'spinner') {
      const sc = spinnerCuesForLayer(tlScene, layer);
      if (sc) spinnerCues.push({ target: path, ...sc });
    }
  }
  return { animTracks, spineCues, spinnerCues };
}

/** Convert a scene transform to Unity space for prefab placement. */
function convertTransform(t, { isRoot, stage, ui, ppu }) {
  const x = (t?.x ?? 0) - (isRoot ? stage.w / 2 : 0);
  const y = -((t?.y ?? 0) - (isRoot ? stage.h / 2 : 0));
  const k = ui ? 1 : 1 / ppu;
  const anchor = Array.isArray(t?.anchor) ? t.anchor : [0.5, 0.5];
  return {
    pos: { x: x * k, y: y * k },
    scale: { x: t?.scaleX ?? 1, y: t?.scaleY ?? 1 },
    rotDeg: radToDeg(t?.rotation),
    alpha: typeof t?.alpha === 'number' ? t.alpha : 1,
    tint: t?.tint || { r: 1, g: 1, b: 1 },
    pivot: { x: anchor[0], y: 1 - anchor[1] }
  };
}

/**
 * Export the scene as a .unitypackage Blob.
 *
 * @returns {Promise<{blob: Blob, fileName: string, warnings: string[], stats: object}>}
 */
export async function exportUnityPackage({ scene, rootHandle, sceneBasePath, settings: userSettings, onProgress }) {
  const settings = { ...DEFAULT_UNITY_SETTINGS, ...(userSettings || {}) };
  // Persisted settings from older versions may carry empty spine GUIDs that
  // would shadow the baked-in defaults — empty always means "use default".
  if (!settings.spineGraphicGuid) settings.spineGraphicGuid = DEFAULT_UNITY_SETTINGS.spineGraphicGuid;
  if (!settings.spineAnimationGuid) settings.spineAnimationGuid = DEFAULT_UNITY_SETTINGS.spineAnimationGuid;
  const warnings = [];
  const progress = (msg) => { if (onProgress) onProgress(msg); };

  const pkg = safeName(settings.packageName || scene.name || 'Scene', 'Scene');
  const sceneName = safeName(scene.name, 'Scene');
  const ui = settings.variant !== 'world';
  const orientation = scene.stage?.activeOrientation === 'portrait' ? 'portrait' : 'landscape';
  const stage = scene.stage?.orientations?.[orientation] || { w: 1920, h: 1080 };
  const duration = Math.max(0.05, Number(scene.stage?.duration) || 5);
  const base = `Assets/${pkg}`;

  const items = [];        // { guid, path, data?, meta }
  const itemsByPath = new Map();
  const pushItem = async (path, data, meta, seed = null) => {
    if (itemsByPath.has(path)) return itemsByPath.get(path);
    const guid = await guidFor(seed || `${pkg}:${path}`);
    const item = { guid, path, data, meta: meta(guid) };
    items.push(item);
    itemsByPath.set(path, item);
    return item;
  };
  // Constant-path items (shared runtime scripts) get package-independent
  // GUIDs so two exported scenes can be imported into one project without
  // path/GUID collisions.
  const pushShared = (path, data, meta) => pushItem(path, data, meta, `shared:${path}`);

  // ── 1. Resolve + place assets ─────────────────────────────────────────
  progress('resolving assets…');
  const usedAssetIds = new Set(scene.layers.map((l) => l.assetId).filter(Boolean));
  // Spinner symbol land/win SPINE assets are referenced from the spinner
  // config (not as layer assetIds), so add them explicitly — otherwise the
  // overlay skeletons never ship (§A3). Their triplets export via the normal
  // spine branch below.
  for (const layer of scene.layers) {
    const a = (scene.assets || []).find((x) => x.id === layer.assetId);
    if (a?.type !== 'spinner') continue;
    for (const sym of a.spinner?.symbols || []) {
      for (const an of [sym.landAnim, sym.winAnim]) {
        if (an?.kind === 'spine' && an.assetId) usedAssetIds.add(an.assetId);
      }
    }
  }
  const assetInfo = new Map(); // assetId → { kind, spriteGuid?, size?, spineFolder? }

  for (const asset of scene.assets) {
    if (!usedAssetIds.has(asset.id)) continue;
    const displayName = safeName(asset.meta?.originalName || lastSegment(asset.src), 'Asset');

    if (asset.type === 'png') {
      const bytes = await bytesForSrc(asset.src, rootHandle, sceneBasePath);
      if (!bytes) { warnings.push(`PNG not resolved: ${asset.src} — layer exports without sprite.`); assetInfo.set(asset.id, { kind: 'missing' }); continue; }
      const size = pngSize(bytes);
      const comp = settings.perAssetCompression[asset.id] || settings.staticCompression;
      const path = `${base}/Art/StaticArt/${displayName}.png`;
      const item = await pushItem(path, bytes, (g) => textureMeta(g, {
        compression: comp,
        alphaIsTransparency: settings.alphaIsTransparency,
        pixelsPerUnit: settings.pixelsPerUnit
      }));
      assetInfo.set(asset.id, { kind: 'png', spriteGuid: item.guid, size });
    } else if (asset.type === 'spine') {
      const name = safeName(asset.meta?.originalName || lastSegment(asset.src), 'Spine');
      const json = await bytesForSrc(asset.src, rootHandle, sceneBasePath);
      const atlas = asset.atlas ? await bytesForSrc(asset.atlas, rootHandle, sceneBasePath) : null;
      const tex = asset.texture ? await bytesForSrc(asset.texture, rootHandle, sceneBasePath) : null;
      // A spine skeleton without its atlas+texture is non-functional in
      // spine-unity AND its broken/partial import errors can abort the whole
      // package import (taking down healthy skeletons too). So SKIP it entirely
      // rather than shipping a json-only triplet — and tell the user why.
      if (!json || !atlas || !tex) {
        const miss = [!json && 'json', !atlas && 'atlas', !tex && 'texture'].filter(Boolean).join('+');
        warnings.push(`Spine "${name}": missing ${miss} — SKIPPED (not exported). Atlas/texture are auto-recovered from disk when a project folder is connected; connect the project root (so Scene Studio can find the shared atlas+png) and re-export. Otherwise re-pick the skeleton in the Spinner wizard / Asset Browser.`);
        assetInfo.set(asset.id, { kind: 'missing' });
        continue;
      }
      // Embedded (data:) assets have no usable path segment — fall back to the
      // display name for every file of the triplet.
      const jsonName = asset.src.startsWith('data:') ? name : lastSegment(asset.src).replace(/\.json$/i, '');
      const atlasName = asset.atlas.startsWith('data:')
        ? jsonName
        : lastSegment(asset.atlas).replace(/\.txt$/i, '').replace(/\.atlas$/i, '');
      // Skeletons that SHARE an atlas (made in one Spine project) export into ONE
      // folder named after the atlas, so the atlas .txt + .png export exactly once
      // (pushItem dedups by path) and spine-unity builds a single shared
      // SpineAtlasAsset/material → ONE draw call for all of them, instead of a
      // per-symbol folder+atlas+material (= a draw call per symbol).
      const folder = asset.atlas.startsWith('data:')
        ? `${base}/Art/Animations/${name}`
        : `${base}/Art/Animations/${safeName(atlasName, 'Spine')}`;
      await pushItem(`${folder}/${jsonName}.json`, json, textMeta);
      // spine-unity requires ".atlas.txt"; shared path → exported once.
      await pushItem(`${folder}/${atlasName}.atlas.txt`, atlas, textMeta);
      const texName = asset.texture.startsWith('data:') ? `${atlasName}.png` : lastSegment(asset.texture);
      const texSize = pngSize(tex);
      const comp = settings.perAssetCompression[asset.id] || settings.spineCompression;
      await pushItem(`${folder}/${texName}`, tex, (g) => textureMeta(g, {
        compression: comp,
        alphaIsTransparency: settings.alphaIsTransparency,
        // spine-unity material samples the texture directly; sprite mode off
        spriteMode: 0,
        pixelsPerUnit: settings.pixelsPerUnit
      }));
      // spineName MUST equal the json base — spine-unity names the generated
      // SkeletonDataAsset "<jsonName>_SkeletonData", which autowire matches on.
      assetInfo.set(asset.id, { kind: 'spine', size: texSize, spineName: jsonName, jsonBase: jsonName });
    } else if (asset.type === 'video') {
      if (!settings.includeVideos) { assetInfo.set(asset.id, { kind: 'skipped' }); continue; }
      const bytes = await bytesForSrc(asset.src, rootHandle, sceneBasePath);
      if (!bytes) { warnings.push(`Video not resolved: ${asset.src}`); continue; }
      await pushItem(`${base}/Art/Video/${displayName}${asset.src.match(/\.\w+$/)?.[0] || '.webm'}`, bytes, defaultMeta);
      assetInfo.set(asset.id, { kind: 'video' });
    } else if (asset.type === 'spinner') {
      // Export each symbol's static + blurred PNGs under Art/Spinner/.
      // The symbol png assets may also appear directly on layers (already
      // handled above); pushItem deduplicates by path so they won't double.
      const spinnerCfg = asset.spinner || {};
      const symAssetMap = new Map(); // sym assetId → { spriteGuid, size }
      for (const sym of (spinnerCfg.symbols || [])) {
        for (const [saId, suffix] of [[sym.assetId, ''], [sym.blurAssetId, '_blur']]) {
          if (!saId) continue;
          const sa = scene.assets.find((a) => a.id === saId);
          if (!sa || sa.type !== 'png') continue;
          const bytes = await bytesForSrc(sa.src, rootHandle, sceneBasePath);
          if (!bytes) { warnings.push(`Spinner symbol PNG not resolved: ${sa.src}`); continue; }
          const symName = safeName(sym.name || sym.id, 'Symbol');
          const path = `${base}/Art/Spinner/${symName}${suffix}.png`;
          const comp = settings.perAssetCompression[saId] || settings.staticCompression;
          const item = await pushItem(path, bytes, (g) => textureMeta(g, {
            compression: comp, alphaIsTransparency: settings.alphaIsTransparency, pixelsPerUnit: settings.pixelsPerUnit
          }));
          const info = { kind: 'png', spriteGuid: item.guid, size: pngSize(bytes) };
          symAssetMap.set(saId, info);
          if (!assetInfo.has(saId)) assetInfo.set(saId, info);
        }
      }
      assetInfo.set(asset.id, { kind: 'spinner', symAssetMap });
    } else {
      warnings.push(`Asset type "${asset.type}" not supported in Unity export yet (${displayName}).`);
      assetInfo.set(asset.id, { kind: 'skipped' });
    }
  }

  // ── 2. Generated C# (constant paths + package-independent GUIDs) ──────
  await pushShared(SCRIPT_PATHS.player, scenePlayerSource(), monoMeta);
  await pushShared(SCRIPT_PATHS.spinner, spinnerSource(), monoMeta);
  await pushShared(SCRIPT_PATHS.spinnerClip, yggSpinnerClipSource(), monoMeta);
  await pushShared(SCRIPT_PATHS.spinnerTrack, yggSpinnerTrackSource(), monoMeta);
  await pushShared(SCRIPT_PATHS.playerEditor, scenePlayerEditorSource(), monoMeta);
  await pushShared(SCRIPT_PATHS.timelineBuilder, timelineBuilderSource(), monoMeta);
  await pushShared(SCRIPT_PATHS.packageBootstrap, packageBootstrapSource(), monoMeta);
  await pushShared(SCRIPT_PATHS.spineAutoWire, spineAutoWireSource(), monoMeta);
  await pushShared(SCRIPT_PATHS.runtimeAsmdef, runtimeAsmdefSource(), asmdefMeta);
  await pushShared(SCRIPT_PATHS.runtimeTimelineAsmdef, runtimeTimelineAsmdefSource(), asmdefMeta);
  await pushShared(SCRIPT_PATHS.editorAsmdef, editorAsmdefSource(), asmdefMeta);
  await pushShared(SCRIPT_PATHS.timelineAsmdef, timelineAsmdefSource(), asmdefMeta);
  const playerScriptGuid = itemsByPath.get(SCRIPT_PATHS.player).guid;
  const spinnerScriptGuid = itemsByPath.get(SCRIPT_PATHS.spinner).guid;

  // World-variant spinner reels are masked with SpriteMask — ship a tiny
  // white sprite for it (the UI variant uses RectMask2D, no asset needed).
  let spinnerMaskSpriteGuid = null;
  if (!ui && [...assetInfo.values()].some((i) => i.kind === 'spinner')) {
    const maskBytes = whiteMaskPngBytes();
    if (maskBytes) {
      const maskItem = await pushItem(`${base}/Art/Spinner/YggReelMask.png`, maskBytes, (g) => textureMeta(g, {
        compression: 'none',
        alphaIsTransparency: false,
        pixelsPerUnit: settings.pixelsPerUnit
      }));
      spinnerMaskSpriteGuid = maskItem.guid;
    }
  }

  // ── 3. Per-canvas: bake → anim (one per timeline), descriptor, prefab ──
  const tree = buildLayerTree(scene);
  const canvases = scene.canvases?.length ? scene.canvases : [{ id: '__all', name: 'Canvas' }];
  const sceneFolder = `${base}/Scenes/${sceneName}`;
  let exportedCanvases = 0;

  const timelines = timelinesOf(scene);
  const primaryTl = timelines[0];
  const primaryScene = sceneForTimeline(scene, primaryTl);

  // A layer is "spine-cue driven" if ANY timeline animates its spine state —
  // such a layer must not carry a starting animation in the prefab (§E).
  const layersWithSpineCues = new Set();
  for (const tl of timelines) {
    const tlScene = sceneForTimeline(scene, tl);
    for (const layer of scene.layers) {
      if (spineCuesForLayer(tlScene, layer).length) layersWithSpineCues.add(layer.id);
    }
  }

  for (const canvas of canvases) {
    const rootNodes = tree.get(canvas.id) || [];
    if (!rootNodes.length) continue;
    exportedCanvases++;
    const canvasName = safeName(canvas.name || 'Canvas', 'Canvas');
    progress(`baking canvas "${canvasName}"…`);

    // Geometry pass — build the node tree + descriptor nodes + spinner payload
    // ONCE (timeline-independent), and record a flat { layer, isRoot, path,
    // info } list for the per-timeline bake passes below.
    const descriptorNodes = [];
    const flatInfos = [];

    const buildNodes = (treeNodes, isRoot, pathPrefix, usedNames) => {
      const out = [];
      for (const tn of treeNodes) {
        const layer = tn.layer;
        const info = assetInfo.get(layer.assetId) || { kind: 'group' };
        let name = safeName(layer.name, 'Layer');
        let n = 2;
        while (usedNames.has(name)) name = `${safeName(layer.name, 'Layer')}_${n++}`;
        usedNames.add(name);
        const path = pathPrefix ? `${pathPrefix}/${name}` : name;
        flatInfos.push({ layer, isRoot, path, info });

        const t = orientation === 'portrait'
          ? (layer.transforms?.portrait ?? layer.transforms?.landscape)
          : layer.transforms?.landscape;
        const conv = convertTransform(t, { isRoot, stage, ui, ppu: settings.pixelsPerUnit });
        // Unified visibility model: visibility IS `transform.alpha` (0 = hidden),
        // which convertTransform already baked into conv.alpha. Nothing extra to
        // gate here — the GameObject stays active and a hidden object exports as
        // alpha 0 on its SpriteRenderer/CanvasGroup/Image.
        if (!ui && (conv.pivot.x !== 0.5 || conv.pivot.y !== 0.5)) {
          warnings.push(`"${name}": non-center anchor approximated in world variant (sprite pivot stays centered).`);
        }

        // §E: a spine layer driven by ANY timeline must NOT carry a starting
        // animation (it would play before the first clip and re-trigger on scrub).
        const spineHasCues = info.kind === 'spine' && layersWithSpineCues.has(layer.id);

        // Spinner: serialized component payload for the prefab (timeline-
        // independent config + bindings; the prefab's runtime clips come from
        // the PRIMARY timeline — extra timelines' action cues live in the
        // descriptor's timelines[] array).
        let spinnerData = null;
        let spinnerSize = null;
        if (info.kind === 'spinner') {
          const sc = spinnerCuesForLayer(primaryScene, layer);
          if (sc) {
            const spinnerAsset = (scene.assets || []).find((a) => a.id === layer.assetId);
            const size2 = (i) => (i?.size ? { w: i.size.width, h: i.size.height } : null);
            const bindings = (spinnerAsset?.spinner?.symbols || []).map((sym) => {
              const sInfo = info.symAssetMap?.get(sym.assetId);
              const bInfo = info.symAssetMap?.get(sym.blurAssetId);
              return {
                symbolId: sym.id,
                staticGuid: sInfo?.spriteGuid || null,
                blurGuid: bInfo?.spriteGuid || null,
                staticSize: size2(sInfo),
                blurSize: size2(bInfo)
              };
            });
            const animOf = (an, kind, symId) => {
              if (!an || an.kind !== 'spine' || !an.assetId || !an.anim) return null;
              const aInfo = assetInfo.get(an.assetId);
              if (aInfo?.kind !== 'spine' || !aInfo.spineName) return null;
              return {
                symbolId: symId, kind, spineName: aInfo.spineName,
                anim: an.anim, loop: an.loop !== false,
                offset: Number.isFinite(Number(an.offset)) ? Number(an.offset) : 0
              };
            };
            const animBindings = [];
            for (const sym of (spinnerAsset?.spinner?.symbols || [])) {
              const l = animOf(sym.landAnim, 'land', sym.id); if (l) animBindings.push(l);
              const w = animOf(sym.winAnim, 'win', sym.id); if (w) animBindings.push(w);
            }
            const reelCount = normalizeSpinnerConfig(spinnerAsset?.spinner)?.grid?.reels || 0;
            for (let r = 0; r < reelCount; r++) {
              for (const b of animBindings) {
                descriptorNodes.push({
                  path: `${path}/Board/Fx/Reel_${r}/Anim_${b.symbolId}_${b.kind}`,
                  kind: 'spine',
                  layerId: layer.id,
                  visible: true,
                  spineData: b.spineName,
                  spineSkin: '',
                  spineAnim: '',
                  spineLoop: false,
                  spineHasCues: true
                });
              }
            }
            spinnerData = {
              configJson: sc.configJson,
              clipsJson: JSON.stringify({ clips: sc.clips }),
              bindings,
              animBindings,
              config: normalizeSpinnerConfig(spinnerAsset?.spinner)
            };
            const g = spinnerAsset?.spinner?.grid;
            if (g) spinnerSize = {
              w: g.reels * g.cellW + (g.reels - 1) * g.spacingX,
              h: g.rows * g.cellH + (g.rows - 1) * g.spacingY
            };
          }
        }

        const size = spinnerSize || (info.size ? { w: info.size.width, h: info.size.height } : null);
        descriptorNodes.push({
          path,
          kind: info.kind,
          layerId: layer.id,
          visible: layer.visible !== false,
          spineData: info.jsonBase || '',
          spineSkin: layer.spine?.skin || '',
          spineAnim: layer.spine?.defaultAnimation || '',
          spineLoop: layer.spine?.loop !== false,
          spineHasCues
        });

        out.push({
          key: layer.id,
          name,
          kind: info.kind === 'png' ? 'static'
            : info.kind === 'spine' ? 'spine'
            : info.kind === 'spinner' ? 'spinner'
            : 'group',
          // T5: no hard-disable path — a closed eye is an alpha-0 gate
          // (conv.alpha above), not GameObject.SetActive(false). Keeping the
          // GameObject active means any Animator/script on it keeps running,
          // matching the editor runtime's "stays fully in the graph" rule.
          active: true,
          ...conv,
          size,
          spriteGuid: info.spriteGuid || null,
          spine: layer.spine || null,
          spineHasCues,
          spinner: spinnerData,
          children: buildNodes(tn.children, false, path, new Set())
        });
      }
      return out;
    };

    const nodes = buildNodes(rootNodes, true, '', new Set());

    // Bake one .anim per timeline. The GUID seed includes the timeline id so a
    // re-export keeps prior timelines' clip GUIDs (Unity merges) while a newly
    // added timeline gets a fresh GUID (added, not clobbered).
    const timelineEntries = [];
    for (let i = 0; i < timelines.length; i++) {
      const tl = timelines[i];
      const isPrimary = i === 0;
      const tlScene = sceneForTimeline(scene, tl);
      const { animTracks, spineCues, spinnerCues } = bakeTimelineForCanvas(tlScene, flatInfos, {
        orientation, bakeFps: settings.bakeFps, ui, stage, settings,
        warnings: isPrimary ? warnings : []
      });
      const tlSafe = safeName(tl.name, `Timeline${i + 1}`);
      const animName = `${canvasName}_${tlSafe}_Bake`;
      const animYaml = buildAnimationClip({
        name: animName,
        duration,
        sampleRate: scene.stage?.fps || 60,
        tracks: animTracks
      });
      const animItem = await pushItem(
        `${sceneFolder}/${animName}.anim`,
        animYaml,
        (g) => nativeMeta(g, 7400000),
        `${pkg}:${sceneFolder}/${canvasName}_${tl.id}_Bake.anim`
      );
      timelineEntries.push({
        id: tl.id,
        name: tl.name,
        clipGuid: animItem.guid,
        spineCues,
        spinnerCues
      });
    }
    const primary = timelineEntries[0];

    // descriptor JSON (drives the editor Timeline builder + future tooling).
    // Schema v2: a `timelines[]` array (per-timeline clipGuid + cues). The
    // top-level spineCues/spinnerCues mirror the primary timeline for
    // back-compat with the runtime player / spinner track.
    const descriptor = {
      schema: 'ygg-unity-scene/2',
      scene: scene.name,
      canvas: canvasName,
      orientation,
      stage: { ...stage, fps: scene.stage?.fps || 60, duration },
      variant: settings.variant,
      nodes: descriptorNodes,
      timelines: timelineEntries,
      spineCues: primary.spineCues,
      spinnerCues: primary.spinnerCues,
      bakeFps: settings.bakeFps
    };
    const descPath = `${sceneFolder}/${canvasName}_timeline.json`;
    const descItem = await pushItem(descPath, JSON.stringify(descriptor, null, 2), textMeta);

    // prefab
    progress(`writing prefab "${canvasName}"…`);
    const prefabYaml = await buildPrefab({
      canvasName: `${sceneName}_${canvasName}`,
      variant: settings.variant,
      stage,
      nodes,
      spineScriptGuid: ui ? settings.spineGraphicGuid : settings.spineAnimationGuid,
      spinnerScriptGuid,
      pixelsPerUnit: settings.pixelsPerUnit,
      spinnerMaskSpriteGuid,
      player: {
        scriptGuid: playerScriptGuid,
        clipGuid: primary.clipGuid,
        descriptorGuid: descItem.guid,
        durationSeconds: duration,
        spineCues: primary.spineCues,
        autoBuildTimeline: settings.autoBuildTimeline === true
      }
    });
    await pushItem(`${sceneFolder}/${sceneName}_${canvasName}.prefab`, prefabYaml, (g) => nativeMeta(g, 100100000));
  }

  if (!exportedCanvases) throw new Error('Nothing to export — the scene has no layers.');
  const hasSpine = [...assetInfo.values()].some((i) => i.kind === 'spine');
  if (hasSpine && ((ui && !settings.spineGraphicGuid) || (!ui && !settings.spineAnimationGuid))) {
    warnings.push('Spine script GUID cleared in settings — spine layers export as placeholders.');
  } else if (hasSpine) {
    warnings.push('Spine components are wired automatically after import (SkeletonDataAsset, skin, animation). If a node stays empty, click "Auto-assign Spine Data" on the prefab.');
  }

  // ── 4. Folder entries for every directory in the package ──────────────
  const folders = new Set();
  for (const it of [...items]) {
    const segs = it.path.split('/');
    for (let i = 1; i < segs.length; i++) folders.add(segs.slice(0, i).join('/'));
  }
  folders.delete('Assets'); // Unity never packages the Assets root itself
  for (const dir of [...folders].sort()) {
    // Folder GUIDs are path-seeded (package-independent) so shared folders
    // like Assets/YggSceneStudio merge across packages instead of colliding.
    if (!itemsByPath.has(dir)) await pushShared(dir, null, folderMeta);
  }

  // ── 5. Pack ────────────────────────────────────────────────────────────
  progress('packing .unitypackage…');
  const blob = await buildUnityPackage(items.map((it) => ({
    guid: it.guid,
    path: it.path,
    data: it.data == null ? null : it.data,
    meta: it.meta
  })));

  return {
    blob,
    fileName: `${pkg}.unitypackage`,
    warnings,
    stats: {
      files: items.filter((i) => i.data != null).length,
      folders: folders.size,
      canvases: exportedCanvases,
      animTracks: undefined
    }
  };
}

/** Merge two scalar key lists (x, y) into vec2 keys; null when both static. */
function mergeVec(keysX, keysY, baseX, baseY) {
  if (!keysX.length && !keysY.length) return null;
  const ts = [...new Set([...(keysX || []).map((k) => k.t), ...(keysY || []).map((k) => k.t)])].sort((a, b) => a - b);
  const evalAt = (keys, t, fallback) => {
    if (!keys.length) return fallback;
    if (t <= keys[0].t) return keys[0].v;
    if (t >= keys[keys.length - 1].t) return keys[keys.length - 1].v;
    for (let i = 0; i < keys.length - 1; i++) {
      const a = keys[i];
      const b = keys[i + 1];
      if (t >= a.t && t <= b.t) {
        const p = (t - a.t) / Math.max(1e-9, b.t - a.t);
        return a.v + (b.v - a.v) * p;
      }
    }
    return keys[keys.length - 1].v;
  };
  return ts.map((t) => ({ t, v: { x: evalAt(keysX, t, baseX), y: evalAt(keysY, t, baseY) } }));
}
