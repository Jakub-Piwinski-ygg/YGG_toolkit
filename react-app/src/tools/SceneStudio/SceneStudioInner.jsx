// SceneStudioInner — Scene Studio main React component.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import { AssetBrowserPanel } from './components/AssetBrowserPanel.jsx';
import { HierarchyPanel } from './components/HierarchyPanel.jsx';
import { InspectorPanel } from './components/InspectorPanel.jsx';
import { PixiErrorBoundary } from './components/PixiErrorBoundary.jsx';
import { PixiViewport } from './components/PixiViewport.jsx';
import { StudioToolbar } from './components/StudioToolbar.jsx';
import { TimelinePanel } from './components/TimelinePanel.jsx';
import { scanProjectAssets } from './engine/assetBrowser.js';
import {
  createEmptyScene,
  defaultTransformsForNewLayer,
  deriveFlowGraph,
  getWorldPosition,
  isDescendantOf,
  uid
} from './engine/sceneModel.js';
import {
  createInitialFlowState,
  flowPause,
  flowPlay,
  flowResolveSignal,
  flowResumeByClick,
  flowSeek,
  flowStop,
  tickFlow
} from './engine/flowInterpreter.js';
import {
  fileToDataUrl,
  getDroppedDirectoryHandle,
  isDropDirectorySupported,
  loadSceneFromFile,
  loadSceneFromHandle,
  pickProjectRoot,
  saveScene
} from './engine/persist.js';
import { makeVirtualRootHandle, readFolderDropAsFiles } from './engine/virtualHandle.js';
import { patchTransform, resetPortrait } from './engine/orientationManager.js';
import { groupSpineFiles } from './engine/spineLoader.js';
import {
  channelLayout,
  clipLocalSeconds,
  composeRgbValue,
  composeVec2Value,
  evalChannel,
  insertOrUpdateKey,
  splitChannel,
  SPRITE_PROP_TO_CHANNEL
} from './engine/animation/keyframes.js';
import './styles/scene-studio.css';

const VIDEO_EXT = /\.(mp4|webm|mov|m4v)$/i;

export default function SceneStudioInner() {
  const { log } = useApp();
  const [scene, setSceneInternal] = useState(() => createEmptyScene('Untitled scene'));
  const [rootHandle, setRootHandle] = useState(null);
  const [selectedLayerId, setSelectedLayerId] = useState(null);
  const [selectedClipId, setSelectedClipId] = useState(null);
  const [selectedKey, setSelectedKey] = useState(null);   // { clipId, name, idx } | null
  const [clipboardKey, setClipboardKey] = useState(null); // { name, v, out } | null
  const [busy, setBusy] = useState(false);
  const [assetDescriptors, setAssetDescriptors] = useState({});
  const [assetItems, setAssetItems] = useState([]);
  const [flowState, setFlowState] = useState(() => createInitialFlowState());
  const [rootDropHover, setRootDropHover] = useState(false);
  const [pickError, setPickError] = useState(null);
  const [livePreview, setLivePreview] = useState(true);
  // Auto-key: when ON, editing a transform while a clip is selected and
  // the playhead is inside it records a keyframe. When OFF, edits always
  // go to the base pose. Read through a ref by handlePatchTransform.
  const [autoKey, setAutoKey] = useState(true);
  const autoKeyRef = useRef(autoKey);
  autoKeyRef.current = autoKey;
  // Undo / redo: simple stacks of full-scene snapshots. Pushes are
  // coalesced for rapid edits (e.g. drag-scrubbing a value) via
  // `historyCoalesceUntilRef` so a 30-frame drag becomes one undo step.
  const undoStackRef = useRef([]);
  const redoStackRef = useRef([]);
  const historyCoalesceUntilRef = useRef(0);
  const [historyDepth, setHistoryDepth] = useState({ undo: 0, redo: 0 });
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  const selectedClipIdRef = useRef(selectedClipId);
  selectedClipIdRef.current = selectedClipId;
  const selectedKeyRef = useRef(selectedKey);
  selectedKeyRef.current = selectedKey;
  const clipboardKeyRef = useRef(clipboardKey);
  clipboardKeyRef.current = clipboardKey;

  /**
   * Wrap a scene mutation so the prior state lands on the undo stack.
   * Same call signature as `setScene` (accepts updater fn or value).
   * Rapid follow-ups within 250ms reuse the same undo entry — so a
   * fast drag-scrub on a value records exactly one undo step.
   */
  /**
   * Public `setScene` wrapper that pushes the prior state onto the undo
   * stack before applying the update. Within a 250ms window, rapid
   * follow-up writes coalesce into the same history entry so a single
   * drag becomes one undo step.
   */
  const setScene = useCallback((updater) => {
    setSceneInternal((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      if (next === prev) return prev;
      const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      const coalesce = now < historyCoalesceUntilRef.current;
      historyCoalesceUntilRef.current = now + 250;
      if (!coalesce) {
        undoStackRef.current.push(prev);
        if (undoStackRef.current.length > 100) undoStackRef.current.shift();
        redoStackRef.current.length = 0;
        setHistoryDepth({ undo: undoStackRef.current.length, redo: 0 });
      }
      return next;
    });
  }, []);

  /** Replace the scene WITHOUT pushing a history entry — used by load / reset. */
  const replaceSceneNoHistory = useCallback((next) => {
    undoStackRef.current.length = 0;
    redoStackRef.current.length = 0;
    historyCoalesceUntilRef.current = 0;
    setHistoryDepth({ undo: 0, redo: 0 });
    setSceneInternal(next);
  }, []);

  const undo = useCallback(() => {
    const prev = undoStackRef.current.pop();
    if (!prev) return;
    redoStackRef.current.push(sceneRef.current);
    historyCoalesceUntilRef.current = 0;
    setSceneInternal(prev);
    setHistoryDepth({ undo: undoStackRef.current.length, redo: redoStackRef.current.length });
  }, []);

  const redo = useCallback(() => {
    const next = redoStackRef.current.pop();
    if (!next) return;
    undoStackRef.current.push(sceneRef.current);
    historyCoalesceUntilRef.current = 0;
    setSceneInternal(next);
    setHistoryDepth({ undo: undoStackRef.current.length, redo: redoStackRef.current.length });
  }, []);

  const flowRef = useRef(flowState);
  flowRef.current = flowState;

  const dropRef = useRef(null);

  const addAssetLayer = useCallback((prev, asset, layerName, layerPatch = {}) => {
    const layerId = uid('L');
    const transforms = defaultTransformsForNewLayer(prev.stage);
    return {
      ...prev,
      assets: [...prev.assets, asset],
      layers: [...prev.layers, {
        id: layerId,
        name: layerName,
        assetId: asset.id,
        canvasId: prev.activeCanvasId || prev.canvases[0].id,
        parentId: null,
        visible: true,
        blend: 'normal',
        transforms,
        ...layerPatch
      }]
    };
  }, []);

  const addPngLayer = useCallback(async (file) => {
    const src = await fileToDataUrl(file);
    setScene((prev) => {
      const asset = { id: uid('a'), type: 'png', src, meta: { originalName: file.name, size: file.size } };
      return addAssetLayer(prev, asset, file.name.replace(/\.png$/i, ''));
    });
    log(`Scene Studio: + png ${file.name}`, 'ok');
  }, [addAssetLayer, log]);

  const addVideoLayer = useCallback(async (file) => {
    const src = await fileToDataUrl(file);
    setScene((prev) => {
      const asset = { id: uid('a'), type: 'video', src, meta: { originalName: file.name, size: file.size } };
      return addAssetLayer(prev, asset, file.name.replace(VIDEO_EXT, ''), { video: { loop: true, muted: true } });
    });
    log(`Scene Studio: + video ${file.name}`, 'ok');
  }, [addAssetLayer, log]);

  const addSpineLayer = useCallback(async (group) => {
    const [jsonSrc, atlasSrc, textureSrc] = await Promise.all([
      fileToDataUrl(group.json),
      fileToDataUrl(group.atlas),
      fileToDataUrl(group.texture)
    ]);
    setScene((prev) => {
      const asset = {
        id: uid('a'),
        type: 'spine',
        src: jsonSrc,
        atlas: atlasSrc,
        texture: textureSrc,
        meta: {
          originalName: group.basename,
          jsonName: group.json.name,
          atlasName: group.atlas.name,
          textureName: group.texture.name
        }
      };
      return addAssetLayer(prev, asset, group.basename, { spine: { defaultAnimation: null, loop: true, skin: null } });
    });
    log(`Scene Studio: + spine ${group.basename}`, 'ok');
  }, [addAssetLayer, log]);

  const addAssetItemFromBrowser = useCallback(async (item) => {
    if (!rootHandle) return;
    try {
      if (item.type === 'png') {
        setScene((prev) => {
          const asset = { id: uid('a'), type: 'png', src: item.path, meta: { originalName: item.name } };
          return addAssetLayer(prev, asset, item.name.replace(/\.png$/i, ''));
        });
        log(`Scene Studio: + png ${item.path}`, 'ok');
        return;
      }
      if (item.type === 'video') {
        setScene((prev) => {
          const asset = { id: uid('a'), type: 'video', src: item.path, meta: { originalName: item.name } };
          return addAssetLayer(prev, asset, item.name.replace(VIDEO_EXT, ''), { video: { loop: true, muted: true } });
        });
        log(`Scene Studio: + video ${item.path}`, 'ok');
        return;
      }
      if (item.type === 'spine') {
        setScene((prev) => {
          const asset = {
            id: uid('a'),
            type: 'spine',
            src: item.jsonPath,
            atlas: item.atlasPath,
            texture: item.texturePath,
            meta: { originalName: item.name }
          };
          return addAssetLayer(prev, asset, item.name, { spine: { defaultAnimation: null, loop: true, skin: null } });
        });
        log(`Scene Studio: + spine ${item.name}`, 'ok');
        return;
      }
    } catch (e) {
      log(`Scene Studio asset add failed: ${e.message || e}`, 'err');
    }
  }, [addAssetLayer, log, rootHandle]);

  useEffect(() => {
    const el = dropRef.current;
    if (!el) return;
    const onOver = (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      el.classList.add('drop-hover');
    };
    const onLeave = () => el.classList.remove('drop-hover');
    const onDrop = async (e) => {
      e.preventDefault();
      el.classList.remove('drop-hover');
      const files = Array.from(e.dataTransfer.files || []);
      if (!files.length) return;
      const { spineGroups, looseFiles } = groupSpineFiles(files);
      for (const g of spineGroups) await addSpineLayer(g);
      for (const f of looseFiles) {
        if (f.type === 'image/png' || /\.png$/i.test(f.name)) await addPngLayer(f);
        else if (VIDEO_EXT.test(f.name) || f.type.startsWith('video/')) await addVideoLayer(f);
      }
    };
    el.addEventListener('dragover', onOver);
    el.addEventListener('dragleave', onLeave);
    el.addEventListener('drop', onDrop);
    return () => {
      el.removeEventListener('dragover', onOver);
      el.removeEventListener('dragleave', onLeave);
      el.removeEventListener('drop', onDrop);
    };
  }, [addPngLayer, addSpineLayer, addVideoLayer]);

  const patchFlow = useCallback((nextFlow) => {
    setScene((prev) => {
      try {
        return { ...prev, flow: deriveFlowGraph(nextFlow) };
      } catch (e) {
        console.warn('[SceneStudio] patchFlow failed', e);
        return prev;
      }
    });
  }, []);

  const handleFlowAction = useCallback((action, payload) => {
    setFlowState((prev) => {
      const curScene = sceneRef.current;
      if (action === 'play') return flowPlay(prev);
      if (action === 'pause') return flowPause(prev);
      if (action === 'stop') return flowStop(prev);
      if (action === 'seek') return flowSeek(curScene, prev, Number(payload) || 0);
      if (action === 'clickResume') return flowResumeByClick(prev);
      if (action === 'emitSignal') return flowResolveSignal(prev, String(payload || ''));
      if (action === 'setDuration') {
        const n = Number(payload);
        const d = Number.isFinite(n) ? Math.max(0.5, Math.min(300, n)) : (curScene?.stage?.duration || 5);
        setScene((s) => ({ ...s, stage: { ...s.stage, duration: d } }));
        return flowSeek(curScene, prev, Math.min(prev.time, d));
      }
      return prev;
    });
  }, []);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (now) => {
      const dt = Math.max(0, (now - last) / 1000);
      last = now;
      setFlowState((prev) => tickFlow(sceneRef.current, prev, dt));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (!flowState.emitted?.length) return;
    for (const signal of flowState.emitted) {
      setFlowState((prev) => flowResolveSignal(prev, signal));
    }
  }, [flowState.emitted]);

  const handlePatchLayer = useCallback((layerId, patch) => {
    setScene((prev) => ({
      ...prev,
      layers: prev.layers.map((l) => (l.id === layerId ? { ...l, ...patch } : l))
    }));
  }, []);

  /**
   * Decide between auto-keyframe write and base-pose patch.
   *
   * If a clip is currently selected AND it lives on `layerId` AND the
   * playhead is inside its time range, treat numeric prop edits as
   * keyframe writes on that clip's per-property channels. Otherwise
   * fall through to the legacy "patch base pose" path.
   *
   * Used for BOTH inspector transform field edits and viewport-driven
   * transforms (drag, resize, rotate). The decision is made once per
   * patch so a single drag emits exactly one update path.
   */
  const handlePatchTransform = useCallback((layerId, patch) => {
    const sceneNow = sceneRef.current;
    const flowNow = flowRef.current;
    const tracks = sceneNow.flow?.tracks || [];

    // Find the active recording target — only if the user has explicitly
    // selected a clip on this layer and the playhead sits inside it.
    // Read selectedClipId from the ref so this callback never goes stale
    // when invoked via window.__sceneStudio or a closure-captured handler.
    let targetClip = null;
    let targetTrack = null;
    const selClipId = selectedClipIdRef.current;
    if (selClipId && autoKeyRef.current) {
      for (const tr of tracks) {
        if (tr.layerId !== layerId) continue;
        const c = (tr.clips || []).find((cl) => cl.id === selClipId);
        if (!c) continue;
        if (flowNow.time >= c.start && flowNow.time < c.start + c.duration) {
          targetClip = c;
          targetTrack = tr;
        }
        break;
      }
    }

    if (!targetClip) {
      // No recording context — patch the layer's base pose as before.
      setScene((prev) => ({
        ...prev,
        layers: prev.layers.map((l) =>
          l.id === layerId ? patchTransform(l, prev.stage.activeOrientation, patch) : l
        )
      }));
      return;
    }

    // Auto-key path: group the patch by logical channel (position /
    // scale / rotation / alpha / tint), build the merged value
    // (preserving the OTHER component for vec2 / vec3 channels from the
    // channel's current value at the playhead OR the base pose), then
    // write one key per channel.
    const localT = clipLocalSeconds(targetClip, flowNow.time, { clampPastEnd: true });
    let nextClipChannels = { ...(targetClip.channels || {}) };
    const grouped = {};
    for (const [prop, value] of Object.entries(patch)) {
      // Whole-vec3 patch ({ tint: { r, g, b } }) from the colour picker —
      // unpacks straight into the tint bag.
      if (prop === 'tint' && value && typeof value === 'object') {
        const bag = grouped.tint || (grouped.tint = {});
        if (typeof value.r === 'number') bag.r = value.r;
        if (typeof value.g === 'number') bag.g = value.g;
        if (typeof value.b === 'number') bag.b = value.b;
        continue;
      }
      const mapping = SPRITE_PROP_TO_CHANNEL[prop];
      if (!mapping) continue;
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      const bag = grouped[mapping.channel] || (grouped[mapping.channel] = {});
      if (mapping.component) bag[mapping.component] = value;
      else bag.scalar = value;
    }
    const layerNow = sceneNow.layers.find((l) => l.id === layerId);
    const baseT = layerNow?.transforms?.[sceneNow.stage.activeOrientation]
      || layerNow?.transforms?.landscape || {};
    let touched = false;
    for (const [channelName, bag] of Object.entries(grouped)) {
      const existing = nextClipChannels[channelName];
      const layout = channelLayout(channelName);

      // Split path: write each patch component into its own scalar
      // key list. Lets x and y (or r/g/b) animate on independent
      // timelines and curves.
      if (existing?.split && (layout === 'vec2' || layout === 'rgb')) {
        const comps = layout === 'vec2' ? ['x', 'y'] : ['r', 'g', 'b'];
        const nextPerComp = { ...(existing.perComp || {}) };
        for (const c of comps) {
          if (typeof bag[c] !== 'number' || !Number.isFinite(bag[c])) continue;
          const compKeys = nextPerComp[c]?.keys || [];
          nextPerComp[c] = insertOrUpdateKey({ keys: compKeys }, localT, bag[c]);
        }
        nextClipChannels[channelName] = { ...existing, perComp: nextPerComp };
        touched = true;
        continue;
      }

      // Linked path.
      let v;
      if (layout === 'vec2') {
        const current = existing?.keys?.length
          ? evalChannel(existing, localT, channelName)
          : channelName === 'scale'
            ? { x: baseT.scaleX ?? 1, y: baseT.scaleY ?? 1 }
            : { x: baseT.x ?? 0, y: baseT.y ?? 0 };
        v = composeVec2Value(current, bag);
      } else if (layout === 'rgb') {
        const current = existing?.keys?.length
          ? evalChannel(existing, localT, channelName)
          : (baseT.tint || { r: 1, g: 1, b: 1 });
        v = composeRgbValue(current, bag);
      } else {
        v = typeof bag.scalar === 'number' ? bag.scalar : (existing?.keys?.length ? evalChannel(existing, localT, channelName) : 0);
      }
      nextClipChannels[channelName] = insertOrUpdateKey(existing || { keys: [] }, localT, v);
      touched = true;
    }
    if (!touched) {
      // Patch contained no channel-eligible props (e.g. anchor only).
      // Fall back to base pose so the edit isn't silently dropped.
      setScene((prev) => ({
        ...prev,
        layers: prev.layers.map((l) =>
          l.id === layerId ? patchTransform(l, prev.stage.activeOrientation, patch) : l
        )
      }));
      return;
    }
    const targetClipId = targetClip.id;
    const targetTrackId = targetTrack.id;
    setScene((prev) => {
      const nextFlow = {
        ...(prev.flow || {}),
        tracks: (prev.flow?.tracks || []).map((tr) => {
          if (tr.id !== targetTrackId) return tr;
          return {
            ...tr,
            clips: tr.clips.map((c) =>
              c.id === targetClipId
                ? {
                    ...c,
                    channels: Object.keys(nextClipChannels).length ? nextClipChannels : null
                  }
                : c
            )
          };
        })
      };
      return { ...prev, flow: deriveFlowGraph(nextFlow) };
    });
  }, [setScene]);

  const handleTransformLayer = useCallback((layerId, patch) => {
    handlePatchTransform(layerId, patch);
  }, [handlePatchTransform]);

  const handleReorder = useCallback((draggedId, targetId, mode, canvasIdArg) => {
    setScene((prev) => {
      const idx = prev.layers.findIndex((l) => l.id === draggedId);
      if (idx < 0) return prev;
      const dragged = prev.layers[idx];

      if (mode === 'inside' && (targetId === draggedId || isDescendantOf(prev, draggedId, targetId))) return prev;
      if ((mode === 'above' || mode === 'below') && targetId === draggedId) return prev;

      let newParentId = null;
      let newCanvasId = dragged.canvasId;
      if (mode === 'inside') {
        const target = prev.layers.find((l) => l.id === targetId);
        if (!target) return prev;
        newParentId = target.id;
        newCanvasId = target.canvasId;
      } else if (mode === 'above' || mode === 'below') {
        const target = prev.layers.find((l) => l.id === targetId);
        if (!target) return prev;
        if (isDescendantOf(prev, draggedId, targetId)) return prev;
        newParentId = target.parentId ?? null;
        newCanvasId = target.canvasId;
      } else if (mode === 'canvasRoot') {
        newParentId = null;
        newCanvasId = canvasIdArg || prev.activeCanvasId || prev.canvases[0].id;
      }

      const newWorldParentLand = newParentId ? getWorldPosition(prev, newParentId, 'landscape') : { x: 0, y: 0 };
      const newWorldParentPort = newParentId ? getWorldPosition(prev, newParentId, 'portrait') : { x: 0, y: 0 };
      const oldWorldLand = getWorldPosition(prev, draggedId, 'landscape');
      const oldWorldPort = getWorldPosition(prev, draggedId, 'portrait');

      const draggedLandT = dragged.transforms.landscape;
      const newLandT = { ...draggedLandT, x: oldWorldLand.x - newWorldParentLand.x, y: oldWorldLand.y - newWorldParentLand.y };
      let newPortT = dragged.transforms.portrait;
      if (newPortT) newPortT = { ...newPortT, x: oldWorldPort.x - newWorldParentPort.x, y: oldWorldPort.y - newWorldParentPort.y };

      const without = prev.layers.filter((l) => l.id !== draggedId);
      const newDragged = {
        ...dragged,
        parentId: newParentId,
        canvasId: newCanvasId,
        transforms: { landscape: newLandT, portrait: newPortT }
      };

      let insertAt;
      if (mode === 'inside') {
        let lastChildPos = without.findIndex((l) => l.id === targetId);
        for (let i = lastChildPos + 1; i < without.length; i++) {
          if (without[i].parentId === targetId) lastChildPos = i;
          else break;
        }
        insertAt = lastChildPos + 1;
      } else if (mode === 'above') {
        insertAt = without.findIndex((l) => l.id === targetId);
      } else if (mode === 'below') {
        insertAt = without.findIndex((l) => l.id === targetId) + 1;
      } else {
        insertAt = without.length;
      }
      return { ...prev, layers: [...without.slice(0, insertAt), newDragged, ...without.slice(insertAt)] };
    });
  }, []);

  const handleAssetReady = useCallback((assetId, descriptor) => {
    if (!descriptor) return;
    setAssetDescriptors((prev) => {
      const old = prev[assetId];
      if (old && JSON.stringify(old) === JSON.stringify(descriptor)) return prev;
      return { ...prev, [assetId]: descriptor };
    });
    // For Spine layers, pick a sensible default animation the first time
    // we learn the animation list from the descriptor. Preference:
    //   1. first animation whose name contains "idle" (case-insensitive)
    //   2. otherwise, the first animation in the list
    // Only patches layers that don't have a defaultAnimation set yet, so
    // user choices are preserved.
    if (Array.isArray(descriptor.animations) && descriptor.animations.length) {
      const pick = descriptor.animations.find((n) => /idle/i.test(n)) || descriptor.animations[0];
      setScene((prev) => {
        let changed = false;
        const layers = prev.layers.map((l) => {
          if (l.assetId !== assetId) return l;
          if (l.spine?.defaultAnimation) return l;
          changed = true;
          return { ...l, spine: { ...(l.spine || {}), defaultAnimation: pick, loop: l.spine?.loop !== false } };
        });
        return changed ? { ...prev, layers } : prev;
      });
    }
  }, []);

  const handleResetPortrait = useCallback((layerId) => {
    setScene((prev) => ({
      ...prev,
      layers: prev.layers.map((l) => (l.id === layerId ? resetPortrait(l) : l))
    }));
  }, []);

  const handleToggleVisibility = useCallback((layerId, visible) => {
    handlePatchLayer(layerId, { visible });
  }, [handlePatchLayer]);

  const handleRemoveLayer = useCallback((layerId) => {
    setScene((prev) => {
      const layer = prev.layers.find((l) => l.id === layerId);
      const assetId = layer?.assetId;
      const stillUsed = prev.layers.some((l) => l.id !== layerId && l.assetId === assetId);
      return {
        ...prev,
        layers: prev.layers.filter((l) => l.id !== layerId),
        assets: stillUsed ? prev.assets : prev.assets.filter((a) => a.id !== assetId)
      };
    });
    setSelectedLayerId((cur) => (cur === layerId ? null : cur));
  }, []);

  const handleToggleOrientation = useCallback(() => {
    setScene((prev) => ({
      ...prev,
      stage: {
        ...prev.stage,
        activeOrientation: prev.stage.activeOrientation === 'landscape' ? 'portrait' : 'landscape'
      }
    }));
  }, []);

  const handleRename = useCallback((name) => {
    setScene((prev) => ({ ...prev, name }));
  }, []);

  const refreshAssetBrowser = useCallback(async (handle) => {
    if (!handle) return setAssetItems([]);
    try {
      const list = await scanProjectAssets(handle);
      setAssetItems(list);
    } catch (e) {
      log(`Scene Studio: asset scan failed: ${e.message || e}`, 'err');
      setAssetItems([]);
    }
  }, [log]);

  const linkProjectRoot = useCallback(async (handle) => {
    if (!handle || handle.kind !== 'directory') return;
    setRootHandle(handle);
    await refreshAssetBrowser(handle);
    log(`Scene Studio: project root = ${handle.name}`, 'ok');
    try {
      const existing = await loadSceneFromHandle(handle);
      if (existing) {
        replaceSceneNoHistory(existing);
        setSelectedLayerId(null);
        setFlowState(createInitialFlowState());
        const rel = existing.projectRoot ? `${existing.projectRoot}/scene.json` : 'scene.json';
        log(`Scene Studio: loaded ${rel}`, 'ok');
      }
    } catch (e) {
      log(`Scene Studio: ${e.message || e}`, 'err');
    }
  }, [log, refreshAssetBrowser]);

  const handlePickRoot = useCallback(async () => {
    setPickError(null);
    // Call the picker SYNCHRONOUSLY from the click event so the browser's
    // transient user activation is still valid. Wrapping it behind any
    // pre-await (including setBusy) can cause Chromium to reject the call
    // with SecurityError silently. Only flip busy after the dialog returns.
    let handle = null;
    try {
      handle = await pickProjectRoot();
    } catch (e) {
      const msg = e?.message || String(e);
      console.warn('[SceneStudio] pickProjectRoot failed', e);
      setPickError(msg);
      log(`Scene Studio: ${msg}`, 'err');
      return;
    }
    if (!handle) return; // user cancelled
    setBusy(true);
    try {
      await linkProjectRoot(handle);
    } catch (e) {
      console.warn('[SceneStudio] linkProjectRoot failed', e);
      setPickError(e?.message || String(e));
      log(`Scene Studio: ${e.message || e}`, 'err');
    } finally {
      setBusy(false);
    }
  }, [linkProjectRoot, log]);

  // Firefox / Safari fallback: turn a flat File[] (picked via
  // <input webkitdirectory> or dropped folder) into a virtual directory
  // handle that satisfies the same interface scanProjectAssets and
  // resolveAssetUrl already use. Save back to disk falls back to download.
  const handlePickFolderFallback = useCallback(async (files) => {
    if (!files?.length) return;
    setPickError(null);
    setBusy(true);
    try {
      const rootName = files[0].webkitRelativePath?.split('/')[0]
        || files[0].relativePath?.split('/')[0]
        || 'workspace';
      const virtual = makeVirtualRootHandle(files, rootName);
      await linkProjectRoot(virtual);
    } catch (e) {
      console.warn('[SceneStudio] virtual root link failed', e);
      setPickError(e?.message || String(e));
      log(`Scene Studio: ${e?.message || e}`, 'err');
    } finally {
      setBusy(false);
    }
  }, [linkProjectRoot, log]);

  const handleClearRoot = useCallback(() => {
    setRootHandle(null);
    setAssetItems([]);
    log('Scene Studio: project root cleared (quick mode)', 'info');
  }, [log]);

  const handleRootDragOver = useCallback((e) => {
    // Accept drops in any browser that can present files in DataTransfer.
    // Chromium also supports getAsFileSystemHandle; Firefox / Safari fall
    // back to webkitGetAsEntry inside handleRootDrop.
    const hasFiles = Array.from(e.dataTransfer?.items || []).some((it) => it.kind === 'file');
    if (!hasFiles) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!rootDropHover) setRootDropHover(true);
  }, [rootDropHover]);

  const handleRootDragLeave = useCallback(() => {
    if (rootDropHover) setRootDropHover(false);
  }, [rootDropHover]);

  const handleRootDrop = useCallback(async (e) => {
    e.preventDefault();
    setRootDropHover(false);

    // Chromium fast path: real FileSystemDirectoryHandle from the drop.
    if (isDropDirectorySupported()) {
      const dirHandle = await getDroppedDirectoryHandle(e);
      if (dirHandle) {
        setBusy(true);
        try {
          await linkProjectRoot(dirHandle);
        } finally {
          setBusy(false);
        }
        return;
      }
    }

    // Cross-browser fallback: walk DataTransfer items as webkitGetAsEntry
    // and build a virtual handle from the resulting File[].
    const items = e.dataTransfer?.items;
    if (items && items.length) {
      setBusy(true);
      try {
        const files = await readFolderDropAsFiles(items);
        if (!files.length) {
          log('Scene Studio: drop a FOLDER (not empty selection) to link project root.', 'info');
          return;
        }
        const rootName = files[0].webkitRelativePath?.split('/')[0]
          || files[0].relativePath?.split('/')[0]
          || 'workspace';
        const virtual = makeVirtualRootHandle(files, rootName);
        await linkProjectRoot(virtual);
      } catch (err) {
        console.warn('[SceneStudio] folder drop fallback failed', err);
        log(`Scene Studio: ${err.message || err}`, 'err');
      } finally {
        setBusy(false);
      }
      return;
    }
    log('Scene Studio: drop a FOLDER (not files) to link project root.', 'info');
  }, [linkProjectRoot, log]);

  const sceneWithRuntime = useMemo(() => ({
    ...scene,
    flow: {
      ...(scene.flow || {}),
      runtime: {
        time: flowState.time,
        playing: flowState.playing,
        hold: flowState.hold
      }
    }
  }), [scene, flowState.time, flowState.playing, flowState.hold]);

  const selectedLayer = scene.layers.find((l) => l.id === selectedLayerId) || null;
  const selectedLayerAssetType = selectedLayer
    ? scene.assets.find((a) => a.id === selectedLayer.assetId)?.type || null
    : null;

  // Resolve the currently-selected clip from scene.flow.tracks. Clears
  // itself when the underlying clip is removed or the track that owned
  // it disappears, so stale ids don't haunt the inspector.
  const selectedClipContext = useMemo(() => {
    if (!selectedClipId) return null;
    for (const track of scene.flow?.tracks || []) {
      const clip = track.clips?.find((c) => c.id === selectedClipId);
      if (clip) return { track, clip };
    }
    return null;
  }, [selectedClipId, scene.flow]);
  useEffect(() => {
    if (selectedClipId && !selectedClipContext) setSelectedClipId(null);
  }, [selectedClipId, selectedClipContext]);

  /**
   * Selecting a clip also focuses the layer it lives on so the
   * inspector / hierarchy stay in sync. Selecting a different layer
   * (via hierarchy, viewport click, or timeline label) clears the
   * clip selection so the inspector reverts to layer-only mode.
   */
  const handleSelectClip = useCallback((clipId) => {
    setSelectedClipId(clipId);
    setSelectedKey(null);
    if (!clipId) return;
    for (const track of sceneRef.current.flow?.tracks || []) {
      const clip = track.clips?.find((c) => c.id === clipId);
      if (clip) { setSelectedLayerId(track.layerId); return; }
    }
  }, []);

  // ── Timeline keyframe selection + clipboard ─────────────────────────

  const handleSelectKey = useCallback((ref) => {
    setSelectedKey(ref);
  }, []);

  /**
   * Explicitly add keyframe(s) at the playhead to the selected clip for a
   * chosen target — used by the timeline "+ key" dropdown. Works
   * regardless of the auto-key toggle.
   *
   * `target` is one of: 'all' | 'position' | 'position.x' | 'position.y'
   * | 'scale' | 'scale.x' | 'scale.y' | 'rotation' | 'alpha' | 'tint'.
   * A `channel.comp` target forces the channel into split mode so the
   * component gets its own independent key.
   */
  const handleAddKeys = useCallback((target) => {
    const clipId = selectedClipIdRef.current;
    if (!clipId || !target) return;
    const sceneNow = sceneRef.current;
    const flowNow = flowRef.current;
    const tracks = sceneNow.flow?.tracks || [];
    let track = null;
    let clip = null;
    for (const tr of tracks) {
      const c = tr.clips?.find((cl) => cl.id === clipId);
      if (c) { track = tr; clip = c; break; }
    }
    if (!clip) return;
    const layer = sceneNow.layers.find((l) => l.id === track.layerId);
    const baseT = layer?.transforms?.[sceneNow.stage.activeOrientation] || layer?.transforms?.landscape || {};
    const localT = clipLocalSeconds(clip, flowNow.time, { clampPastEnd: true });

    // Expand the target token into a list of { channel, comp? }.
    const specs = [];
    if (target === 'all') {
      for (const ch of ['position', 'scale', 'rotation', 'alpha', 'tint']) specs.push({ channel: ch });
    } else if (target.includes('.')) {
      const [channel, comp] = target.split('.');
      specs.push({ channel, comp });
    } else {
      specs.push({ channel: target });
    }

    // Current value of a logical channel at the playhead (existing data
    // wins; otherwise read the base pose).
    const currentValue = (channelName, ch) => {
      if (ch) {
        const v = evalChannel(ch, localT, channelName);
        if (v != null) return v;
      }
      if (channelName === 'position') return { x: baseT.x ?? 0, y: baseT.y ?? 0 };
      if (channelName === 'scale')    return { x: baseT.scaleX ?? 1, y: baseT.scaleY ?? 1 };
      if (channelName === 'rotation') return baseT.rotation ?? 0;
      if (channelName === 'alpha')    return typeof baseT.alpha === 'number' ? baseT.alpha : 1;
      if (channelName === 'tint')     return baseT.tint || { r: 1, g: 1, b: 1 };
      return 0;
    };

    setScene((prev) => {
      const nextTracks = (prev.flow?.tracks || []).map((tr) => {
        if (tr.id !== track.id) return tr;
        return {
          ...tr,
          clips: tr.clips.map((c) => {
            if (c.id !== clipId) return c;
            const channels = { ...(c.channels || {}) };
            for (const { channel: name, comp } of specs) {
              const layout = channelLayout(name);
              let ch = channels[name];
              if (comp && (layout === 'vec2' || layout === 'rgb')) {
                // Force split, then add a key to just this component.
                if (!ch) ch = { split: true, perComp: {} };
                else if (!ch.split) ch = splitChannel(ch, name);
                const full = currentValue(name, ch);
                const compVal = (full && typeof full === 'object') ? Number(full[comp] ?? 0) : 0;
                const sub = ch.perComp?.[comp] || { keys: [] };
                const nextSub = insertOrUpdateKey(sub, localT, compVal);
                ch = { ...ch, split: true, perComp: { ...(ch.perComp || {}), [comp]: nextSub } };
              } else if (ch?.split) {
                // Whole-channel key on an already-split channel: key every comp.
                const comps = layout === 'vec2' ? ['x', 'y'] : layout === 'rgb' ? ['r', 'g', 'b'] : [];
                const full = currentValue(name, ch);
                const nextPerComp = { ...(ch.perComp || {}) };
                for (const cc of comps) {
                  const sub = nextPerComp[cc] || { keys: [] };
                  nextPerComp[cc] = insertOrUpdateKey(sub, localT, Number(full?.[cc] ?? 0));
                }
                ch = { ...ch, perComp: nextPerComp };
              } else {
                // Linked write.
                const v = currentValue(name, ch);
                ch = insertOrUpdateKey(ch || { keys: [] }, localT, v);
              }
              channels[name] = ch;
            }
            return { ...c, channels: Object.keys(channels).length ? channels : null };
          })
        };
      });
      return { ...prev, flow: deriveFlowGraph({ ...(prev.flow || {}), tracks: nextTracks }) };
    });
  }, [setScene]);

  /** Update the `t` of a specific key (timeline diamond drag). comp set = split channel. */
  const handleMoveKey = useCallback((clipId, name, idx, comp, newT) => {
    setScene((prev) => {
      const tracks = (prev.flow?.tracks || []).map((tr) => {
        if (!tr.clips?.some((c) => c.id === clipId)) return tr;
        return {
          ...tr,
          clips: tr.clips.map((c) => {
            if (c.id !== clipId) return c;
            const ch = c.channels?.[name];
            if (!ch) return c;
            const clamped = Math.max(0, Math.min(c.duration, newT));
            if (comp && ch.split) {
              const sub = ch.perComp?.[comp];
              if (!sub?.keys?.[idx]) return c;
              const keys = sub.keys.map((k, i) => (i === idx ? { ...k, t: clamped } : k));
              keys.sort((a, b) => a.t - b.t);
              return { ...c, channels: { ...c.channels, [name]: { ...ch, perComp: { ...ch.perComp, [comp]: { keys } } } } };
            }
            if (!ch.keys?.[idx]) return c;
            const keys = ch.keys.map((k, i) => (i === idx ? { ...k, t: clamped } : k));
            keys.sort((a, b) => a.t - b.t);
            return { ...c, channels: { ...c.channels, [name]: { ...ch, keys } } };
          })
        };
      });
      return { ...prev, flow: deriveFlowGraph({ ...(prev.flow || {}), tracks }) };
    });
  }, [setScene]);

  /** Delete the selected timeline keyframe. */
  const handleDeleteSelectedKey = useCallback(() => {
    const sel = selectedKeyRef.current;
    if (!sel) return false;
    setScene((prev) => {
      const tracks = (prev.flow?.tracks || []).map((tr) => ({
        ...tr,
        clips: tr.clips.map((c) => {
          if (c.id !== sel.clipId) return c;
          const ch = c.channels?.[sel.name];
          if (!ch) return c;
          const nextChannels = { ...c.channels };
          if (sel.comp && ch.split) {
            const sub = ch.perComp?.[sel.comp];
            if (!sub?.keys) return c;
            const keys = sub.keys.filter((_, i) => i !== sel.idx);
            const perComp = { ...ch.perComp };
            if (keys.length) perComp[sel.comp] = { keys };
            else delete perComp[sel.comp];
            if (Object.keys(perComp).length) nextChannels[sel.name] = { ...ch, perComp };
            else delete nextChannels[sel.name];
          } else {
            if (!ch.keys) return c;
            const keys = ch.keys.filter((_, i) => i !== sel.idx);
            if (keys.length) nextChannels[sel.name] = { ...ch, keys };
            else delete nextChannels[sel.name];
          }
          return { ...c, channels: Object.keys(nextChannels).length ? nextChannels : null };
        })
      }));
      return { ...prev, flow: deriveFlowGraph({ ...(prev.flow || {}), tracks }) };
    });
    setSelectedKey(null);
    return true;
  }, [setScene]);

  /** Copy the selected key's value to the in-memory clipboard. */
  const handleCopySelectedKey = useCallback(() => {
    const sel = selectedKeyRef.current;
    if (!sel) return false;
    const tracks = sceneRef.current.flow?.tracks || [];
    for (const tr of tracks) {
      const c = tr.clips?.find((cl) => cl.id === sel.clipId);
      if (!c) continue;
      const key = c.channels?.[sel.name]?.keys?.[sel.idx];
      if (!key) return false;
      setClipboardKey({ name: sel.name, v: key.v, out: key.out });
      return true;
    }
    return false;
  }, []);

  /**
   * Paste the clipboard value into the selected clip's matching channel
   * at the playhead. Falls back to inserting on the currently-selected
   * clip if the clipboard channel doesn't exist yet.
   */
  const handlePasteKey = useCallback(() => {
    const cb = clipboardKeyRef.current;
    if (!cb) return false;
    const clipId = selectedClipIdRef.current;
    if (!clipId) return false;
    const tracks = sceneRef.current.flow?.tracks || [];
    let targetClip = null;
    let targetTrackId = null;
    for (const tr of tracks) {
      const c = tr.clips?.find((cl) => cl.id === clipId);
      if (c) { targetClip = c; targetTrackId = tr.id; break; }
    }
    if (!targetClip) return false;
    const localT = clipLocalSeconds(targetClip, flowRef.current.time, { clampPastEnd: true });
    setScene((prev) => {
      const ftracks = (prev.flow?.tracks || []).map((tr) => {
        if (tr.id !== targetTrackId) return tr;
        return {
          ...tr,
          clips: tr.clips.map((c) => {
            if (c.id !== clipId) return c;
            const existing = c.channels?.[cb.name] || { keys: [] };
            const nextCh = insertOrUpdateKey(existing, localT, cb.v, { out: cb.out });
            return { ...c, channels: { ...(c.channels || {}), [cb.name]: nextCh } };
          })
        };
      });
      return { ...prev, flow: deriveFlowGraph({ ...(prev.flow || {}), tracks: ftracks }) };
    });
    return true;
  }, [setScene]);

  /** Duplicate the selected key at the playhead (Ctrl+D). */
  const handleDuplicateSelectedKey = useCallback(() => {
    const ok = handleCopySelectedKey();
    if (!ok) return false;
    return handlePasteKey();
  }, [handleCopySelectedKey, handlePasteKey]);

  // Drop stale selectedKey if its clip / channel / idx no longer exist.
  useEffect(() => {
    if (!selectedKey) return;
    const tracks = scene.flow?.tracks || [];
    for (const tr of tracks) {
      const c = tr.clips?.find((cl) => cl.id === selectedKey.clipId);
      if (!c) continue;
      const len = c.channels?.[selectedKey.name]?.keys?.length || 0;
      if (selectedKey.idx >= len) setSelectedKey(null);
      return;
    }
    setSelectedKey(null);
  }, [scene, selectedKey]);

  // Global keyboard shortcuts: Delete, Ctrl+D, Ctrl+C, Ctrl+V, Ctrl+Z, Ctrl+Y, Ctrl+Shift+Z.
  // Don't fire when the user is typing in an input/textarea/contentEditable.
  useEffect(() => {
    const isEditable = (el) => {
      if (!el) return false;
      const tag = (el.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
      if (el.isContentEditable) return true;
      return false;
    };
    const onKey = (e) => {
      if (isEditable(e.target)) return;
      const meta = e.ctrlKey || e.metaKey;
      if (meta && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }
      if (meta && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
        e.preventDefault();
        redo();
        return;
      }
      if (meta && e.key.toLowerCase() === 'd') {
        if (handleDuplicateSelectedKey()) e.preventDefault();
        return;
      }
      if (meta && e.key.toLowerCase() === 'c') {
        if (handleCopySelectedKey()) e.preventDefault();
        return;
      }
      if (meta && e.key.toLowerCase() === 'v') {
        if (handlePasteKey()) e.preventDefault();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (handleDeleteSelectedKey()) e.preventDefault();
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, handleDuplicateSelectedKey, handleCopySelectedKey, handlePasteKey, handleDeleteSelectedKey]);

  /**
   * Selecting a layer (via hierarchy, viewport click, or timeline label)
   * keeps the current clip selection if the clip already lives on the
   * newly-selected layer. This is what makes "click sprite on stage,
   * then edit transform → auto-key" work — clicking the sprite shouldn't
   * un-arm recording.
   */
  const handleSelectLayer = useCallback((layerId) => {
    setSelectedLayerId(layerId);
    setSelectedClipId((curClipId) => {
      if (!curClipId) return null;
      const tracks = sceneRef.current.flow?.tracks || [];
      for (const tr of tracks) {
        if (tr.clips?.some((c) => c.id === curClipId)) {
          if (tr.layerId !== layerId) {
            setSelectedKey(null);
            return null;
          }
          return curClipId;
        }
      }
      setSelectedKey(null);
      return null;
    });
  }, []);

  const handleSave = useCallback(async () => {
    setBusy(true);
    try {
      const result = await saveScene(scene, rootHandle);
      log(
        result.mode === 'scaffold'
          ? `Scene Studio: saved to ${rootHandle.name}/${result.path}`
          : 'Scene Studio: scene.json downloaded',
        'ok'
      );
    } catch (e) {
      log(`Scene Studio save failed: ${e.message || e}`, 'err');
    } finally {
      setBusy(false);
    }
  }, [scene, rootHandle, log]);

  const handleLoad = useCallback(async () => {
    setBusy(true);
    try {
      const loaded = await loadSceneFromFile();
      if (!loaded) return;
      replaceSceneNoHistory(loaded);
      setSelectedLayerId(null);
      setFlowState(createInitialFlowState());
      log('Scene Studio: scene loaded', 'ok');
    } catch (e) {
      log(`Scene Studio load failed: ${e.message || e}`, 'err');
    } finally {
      setBusy(false);
    }
  }, [log]);

  useEffect(() => {
    const api = {
      getScene: () => sceneRef.current,
      getSelected: () => selectedLayerId,
      getOrientation: () => scene.stage.activeOrientation,
      listLayers: () => scene.layers.map((l) => ({
        id: l.id,
        name: l.name,
        parentId: l.parentId,
        canvasId: l.canvasId,
        assetType: scene.assets.find((a) => a.id === l.assetId)?.type
      })),
      listAssets: () => assetItems,
      getAssetDescriptor: (assetId) => assetDescriptors[assetId] || null,
      addPng: (file) => addPngLayer(file instanceof File ? file : new File([file], 'png', { type: 'image/png' })),
      addVideo: (file) => addVideoLayer(file instanceof File ? file : new File([file], 'video', { type: 'video/mp4' })),
      addSpine: (group) => addSpineLayer(group),
      addAssetItem: (id) => {
        const item = assetItems.find((x) => x.id === id);
        if (!item) return Promise.resolve();
        return addAssetItemFromBrowser(item);
      },
      select: (id) => setSelectedLayerId(id),
      patchLayer: (id, patch) => handlePatchLayer(id, patch),
      patchTransform: (id, patch) => handlePatchTransform(id, patch),
      resetPortrait: (id) => handleResetPortrait(id),
      setVisibility: (id, visible) => handleToggleVisibility(id, visible),
      removeLayer: (id) => handleRemoveLayer(id),
      reorder: (draggedId, targetId, mode, canvasId) => handleReorder(draggedId, targetId, mode, canvasId),
      toggleOrientation: () => handleToggleOrientation(),
      setOrientation: (o) => setScene((prev) => ({ ...prev, stage: { ...prev.stage, activeOrientation: o } })),
      play: () => setFlowState((s) => flowPlay(s)),
      pause: () => setFlowState((s) => flowPause(s)),
      stop: () => setFlowState((s) => flowStop(s)),
      seek: (t) => setFlowState((s) => flowSeek(sceneRef.current, s, t)),
      emitSignal: (name) => setFlowState((s) => flowResolveSignal(s, name)),
      addMarker: (type = 'waitForClick') => {
        const marker = { id: uid('M'), time: flowRef.current.time, type };
        patchFlow({ ...(scene.flow || {}), markers: [...(scene.flow?.markers || []), marker] });
      },
      setDuration: (seconds) => handleFlowAction('setDuration', seconds),
      save: () => handleSave(),
      load: () => handleLoad(),
      rescanAssets: () => refreshAssetBrowser(rootHandle),
      reset: () => {
        replaceSceneNoHistory(createEmptyScene('Untitled scene'));
        setSelectedLayerId(null);
        setSelectedClipId(null);
        setSelectedKey(null);
        setAssetDescriptors({});
        setFlowState(createInitialFlowState());
      },
      undo,
      redo,
      historyDepth: () => ({ undo: undoStackRef.current.length, redo: redoStackRef.current.length }),
      selectedKey: () => selectedKeyRef.current,
      selectKey: (clipId, name, idx) => setSelectedKey({ clipId, name, idx }),
      deleteSelectedKey: () => handleDeleteSelectedKey(),
      duplicateSelectedKey: () => handleDuplicateSelectedKey(),
      copySelectedKey: () => handleCopySelectedKey(),
      pasteKey: () => handlePasteKey()
    };
    window.__sceneStudio = api;
    return () => {
      if (window.__sceneStudio === api) delete window.__sceneStudio;
    };
  }, [
    scene,
    selectedLayerId,
    assetDescriptors,
    assetItems,
    rootHandle,
    addPngLayer,
    addSpineLayer,
    addVideoLayer,
    addAssetItemFromBrowser,
    handlePatchLayer,
    handlePatchTransform,
    handleResetPortrait,
    handleToggleVisibility,
    handleRemoveLayer,
    handleReorder,
    handleToggleOrientation,
    patchFlow,
    handleSave,
    handleLoad,
    refreshAssetBrowser
  ]);

  return (
    <div className="scene-studio-root">
      <StudioToolbar
        scene={scene}
        onRename={handleRename}
        rootHandle={rootHandle}
        onPickRoot={handlePickRoot}
        onPickFolderFallback={handlePickFolderFallback}
        onClearRoot={handleClearRoot}
        onSave={handleSave}
        onLoad={handleLoad}
        onToggleOrientation={handleToggleOrientation}
        livePreview={livePreview}
        onToggleLivePreview={() => setLivePreview((v) => !v)}
        busy={busy}
        rootDropSupported
        rootDropHover={rootDropHover}
        onRootDragOver={handleRootDragOver}
        onRootDragLeave={handleRootDragLeave}
        onRootDrop={handleRootDrop}
        onUndo={undo}
        onRedo={redo}
        canUndo={historyDepth.undo > 0}
        canRedo={historyDepth.redo > 0}
      />

      <div className="scene-studio-body">
        <div className="scene-left-stack">
          <HierarchyPanel
            scene={scene}
            selectedLayerId={selectedLayerId}
            onSelect={handleSelectLayer}
            onToggleVisibility={handleToggleVisibility}
            onRemove={handleRemoveLayer}
            onReorder={handleReorder}
          />
          <AssetBrowserPanel
            items={assetItems}
            onAddItem={addAssetItemFromBrowser}
            hasRoot={!!rootHandle}
            onPickRoot={handlePickRoot}
            onPickFolderFallback={handlePickFolderFallback}
            busy={busy}
            pickError={pickError}
            onDismissPickError={() => setPickError(null)}
            rootDropSupported
            rootDropHover={rootDropHover}
            onRootDragOver={handleRootDragOver}
            onRootDragLeave={handleRootDragLeave}
            onRootDrop={handleRootDrop}
          />
        </div>

        <div className="scene-center-stack">
          <div ref={dropRef} className="scene-viewport-wrap">
            <PixiErrorBoundary>
              <PixiViewport
                scene={sceneWithRuntime}
                rootHandle={rootHandle}
                selectedLayerId={selectedLayerId}
                selectedClip={selectedClipContext}
                onSelectLayer={handleSelectLayer}
                onTransformLayer={handleTransformLayer}
                onAssetReady={handleAssetReady}
                flowTime={flowState.time}
                livePreview={livePreview}
                onViewportClick={() => handleFlowAction('clickResume')}
              />
            </PixiErrorBoundary>
            {scene.layers.length === 0 && (
              <div className="scene-viewport-empty">
                <div className="scene-viewport-empty-icon">🎬</div>
                <div>drop PNG / video / Spine files here</div>
                <div className="scene-viewport-empty-hint">or use assets panel from selected project root</div>
              </div>
            )}
          </div>

          <TimelinePanel
            scene={scene}
            flowState={flowState}
            selectedLayerId={selectedLayerId}
            selectedLayerAssetType={selectedLayerAssetType}
            selectedClipId={selectedClipId}
            selectedKey={selectedKey}
            assetDescriptors={assetDescriptors}
            autoKey={autoKey}
            onToggleAutoKey={() => setAutoKey((v) => !v)}
            onAddKeys={handleAddKeys}
            onSelectLayer={handleSelectLayer}
            onSelectClip={handleSelectClip}
            onSelectKey={handleSelectKey}
            onMoveKey={handleMoveKey}
            onPatchFlow={patchFlow}
            onFlowAction={handleFlowAction}
          />
        </div>

        <InspectorPanel
          scene={scene}
          selectedLayerId={selectedLayerId}
          selectedClip={selectedClipContext}
          assetDescriptors={assetDescriptors}
          flowTime={flowState.time}
          onPatchLayer={handlePatchLayer}
          onPatchTransform={handlePatchTransform}
          onResetPortrait={handleResetPortrait}
          onPatchFlow={patchFlow}
        />
      </div>
      {rootDropHover && (
        <div className="scene-root-drop-overlay">
          <div className="scene-root-drop-card">
            <div className="scene-root-drop-title">
              {rootHandle ? 'Drop project folder to replace root' : 'Drop project folder to link root'}
            </div>
            <div className="scene-root-drop-sub">Drop on toolbar slot or Assets panel</div>
          </div>
        </div>
      )}
    </div>
  );
}
