// SceneStudioInner — Scene Studio main React component.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import { AssetBrowserPanel } from './components/AssetBrowserPanel.jsx';
import { HierarchyPanel } from './components/HierarchyPanel.jsx';
import { InspectorPanel } from './components/InspectorPanel.jsx';
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
import './styles/scene-studio.css';

const VIDEO_EXT = /\.(mp4|webm|mov|m4v)$/i;

export default function SceneStudioInner() {
  const { log } = useApp();
  const [scene, setScene] = useState(() => createEmptyScene('Untitled scene'));
  const [rootHandle, setRootHandle] = useState(null);
  const [selectedLayerId, setSelectedLayerId] = useState(null);
  const [selectedClipId, setSelectedClipId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [assetDescriptors, setAssetDescriptors] = useState({});
  const [assetItems, setAssetItems] = useState([]);
  const [flowState, setFlowState] = useState(() => createInitialFlowState());
  const [rootDropHover, setRootDropHover] = useState(false);
  const [pickError, setPickError] = useState(null);
  const [livePreview, setLivePreview] = useState(true);
  const sceneRef = useRef(scene);
  sceneRef.current = scene;

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

  const handlePatchTransform = useCallback((layerId, patch) => {
    setScene((prev) => ({
      ...prev,
      layers: prev.layers.map((l) =>
        l.id === layerId ? patchTransform(l, prev.stage.activeOrientation, patch) : l
      )
    }));
  }, []);

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
        setScene(existing);
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
    if (!clipId) return;
    for (const track of sceneRef.current.flow?.tracks || []) {
      const clip = track.clips?.find((c) => c.id === clipId);
      if (clip) { setSelectedLayerId(track.layerId); return; }
    }
  }, []);

  const handleSelectLayer = useCallback((layerId) => {
    setSelectedLayerId(layerId);
    setSelectedClipId(null);
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
      setScene(loaded);
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
      getScene: () => scene,
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
        setScene(createEmptyScene('Untitled scene'));
        setSelectedLayerId(null);
        setAssetDescriptors({});
        setFlowState(createInitialFlowState());
      }
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
            <PixiViewport
              scene={sceneWithRuntime}
              rootHandle={rootHandle}
              selectedLayerId={selectedLayerId}
              onSelectLayer={handleSelectLayer}
              onTransformLayer={handleTransformLayer}
              onAssetReady={handleAssetReady}
              flowTime={flowState.time}
              livePreview={livePreview}
              onViewportClick={() => handleFlowAction('clickResume')}
            />
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
            assetDescriptors={assetDescriptors}
            onSelectLayer={handleSelectLayer}
            onSelectClip={handleSelectClip}
            onPatchFlow={patchFlow}
            onFlowAction={handleFlowAction}
          />
        </div>

        <InspectorPanel
          scene={scene}
          selectedLayerId={selectedLayerId}
          selectedClip={selectedClipContext}
          assetDescriptors={assetDescriptors}
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
