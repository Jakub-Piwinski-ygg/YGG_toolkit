// SceneStudioInner — Scene Studio main React component.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import { useRepoBrowser } from '../../context/RepoBrowserContext.jsx';
import { fetchTree, commitFile, authBlobUrl, runPool, LS_KEY } from '../../utils/repoBrowser.js';
import { rootZoom } from '../../utils/domZoom.js';
import { AssetBrowserPanel } from './components/AssetBrowserPanel.jsx';
import { HierarchyPanel } from './components/HierarchyPanel.jsx';
import { InspectorPanel } from './components/InspectorPanel.jsx';
import { PixiErrorBoundary } from './components/PixiErrorBoundary.jsx';
import { PixiViewport } from './components/PixiViewport.jsx';
import { SpinnerWizard } from './components/SpinnerWizard.jsx';
import { normalizeSpinnerConfig, buildSpinnerFullSpinTimeline } from './engine/spinner/spinnerModel.js';
import { WinSequenceWizard } from './components/WinSequenceWizard.jsx';
import { normalizeWinSeqConfig, buildWinSeqTimelines } from './engine/winseq/winseqModel.js';
import {
  buildSceneSetupIdleTimelines,
  buildSceneSetupAuxTimelines,
  resolveSceneSetupPhaseClips
} from './engine/sceneSetupTimelines.js';
import { SceneSetupWizard } from './components/SceneSetupWizard.jsx';
import { StudioToolbar } from './components/StudioToolbar.jsx';
import { WorkspaceLockOverlay } from './components/WorkspaceLockOverlay.jsx';
import { RepoWorkspacePicker } from './components/RepoWorkspacePicker.jsx';
import { TimelinePanel } from './components/TimelinePanel.jsx';
import { ScenarioTimelineList } from './components/ScenarioTimelineList.jsx';
import { ScenarioGraphPanel } from './components/ScenarioGraphPanel.jsx';
import { ScenarioInspectorSections } from './components/ScenarioInspectorSections.jsx';
import { UnityExportDialog } from './components/UnityExportDialog.jsx';
import { WebMExportDialog } from './components/WebMExportDialog.jsx';
import { RelinkAssetsDialog } from './components/RelinkAssetsDialog.jsx';
import { scanProjectAssets } from './engine/assetBrowser.js';
import {
  createEmptyScene,
  defaultTransformsForNewLayer,
  deriveFlowGraph,
  getWorldPosition,
  isDescendantOf,
  uid,
  addTimeline,
  addPrebuiltTimelines,
  regenerateTimelinesForLayer,
  setActiveTimeline,
  renameTimeline,
  removeTimeline,
  syncFlowToActiveTimeline
} from './engine/sceneModel.js';
import {
  PROJECT_SCHEMA,
  createEmptyProject,
  deriveWorkingScene,
  foldSceneIntoProject,
  projectFromScene,
  validateProject,
  addScene as addProjectScene,
  duplicateSceneAsVariant,
  setActiveScene,
  renameScene
} from './engine/projectModel.js';
import {
  activeScenario as getActiveScenario,
  addScenario,
  removeScenario,
  renameScenario,
  setActiveScenario,
  duplicateScenario,
  updateScenario,
  addTimelineNode,
  addTimelineNodeChained,
  removeNode as scRemoveNode,
  addOutputPin as scAddOutputPin,
  removeOutputPin as scRemoveOutputPin,
  connect as scConnect,
  disconnect as scDisconnect,
  disconnectAndPrunePin as scDisconnectAndPrunePin,
  setActiveEdge as scSetActiveEdge,
  moveNode as scMoveNode,
  setNodeLabel as scSetNodeLabel,
  setNodeEntry as scSetNodeEntry,
  setEdgeTransition as scSetEdgeTransition,
  setView as scSetView,
  listProjectTimelines
} from './engine/scenarioModel.js';
import { buildScenarioTimeline, sampleScenario, spinnerCarryByNode, layerPoseCarryByNode } from './engine/scenarioTimeline.js';
import { buildBlendedScene, bakeCarriedPoses } from './engine/scenarioBlend.js';
import { clearSession, loadSession, saveSession } from './engine/sessionStore.js';
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
  loadProjectFromFile,
  loadProjectFromHandle,
  listUnresolvedAssets,
  pickProjectRoot,
  relinkSceneAssetsToScan,
  repairSceneSpineAssets,
  saveProject,
  serializeProject
} from './engine/persist.js';
import { makeVirtualRootHandle, readFolderDropAsFiles, isVirtualHandle } from './engine/virtualHandle.js';
import { makeRepoRootHandle } from './engine/repoHandle.js';
import { patchTransform, resetPortrait, resolveTransform } from './engine/orientationManager.js';
import { groupSpineFiles } from './engine/spineLoader.js';
import {
  channelLayout,
  baseChannelValue,
  channelKeyList,
  clipLocalSeconds,
  composeRgbValue,
  composeVec2Value,
  evalChannel,
  evalScalarKeys,
  insertOrUpdateKey,
  insertKeyWithStartRamp,
  insertCompKeyWithStartRamp,
  isPathChannel,
  splitChannel,
  transformClipKeys,
  SPRITE_PROP_TO_CHANNEL
} from './engine/animation/keyframes.js';
import { insertOrUpdatePathPoint, resolvePointHandles } from './engine/animation/pathSpline.js';
import './styles/scene-studio.css';

const VIDEO_EXT = /\.(mp4|webm|mov|m4v)$/i;

// Asset file types worth pre-downloading from a repo workspace into the blob
// cache (images, spine skeletons/atlases, video). Other repo files lazy-load.
const REPO_ASSET_EXT = /\.(png|jpe?g|webp|gif|bmp|tga|json|mp4|webm|mov|m4v)$/i;
function collectRepoMediaFiles(tree, subPath) {
  const prefix = String(subPath || '').replace(/\/+$/, '');
  const norm = prefix ? prefix + '/' : '';
  const out = [];
  for (const it of tree) {
    if (it.type !== 'blob') continue;
    if (norm && !it.path.startsWith(norm)) continue;
    if (REPO_ASSET_EXT.test(it.path) || /\.atlas(\.txt)?$/i.test(it.path)) out.push(it.path);
  }
  return out;
}

/** Zero-offset transforms for a bone-following child (e.g. a win-number layer).
 *  The bone follow places it; this transform is just the user's tweak on top. */
function zeroOffsetTransforms() {
  const z = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, anchor: [0.5, 0.5], alpha: 1, tint: { r: 1, g: 1, b: 1 } };
  return { landscape: z, portrait: null };
}

/**
 * Find a free [start, duration] window of `slotDuration` seconds at/after
 * `prefStart` that doesn't overlap any clip in `clips`, shrinking to fit if
 * needed. Returns null when nothing fits. Used by clip paste (the TimelinePanel
 * has its own copy for drag-to-create).
 */
function findFreeSlotIn(clips, prefStart, slotDuration, duration) {
  const sorted = [...(clips || [])].sort((a, b) => a.start - b.start);
  let start = Math.max(0, Math.min(prefStart, Math.max(0, duration - 0.05)));
  for (const c of sorted) {
    if (start >= c.start && start < c.start + c.duration) start = c.start + c.duration;
  }
  if (start >= duration) return null;
  let maxEnd = duration;
  for (const c of sorted) {
    if (c.start >= start) { maxEnd = Math.min(maxEnd, c.start); break; }
  }
  const dur = Math.max(0.05, Math.min(slotDuration, maxEnd - start));
  if (dur < 0.05) return null;
  return { start, duration: dur };
}

/** Locate a clip (and its track) by id across the scene's flow tracks. */
function findClipById(scene, clipId) {
  for (const tr of scene?.flow?.tracks || []) {
    const c = tr.clips?.find((cl) => cl.id === clipId);
    if (c) return { track: tr, clip: c };
  }
  return { track: null, clip: null };
}

/**
 * Resolve a keyframe-selection entry to its live array index by stable `kid`
 * (falling back to its cached `idx` for legacy entries). Returns -1 if the key
 * no longer exists. The timeline selection identifies keys by kid so it survives
 * the re-sorts that move / delete / paste trigger; consumers that need an index
 * (graph editor, move-by-frame) resolve it here against the live scene.
 */
function resolveSelIdx(clip, sel) {
  const keys = channelKeyList(clip?.channels, sel.name, sel.comp);
  if (!keys) return -1;
  if (sel.kid != null) {
    const i = keys.findIndex((k) => k.kid === sel.kid);
    if (i >= 0) return i;
  }
  return (typeof sel.idx === 'number' && sel.idx >= 0 && sel.idx < keys.length) ? sel.idx : -1;
}

/** Stamp a selection entry with its key's `kid` when the caller passed idx only. */
function selKeyWithKid(clip, sel) {
  if (!sel || sel.kid != null) return sel;
  const keys = channelKeyList(clip?.channels, sel.name, sel.comp);
  const k = keys?.[sel.idx];
  return k?.kid != null ? { ...sel, kid: k.kid } : sel;
}

// ── Resizable-panel sizing (persisted to localStorage) ────────────────
const PANEL_SIZES = {
  left:     { key: 'ss.leftW',     def: 260, min: 260, max: 560 },  // hierarchy/workspace — grow rightward
  right:    { key: 'ss.rightW',    def: 300, min: 300, max: 640 },  // inspector — grow leftward
  timeline: { key: 'ss.timelineH', def: 220, min: 120, max: 600 },
  // Wizard side panel (full-focus): a vertical right column, wider than the
  // inspector so every setup field fits comfortably. T8: user-resizable like
  // every other panel — was a hardcoded WIZARD_PANEL_W=460 constant with no
  // resize handle or persistence, the one panel in the app that diverged
  // from the shared left/right/timeline resize mechanism. Default bumped
  // 460→620 (2026-07-04): the symbol-preview thumbnails now scale with the
  // panel width (see .spinner-sym-previews), so a narrow default left most
  // of the row visibly empty — 620px (~43% of a 1440px viewport) actually
  // uses that space instead of just leaving more blank margin.
  wizard:   { key: 'ss.wizardW',   def: 620, min: 320, max: 760 }
};
function readStoredSize(spec) {
  try {
    const v = Number(localStorage.getItem(spec.key));
    if (Number.isFinite(v) && v > 0) return Math.max(spec.min, Math.min(spec.max, v));
  } catch { /* ignore */ }
  return spec.def;
}

/** Total layer count across all scenes in a session-draft project. */
function sessionLayerCount(project) {
  if (!project?.scenes) return 0;
  return project.scenes.reduce((sum, s) => sum + (s?.data?.layers?.length || 0), 0);
}

/**
 * Commit the active scene's LIVE `flow` into its active timeline, then fold it
 * back into the project. Call this before any project-level change (scene
 * switch / add / variant) so the outgoing scene's `timelines[]` is current and
 * doesn't lose edits when it becomes inactive.
 */
function commitCurrentSceneFlow(project) {
  const curScene = deriveWorkingScene(project);
  const synced = syncFlowToActiveTimeline(curScene);
  return foldSceneIntoProject(project, synced);
}

/** Build a scene asset from an asset-browser item (mirrors addAssetItemFromBrowser). */
function assetFromBrowserItem(item) {
  if (item.type === 'spine') {
    return { id: uid('a'), type: 'spine', src: item.jsonPath, atlas: item.atlasPath, texture: item.texturePath, meta: { originalName: item.name } };
  }
  if (item.type === 'video') {
    return { id: uid('a'), type: 'video', src: item.path, meta: { originalName: item.name } };
  }
  return { id: uid('a'), type: 'png', src: item.path, meta: { originalName: item.name } };
}

/** Find an existing scene asset matching a browser item's source (dedupe). */
function findAssetForItem(assets, item) {
  const src = item.type === 'spine' ? item.jsonPath : item.path;
  return (assets || []).find((a) => a.src === src) || null;
}

/**
 * Reassign a layer to a different asset (object swap), keeping the animation
 * (clips/channels live on the track, not the layer) and the layer's pose, but
 * resetting scale to 1:1 so the new object isn't distorted by the previous
 * object's scaling. Spine/video sub-config is reset to sensible defaults.
 */
function applyAssetSwapToLayer(layer, asset) {
  const scaleOne = (t) => (t ? { ...t, scaleX: 1, scaleY: 1 } : t);
  const next = {
    ...layer,
    assetId: asset.id,
    transforms: {
      landscape: scaleOne(layer.transforms?.landscape),
      portrait: scaleOne(layer.transforms?.portrait)
    }
  };
  if (asset.type === 'spine') next.spine = { defaultAnimation: null, loop: true, skin: null };
  else delete next.spine;
  if (asset.type === 'video') next.video = layer.video || { loop: true, muted: true };
  else delete next.video;
  return next;
}

/**
 * Shift all clip-local key times by `delta` seconds to preserve absolute
 * time positions when the clip's start is moved. Works for linked and split
 * channel storage. Clamps shifted times to ≥ 0.
 */
function shiftAllChannelKeys(channels, delta) {
  if (!channels || delta === 0) return channels;
  const result = {};
  for (const [name, ch] of Object.entries(channels)) {
    if (!ch) { result[name] = ch; continue; }
    if (ch.split && ch.perComp) {
      const perComp = {};
      for (const [comp, sub] of Object.entries(ch.perComp || {})) {
        perComp[comp] = { keys: (sub.keys || []).map((k) => ({ ...k, t: Math.max(0, k.t + delta) })) };
      }
      result[name] = { ...ch, perComp };
    } else if (ch.keys) {
      result[name] = { ...ch, keys: ch.keys.map((k) => ({ ...k, t: Math.max(0, k.t + delta) })) };
    } else {
      result[name] = ch;
    }
  }
  return result;
}

export default function SceneStudioInner() {
  const { log } = useApp();
  const rb = useRepoBrowser();
  const [showRepoPicker, setShowRepoPicker] = useState(false);
  // Repo asset pre-download progress: null | { total, done, repo }
  const [prefetch, setPrefetch] = useState(null);
  const prefetchAbortRef = useRef(false);
  // The document is a Project (shared asset pool + multiple scenes). The
  // working `scene` is materialized from the active scene's data + the shared
  // pool, so every existing scene.* / scene.flow consumer keeps working.
  const [project, setProjectInternal] = useState(() => createEmptyProject());
  const scene = useMemo(() => deriveWorkingScene(project), [project]);
  const [rootHandle, setRootHandle] = useState(null);
  const [showUnityExport, setShowUnityExport] = useState(false);
  const [showWebMExport, setShowWebMExport] = useState(false);
  const [showSpinnerWizard, setShowSpinnerWizard] = useState(false);
  // When set, the wizard runs in edit mode against an existing spinner:
  // { layerId, assetId, config, name }
  const [editSpinnerTarget, setEditSpinnerTarget] = useState(null);
  const [showWinSeqWizard, setShowWinSeqWizard] = useState(false);
  // When set, the win-sequence wizard runs in edit mode against an existing
  // winseq object: { layerId, assetId, config, name, skeleton }
  const [editWinSeqTarget, setEditWinSeqTarget] = useState(null);
  const [showSceneSetupWizard, setShowSceneSetupWizard] = useState(false);
  // Edit mode for the Scene Setup wizard: { layerId, config } from a root object.
  const [editSceneSetupTarget, setEditSceneSetupTarget] = useState(null);
  const editSceneSetupTargetRef = useRef(null);
  editSceneSetupTargetRef.current = editSceneSetupTarget;
  // Live wizard preview: while a wizard is open it owns the scene-view render —
  // it pushes a synthetic preview scene + a transport clock here (mirrors the
  // scenario `directPreview` swap). Cleared when the wizard closes.
  const [wizardPreviewScene, setWizardPreviewScene] = useState(null);
  const [wizardPreviewTime, setWizardPreviewTime] = useState(0);
  // Bumped by "refresh assets" to force the viewport to rebuild from disk
  // (re-reads every asset → fresh textures). Viewport-only; never serialized.
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [selectedLayerId, setSelectedLayerId] = useState(null);
  // Multi-selection of hierarchy objects (ctrl/shift-click). The primary
  // `selectedLayerId` drives the inspector/viewport; `selectedLayerIds` is the
  // full set for multi-drag reparent + multi-drop to the timeline.
  const [selectedLayerIds, setSelectedLayerIds] = useState([]);
  const [selectedClipId, setSelectedClipId] = useState(null);
  // Multi-selection of timeline clips (ctrl/shift-click + marquee). The
  // primary `selectedClipId` is kept as the last-clicked clip and drives the
  // inspector + auto-key target. `selectedClipIds` is the full set for group
  // move + group delete.
  const [selectedClipIds, setSelectedClipIds] = useState([]);
  const [selectedKey, setSelectedKey] = useState(null);   // { clipId, name, comp, idx } | null (primary)
  // Multi-selection of keyframes within a SINGLE clip (marquee + ctrl-click).
  // Each entry is { clipId, name, comp, idx }; `selectedKey` is the primary.
  const [selectedKeys, setSelectedKeys] = useState([]);
  // Unified clipboard for copy/paste: kind 'keys' carries a relative-timed key
  // sequence; kind 'clips' carries clip snapshots (with their track + offset).
  const [clipboard, setClipboard] = useState(null); // { kind:'keys'|'clips', ... } | null
  const [busy, setBusy] = useState(false);
  const [assetDescriptors, setAssetDescriptors] = useState({});
  const [assetItems, setAssetItems] = useState([]);
  const [flowState, setFlowState] = useState(() => createInitialFlowState());
  const [rootDropHover, setRootDropHover] = useState(false);
  const [pickError, setPickError] = useState(null);
  // Layers created by a wizard that still need their timelines auto-generated.
  // Win-seq generation needs the object's animation durations, which arrive
  // asynchronously after the Pixi build — so we queue the layer and fire once
  // the descriptor is ready (spinner needs no durations and fires next tick).
  const pendingAutoGenRef = useRef(new Set());
  const [autoGenNonce, setAutoGenNonce] = useState(0);
  // Live preview is always on now (the toolbar toggle was removed) — Spine
  // animations and video play continuously in the viewport.
  const livePreview = true;
  // Gizmo visibility toggle (viewport overlay): hides the origin pivot cross +
  // the transform selection box/handles for a clean, uncluttered preview.
  const [showGizmo, setShowGizmo] = useState(true);
  // Easy mode (?easy=1 in the URL): a stripped-down surface for onboarding —
  // hides advanced/rarely-needed controls (direct mode, keyframe-ease picker,
  // Unity export) without changing any behaviour. Read once; URL is stable.
  const easyMode = useMemo(() => {
    try {
      const p = new URLSearchParams(window.location.search);
      // Accept ?easy, ?easy=1, ?easy=true — anything but an explicit off value.
      // NB: Scene Studio must already be the active tool, so the full URL is
      // e.g. ?tool=scenestudio&easy=1 (not ?easy=1 on its own).
      return p.has('easy') && !['0', 'false', 'no'].includes((p.get('easy') || '').toLowerCase());
    } catch { return false; }
  }, []);
  // ?debug=1 turns on viewport gizmo diagnostics (routed to the app log).
  const sceneDebug = useMemo(() => {
    try { return new URLSearchParams(window.location.search).has('debug'); }
    catch { return false; }
  }, []);
  const [overlayMode, setOverlayMode] = useState('above');
  // Default tangent mode stamped onto NEWLY created keyframes (P4). Existing
  // keys keep their own mode. Read through a ref by the imperative auto-key
  // path so it never goes stale.
  const [defaultEase, setDefaultEase] = useState('auto');
  const defaultEaseRef = useRef(defaultEase);
  defaultEaseRef.current = defaultEase;
  // Auto-key: when ON, editing a transform while a clip is selected and
  // the playhead is inside it records a keyframe. When OFF, edits always
  // go to the base pose. Read through a ref by handlePatchTransform.
  const [autoKey, setAutoKey] = useState(true);
  const autoKeyRef = useRef(autoKey);
  autoKeyRef.current = autoKey;

  // Studio mode: 'setup' = position default poses per orientation (no timeline,
  // no keyframes); 'animate' = create timelines + keyframe over time. Read
  // through a ref by the imperative handlePatchTransform path.
  const [studioMode, setStudioMode] = useState('setup');
  const studioModeRef = useRef(studioMode);
  studioModeRef.current = studioMode;
  // While the video-export dialog is open, playback must not advance: the
  // exporter drives the viewport frame-by-frame at native res, and any
  // state-driven tick (flow / scenario) would run a competing applyFlowAtTime +
  // render into the live view — the "flicker fight" (see PLAN_2026-07 B1).
  const exportDialogOpenRef = useRef(false);
  exportDialogOpenRef.current = showWebMExport;

  // ── Resizable panels (drag-to-resize, persisted) ──────────────────────
  const [leftW, setLeftW] = useState(() => readStoredSize(PANEL_SIZES.left));
  const [rightW, setRightW] = useState(() => readStoredSize(PANEL_SIZES.right));
  const [timelineH, setTimelineH] = useState(() => readStoredSize(PANEL_SIZES.timeline));
  const [wizardW, setWizardW] = useState(() => readStoredSize(PANEL_SIZES.wizard));
  const centerStackRef = useRef(null);
  useEffect(() => { try { localStorage.setItem(PANEL_SIZES.left.key, String(Math.round(leftW))); } catch { /* ignore */ } }, [leftW]);
  useEffect(() => { try { localStorage.setItem(PANEL_SIZES.right.key, String(Math.round(rightW))); } catch { /* ignore */ } }, [rightW]);
  useEffect(() => { try { localStorage.setItem(PANEL_SIZES.timeline.key, String(Math.round(timelineH))); } catch { /* ignore */ } }, [timelineH]);
  useEffect(() => { try { localStorage.setItem(PANEL_SIZES.wizard.key, String(Math.round(wizardW))); } catch { /* ignore */ } }, [wizardW]);

  /**
   * Start a panel-resize drag. Uses window listeners (not pointer capture) so
   * the drag survives the cursor leaving the thin handle. `sign` is +1 when
   * dragging toward larger values grows the panel, -1 otherwise.
   */
  const beginPanelResize = useCallback((e, { axis, base, min, max, sign, set }) => {
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    const startPos = axis === 'x' ? e.clientX : e.clientY;
    const onMove = (ev) => {
      const pos = axis === 'x' ? ev.clientX : ev.clientY;
      // Panel sizes are layout px; the pointer delta is in ui-scale-zoomed px.
      const z = rootZoom();
      set(Math.max(min, Math.min(max, base + sign * (pos - startPos) / z)));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    document.body.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
  }, []);

  /**
   * Switch studio mode. Entering setup mode pins the playhead to 0, stops
   * playback, and clears any clip / keyframe selection so transform edits
   * unambiguously route to the base pose.
   */
  const handleSetStudioMode = useCallback((mode) => {
    if (mode !== 'setup' && mode !== 'animate' && mode !== 'direct') return;
    setStudioMode(mode);
    if (mode === 'setup') {
      setSelectedClipId(null);
      setSelectedClipIds([]);
      setSelectedKey(null);
      setFlowState((prev) => flowSeek(sceneRef.current, flowStop(prev), 0));
      // Wipe all live animation state so setup shows the clean setup pose —
      // Spine tracks cleared + setup pose, spinner board idled, videos rewound.
      pixiViewportRef.current?.resetToSetup();
    }
    if (mode === 'direct') {
      // Direct mode drives the preview through the scenario runtime (P3). Stop
      // the single-timeline playback and clear clip/key selection so it can't
      // fight the runtime. Ensure the project has at least one scenario to edit.
      setSelectedClipId(null);
      setSelectedClipIds([]);
      setSelectedKey(null);
      setFlowState((prev) => flowStop(prev));
      setProjectInternal((prev) => {
        // Always commit the active scene's LIVE flow into its timeline first, so
        // edits just made in animate mode are visible to the scenario preview
        // (the scenario timeline reads from timelines[], not the live flow).
        let next = commitCurrentSceneFlow(prev);
        if (!(next.scenarios || []).length) next = addScenario(next, 'Scenario 1').project;
        return next;
      });
      setScenarioPlayhead({ time: 0, playing: false });
    }
  }, []);

  // Session persistence: draft shown to user on mount if IDB has a saved scene.
  // Shape: { scene, rootHandle, savedAt, schemaVersion } | null
  const [sessionDraft, setSessionDraft] = useState(null);
  const sessionDraftRef = useRef(sessionDraft);
  sessionDraftRef.current = sessionDraft;
  // Guard: only start autosaving once the user has taken an action
  // (avoids immediately overwriting a good session with a blank scene on mount).
  const autosaveEnabledRef = useRef(false);
  const autosaveTimerRef = useRef(null);

  // Confirm dialog for "New project" (shown when current scene has layers).
  const [newProjectPending, setNewProjectPending] = useState(false);

  // Undo / redo: simple stacks of full-scene snapshots. Pushes are
  // coalesced for rapid edits (e.g. drag-scrubbing a value) via
  // `historyCoalesceUntilRef` so a 30-frame drag becomes one undo step.
  const undoStackRef = useRef([]);
  const redoStackRef = useRef([]);
  const historyCoalesceUntilRef = useRef(0);
  const [historyDepth, setHistoryDepth] = useState({ undo: 0, redo: 0 });
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  const projectRef = useRef(project);
  projectRef.current = project;
  const rootHandleRef = useRef(rootHandle);
  rootHandleRef.current = rootHandle;
  const selectedClipIdRef = useRef(selectedClipId);
  selectedClipIdRef.current = selectedClipId;
  const selectedClipIdsRef = useRef(selectedClipIds);
  selectedClipIdsRef.current = selectedClipIds;
  const selectedKeyRef = useRef(selectedKey);
  selectedKeyRef.current = selectedKey;
  const selectedKeysRef = useRef(selectedKeys);
  selectedKeysRef.current = selectedKeys;
  const clipboardRef = useRef(clipboard);
  clipboardRef.current = clipboard;

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
    setProjectInternal((prevProj) => {
      const prevScene = deriveWorkingScene(prevProj);
      const next = typeof updater === 'function' ? updater(prevScene) : updater;
      if (next === prevScene) return prevProj;
      const nextProj = foldSceneIntoProject(prevProj, next);
      const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      const coalesce = now < historyCoalesceUntilRef.current;
      historyCoalesceUntilRef.current = now + 250;
      if (!coalesce) {
        undoStackRef.current.push(prevProj);
        if (undoStackRef.current.length > 100) undoStackRef.current.shift();
        redoStackRef.current.length = 0;
        setHistoryDepth({ undo: undoStackRef.current.length, redo: 0 });
      }
      return nextProj;
    });
  }, []);

  /** Apply a project-level change (scene/timeline switch) without history. */
  const replaceProjectNoHistory = useCallback((next) => {
    undoStackRef.current.length = 0;
    redoStackRef.current.length = 0;
    historyCoalesceUntilRef.current = 0;
    setHistoryDepth({ undo: 0, redo: 0 });
    setProjectInternal(next);
  }, []);

  /** Replace the whole document with a 1-scene project wrapping `next`. */
  const replaceSceneNoHistory = useCallback((next) => {
    replaceProjectNoHistory(projectFromScene(next));
  }, [replaceProjectNoHistory]);

  const undo = useCallback(() => {
    const prev = undoStackRef.current.pop();
    if (!prev) return;
    redoStackRef.current.push(projectRef.current);
    historyCoalesceUntilRef.current = 0;
    setProjectInternal(prev);
    setHistoryDepth({ undo: undoStackRef.current.length, redo: redoStackRef.current.length });
  }, []);

  const redo = useCallback(() => {
    const next = redoStackRef.current.pop();
    if (!next) return;
    undoStackRef.current.push(projectRef.current);
    historyCoalesceUntilRef.current = 0;
    setProjectInternal(next);
    setHistoryDepth({ undo: undoStackRef.current.length, redo: redoStackRef.current.length });
  }, []);

  const flowRef = useRef(flowState);
  flowRef.current = flowState;

  const dropRef = useRef(null);
  const pixiViewportRef = useRef(null);

  // Fullscreen the scene viewport. The wrap (dropRef) is the element made
  // fullscreen; PixiViewport's ResizeObserver picks up the new size and
  // resizes the canvas automatically, so no manual resize is needed here.
  const [isFullscreen, setIsFullscreen] = useState(false);
  const toggleFullscreen = useCallback(() => {
    const el = dropRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
    } else {
      el.requestFullscreen?.();
    }
  }, []);
  useEffect(() => {
    const onChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
      // Fit the design frame to the new canvas size on BOTH enter and exit.
      // Double-rAF lets the fullscreen layout settle and the ResizeObserver
      // resize the renderer before we fit.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        pixiViewportRef.current?.fitToStage?.();
      }));
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const assetItemsRef = useRef(assetItems);
  assetItemsRef.current = assetItems;
  const addAssetItemFromBrowserRef = useRef(null);

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

  const addAssetItemFromBrowser = useCallback(async (item, spawnPos = null) => {
    if (!rootHandle) return;
    // Adding objects to the hierarchy is a setup-mode action — auto-switch.
    if (studioModeRef.current !== 'setup') { setStudioMode('setup'); studioModeRef.current = 'setup'; }
    try {
      const newLayerId = uid('L');
      // Build the layer patch common to all types: pre-assigned id + optional
      // world-space spawn position (merged into both landscape and portrait transforms).
      const makePatch = (prev, extra = {}) => {
        const patch = { id: newLayerId, ...extra };
        if (spawnPos) {
          const defT = defaultTransformsForNewLayer(prev.stage);
          patch.transforms = {
            landscape: { ...defT.landscape, x: spawnPos.x, y: spawnPos.y },
            portrait: defT.portrait ? { ...defT.portrait, x: spawnPos.x, y: spawnPos.y } : undefined
          };
        }
        return patch;
      };
      if (item.type === 'png') {
        setScene((prev) => {
          const asset = { id: uid('a'), type: 'png', src: item.path, meta: { originalName: item.name } };
          return addAssetLayer(prev, asset, item.name.replace(/\.png$/i, ''), makePatch(prev));
        });
        if (spawnPos) setSelectedLayerId(newLayerId);
        log(`Scene Studio: + png ${item.path}`, 'ok');
        return;
      }
      if (item.type === 'video') {
        setScene((prev) => {
          const asset = { id: uid('a'), type: 'video', src: item.path, meta: { originalName: item.name } };
          return addAssetLayer(prev, asset, item.name.replace(VIDEO_EXT, ''), makePatch(prev, { video: { loop: true, muted: true } }));
        });
        if (spawnPos) setSelectedLayerId(newLayerId);
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
          return addAssetLayer(prev, asset, item.name, makePatch(prev, { spine: { defaultAnimation: null, loop: true, skin: null } }));
        });
        if (spawnPos) setSelectedLayerId(newLayerId);
        log(`Scene Studio: + spine ${item.name}`, 'ok');
        return;
      }
    } catch (e) {
      log(`Scene Studio asset add failed: ${e.message || e}`, 'err');
    }
  }, [addAssetLayer, log, rootHandle]);
  addAssetItemFromBrowserRef.current = addAssetItemFromBrowser;

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
      // Asset panel drag: item id carried as application/x-ygg-asset-id
      const assetId = e.dataTransfer.getData('application/x-ygg-asset-id');
      if (assetId) {
        const item = assetItemsRef.current.find((x) => x.id === assetId);
        if (item) {
          const worldPos = pixiViewportRef.current?.screenToWorld(e.clientX, e.clientY) ?? null;
          await addAssetItemFromBrowserRef.current(item, worldPos);
        }
        return;
      }
      const files = Array.from(e.dataTransfer.files || []);
      if (!files.length) return;
      // Dropping assets into the scene is a setup-mode action — auto-switch.
      if (studioModeRef.current !== 'setup') { setStudioMode('setup'); studioModeRef.current = 'setup'; }
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
      if (action === 'setFps') {
        const n = Math.round(Number(payload));
        const fps = Number.isFinite(n) ? Math.max(1, Math.min(120, n)) : (curScene?.stage?.fps || 60);
        setScene((s) => ({ ...s, stage: { ...s.stage, fps } }));
        return prev;
      }
      if (action === 'setDuration') {
        const n = Number(payload);
        const d = Number.isFinite(n) ? Math.max(0.5, Math.min(300, n)) : (curScene?.stage?.duration || 5);
        // Typing a length flips the timeline to MANUAL — auto fit stops winning.
        setScene((s) => ({ ...s, stage: { ...s.stage, duration: d, manualDuration: true } }));
        return flowSeek(curScene, prev, Math.min(prev.time, d));
      }
      if (action === 'setDurationAuto') {
        // Hand the length back to auto-fit (the effect resizes to the content).
        setScene((s) => ({ ...s, stage: { ...s.stage, manualDuration: false } }));
        return prev;
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
      // Freeze all playback while the export dialog owns the viewport.
      if (exportDialogOpenRef.current) {
        raf = requestAnimationFrame(loop);
        return;
      }
      if (studioModeRef.current === 'direct') {
        setScenarioPlayhead((prev) => {
          if (!prev.playing) return prev;
          const total = scenarioTimelineRef.current.total || 0;
          const next = prev.time + dt;
          if (next >= total) return { time: total, playing: false }; // reached the end
          return { ...prev, time: next };
        });
      } else {
        setFlowState((prev) => tickFlow(sceneRef.current, prev, dt));
      }
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

  // Opening the export dialog pauses any running playback (both the flow/
  // timeline interpreter and the direct-mode scenario), so the exporter is the
  // sole driver of the viewport. Pause (not stop) keeps the playhead intact.
  useEffect(() => {
    if (!showWebMExport) return;
    setFlowState((prev) => (prev.playing ? flowPause(prev) : prev));
    setScenarioPlayhead((prev) => (prev.playing ? { ...prev, playing: false } : prev));
  }, [showWebMExport]);

  // ── Dynamic timeline length ──────────────────────────────────────────
  // Unless the user pinned the length manually (stage.manualDuration), the
  // timeline auto-fits to the content: it grows when a clip is dragged/extended
  // past the end and shrinks back to the last clip when one is removed. Clips
  // can be dragged up to the absolute cap (see dragMax in TimelinePanel), so a
  // drag pushes the content end out and this effect follows it.
  useEffect(() => {
    if (scene.stage?.manualDuration) return;
    let contentEnd = 0;
    for (const tr of scene.flow?.tracks || []) {
      for (const c of tr.clips || []) {
        const end = (Number(c.start) || 0) + (Number(c.duration) || 0);
        if (end > contentEnd) contentEnd = end;
      }
    }
    const target = contentEnd > 0 ? Math.max(1, Math.min(300, contentEnd)) : 5;
    const cur = Number(scene.stage?.duration);
    if (!Number.isFinite(cur) || Math.abs(cur - target) > 1e-3) {
      setScene((s) => (s.stage?.manualDuration ? s : { ...s, stage: { ...s.stage, duration: target } }));
    }
  }, [scene, setScene]);

  // ── Session restore: on mount, check IDB for a saved scene ────────────
  useEffect(() => {
    loadSession().then((draft) => {
      const layerCount = sessionLayerCount(draft?.project);
      if (layerCount > 0) {
        setSessionDraft(draft);
      } else {
        // No meaningful session — safe to start autosaving immediately.
        autosaveEnabledRef.current = true;
      }
    });
    return () => clearTimeout(autosaveTimerRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Autosave: debounced 1 s after every project / rootHandle change ───
  useEffect(() => {
    if (!autosaveEnabledRef.current) return;
    clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      // Sync the live flow into the active timeline before snapshotting.
      const synced = syncFlowToActiveTimeline(sceneRef.current);
      saveSession(foldSceneIntoProject(projectRef.current, synced), rootHandleRef.current);
    }, 1000);
  // We intentionally re-run on every `project` and `rootHandle` change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, rootHandle]);

  // ── Self-heal: recover lost spine atlas/texture references ────────────
  // Spine assets picked through the Spinner wizard (before the fix) lost their
  // atlas+texture, which broke Unity export AND web overlay rendering. When a
  // project root is available, resolve the siblings from disk and write them
  // back onto the asset records (permanent repair). Each src is attempted once
  // per session so unresolvable ones don't loop.
  const spineRepairAttempted = useRef(new Set());
  useEffect(() => {
    if (!rootHandle) return;
    const pending = (scene.assets || []).filter(
      (a) => a.type === 'spine' && (!a.atlas || !a.texture) && !spineRepairAttempted.current.has(a.src)
    );
    if (!pending.length) return;
    pending.forEach((a) => spineRepairAttempted.current.add(a.src));
    let cancelled = false;
    (async () => {
      const baseDir = sceneRef.current.projectRoot || null;
      const { scene: fixed, repaired } = await repairSceneSpineAssets(sceneRef.current, rootHandle, baseDir);
      if (cancelled || !repaired.length) return;
      // Repaired assets live in the shared pool — patch it without history and
      // without disturbing the multi-scene project structure.
      setProjectInternal((prev) => ({ ...prev, assets: fixed.assets }));
      log(`Scene Studio: recovered atlas+texture for ${repaired.length} spine asset(s) — ${repaired.join(', ')}`);
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, rootHandle]);

  // ── Auto-relink: recover assets whose folder path changed since save ──────
  // Reopening a project whose on-disk folder structure was remodeled leaves
  // every stored asset `src` pointing at a path that no longer exists — assets
  // silently fail to render and the Spinner wizard rebuilds the OLD folder
  // layout from those dead paths. Once the live folder scan (assetItems) is in,
  // re-point each unresolvable asset at the file of the same name in the
  // current workspace. Runs once per distinct asset-id set (relink only mutates
  // src/atlas/texture, never ids, so it converges without looping).
  const relinkSeenRef = useRef(new Set());
  useEffect(() => {
    if (!rootHandle || !assetItems.length || !scene.assets?.length) return;
    const key = scene.assets.map((a) => a.id).join(',');
    if (relinkSeenRef.current.has(key)) return;
    relinkSeenRef.current.add(key);

    const { scene: relinkedScene, relinked, ambiguous, missing } =
      relinkSceneAssetsToScan(sceneRef.current, assetItemsRef.current);
    if (relinked.length) {
      const byId = new Map(relinkedScene.assets.map((a) => [a.id, a]));
      // Merge by id onto the live pool so a concurrent spine-repair can't clobber.
      setProjectInternal((prev) => ({ ...prev, assets: prev.assets.map((a) => byId.get(a.id) || a) }));
      log(`Scene Studio: relinked ${relinked.length} moved asset(s) by name — ${relinked.join(', ')}`);
    }
    if (ambiguous.length)
      log(`Scene Studio: ${ambiguous.length} asset(s) matched multiple files by name, left as-is — ${ambiguous.join(', ')}`, 'warn');
    if (missing.length)
      log(`Scene Studio: ${missing.length} asset(s) not found in the current workspace — ${missing.join(', ')}`, 'warn');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, rootHandle, assetItems]);

  // Assets that auto-relink couldn't recover — surfaced in a banner + manual
  // relink dialog. Recomputed live, so fixing one (manually or by rescanning)
  // shrinks the list. Empty until the scan is in, so nothing flags prematurely.
  const [showRelinkDialog, setShowRelinkDialog] = useState(false);
  const [relinkBannerDismissed, setRelinkBannerDismissed] = useState(false);
  const unresolvedAssets = useMemo(
    () => (rootHandle && assetItems.length ? listUnresolvedAssets(scene, assetItems) : []),
    [scene, assetItems, rootHandle]
  );
  // A fresh workspace re-surfaces the banner even if a previous one was dismissed.
  useEffect(() => { setRelinkBannerDismissed(false); setShowRelinkDialog(false); }, [rootHandle]);

  const handleApplyRelink = useCallback((mappings) => {
    const patch = new Map();
    for (const { assetId, item } of mappings) {
      if (!item) continue;
      patch.set(assetId, item.type === 'spine'
        ? { src: item.jsonPath, atlas: item.atlasPath || null, texture: item.texturePath || null }
        : { src: item.path });
    }
    if (patch.size) {
      setProjectInternal((prev) => ({
        ...prev,
        assets: prev.assets.map((a) => (patch.has(a.id) ? { ...a, ...patch.get(a.id) } : a)),
      }));
      log(`Scene Studio: manually relinked ${patch.size} asset(s)`);
    }
    setShowRelinkDialog(false);
  }, [log]);

  const handlePatchLayer = useCallback((layerId, patch) => {
    setScene((prev) => ({
      ...prev,
      layers: prev.layers.map((l) => (l.id === layerId ? { ...l, ...patch } : l))
    }));
  }, []);

  const handlePatchAsset = useCallback((assetId, patch) => {
    setScene((prev) => ({
      ...prev,
      assets: prev.assets.map((a) => (a.id === assetId ? { ...a, ...patch } : a))
    }));
  }, []);

  // Stable identity so the Spinner wizard's per-symbol pose thumbnails don't
  // re-bake on every parent render. Reads projectRoot from the live scene ref.
  const handleRenderSpinePose = useCallback(
    (spineAsset, animName, loop, skin, atFraction) =>
      pixiViewportRef.current?.renderSpinePosePng(
        spineAsset, animName, loop, skin, atFraction, sceneRef.current?.projectRoot || null
      ),
    []
  );

  const handleCreateSpinner = useCallback(({ name, spinnerConfig, newAssets }) => {
    setShowSpinnerWizard(false);
    const newLayerId = uid('L');
    setScene((prev) => {
      const asset = { id: uid('a'), type: 'spinner', spinner: spinnerConfig, meta: { originalName: name } };
      const transforms = defaultTransformsForNewLayer(prev.stage);
      // newAssets: generated blur PNGs from the wizard (already have IDs referenced by spinnerConfig.symbols)
      const extraAssets = Array.isArray(newAssets) ? newAssets : [];
      return {
        ...prev,
        assets: [...prev.assets, ...extraAssets, asset],
        layers: [...prev.layers, {
          id: newLayerId,
          name,
          assetId: asset.id,
          canvasId: prev.activeCanvasId || prev.canvases[0].id,
          parentId: null,
          visible: true,
          blend: 'normal',
          transforms
        }]
      };
    });
    setSelectedLayerId(newLayerId);
    pendingAutoGenRef.current.add(newLayerId);
    setAutoGenNonce((n) => n + 1);
    log(`Scene Studio: + spinner "${name}"`, 'ok');
  }, [log]);

  // Re-open the wizard pre-filled with an existing spinner's config so it can be
  // edited and rebuilt. Reads from the live scene via sceneRef.
  const handleEditSpinner = useCallback((layerId) => {
    const cur = sceneRef.current;
    const layer = cur.layers.find((l) => l.id === layerId);
    if (!layer) return;
    const asset = cur.assets.find((a) => a.id === layer.assetId);
    if (!asset || asset.type !== 'spinner') return;
    const config = normalizeSpinnerConfig(asset.spinner);
    if (!config) return;
    setStudioMode('setup'); studioModeRef.current = 'setup';
    setShowSpinnerWizard(false);
    setEditSpinnerTarget({
      layerId,
      assetId: asset.id,
      config,
      name: asset.meta?.originalName || layer.name || 'Spinner',
    });
  }, []);

  // Apply a wizard rebuild onto the existing spinner asset (and rename its
  // layer). New wizard assets (generated blurs, browser PNG/Spine picks) are
  // appended without creating layers, matching handleCreateSpinner.
  const handleUpdateSpinner = useCallback((target, { name, spinnerConfig, newAssets }) => {
    setEditSpinnerTarget(null);
    setScene((prev) => {
      const have = new Set(prev.assets.map((a) => a.id));
      const extraAssets = (Array.isArray(newAssets) ? newAssets : []).filter((a) => !have.has(a.id));
      return {
        ...prev,
        assets: [...prev.assets, ...extraAssets].map((a) =>
          a.id === target.assetId
            ? { ...a, spinner: spinnerConfig, meta: { ...a.meta, originalName: name } }
            : a
        ),
        layers: prev.layers.map((l) => (l.id === target.layerId ? { ...l, name } : l)),
      };
    });
    setSelectedLayerId(target.layerId);
    log(`Scene Studio: rebuilt spinner "${name}"`, 'ok');
  }, [log]);

  // ── Win-sequence object ──────────────────────────────────────────────────
  // Create a winseq asset (a Spine skeleton + tier/flow config) + its layer.
  const handleCreateWinSeq = useCallback(({ name, winseqConfig, skeleton }) => {
    setShowWinSeqWizard(false);
    const newLayerId = uid('L');
    setScene((prev) => {
      const asset = {
        id: uid('a'),
        type: 'winseq',
        src: skeleton?.src || null,
        atlas: skeleton?.atlas || null,
        texture: skeleton?.texture || null,
        winseq: winseqConfig,
        meta: { originalName: name }
      };
      const canvasId = prev.activeCanvasId || prev.canvases[0].id;
      const transforms = defaultTransformsForNewLayer(prev.stage);
      const assets = [...prev.assets, asset];
      const layers = [...prev.layers, {
        id: newLayerId,
        name,
        assetId: asset.id,
        canvasId,
        parentId: null,
        visible: true,
        blend: 'normal',
        transforms
      }];
      // When the wizard configured a count-up number, add its locked child
      // (a `winnumber` asset + layer parented to the win-sequence layer). The
      // child's transform is a zero offset — the bone follow places it; the
      // transform is just the user's tweak on top.
      if (winseqConfig?.number?.fontSrc) {
        const numAsset = { id: uid('a'), type: 'winnumber', parentAssetId: asset.id, meta: { originalName: `${name} number` } };
        assets.push(numAsset);
        layers.push({
          id: uid('L'), name: 'Win Number', assetId: numAsset.id,
          canvasId, parentId: newLayerId, locked: true, visible: true, blend: 'normal',
          transforms: zeroOffsetTransforms()
        });
      }
      return { ...prev, assets, layers };
    });
    setSelectedLayerId(newLayerId);
    pendingAutoGenRef.current.add(newLayerId);
    setAutoGenNonce((n) => n + 1);
    log(`Scene Studio: + win sequences "${name}"`, 'ok');
  }, [log]);

  // Re-open the win-sequence wizard pre-filled from an existing object.
  const handleEditWinSeq = useCallback((layerId, initialStep = null) => {
    const cur = sceneRef.current;
    const layer = cur.layers.find((l) => l.id === layerId);
    if (!layer) return;
    const asset = cur.assets.find((a) => a.id === layer.assetId);
    if (!asset || asset.type !== 'winseq') return;
    const config = normalizeWinSeqConfig(asset.winseq);
    setStudioMode('setup'); studioModeRef.current = 'setup';
    setShowWinSeqWizard(false);
    setEditWinSeqTarget({
      layerId,
      assetId: asset.id,
      config,
      name: asset.meta?.originalName || layer.name || 'Win Sequences',
      skeleton: { src: asset.src, atlas: asset.atlas, texture: asset.texture },
      initialStep,
    });
  }, []);

  // Generate one ready-to-use timeline per win-sequence flow (small/medium/…),
  // each a single clip playing that whole sequence — available in the Director.
  const handleGenerateWinSeqTimelines = useCallback((layerId) => {
    const cur = sceneRef.current;
    const layer = cur.layers.find((l) => l.id === layerId);
    if (!layer) return;
    const asset = cur.assets.find((a) => a.id === layer.assetId);
    if (!asset || asset.type !== 'winseq') return;
    const config = normalizeWinSeqConfig(asset.winseq);
    const durations = assetDescriptors[asset.id]?.animationDurations || {};
    const built = buildWinSeqTimelines(layerId, config, durations);
    if (!built.length) { log('No win-sequence flows to generate timelines from', 'warn'); return; }
    // Regenerate: replace any timelines previously generated for this layer.
    setScene((prev) => regenerateTimelinesForLayer(prev, layerId, built));
    log(`Scene Studio: regenerated ${built.length} win-sequence timeline${built.length === 1 ? '' : 's'}`, 'ok');
  }, [assetDescriptors, log, setScene]);

  // Generate a single full-spin timeline (start → spin → stop → presentWin).
  const handleGenerateSpinnerTimeline = useCallback((layerId) => {
    const cur = sceneRef.current;
    const layer = cur.layers.find((l) => l.id === layerId);
    if (!layer) return;
    const asset = cur.assets.find((a) => a.id === layer.assetId);
    if (!asset || asset.type !== 'spinner') return;
    const built = buildSpinnerFullSpinTimeline(layerId, normalizeSpinnerConfig(asset.spinner));
    // Regenerate: replace any timeline previously generated for this layer.
    setScene((prev) => regenerateTimelinesForLayer(prev, layerId, [built]));
    log('Scene Studio: regenerated full-spin timeline', 'ok');
  }, [log, setScene]);

  // Scene Setup aux timelines (splash / intro / outro) are generated inside the
  // setup callback before fresh spine descriptors exist, so their clips may be
  // created with anim:null. Once the descriptor arrives, backfill only those
  // missing-anim tracks with normal named spine clips (never touches authored
  // clips that already have anim names).
  const backfillSceneSetupAuxClips = useCallback((assetId, descriptor) => {
    const animations = descriptor?.animations || [];
    if (!Array.isArray(animations) || !animations.length) return;
    const durations = descriptor?.animationDurations || {};
    setScene((prev) => {
      let changed = false;
      const timelines = (prev.timelines || []).map((tl) => {
        const meta = tl?.generatedMeta;
        if (meta?.source !== 'sceneSetup' || !meta.contentLayerId || !meta.phase) return tl;
        const layer = prev.layers.find((l) => l.id === meta.contentLayerId);
        if (!layer || layer.assetId !== assetId) return tl;
        let tlChanged = false;
        const tracks = (tl.tracks || []).map((track) => {
          if (track.layerId !== meta.contentLayerId) return track;
          const clips = track.clips || [];
          const needsFill = clips.some((c) => !c.anim);
          if (!needsFill) return track;
          changed = true;
          tlChanged = true;
          return { ...track, clips: resolveSceneSetupPhaseClips(animations, durations, meta.phase) };
        });
        return tlChanged ? { ...tl, tracks } : tl;
      });
      return changed ? { ...prev, timelines } : prev;
    });
  }, [setScene]);

  // Drain the wizard auto-generate queue: for each freshly-created spinner /
  // win-seq layer, generate its timelines once the inputs are ready. Spinners
  // fire immediately; win-seq waits for the asset's animation durations to
  // arrive (empty → step lengths would be wrong).
  useEffect(() => {
    if (!pendingAutoGenRef.current.size) return;
    const cur = sceneRef.current;
    for (const layerId of [...pendingAutoGenRef.current]) {
      const layer = cur.layers.find((l) => l.id === layerId);
      const asset = layer && cur.assets.find((a) => a.id === layer.assetId);
      if (!layer || !asset) { pendingAutoGenRef.current.delete(layerId); continue; }
      if (asset.type === 'spinner') {
        pendingAutoGenRef.current.delete(layerId);
        handleGenerateSpinnerTimeline(layerId);
      } else if (asset.type === 'winseq') {
        const durs = assetDescriptors[asset.id]?.animationDurations;
        if (durs && Object.keys(durs).length) {
          pendingAutoGenRef.current.delete(layerId);
          handleGenerateWinSeqTimelines(layerId);
        }
        // else: keep queued; the assetDescriptors update re-runs this effect.
      } else {
        pendingAutoGenRef.current.delete(layerId);
      }
    }
  }, [autoGenNonce, assetDescriptors, handleGenerateSpinnerTimeline, handleGenerateWinSeqTimelines]);

  // Apply a wizard rebuild onto the existing winseq asset (and rename its layer).
  const handleUpdateWinSeq = useCallback((target, { name, winseqConfig, skeleton }) => {
    setEditWinSeqTarget(null);
    setScene((prev) => {
      let assets = prev.assets.map((a) =>
        a.id === target.assetId
          ? {
              ...a,
              src: skeleton?.src ?? a.src,
              atlas: skeleton?.atlas ?? a.atlas,
              texture: skeleton?.texture ?? a.texture,
              winseq: winseqConfig,
              meta: { ...a.meta, originalName: name }
            }
          : a
      );
      let layers = prev.layers.map((l) => (l.id === target.layerId ? { ...l, name } : l));

      // Reconcile the locked win-number child against the new config.
      const childLayer = layers.find(
        (l) => l.parentId === target.layerId &&
          assets.find((a) => a.id === l.assetId)?.type === 'winnumber'
      );
      const wantsNumber = !!winseqConfig?.number?.fontSrc;
      if (wantsNumber && !childLayer) {
        const winseqLayer = layers.find((l) => l.id === target.layerId);
        const numAsset = { id: uid('a'), type: 'winnumber', parentAssetId: target.assetId, meta: { originalName: `${name} number` } };
        assets = [...assets, numAsset];
        layers = [...layers, {
          id: uid('L'), name: 'Win Number', assetId: numAsset.id,
          canvasId: winseqLayer?.canvasId || prev.activeCanvasId, parentId: target.layerId,
          locked: true, visible: true, blend: 'normal', transforms: zeroOffsetTransforms()
        }];
      } else if (!wantsNumber && childLayer) {
        assets = assets.filter((a) => a.id !== childLayer.assetId);
        layers = layers.filter((l) => l.id !== childLayer.id);
      }
      // (number present + child exists → leave the child; its glyphs rebuild via
      // the winseq rev bump, and the user's offset/scale are preserved.)
      return { ...prev, assets, layers };
    });
    setSelectedLayerId(target.layerId);
    log(`Scene Studio: rebuilt win sequences "${name}"`, 'ok');
  }, [log]);

  // Wizard launchers (moved from the toolbar into the left stack). Each forces
  // setup mode and closes any other open wizard before opening its own.
  const handleAddSpinner = useCallback(() => {
    setStudioMode('setup'); studioModeRef.current = 'setup';
    setShowWinSeqWizard(false); setEditWinSeqTarget(null); setEditSpinnerTarget(null);
    setShowSceneSetupWizard(false);
    setShowSpinnerWizard(true);
  }, []);
  const handleAddWinSeq = useCallback(() => {
    setStudioMode('setup'); studioModeRef.current = 'setup';
    setShowSpinnerWizard(false); setEditSpinnerTarget(null); setEditWinSeqTarget(null);
    setShowSceneSetupWizard(false);
    setShowWinSeqWizard(true);
  }, []);
  const handleAddSceneSetup = useCallback(() => {
    setStudioMode('setup'); studioModeRef.current = 'setup';
    setShowSpinnerWizard(false); setEditSpinnerTarget(null);
    setShowWinSeqWizard(false); setEditWinSeqTarget(null);
    setEditSceneSetupTarget(null);
    setShowSceneSetupWizard(true);
  }, []);

  // Add an empty static placeholder — a solid white square PNG (data URL) so it
  // reuses the normal png pipeline: transform (scale to any size) + tint (colour)
  // work out of the box. The user can swap it for a real asset later.
  const handleAddEmptyStatic = useCallback(() => {
    if (studioModeRef.current !== 'setup') { setStudioMode('setup'); studioModeRef.current = 'setup'; }
    let src;
    try {
      const c = document.createElement('canvas');
      c.width = 200; c.height = 200;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 200, 200);
      src = c.toDataURL('image/png');
    } catch { return; }
    const newLayerId = uid('L');
    setScene((prev) => {
      const asset = { id: uid('a'), type: 'png', src, meta: { originalName: 'Static' } };
      const canvasId = prev.activeCanvasId || prev.canvases[0].id;
      const transforms = defaultTransformsForNewLayer(prev.stage);
      return {
        ...prev,
        assets: [...prev.assets, asset],
        layers: [...prev.layers, {
          id: newLayerId, name: 'Static', assetId: asset.id, canvasId, parentId: null,
          visible: true, blend: 'normal',
          transforms: { landscape: { ...transforms.landscape }, portrait: null },
        }],
      };
    });
    setSelectedLayerId(newLayerId);
    log('Scene Studio: + static square', 'ok');
  }, [log]);

  // Add an empty folder — a plain container ('empty' asset, no sceneSetup) that
  // can parent other layers. Same idea as the groups Scene Setup creates, but
  // spawned on demand so the user can organise the hierarchy freely.
  const handleAddFolder = useCallback(() => {
    if (studioModeRef.current !== 'setup') { setStudioMode('setup'); studioModeRef.current = 'setup'; }
    const newLayerId = uid('L');
    setScene((prev) => {
      const asset = { id: uid('a'), type: 'empty', meta: { originalName: 'Folder' } };
      const canvasId = prev.activeCanvasId || prev.canvases[0].id;
      const transforms = defaultTransformsForNewLayer(prev.stage);
      return {
        ...prev,
        assets: [...prev.assets, asset],
        layers: [...prev.layers, {
          id: newLayerId, name: 'Folder', assetId: asset.id, canvasId, parentId: null,
          visible: true, blend: 'normal',
          transforms: { landscape: { ...transforms.landscape }, portrait: null },
        }],
      };
    });
    setSelectedLayerId(newLayerId);
    log('Scene Studio: + folder', 'ok');
  }, [log]);

  // Build a parented scene skeleton from the Scene Setup wizard.
  //   root (empty, stores the setup config for re-entry)
  //   └─ background (static ?? bg-anim)
  //      ├─ background anim (only if a static bg exists)
  //      ├─ logo
  //      └─ machine frame (static ?? machine-anim)
  //         └─ machine frame anim (only if a static frame exists)
  // Each enabled game mode (Free Spins / Bonus / Pick&Click) gets the same
  // sub-tree under its own empty group, gated by group ALPHA (visible:true,
  // alpha:0) so Direct-mode crossfades can ease between modes. One "<Mode>
  // Idle" timeline per mode is generated to pose those alphas.
  const handleCreateSceneSetup = useCallback(({ name, modes, setup }) => {
    const editTarget = editSceneSetupTargetRef.current;
    setShowSceneSetupWizard(false);
    setEditSceneSetupTarget(null);
    if (!modes?.base) return;
    let rootLayerId = null;
    setScene((prev) => {
      // Re-enter: drop the previous root object and its whole subtree first.
      let baseAssets = prev.assets;
      let baseLayers = prev.layers;
      if (editTarget) {
        const remove = new Set([editTarget.layerId]);
        for (let changed = true; changed;) {
          changed = false;
          for (const l of baseLayers) {
            if (l.parentId && remove.has(l.parentId) && !remove.has(l.id)) { remove.add(l.id); changed = true; }
          }
        }
        const removedAssets = new Set(baseLayers.filter((l) => remove.has(l.id)).map((l) => l.assetId));
        baseLayers = baseLayers.filter((l) => !remove.has(l.id));
        baseAssets = baseAssets.filter((a) => !removedAssets.has(a.id));
      }
      const canvasId = prev.activeCanvasId || prev.canvases[0].id;
      const def = defaultTransformsForNewLayer(prev.stage);
      const assets = [];
      const layers = [];
      // add(spec, name, parentId, visible, alpha) → new layerId. spec.empty for a group.
      const add = (spec, layerName, parentId, visible, alpha = 1) => {
        const assetId = uid('a');
        if (spec.empty) {
          assets.push({ id: assetId, type: 'empty', ...(spec.setup ? { sceneSetup: spec.setup } : {}), meta: { originalName: layerName } });
        } else if (spec.kind === 'spine') {
          assets.push({ id: assetId, type: 'spine', src: spec.src, atlas: spec.atlas, texture: spec.texture, meta: { originalName: layerName } });
        } else {
          assets.push({ id: assetId, type: 'png', src: spec.src, meta: { originalName: layerName } });
        }
        const layerId = uid('L');
        // Root is centred on the stage; children sit at their parent's ORIGIN
        // (parent-local 0,0), so the whole group stacks centred instead of each
        // node being offset by half the stage.
        const landscape = parentId
          ? { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, anchor: [0.5, 0.5], alpha, tint: { r: 1, g: 1, b: 1 } }
          : { ...def.landscape, alpha };
        layers.push({
          id: layerId, name: layerName, assetId, canvasId, parentId: parentId || null,
          visible, blend: 'normal',
          transforms: { landscape, portrait: null },
          ...(spec.kind === 'spine' ? { spine: { defaultAnimation: null, loop: true, skin: null } } : {}),
        });
        return layerId;
      };
      // Build one background→machine sub-tree under `parentId`. Z-order
      // (bottom→top): background, bg-anim, machine frame, machine anim, then
      // optional logo. All children stay visible and opaque — a mode is gated
      // via its top parent's ALPHA alone (container alpha multiplies down the
      // subtree), so fading that parent fades the whole mode at once.
      const buildGroup = (roles, parentId, { includeLogo = true } = {}) => {
        if (!roles) return;
        const bgSpec = roles.background || roles.backgroundAnim;
        const bgNodeId = bgSpec
          ? add(bgSpec, bgSpec === roles.background ? 'Background' : 'Background Anim', parentId, true)
          : parentId;
        if (roles.background && roles.backgroundAnim) add(roles.backgroundAnim, 'Background Anim', bgNodeId, true);
        const machineSpec = roles.machineFrame || roles.machineAnim;
        if (machineSpec) {
          const machineNodeId = add(machineSpec, machineSpec === roles.machineFrame ? 'Machine Frame' : 'Machine Frame Anim', bgNodeId, true);
          if (roles.machineFrame && roles.machineAnim) add(roles.machineAnim, 'Machine Frame Anim', machineNodeId, true);
        }
        if (includeLogo && roles.logo) add(roles.logo, 'Logo', bgNodeId, true); // logo last → on top
      };

      rootLayerId = add({ empty: true, setup }, name || 'Scene', null, true);
      const hasRoles = (roles) => !!roles && Object.values(roles).some(Boolean);
      const modeLabels = { base: 'Base Game', freespins: 'Free Spins', bonus: 'Bonus Game', pick: 'Pick & Click' };
      const modeGroups = [];
      const gameModesRootId = add({ empty: true }, 'Game Modes', rootLayerId, true, 1);
      const baseGroupId = add({ empty: true }, modeLabels.base, gameModesRootId, true, 1);
      modeGroups.push({ key: 'base', label: modeLabels.base, layerId: baseGroupId });
      buildGroup(modes.base, baseGroupId, { includeLogo: false });

      // Mode gating is ALPHA-based (visible stays a pure editing toggle): each
      // feature group is created visible but fully transparent, and the
      // generated "<Mode> Idle" timelines drive the group alphas — so Direct-
      // mode edges can crossfade between game modes instead of hard-cutting.
      for (const key of ['freespins', 'bonus', 'pick']) {
        const roles = modes[key];
        if (!hasRoles(roles)) continue;
        const groupId = add({ empty: true }, modeLabels[key], gameModesRootId, true, 0);
        modeGroups.push({ key, label: modeLabels[key], layerId: groupId });
        buildGroup(roles, groupId);
      }

      // Shared logo sits directly under scene root (outside mode groups), so it
      // remains constant across game modes unless explicitly animated.
      if (modes.base?.logo) add(modes.base.logo, 'Logo', rootLayerId, true, 1);

      const pickAuxSpec = (roles) => roles?.backgroundAnim || roles?.background || null;
      const specKey = (spec) => {
        if (!spec) return null;
        if (spec.kind === 'spine') return `spine:${spec.src || ''}:${spec.atlas || ''}:${spec.texture || ''}`;
        return `${spec.kind}:${spec.src || ''}`;
      };
      let transitionsRootId = null;
      const ensureTransitionsRoot = () => {
        if (transitionsRootId) return transitionsRootId;
        transitionsRootId = add({ empty: true }, 'Transitions', rootLayerId, true, 1);
        return transitionsRootId;
      };
      const createAuxGroup = (key, label) => ({
        key,
        label,
        layerId: add({ empty: true }, label, ensureTransitionsRoot(), true, 0)
      });
      const auxGroups = [];
      const auxTimelines = [];
      const descriptorForSpec = (spec) => {
        if (!spec || spec.kind !== 'spine' || !spec.src) return null;
        const item = assetItemsRef.current.find((it) => it.type === 'spine' && it.jsonPath === spec.src);
        const sceneAsset = item ? findAssetForItem(prev.assets, item) : null;
        return sceneAsset ? (assetDescriptors[sceneAsset.id] || null) : null;
      };

      const splashSpec = pickAuxSpec(modes.splash);
      if (splashSpec) {
        const grp = createAuxGroup('splash', 'Splash');
        auxGroups.push(grp);
        const contentLayerId = add(
          splashSpec,
          splashSpec.kind === 'spine' ? 'Splash Anim' : 'Splash',
          grp.layerId,
          true,
          1
        );
        auxTimelines.push({
          ...grp,
          label: 'Splash',
          type: 'splash',
          phase: 'splash',
          contentLayerId,
          contentKind: splashSpec.kind,
          contentAnimations: descriptorForSpec(splashSpec)?.animations || [],
          contentDurations: descriptorForSpec(splashSpec)?.animationDurations || {}
        });
      }

      const transitionDefs = [
        { modeKey: 'freespins', groupKey: 'freespinsTransition', groupLabel: 'Free Spins Transition', intro: 'freespinsIntro', outro: 'freespinsOutro', introLabel: 'Free Spins Intro', outroLabel: 'Free Spins Outro' },
        { modeKey: 'bonus', groupKey: 'bonusTransition', groupLabel: 'Bonus Transition', intro: 'bonusIntro', outro: 'bonusOutro', introLabel: 'Bonus Intro', outroLabel: 'Bonus Outro' },
        { modeKey: 'pick', groupKey: 'pickTransition', groupLabel: 'Pick Transition', intro: 'pickIntro', outro: 'pickOutro', introLabel: 'Pick Intro', outroLabel: 'Pick Outro' }
      ];
      for (const defn of transitionDefs) {
        const introSpec = pickAuxSpec(modes[defn.intro]);
        const outroSpec = pickAuxSpec(modes[defn.outro]);
        if (!introSpec && !outroSpec) continue;
        const grp = createAuxGroup(defn.groupKey, defn.groupLabel);
        auxGroups.push(grp);
        const layerBySig = new Map();
        const ensureLayer = (spec) => {
          const sig = specKey(spec);
          if (!sig) return null;
          if (layerBySig.has(sig)) return layerBySig.get(sig);
          const id = add(spec, `${defn.groupLabel} Anim`, grp.layerId, true, 1);
          layerBySig.set(sig, id);
          return id;
        };
        if (introSpec) {
          const introDesc = descriptorForSpec(introSpec);
          auxTimelines.push({
            ...grp,
            label: defn.introLabel,
            type: 'transition',
            phase: 'intro',
            contentLayerId: ensureLayer(introSpec),
            contentKind: introSpec.kind,
            contentAnimations: introDesc?.animations || [],
            contentDurations: introDesc?.animationDurations || {},
            modeKey: defn.modeKey
          });
        }
        if (outroSpec) {
          const outroDesc = descriptorForSpec(outroSpec);
          auxTimelines.push({
            ...grp,
            label: defn.outroLabel,
            type: 'transition',
            phase: 'outro',
            contentLayerId: ensureLayer(outroSpec),
            contentKind: outroSpec.kind,
            contentAnimations: outroDesc?.animations || [],
            contentDurations: outroDesc?.animationDurations || {},
            modeKey: defn.modeKey
          });
        }
      }

      let next = { ...prev, assets: [...baseAssets, ...assets], layers: [...baseLayers, ...layers] };
      // Re-entry: drop the previous root's generated idle timelines with its
      // subtree (the new ones get fresh layer ids).
      if (editTarget) {
        next = { ...next, timelines: (next.timelines || []).filter((t) => t.generatedBy !== editTarget.layerId) };
      }
      const gateGroups = [...modeGroups, ...auxGroups];
      const idle = buildSceneSetupIdleTimelines(modeGroups, gateGroups).map((b) => ({ ...b, generatedBy: rootLayerId }));
      const auxTl = buildSceneSetupAuxTimelines(auxTimelines, gateGroups).map((b) => ({ ...b, generatedBy: rootLayerId }));
      if (idle.length || auxTl.length) next = addPrebuiltTimelines(next, [...idle, ...auxTl]);
      return next;
    });
    if (rootLayerId) setSelectedLayerId(rootLayerId);
    log(`Scene Studio: scene setup "${name}"`, 'ok');
  }, [log]);

  // Re-open the Scene Setup wizard pre-filled from an existing root object.
  const handleEditSceneSetup = useCallback((layerId) => {
    const cur = sceneRef.current;
    const layer = cur.layers.find((l) => l.id === layerId);
    const asset = layer && cur.assets.find((a) => a.id === layer.assetId);
    if (!asset || asset.type !== 'empty' || !asset.sceneSetup) return;
    setStudioMode('setup'); studioModeRef.current = 'setup';
    setShowSpinnerWizard(false); setEditSpinnerTarget(null);
    setShowWinSeqWizard(false); setEditWinSeqTarget(null);
    setEditSceneSetupTarget({ layerId, config: asset.sceneSetup });
    setShowSceneSetupWizard(true);
  }, []);

  // Swap a layer's animated object to an existing scene asset (keeps clips).
  const handleSwapLayerAsset = useCallback((layerId, assetId) => {
    setScene((prev) => {
      const asset = prev.assets.find((a) => a.id === assetId);
      if (!asset) return prev;
      return {
        ...prev,
        layers: prev.layers.map((l) => (l.id === layerId ? applyAssetSwapToLayer(l, asset) : l))
      };
    });
  }, []);

  // Swap a layer's object to an asset dragged from the Assets panel (by item
  // id). Creates the scene asset if it isn't already present. Scale → 1:1.
  const handleSwapLayerAssetFromBrowserId = useCallback((layerId, browserItemId) => {
    const item = assetItemsRef.current.find((x) => x.id === browserItemId);
    if (!item) return;
    setScene((prev) => {
      let asset = findAssetForItem(prev.assets, item);
      let assets = prev.assets;
      if (!asset) {
        asset = assetFromBrowserItem(item);
        assets = [...prev.assets, asset];
      }
      return {
        ...prev,
        assets,
        layers: prev.layers.map((l) => (l.id === layerId ? applyAssetSwapToLayer(l, asset) : l))
      };
    });
    log(`Scene Studio: swapped layer source → ${item.name}`, 'ok');
  }, [log]);

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

    // Setup mode: edits always update the layer's default pose for the
    // active orientation. No timeline, no keyframes.
    if (studioModeRef.current === 'setup') {
      setScene((prev) => ({
        ...prev,
        layers: prev.layers.map((l) =>
          l.id === layerId ? patchTransform(l, prev.stage.activeOrientation, patch, prev.stage) : l
        )
      }));
      return;
    }

    // ── Resolve the auto-key recording target ──────────────────────────
    // With auto-key ON, an edit records into a clip WITHOUT needing that clip
    // selected first:
    //   1. Playhead inside an existing clip on this layer → key into it and
    //      auto-select it.
    //   2. No clip at the playhead but one within 0.5s → snap to it (extend its
    //      end / shift its start so the playhead lands inside).
    //   3. Otherwise → create a fresh 1s clip centred on the playhead.
    // Auto-key OFF keeps edits transient (they snap back on release).
    // selectedClipId is read from the ref so this callback never goes stale.
    let targetClip = null;
    let targetTrack = null;
    const selClipId = selectedClipIdRef.current;
    let needsExtend = false;   // playhead past clip end — extend + set loop:false
    let needsShiftBack = false; // playhead before clip start — shift clip backwards
    let newClipDef = null;     // clip to be created (case 3)
    let createTrack = null;    // brand-new host track, if the layer has none yet
    const t = flowNow.time;
    const layerTracks = tracks.filter((tr) => tr.layerId === layerId);

    if (autoKeyRef.current) {
      // (1) clip at the playhead — prefer the selected clip if it qualifies.
      for (const tr of layerTracks) {
        for (const c of tr.clips || []) {
          if (t >= c.start && t < c.start + c.duration) {
            if (!targetClip || c.id === selClipId) { targetClip = c; targetTrack = tr; }
          }
        }
      }
      // (2) nearest clip whose edge is within 0.5s → snap to it.
      if (!targetClip) {
        const SNAP = 0.5;
        let best = null;
        for (const tr of layerTracks) {
          for (const c of tr.clips || []) {
            if (t >= c.start + c.duration) {
              const d = t - (c.start + c.duration);
              if (d <= SNAP && (!best || d < best.d)) best = { c, tr, d, side: 'end' };
            } else if (t < c.start) {
              const d = c.start - t;
              if (d <= SNAP && (!best || d < best.d)) best = { c, tr, d, side: 'start' };
            }
          }
        }
        if (best) {
          targetClip = best.c;
          targetTrack = best.tr;
          if (best.side === 'end') needsExtend = true; else needsShiftBack = true;
        }
      }
      // (3) create a fresh 1s clip centred on the playhead.
      if (!targetClip) {
        newClipDef = {
          id: uid('C'), name: null, start: Math.max(0, t - 0.5), duration: 1,
          anim: null, skin: null, loop: false, curve: 'linear', speed: 1,
          mixDuration: null, track: 0, autoFitDuration: false, channels: null
        };
        // Host on the selected clip's track if it's on this layer, else the
        // layer's first track, else a brand-new track.
        targetTrack = layerTracks.find((tr) => tr.clips?.some((c) => c.id === selClipId))
          || layerTracks[0]
          || null;
        if (!targetTrack) { createTrack = { id: uid('T'), layerId, name: null, clips: [] }; targetTrack = createTrack; }
        targetClip = newClipDef;
      }
    }

    if (!targetClip) {
      // Auto-key off (or nothing to record): the edit is transient — commit
      // nothing so the object snaps back to its evaluated pose on release.
      // Base-pose edits belong to setup mode.
      return;
    }

    // Materialise a freshly-created clip (and its track) BEFORE writing keys so
    // the key-commit below finds it. sceneRef is synced synchronously so rapid
    // drag moves route into this same clip instead of spawning duplicates.
    if (newClipDef) {
      setScene((prev) => {
        const nextTracks = createTrack
          ? [...(prev.flow?.tracks || []), { ...createTrack, clips: [newClipDef] }]
          : (prev.flow?.tracks || []).map((tr) =>
              tr.id === targetTrack.id
                ? { ...tr, clips: [...(tr.clips || []), newClipDef].sort((a, b) => a.start - b.start) }
                : tr
            );
        const next = { ...prev, flow: deriveFlowGraph({ ...(prev.flow || {}), tracks: nextTracks }) };
        sceneRef.current = next;
        return next;
      });
    }

    // Extend clip to playhead (disable loop so the clip doesn't wrap around).
    if (needsExtend) {
      const extendedDuration = flowNow.time - targetClip.start;
      setScene((prev) => ({
        ...prev,
        flow: deriveFlowGraph({
          ...(prev.flow || {}),
          tracks: (prev.flow?.tracks || []).map((tr) => {
            if (tr.id !== targetTrack.id) return tr;
            return {
              ...tr,
              clips: tr.clips.map((c) =>
                c.id === targetClip.id ? { ...c, duration: extendedDuration, loop: false } : c
              )
            };
          })
        })
      }));
      targetClip = { ...targetClip, duration: extendedDuration, loop: false };
    }

    // Shift clip backwards: new start = playhead, shift all existing keys by delta
    // so their absolute time positions stay the same.
    if (needsShiftBack) {
      const delta = targetClip.start - flowNow.time; // positive: how many s to shift keys
      const newStart = flowNow.time;
      const newDuration = targetClip.start + targetClip.duration - newStart;
      const shiftedChannels = shiftAllChannelKeys(targetClip.channels, delta);
      setScene((prev) => ({
        ...prev,
        flow: deriveFlowGraph({
          ...(prev.flow || {}),
          tracks: (prev.flow?.tracks || []).map((tr) => {
            if (tr.id !== targetTrack.id) return tr;
            return {
              ...tr,
              clips: tr.clips.map((c) =>
                c.id === targetClip.id
                  ? { ...c, start: newStart, duration: newDuration, channels: shiftedChannels }
                  : c
              )
            };
          })
        })
      }));
      targetClip = { ...targetClip, start: newStart, duration: newDuration, channels: shiftedChannels };
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

      // Path-mode position: auto-key inserts (or refines) a smooth control
      // point at the object's current progress along the path, so dragging
      // the sprite mid-clip bends the path through the new spot.
      if (channelName === 'position' && isPathChannel(existing)) {
        const prog = existing.path.progress?.keys || [];
        const p = Math.max(0, Math.min(1, evalScalarKeys(prog, localT) ?? 0));
        const cur = evalChannel(existing, localT, 'position') || { x: 0, y: 0 };
        const nx = typeof bag.x === 'number' ? bag.x : cur.x;
        const ny = typeof bag.y === 'number' ? bag.y : cur.y;
        const nextPoints = insertOrUpdatePathPoint(existing.path.points, p, nx, ny);
        nextClipChannels.position = { ...existing, path: { ...existing.path, points: nextPoints } };
        touched = true;
        continue;
      }

      // Split path: write each patch component into its own scalar
      // key list. Lets x and y (or r/g/b) animate on independent
      // timelines and curves.
      if (existing?.split && (layout === 'vec2' || layout === 'rgb')) {
        const comps = layout === 'vec2' ? ['x', 'y'] : ['r', 'g', 'b'];
        const nextPerComp = { ...(existing.perComp || {}) };
        const baseV = baseChannelValue(channelName, baseT);
        for (const c of comps) {
          if (typeof bag[c] !== 'number' || !Number.isFinite(bag[c])) continue;
          const compKeys = nextPerComp[c]?.keys || [];
          nextPerComp[c] = insertCompKeyWithStartRamp({ keys: compKeys }, localT, bag[c], baseV?.[c], { tm: defaultEaseRef.current });
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
      nextClipChannels[channelName] = insertKeyWithStartRamp(existing || { keys: [] }, localT, v, baseChannelValue(channelName, baseT), { tm: defaultEaseRef.current });
      touched = true;
    }
    if (!touched) {
      // Patch contained no channel-eligible props (e.g. anchor only).
      // Fall back to base pose so the edit isn't silently dropped.
      setScene((prev) => ({
        ...prev,
        layers: prev.layers.map((l) =>
          l.id === layerId ? patchTransform(l, prev.stage.activeOrientation, patch, prev.stage) : l
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

    // Auto-select the recording clip (and its layer) so the inspector/timeline
    // reflect where keys just landed — only when it isn't already the primary
    // selection, to avoid clearing a keyframe selection mid-edit.
    if (targetClip.id !== selClipId) {
      const clipId = targetClip.id;
      const trackLayerId = targetTrack?.layerId ?? layerId;
      setSelectedClipId(clipId);
      setSelectedClipIds([clipId]);
      setSelectedKey(null);
      setSelectedLayerId(trackLayerId);
      setSelectedLayerIds([trackLayerId]);
    }
  }, [setScene]);

  const handleTransformLayer = useCallback((layerId, patch) => {
    handlePatchTransform(layerId, patch);
  }, [handlePatchTransform]);

  // P5: edit the selected clip's position path from on-scene dials. `x,y` are
  // in the layer's parent-local space (the controller already converted from
  // world). 'point' moves a control point; 'in'/'out' set tangent handles.
  const handlePathEdit = useCallback(({ kind, index, x, y }) => {
    const clipId = selectedClipIdRef.current;
    if (!clipId) return;
    setScene((prev) => {
      const tracks = (prev.flow?.tracks || []).map((tr) => {
        if (!tr.clips?.some((c) => c.id === clipId)) return tr;
        return {
          ...tr,
          clips: tr.clips.map((c) => {
            if (c.id !== clipId) return c;
            const pos = c.channels?.position;
            if (!isPathChannel(pos)) return c;
            const points = pos.path.points.slice();
            const p = points[index];
            if (!p) return c;
            let np;
            if (kind === 'point') {
              np = { ...p, x, y };
            } else if (kind === 'out') {
              const off = { x: x - p.x, y: y - p.y };
              // Auto/linear → unify ('free', mirrors in). Broken stays broken.
              np = p.tm === 'broken' ? { ...p, to: off } : { ...p, tm: 'free', to: off, ti: undefined };
            } else { // 'in' → independent (broken); seed out from current shape.
              const off = { x: x - p.x, y: y - p.y };
              const H = resolvePointHandles(points);
              const seedTo = p.to || { x: H[index].outX - p.x, y: H[index].outY - p.y };
              np = { ...p, tm: 'broken', ti: off, to: seedTo };
            }
            points[index] = np;
            const nextPos = { ...pos, path: { ...pos.path, points } };
            return { ...c, channels: { ...c.channels, position: nextPos } };
          })
        };
      });
      return { ...prev, flow: deriveFlowGraph({ ...(prev.flow || {}), tracks }) };
    });
  }, [setScene]);

  const handleReorder = useCallback((draggedArg, targetId, mode, canvasIdArg) => {
    const draggedIds = Array.isArray(draggedArg) ? draggedArg : [draggedArg];
    setScene((prev) => {
      // The set actually requested to move — existing layers only.
      const idSet = new Set(draggedIds.filter((id) => prev.layers.some((l) => l.id === id)));
      if (!idSet.size) return prev;

      // Move only the "roots" of the selection: if both a parent and its
      // descendant are selected, the descendant rides along with its parent
      // (Unity behaviour), so we don't reparent it independently.
      const isRoot = (id) => {
        let p = prev.layers.find((l) => l.id === id)?.parentId ?? null;
        while (p) { if (idSet.has(p)) return false; p = prev.layers.find((l) => l.id === p)?.parentId ?? null; }
        return true;
      };
      // Keep document order so the moved group preserves its relative stacking.
      let movers = prev.layers
        .filter((l) => idSet.has(l.id) && isRoot(l.id) && !l.locked)
        .map((l) => l.id);
      if (!movers.length) return prev;

      // Can't drop inside a locked target.
      if (mode === 'inside' && prev.layers.find((l) => l.id === targetId)?.locked) return prev;
      // Can't drop the group onto one of its own members.
      if ((mode === 'inside' || mode === 'above' || mode === 'below') && movers.includes(targetId)) return prev;

      // Resolve the destination parent + canvas once from the target + mode.
      let newParentId = null;
      let newCanvasId = prev.layers.find((l) => l.id === movers[0])?.canvasId;
      if (mode === 'inside') {
        const target = prev.layers.find((l) => l.id === targetId);
        if (!target) return prev;
        newParentId = target.id;
        newCanvasId = target.canvasId;
      } else if (mode === 'above' || mode === 'below') {
        const target = prev.layers.find((l) => l.id === targetId);
        if (!target) return prev;
        newParentId = target.parentId ?? null;
        newCanvasId = target.canvasId;
      } else if (mode === 'canvasRoot') {
        newParentId = null;
        newCanvasId = canvasIdArg || prev.activeCanvasId || prev.canvases[0].id;
      }

      // Drop any mover that would become a child of itself or its own descendant.
      movers = movers.filter((id) => !(newParentId && (newParentId === id || isDescendantOf(prev, id, targetId))));
      if (!movers.length) return prev;

      const newWorldParentLand = newParentId ? getWorldPosition(prev, newParentId, 'landscape') : { x: 0, y: 0 };
      const newWorldParentPort = newParentId ? getWorldPosition(prev, newParentId, 'portrait') : { x: 0, y: 0 };

      // Rebuild each mover with the new parent/canvas, preserving world position.
      const rebuilt = movers.map((id) => {
        const dragged = prev.layers.find((l) => l.id === id);
        const oldWorldLand = getWorldPosition(prev, id, 'landscape');
        const oldWorldPort = getWorldPosition(prev, id, 'portrait');
        const newLandT = { ...dragged.transforms.landscape, x: oldWorldLand.x - newWorldParentLand.x, y: oldWorldLand.y - newWorldParentLand.y };
        let newPortT = dragged.transforms.portrait;
        if (newPortT) newPortT = { ...newPortT, x: oldWorldPort.x - newWorldParentPort.x, y: oldWorldPort.y - newWorldParentPort.y };
        return { ...dragged, parentId: newParentId, canvasId: newCanvasId, transforms: { landscape: newLandT, portrait: newPortT } };
      });

      const moverSet = new Set(movers);
      const without = prev.layers.filter((l) => !moverSet.has(l.id));

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
      if (insertAt < 0) insertAt = without.length;
      return { ...prev, layers: [...without.slice(0, insertAt), ...rebuilt, ...without.slice(insertAt)] };
    });
  }, []);

  const handleAssetReady = useCallback((assetId, descriptor) => {
    if (!descriptor) return;
    setAssetDescriptors((prev) => {
      const old = prev[assetId];
      if (old && JSON.stringify(old) === JSON.stringify(descriptor)) return prev;
      return { ...prev, [assetId]: descriptor };
    });
    // For Spine layers, pick a sensible default animation ONCE — the first time
    // we learn the animation list from the descriptor. Preference:
    //   1. first animation whose name contains "idle" (case-insensitive)
    //   2. otherwise, the first animation in the list
    // Guard on KEY PRESENCE, not truthiness: once `defaultAnimation` exists on
    // the layer (even when explicitly set to null = "no pose / setup pose"), we
    // never re-pick. Otherwise choosing "none" would be overwritten on the next
    // rebuild's onAssetReady.
    // Only Spine assets get an auto-picked default animation. A winseq asset is
    // Spine-backed too but its playback is flow-driven (no layer.spine config) —
    // writing layer.spine here would pollute it and force needless rebuilds.
    const readyAsset = sceneRef.current.assets.find((a) => a.id === assetId);
    if (readyAsset?.type === 'spine' && Array.isArray(descriptor.animations) && descriptor.animations.length) {
      const pick = descriptor.animations.find((n) => /idle/i.test(n)) || descriptor.animations[0];
      const skins = Array.isArray(descriptor.skins) ? descriptor.skins : [];
      const byLower = new Map(skins.map((s) => [String(s).toLowerCase(), s]));
      const pickedSkin = byLower.get('base') || byLower.get('default') || null;
      setScene((prev) => {
        let changed = false;
        const layers = prev.layers.map((l) => {
          if (l.assetId !== assetId) return l;
          const hasAnim = l.spine && Object.prototype.hasOwnProperty.call(l.spine, 'defaultAnimation');
          const hasSkin = l.spine && Object.prototype.hasOwnProperty.call(l.spine, 'skin');
          if (hasAnim && (hasSkin || !pickedSkin)) return l;
          changed = true;
          return {
            ...l,
            spine: {
              ...(l.spine || {}),
              ...(hasAnim ? {} : { defaultAnimation: pick }),
              loop: l.spine?.loop !== false,
              ...(hasSkin ? {} : { skin: pickedSkin })
            }
          };
        });
        return changed ? { ...prev, layers } : prev;
      });
    }
    backfillSceneSetupAuxClips(assetId, descriptor);
  }, [backfillSceneSetupAuxClips]);

  // Persist real Spine win/land durations resolved by the runtime back onto
  // the spinner asset's symbols, so the inspector clip-length button and the
  // Unity bake (neither of which loads Spine) see actual anim lengths. Existing
  // scenes self-heal on open: the first rebuild fires this with the resolved
  // map. Only patches when a value actually changed (avoids render/autosave
  // loops). `symbols` = { [symbolId]: { win, land } } in seconds.
  const handleSpinnerAnimDurations = useCallback((assetId, symbols) => {
    if (!assetId || !symbols) return;
    setScene((prev) => {
      let changed = false;
      const assets = prev.assets.map((a) => {
        if (a.id !== assetId || a.type !== 'spinner' || !a.spinner) return a;
        const syms = (a.spinner.symbols || []).map((s) => {
          const upd = symbols[s.id];
          if (!upd) return s;
          let next = s;
          if (upd.win > 0 && s.winAnim && s.winAnim.duration !== upd.win) {
            next = { ...next, winAnim: { ...next.winAnim, duration: upd.win } };
            changed = true;
          }
          if (upd.land > 0 && s.landAnim && s.landAnim.duration !== upd.land) {
            next = { ...next, landAnim: { ...next.landAnim, duration: upd.land } };
            changed = true;
          }
          return next;
        });
        if (!changed) return a;
        // rev is rebuild-inert since the structural-hash refactor; the fresh
        // asset.spinner identity is what carries these durations to the live
        // object (applyRuntimeConfigs config swap — no rebuild). rev still
        // bumps for persistence/versioning semantics.
        return { ...a, spinner: { ...a.spinner, symbols: syms, rev: (a.spinner.rev || 1) + 1 } };
      });
      return changed ? { ...prev, assets } : prev;
    });
  }, [setScene]);

  const handleResetPortrait = useCallback((layerId) => {
    setScene((prev) => ({
      ...prev,
      layers: prev.layers.map((l) => (l.id === layerId ? resetPortrait(l) : l))
    }));
  }, []);

  // Unified visibility model: `transform.alpha` is the single source of truth
  // for opacity AND visibility. `alphaForLayer` resolves the alpha the eye
  // should reflect — the same value the Inspector/viewport show: the evaluated
  // alpha at the playhead in animate mode (single clip under the playhead, same
  // logic as InspectorPanel's `disp.alpha`), else the base-pose alpha.
  const alphaForLayer = useCallback((layerId) => {
    const sc = sceneRef.current;
    const layer = sc?.layers?.find((l) => l.id === layerId);
    if (!layer) return 1;
    const orientation = sc.stage.activeOrientation;
    const base = resolveTransform(layer, orientation, sc.stage);
    let a = typeof base?.alpha === 'number' ? base.alpha : 1;
    if (studioMode !== 'setup') {
      const time = flowState.time;
      const track = (sc.flow?.tracks || []).find((tr) => tr.layerId === layerId);
      const clip = track?.clips?.find((c) => time >= c.start && time < c.start + c.duration);
      const ch = clip?.channels?.alpha;
      const animated = ch && (ch.keys?.length || isPathChannel(ch));
      if (animated) {
        const v = evalChannel(ch, clipLocalSeconds(clip, time, { clampPastEnd: true }), 'alpha');
        if (typeof v === 'number') a = v;
      }
    }
    return Math.max(0, Math.min(1, a));
  }, [studioMode, flowState]);

  // Remembers the last non-zero alpha per layer so re-showing a hidden object
  // restores its prior opacity (in-memory, per session; falls back to 1).
  const lastAlphaRef = useRef({});
  const handleToggleVisibility = useCallback((layerId) => {
    const cur = alphaForLayer(layerId);
    let next;
    if (cur > 0.0001) { lastAlphaRef.current[layerId] = cur; next = 0; }
    else { next = lastAlphaRef.current[layerId] || 1; }
    if (studioModeRef.current === 'setup') {
      // Global eye: set the base-pose alpha on BOTH orientations. Portrait is
      // only stamped when it already has an override — otherwise it inherits
      // landscape's alpha automatically (don't break inheritance).
      setScene((prev) => ({
        ...prev,
        layers: prev.layers.map((l) => {
          if (l.id !== layerId) return l;
          let nl = patchTransform(l, 'landscape', { alpha: next }, prev.stage);
          if (nl.transforms?.portrait) nl = patchTransform(nl, 'portrait', { alpha: next }, prev.stage);
          return nl;
        })
      }));
    } else {
      // Animate mode: route through the alpha edit path so autokey inserts a
      // keyframe exactly like dragging the alpha slider would (keyframes are
      // global, not per-orientation).
      handlePatchTransform(layerId, { alpha: next });
    }
  }, [alphaForLayer, handlePatchTransform]);

  const handleRemoveLayer = useCallback((layerId) => {
    let removedIds = null;
    setScene((prev) => {
      const layer = prev.layers.find((l) => l.id === layerId);
      if (!layer) return prev;
      // A locked layer (e.g. a win-number child) can't be deleted on its own —
      // it only goes when its parent does (handled below by the cascade).
      if (layer.locked) return prev;

      // Collect this layer + all its descendants (a win-sequence takes its
      // locked number child with it).
      const ids = new Set([layerId]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const l of prev.layers) {
          if (!ids.has(l.id) && l.parentId && ids.has(l.parentId)) { ids.add(l.id); grew = true; }
        }
      }
      removedIds = ids;
      const remaining = prev.layers.filter((l) => !ids.has(l.id));
      const removedAssetIds = new Set(prev.layers.filter((l) => ids.has(l.id)).map((l) => l.assetId));
      // Assets are a project-level shared pool — only prune one when NO surviving
      // layer here references it AND no other scene does.
      const assets = prev.assets.filter((a) => {
        if (!removedAssetIds.has(a.id)) return true;
        const usedHere = remaining.some((l) => l.assetId === a.id);
        const usedElsewhere = (projectRef.current.scenes || []).some((s) =>
          s.id !== projectRef.current.activeSceneId
          && (s.data?.layers || []).some((l) => l.assetId === a.id));
        return usedHere || usedElsewhere;
      });
      return { ...prev, layers: remaining, assets };
    });
    setSelectedLayerId((cur) => (cur && removedIds?.has(cur) ? null : cur));
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

  // Reset transient editor state when the working scene changes underneath us
  // (scene switch, timeline switch, project load).
  const resetEditorStateForScene = useCallback(() => {
    setSelectedLayerId(null);
    setSelectedClipId(null);
    setSelectedClipIds([]);
    setSelectedKey(null);
    setFlowState(createInitialFlowState());
  }, []);

  const linkProjectRoot = useCallback(async (handle) => {
    if (!handle || handle.kind !== 'directory') return;
    setRootHandle(handle);
    await refreshAssetBrowser(handle);
    log(`Scene Studio: project root = ${handle.name}`, 'ok');
    try {
      const loadedProject = await loadProjectFromHandle(handle);
      if (loadedProject) {
        replaceProjectNoHistory(loadedProject);
        resetEditorStateForScene();
        setAssetDescriptors({});
        log(`Scene Studio: loaded project "${loadedProject.name}" (${loadedProject.scenes.length} scene(s))`, 'ok');
      }
    } catch (e) {
      log(`Scene Studio: ${e.message || e}`, 'err');
    }
  }, [log, refreshAssetBrowser, replaceProjectNoHistory, resetEditorStateForScene]);

  // Switch the active scene WITHIN the loaded project (non-destructive; the
  // previous scene's edits are already folded into the project).
  const handleSelectScene = useCallback((sceneId) => {
    if (sceneId === projectRef.current.activeSceneId) return;
    setProjectInternal((prev) => setActiveScene(commitCurrentSceneFlow(prev), sceneId));
    resetEditorStateForScene();
    setAssetDescriptors({});
    log('Scene Studio: switched scene', 'ok');
  }, [resetEditorStateForScene, log]);

  // Add a fresh empty scene to the project and make it active.
  const handleNewSceneRequest = useCallback(() => {
    setProjectInternal((prev) => {
      const committed = commitCurrentSceneFlow(prev);
      return addProjectScene(committed, `Scene ${(committed.scenes?.length || 0) + 1}`).project;
    });
    resetEditorStateForScene();
    log('Scene Studio: new scene added to project', 'info');
  }, [resetEditorStateForScene, log]);

  // Duplicate the active scene as a variant (records variantOf, makes it active).
  const handleNewVariant = useCallback(() => {
    setProjectInternal((prev) => {
      const committed = commitCurrentSceneFlow(prev);
      const src = committed.scenes.find((s) => s.id === committed.activeSceneId) || committed.scenes[0];
      return duplicateSceneAsVariant(committed, committed.activeSceneId, `${src?.name || 'Scene'} variant`).project;
    });
    resetEditorStateForScene();
    setAssetDescriptors({});
    log('Scene Studio: created scene variant', 'ok');
  }, [resetEditorStateForScene, log]);

  // ── Timeline management (within the active scene) ──────────────────────
  const handleSelectTimeline = useCallback((timelineId) => {
    if (timelineId === sceneRef.current.activeTimelineId) return;
    setScene((prev) => setActiveTimeline(prev, timelineId));
    setSelectedClipId(null);
    setSelectedClipIds([]);
    setSelectedKey(null);
    setFlowState((prev) => flowStop(prev));
  }, [setScene]);

  const handleAddTimeline = useCallback(() => {
    setScene((prev) => addTimeline(prev));
    setSelectedClipId(null);
    setSelectedClipIds([]);
    setSelectedKey(null);
    setFlowState((prev) => flowStop(prev));
    log('Scene Studio: new timeline', 'ok');
  }, [setScene, log]);

  const handleRenameTimeline = useCallback((timelineId, name) => {
    setScene((prev) => renameTimeline(prev, timelineId, name));
  }, [setScene]);

  const handleRemoveTimeline = useCallback((timelineId) => {
    setScene((prev) => removeTimeline(prev, timelineId));
    setSelectedClipId(null);
    setSelectedClipIds([]);
    setSelectedKey(null);
    setFlowState((prev) => flowStop(prev));
  }, [setScene]);

  // ── Direct-mode scenario management (project-level) ─────────────────────
  // Scenarios live on the project (they may sequence timelines from several
  // scenes), so they're mutated via setProjectInternal, not setScene. The
  // active scene's live flow is committed first so nothing is lost.
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState(null);
  // Direct-mode playback is driven by a single global time (scrubbable). The
  // flattened scenario timeline maps that time → which timeline + local time to
  // preview (or a same-scene crossfade blend).
  const [scenarioPlayhead, setScenarioPlayhead] = useState({ time: 0, playing: false });
  const scenarioPlayheadRef = useRef(scenarioPlayhead);
  scenarioPlayheadRef.current = scenarioPlayhead;
  const activeScenarioRef = useRef(null);
  const scenarioTimelineRef = useRef({ segments: [], total: 0 });
  // Anchor for chained "+" node placement — the node spawned last, cleared on
  // scenario switch/remove so a fresh chain starts from the rightmost node.
  const lastSpawnedNodeIdRef = useRef(null);
  // Wizard-preview transport (registered by the mounted preview, e.g.
  // WinSeqPreview) so the global Space shortcut can drive it.
  const wizardPreviewControlsRef = useRef(null);
  const wizardActiveRef = useRef(false);

  const handleSelectScenario = useCallback((scenarioId) => {
    setProjectInternal((prev) => setActiveScenario(prev, scenarioId));
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setScenarioPlayhead({ time: 0, playing: false });
    lastSpawnedNodeIdRef.current = null;
  }, []);

  // Transport for the scenario playhead (▶ ⏸ ⏹). Play from the start when the
  // playhead is parked at the end.
  const handleScenarioTransport = useCallback((action) => {
    setScenarioPlayhead((prev) => {
      const total = scenarioTimelineRef.current.total || 0;
      if (action === 'play') {
        const atEnd = prev.time >= total - 1e-3;
        return { time: atEnd ? 0 : prev.time, playing: true };
      }
      if (action === 'pause') return { ...prev, playing: false };
      if (action === 'stop') return { time: 0, playing: false };
      if (action === 'seekStart') return { ...prev, time: 0 }; // ⏮ keeps play state
      return prev;
    });
  }, []);

  // Drag the scrubber → set the global time (pauses playback while scrubbing).
  const handleScenarioScrub = useCallback((time) => {
    setScenarioPlayhead(() => {
      const total = scenarioTimelineRef.current.total || 0;
      return { time: Math.max(0, Math.min(total, time)), playing: false };
    });
  }, []);

  const handleAddScenario = useCallback(() => {
    setProjectInternal((prev) => addScenario(commitCurrentSceneFlow(prev), `Scenario ${(prev.scenarios?.length || 0) + 1}`).project);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setScenarioPlayhead({ time: 0, playing: false });
    log('Scene Studio: new scenario', 'ok');
  }, [log]);

  const handleDuplicateScenario = useCallback((scenarioId) => {
    setProjectInternal((prev) => duplicateScenario(prev, scenarioId).project);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setScenarioPlayhead({ time: 0, playing: false });
    log('Scene Studio: scenario duplicated', 'ok');
  }, [log]);

  const handleRenameScenario = useCallback((scenarioId, name) => {
    setProjectInternal((prev) => renameScenario(prev, scenarioId, name));
  }, []);

  const handleRemoveScenario = useCallback((scenarioId) => {
    setProjectInternal((prev) => removeScenario(prev, scenarioId));
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setScenarioPlayhead({ time: 0, playing: false });
    lastSpawnedNodeIdRef.current = null;
  }, []);

  /** Apply a node/edge mutation (fn: scenario → scenario) to the active scenario. */
  const mutateActiveScenario = useCallback((fn) => {
    setProjectInternal((prev) => {
      const sc = getActiveScenario(prev);
      if (!sc) return prev;
      return updateScenario(prev, sc.id, fn);
    });
  }, []);

  // Every spawned node (drop or "+") is selected and the graph view pans to it.
  const graphFocusTokenRef = useRef(0);
  const [graphFocus, setGraphFocus] = useState(null); // { nodeId, token } | null
  const spawnedNode = useCallback((id) => {
    lastSpawnedNodeIdRef.current = id;
    setSelectedNodeId(id);
    setSelectedEdgeId(null);
    setGraphFocus({ nodeId: id, token: ++graphFocusTokenRef.current });
  }, []);
  const handleAddTimelineNode = useCallback((sceneId, timelineId, x, y) => {
    const id = uid('n');
    mutateActiveScenario((sc) => addTimelineNode(sc, sceneId, timelineId, x, y, id));
    spawnedNode(id);
  }, [mutateActiveScenario, spawnedNode]);
  const handleAddTimelineNodeChained = useCallback((sceneId, timelineId) => {
    const id = uid('n');
    mutateActiveScenario((sc) => addTimelineNodeChained(sc, sceneId, timelineId, lastSpawnedNodeIdRef.current, id));
    spawnedNode(id);
  }, [mutateActiveScenario, spawnedNode]);
  const handleScenarioConnect = useCallback((from, to) => {
    mutateActiveScenario((sc) => scConnect(sc, from, to));
  }, [mutateActiveScenario]);
  const handleScenarioDisconnect = useCallback((edgeId) => {
    mutateActiveScenario((sc) => scDisconnect(sc, edgeId));
    setSelectedEdgeId((cur) => (cur === edgeId ? null : cur));
  }, [mutateActiveScenario]);
  // Delete an edge AND prune its source output pin (right-click / Delete on edge).
  const handleScenarioDeleteEdge = useCallback((edgeId) => {
    mutateActiveScenario((sc) => scDisconnectAndPrunePin(sc, edgeId));
    setSelectedEdgeId((cur) => (cur === edgeId ? null : cur));
  }, [mutateActiveScenario]);
  const handleScenarioSetActiveEdge = useCallback((edgeId) => {
    mutateActiveScenario((sc) => scSetActiveEdge(sc, edgeId));
  }, [mutateActiveScenario]);
  const handleScenarioRemoveNode = useCallback((nodeId) => {
    mutateActiveScenario((sc) => scRemoveNode(sc, nodeId));
    setSelectedNodeId((cur) => (cur === nodeId ? null : cur));
  }, [mutateActiveScenario]);
  const handleScenarioMoveNode = useCallback((nodeId, x, y) => {
    mutateActiveScenario((sc) => scMoveNode(sc, nodeId, x, y));
  }, [mutateActiveScenario]);
  const handleScenarioAddOutputPin = useCallback((nodeId) => {
    mutateActiveScenario((sc) => scAddOutputPin(sc, nodeId));
  }, [mutateActiveScenario]);
  const handleScenarioRemoveOutputPin = useCallback((nodeId, pinId) => {
    mutateActiveScenario((sc) => scRemoveOutputPin(sc, nodeId, pinId));
  }, [mutateActiveScenario]);
  const handleScenarioSetNodeLabel = useCallback((nodeId, label) => {
    mutateActiveScenario((sc) => scSetNodeLabel(sc, nodeId, label));
  }, [mutateActiveScenario]);
  const handleScenarioSetNodeEntry = useCallback((nodeId, patch) => {
    mutateActiveScenario((sc) => scSetNodeEntry(sc, nodeId, patch));
  }, [mutateActiveScenario]);
  const handleScenarioSetEdgeTransition = useCallback((edgeId, patch) => {
    mutateActiveScenario((sc) => scSetEdgeTransition(sc, edgeId, patch));
  }, [mutateActiveScenario]);
  const handleScenarioSetView = useCallback((view) => {
    mutateActiveScenario((sc) => scSetView(sc, view));
  }, [mutateActiveScenario]);

  // Double-click a timeline row in Direct mode → open it in Animate mode: switch
  // to its origin scene, make it the active timeline, and flip the studio mode.
  const handleJumpToTimelineInAnimate = useCallback((sceneId, timelineId) => {
    setProjectInternal((prev) => {
      let p = commitCurrentSceneFlow(prev);
      if (sceneId && sceneId !== p.activeSceneId) p = setActiveScene(p, sceneId);
      const working = deriveWorkingScene(p);
      const next = setActiveTimeline(working, timelineId);
      return foldSceneIntoProject(p, next);
    });
    resetEditorStateForScene();
    setAssetDescriptors({});
    setStudioMode('animate');
    studioModeRef.current = 'animate';
    log('Scene Studio: editing timeline in animate mode', 'info');
  }, [log]);

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

  // Build a read-only repo-backed handle (lazy authenticated file fetches) and
  // link it exactly like a local folder.
  const linkRepoSelection = useCallback(async (selection) => {
    setBusy(true);
    try {
      const handle = makeRepoRootHandle({
        provider: selection.provider,
        token: selection.token,
        baseUrl: selection.baseUrl,
        repo: selection.repo,
        subPath: selection.subPath,
        tree: selection.tree,
        blobCache: rb.blobCacheRef.current
      });
      await linkProjectRoot(handle);
      log(`Scene Studio: linked repo ${selection.repo.fullName}@${selection.repo.defaultBranch}` +
        (selection.subPath ? `/${selection.subPath}` : ''), 'ok');
    } catch (e) {
      console.warn('[SceneStudio] repo root link failed', e);
      setPickError(e?.message || String(e));
      log(`Scene Studio: ${e?.message || e}`, 'err');
    } finally {
      setBusy(false);
    }
  }, [linkProjectRoot, log, rb.blobCacheRef]);

  // Open a GitHub/GitLab repo folder AS the workspace. Before linking, warm the
  // blob cache by downloading every asset in the chosen folder (with a progress
  // bar). Skipping falls back to lazy load — the handle fetches on demand.
  const handlePickRepoRoot = useCallback(async (selection) => {
    if (!selection?.repo || !selection?.tree) return;
    setPickError(null);
    setShowRepoPicker(false);

    const mediaFiles = collectRepoMediaFiles(selection.tree, selection.subPath);
    if (!mediaFiles.length) { await linkRepoSelection(selection); return; }

    prefetchAbortRef.current = false;
    setPrefetch({ total: mediaFiles.length, done: 0, repo: selection.repo.fullName });
    let done = 0;
    await runPool(
      mediaFiles,
      async (path) => {
        if (prefetchAbortRef.current) return;
        try {
          await authBlobUrl(
            selection.provider, selection.token, selection.baseUrl,
            selection.repo, path, rb.blobCacheRef.current
          );
        } catch { /* skip unreadable file — it'll lazy-load later */ }
        done += 1;
        setPrefetch((p) => (p ? { ...p, done } : p));
      },
      8,
      () => prefetchAbortRef.current
    );
    setPrefetch(null);
    if (prefetchAbortRef.current) {
      log('Scene Studio: asset pre-download skipped — loading on demand', 'info');
    } else {
      log(`Scene Studio: cached ${done} asset${done !== 1 ? 's' : ''} from repo`, 'ok');
    }
    await linkRepoSelection(selection);
  }, [linkRepoSelection, log, rb.blobCacheRef]);

  const handleSkipPrefetch = useCallback(() => {
    prefetchAbortRef.current = true;
  }, []);

  const handleClearRoot = useCallback(() => {
    setRootHandle(null);
    setAssetItems([]);
    log('Scene Studio: project root cleared (quick mode)', 'info');
  }, [log]);

  // Re-read the already-linked project folder from disk (no re-pick) and force
  // the viewport (scene + wizard previews) to rebuild with the fresh bytes.
  // Works on Chrome/Edge (live FileSystemDirectoryHandle) AND Firefox/Safari
  // (their <input webkitdirectory> File objects re-read current disk content on
  // access). NOTE: on the Firefox/Safari snapshot handle, EDITED existing files
  // refresh, but NEWLY-ADDED files won't appear until the folder is re-picked.
  const handleRefreshAssets = useCallback(async () => {
    const handle = rootHandle;
    if (!handle) return;
    try {
      // Re-verify permission inside this click gesture on real FS handles
      // (virtual snapshot handles have no permission API).
      if (!isVirtualHandle(handle) && handle.queryPermission) {
        const state = await handle.queryPermission({ mode: 'readwrite' });
        if (state !== 'granted' && handle.requestPermission) {
          const req = await handle.requestPermission({ mode: 'readwrite' });
          if (req !== 'granted') {
            log('Scene Studio: folder permission denied — cannot refresh', 'err');
            return;
          }
        }
      }
      await refreshAssetBrowser(handle);
      setRefreshNonce((n) => n + 1);
      log('Scene Studio: assets refreshed from disk', 'ok');
    } catch (e) {
      // Folder moved/deleted (NotFoundError) or permission revoked — keep the
      // scene intact and report.
      log(`Scene Studio: refresh failed: ${e?.message || e}`, 'err');
    }
  }, [rootHandle, refreshAssetBrowser, log]);

  // ── Session restore callbacks ─────────────────────────────────────────

  const handleDismissSession = useCallback(async () => {
    await clearSession();
    setSessionDraft(null);
    autosaveEnabledRef.current = true;
  }, []);

  const handleDownloadOldSession = useCallback(async () => {
    const draft = sessionDraftRef.current;
    if (draft?.project) {
      const text = JSON.stringify(draft.project, null, 2);
      const blob = new Blob([text], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(draft.project.name || 'project').replace(/[\\/:*?"<>|]/g, '_')}_backup.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }
    await handleDismissSession();
  }, [handleDismissSession]);

  const handleRestoreSession = useCallback(async () => {
    const draft = sessionDraftRef.current;
    if (!draft?.project) return;
    replaceProjectNoHistory(validateProject(draft.project));
    resetEditorStateForScene();
    setSessionDraft(null);
    autosaveEnabledRef.current = true;
    log(`Scene Studio: session restored (${sessionLayerCount(draft.project)} layers)`, 'ok');
    if (draft.repoMeta?.kind === 'repo') {
      // Rebuild the repo-backed handle: token from localStorage, tree refetched.
      try {
        let token = '';
        try { token = JSON.parse(localStorage.getItem(LS_KEY) || '{}').token || ''; } catch { /* none */ }
        if (!token) {
          log('Scene Studio: repo workspace needs a token — reopen it from the gate', 'info');
          return;
        }
        const { provider, baseUrl, repo, subPath } = draft.repoMeta;
        const tree = await fetchTree(provider, token, baseUrl, repo);
        const handle = makeRepoRootHandle({
          provider, token, baseUrl, repo, subPath, tree, blobCache: rb.blobCacheRef.current
        });
        await linkProjectRoot(handle);
        log(`Scene Studio: repo workspace reconnected (${repo.fullName})`, 'ok');
      } catch (e) {
        log(`Scene Studio: could not reconnect repo workspace: ${e.message || e}`, 'info');
      }
      return;
    }
    if (draft.rootHandle) {
      try {
        const perm = await draft.rootHandle.requestPermission({ mode: 'readwrite' });
        if (perm === 'granted') {
          await linkProjectRoot(draft.rootHandle);
        } else {
          log('Scene Studio: folder permission denied — scene restored without project folder', 'info');
        }
      } catch (e) {
        log(`Scene Studio: could not restore project folder: ${e.message || e}`, 'info');
      }
    }
  }, [replaceProjectNoHistory, resetEditorStateForScene, log, linkProjectRoot, rb.blobCacheRef]);

  // ── New project ───────────────────────────────────────────────────────

  const handleConfirmNewProject = useCallback(async () => {
    setNewProjectPending(false);
    await clearSession();
    replaceProjectNoHistory(createEmptyProject());
    resetEditorStateForScene();
    setAssetDescriptors({});
    setRootHandle(null);
    setAssetItems([]);
    setSessionDraft(null);
    autosaveEnabledRef.current = true;
    log('Scene Studio: new project', 'info');
  }, [replaceProjectNoHistory, resetEditorStateForScene, log]);

  const handleNewProject = useCallback(() => {
    if (sessionLayerCount(projectRef.current) > 0) {
      setNewProjectPending(true);
    } else {
      handleConfirmNewProject();
    }
  }, [handleConfirmNewProject]);

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

  // T10: preview-only wager override for the win-timeline inspector — never
  // written to the scene/asset until the artist clicks "Apply as authored
  // wager" (InspectorPanel's ClipSection). Reset whenever the selection
  // changes so a leftover override from one win-sequence clip doesn't bleed
  // into the next one silently.
  const [wagerPreview, setWagerPreview] = useState(null);
  useEffect(() => { setWagerPreview(null); }, [selectedLayerId, selectedClipId]);

  const spinnerWizardPreviewGizmoLayerId = (showSpinnerWizard || !!editSpinnerTarget || showWinSeqWizard || !!editWinSeqTarget || showSceneSetupWizard) && wizardPreviewScene
    ? (wizardPreviewScene.layers || []).find((l) => {
      const a = wizardPreviewScene.assets?.find((x) => x.id === l.assetId);
      return a?.type === 'spinner';
    })?.id || null
    : null;

  const sceneWithRuntime = useMemo(() => ({
    ...scene,
    flow: {
      ...(scene.flow || {}),
      runtime: {
        time: flowState.time,
        playing: flowState.playing,
        hold: flowState.hold,
        spinnerCellGizmoLayerId: (() => {
          if (spinnerWizardPreviewGizmoLayerId) return spinnerWizardPreviewGizmoLayerId;
          if (studioMode !== 'setup' || !selectedLayerId) return null;
          const sel = scene.layers.find((l) => l.id === selectedLayerId);
          const type = sel ? scene.assets.find((a) => a.id === sel.assetId)?.type : null;
          return type === 'spinner' ? selectedLayerId : null;
        })()
      }
    },
    ...(wagerPreview != null
      ? { winNumberPreview: { ...(scene.winNumberPreview || null), wager: wagerPreview.wager, forAssetId: wagerPreview.forAssetId } }
      : {})
  }), [scene, flowState.time, flowState.playing, flowState.hold, wagerPreview, studioMode, selectedLayerId, spinnerWizardPreviewGizmoLayerId]);

  // ── Direct-mode derived state ──────────────────────────────────────────
  const activeScenario = useMemo(() => getActiveScenario(project), [project]);
  activeScenarioRef.current = activeScenario;
  const projectTimelines = useMemo(() => listProjectTimelines(project), [project]);

  // ── Video export sources ───────────────────────────────────────────────
  // Everything the exporter can render: each timeline in the active scene plus
  // each project scenario (flattened). Durations drive the export frame count.
  const videoExportSources = useMemo(() => {
    const tlDur = (tracks) => (tracks || []).reduce((mx, tr) =>
      (tr.clips || []).reduce((m, c) => Math.max(m, (c.start || 0) + (c.duration || 0)), mx), 0);
    const timelines = (scene.timelines || []).map((tl) => ({
      kind: 'timeline', id: tl.id, name: tl.name || tl.id,
      // The active timeline's live edits live in scene.flow, not yet synced.
      duration: Math.max(0.1, tl.id === scene.activeTimelineId ? tlDur(scene.flow?.tracks) : tlDur(tl.tracks))
    }));
    const scenarios = (project.scenarios || []).map((sc) => {
      const flat = buildScenarioTimeline(sc, project);
      return { kind: 'scenario', id: sc.id, name: sc.name || sc.id, duration: Math.max(0.1, flat.total || 0), ok: flat.ok };
    });
    return { timelines, scenarios };
  }, [scene.timelines, scene.activeTimelineId, scene.flow, project]);

  // Build the per-frame (time → {scene, flowTime}) provider for a chosen source.
  // Timelines render against the active scene's layers (handles already match);
  // scenarios are flattened + sampled per frame, degrading blends to cuts and
  // skipping cross-scene segments (only the active scene's layers exist).
  const makeVideoFrameProvider = useCallback((source) => {
    if (!source) return null;
    const cur = sceneRef.current;
    if (source.kind === 'timeline') {
      const isActive = source.id === cur.activeTimelineId;
      const tl = (cur.timelines || []).find((t) => t.id === source.id);
      const tracks = isActive ? (cur.flow?.tracks || []) : (tl?.tracks || []);
      const markers = isActive ? (cur.flow?.markers || []) : (tl?.markers || []);
      const flow = deriveFlowGraph({ tracks, markers, nodes: [], edges: [] });
      const renderScene = { ...cur, flow };
      return (t) => ({ scene: renderScene, flowTime: t });
    }
    const sc = (project.scenarios || []).find((s) => s.id === source.id);
    if (!sc) return null;
    const flat = buildScenarioTimeline(sc, project);
    const carryByNode = spinnerCarryByNode(flat, project);
    const poseByNode = layerPoseCarryByNode(flat, project);
    // The live handles belong to the active scene only; segments from other
    // scenes can't render without a graph rebuild, so we skip them. (Compare
    // against the PROJECT scene id — the working scene's own id differs.)
    const activeSceneId = project.activeSceneId;
    let warnedCross = false;
    return (t) => {
      const s = sampleScenario(flat, t);
      if (!s) return null;
      // sampleScenario degrades cross-scene crossfades to a cut; same-scene
      // crossfades come back as 'blend' — take the incoming side as a cut.
      const segTimelineId = s.kind === 'blend' ? s.in.timelineId : s.timelineId;
      const segLocalTime = s.kind === 'blend' ? s.in.localTime : s.localTime;
      if (s.sceneId !== activeSceneId) {
        if (!warnedCross) { warnedCross = true; log('Scenario spans multiple scenes — only the active scene renders in export', 'warn'); }
        return null;
      }
      // Active timeline's freshest tracks live in cur.flow; others are stored.
      const isActive = segTimelineId === cur.activeTimelineId;
      const tl = (cur.timelines || []).find((x) => x.id === segTimelineId);
      if (!isActive && !tl) return null;
      const tracks = isActive ? (cur.flow?.tracks || []) : (tl?.tracks || []);
      const markers = isActive ? (cur.flow?.markers || []) : (tl?.markers || []);
      const flow = deriveFlowGraph({ tracks, markers, nodes: [], edges: [] });
      const carry = carryByNode.get(s.segment?.nodeId) || null;
      const poses = poseByNode.get(s.segment?.nodeId) || null;
      const layers = poses
        ? bakeCarriedPoses(cur.layers, poses, cur.stage?.activeOrientation || 'landscape')
        : cur.layers;
      const outcome = s.segment?.spinOutcome && s.segment.spinOutcome !== 'default' ? s.segment.spinOutcome : null;
      const outcomeReroll = s.segment?.spinOutcomeReroll || 0;
      return { scene: { ...cur, layers, flow, __spinnerCarry: carry, __spinnerOutcome: outcome, __spinnerOutcomeReroll: outcomeReroll }, flowTime: segLocalTime };
    };
  }, [project, log]);

  // One-click "hero frame": render whatever the viewport is currently showing
  // (current playhead + orientation) to a transparent PNG at native resolution
  // and download it. No dialog — it's a quick single-frame companion to the
  // WebM export.
  const handlePngExport = useCallback(async () => {
    try {
      const out = await pixiViewportRef.current?.exportFramePng({ scale: 1, backgroundColor: null });
      if (!out?.blob) throw new Error('the viewport is not ready');
      const base = `${sceneRef.current.name || 'scene'}_${out.orientation}_frame`.replace(/[^\w.-]+/g, '_');
      const url = URL.createObjectURL(out.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${base}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      log(`Scene Studio: exported ${base}.png (${out.width}×${out.height}, ${out.orientation})`, 'ok');
    } catch (err) {
      log(`PNG export failed: ${err.message}`, 'err');
    }
  }, [log]);

  // Flattened, scrubbable scenario timeline (segments + total) — recomputed
  // whenever the scenario or project changes, so the scrubber + preview follow.
  const scenarioTimeline = useMemo(
    () => buildScenarioTimeline(activeScenario, project),
    [activeScenario, project]
  );
  scenarioTimelineRef.current = scenarioTimeline;

  // Per-node spinner carry-in boards: makes a spinner HOLD the board it landed
  // on across a direct-mode timeline hand-off instead of resetting to its
  // authored initial board. Pure fold over the scenario walk — recomputed only
  // when the scenario/project changes (not per playhead frame).
  const spinnerCarry = useMemo(
    () => spinnerCarryByNode(scenarioTimeline, project),
    [scenarioTimeline, project]
  );

  // Per-node carried layer poses: makes HOLD / CROSSFADE hand-offs keep the
  // pose keyframed layers ended on instead of snapping back to the setup pose
  // (cut hand-offs still snap — that's what a cut means). Same pure-fold shape
  // as spinnerCarry above.
  const poseCarry = useMemo(
    () => layerPoseCarryByNode(scenarioTimeline, project),
    [scenarioTimeline, project]
  );

  // Sample the timeline at the playhead → which segment/node is current (fx).
  const scenarioSample = useMemo(
    () => (studioMode === 'direct' ? sampleScenario(scenarioTimeline, scenarioPlayhead.time) : null),
    [studioMode, scenarioTimeline, scenarioPlayhead.time]
  );

  // The preview scene + flowTime for the current playhead. `single` → the
  // origin scene with its timeline's flow at localTime; `blend` → a baked
  // same-scene crossfade pose (empty flow). Cross-scene crossfades degrade to
  // a cut upstream in sampleScenario.
  const directPreview = useMemo(() => {
    if (studioMode !== 'direct' || !scenarioSample) return null;
    const entry = (project.scenes || []).find((s) => s.id === scenarioSample.sceneId);
    if (!entry?.data) return null;
    const tls = entry.data.timelines || [];
    const carry = spinnerCarry.get(scenarioSample.segment?.nodeId) || null;
    const poses = poseCarry.get(scenarioSample.segment?.nodeId) || null;
    const segOutcome = scenarioSample.segment?.spinOutcome;
    const spinOutcome = segOutcome && segOutcome !== 'default' ? segOutcome : null;
    const spinOutcomeReroll = scenarioSample.segment?.spinOutcomeReroll || 0;
    if (scenarioSample.kind === 'blend') {
      const outTl = tls.find((t) => t.id === scenarioSample.out.timelineId);
      const inTl = tls.find((t) => t.id === scenarioSample.in.timelineId);
      if (!outTl || !inTl) return null;
      const scene = buildBlendedScene(
        entry.data, project.assets || [],
        outTl.tracks, scenarioSample.out.localTime,
        inTl.tracks, scenarioSample.in.localTime,
        scenarioSample.f, scenarioSample.channels,
        poses
      );
      if (carry) scene.__spinnerCarry = carry;
      if (spinOutcome) { scene.__spinnerOutcome = spinOutcome; scene.__spinnerOutcomeReroll = spinOutcomeReroll; }
      return { scene, flowTime: 0 };
    }
    const tl = tls.find((t) => t.id === scenarioSample.timelineId);
    if (!tl) return null;
    const orientation = entry.data.stage?.activeOrientation || 'landscape';
    const scene = {
      ...entry.data,
      assets: project.assets || [],
      // Carried poses become the layers' BASE pose for this segment; the
      // timeline's own channels still override on top.
      ...(poses ? { layers: bakeCarriedPoses(entry.data.layers, poses, orientation) } : {}),
      __spinnerCarry: carry,
      __spinnerOutcome: spinOutcome,
      __spinnerOutcomeReroll: spinOutcomeReroll,
      flow: {
        ...deriveFlowGraph({ tracks: tl.tracks, markers: tl.markers, nodes: [], edges: [] }),
        runtime: { time: scenarioSample.localTime, playing: scenarioPlayhead.playing, hold: null }
      }
    };
    return { scene, flowTime: scenarioSample.localTime };
  }, [studioMode, scenarioSample, scenarioPlayhead.playing, project, spinnerCarry, poseCarry]);

  // ── Wizard preview (in-viewport, full-focus) ───────────────────────────
  // A wizard takes over the scene view with a synthetic preview scene + its
  // own transport clock. When no preview scene is pushed yet we render a blank
  // stage so the real scene never flashes underneath.
  const blankPreviewScene = useMemo(() => createEmptyScene('Wizard preview'), []);
  const wizardActive = showSpinnerWizard || !!editSpinnerTarget || showWinSeqWizard || !!editWinSeqTarget || showSceneSetupWizard;
  wizardActiveRef.current = wizardActive;
  useEffect(() => {
    if (!wizardActive) { setWizardPreviewScene(null); setWizardPreviewTime(0); }
  }, [wizardActive]);

  // Wizard mode forces the scene view to "frame behind" so the preview object
  // isn't greyed out by the in-front frame overlay. We stash whatever overlay
  // mode the real scene view was using and restore it when the wizard closes.
  const savedOverlayModeRef = useRef(null);
  useEffect(() => {
    if (wizardActive) {
      if (savedOverlayModeRef.current == null) savedOverlayModeRef.current = overlayMode;
      setOverlayMode('behind');
    } else if (savedOverlayModeRef.current != null) {
      setOverlayMode(savedOverlayModeRef.current);
      savedOverlayModeRef.current = null;
    }
  // overlayMode intentionally omitted — we only react to wizard open/close.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wizardActive]);

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

  // Prune the multi-selection of clips that no longer exist (e.g. after a
  // track / clip removal or scene switch).
  useEffect(() => {
    if (!selectedClipIds.length) return;
    const live = new Set();
    for (const track of scene.flow?.tracks || []) {
      for (const c of track.clips || []) live.add(c.id);
    }
    const next = selectedClipIds.filter((id) => live.has(id));
    if (next.length !== selectedClipIds.length) setSelectedClipIds(next);
  }, [scene.flow, selectedClipIds]);

  /**
   * Selecting a clip also focuses the layer it lives on so the
   * inspector / hierarchy stay in sync. Selecting a different layer
   * (via hierarchy, viewport click, or timeline label) clears the
   * clip selection so the inspector reverts to layer-only mode.
   */
  const handleSelectClip = useCallback((clipId) => {
    setSelectedClipId(clipId);
    setSelectedClipIds(clipId ? [clipId] : []);
    setSelectedKey(null);
    if (!clipId) return;
    for (const track of sceneRef.current.flow?.tracks || []) {
      const clip = track.clips?.find((c) => c.id === clipId);
      if (clip) { setSelectedLayerId(track.layerId); setSelectedLayerIds([track.layerId]); return; }
    }
  }, []);

  /**
   * Multi-select entrypoint used by the timeline (ctrl/shift-click +
   * marquee). `ids` is the full selected set; `primaryId` is the
   * last-clicked clip that drives the inspector / auto-key. Selecting the
   * primary also focuses the layer it lives on.
   */
  const handleSelectClips = useCallback((ids, primaryId) => {
    const list = Array.isArray(ids) ? ids : [];
    const primary = primaryId ?? (list.length ? list[list.length - 1] : null);
    setSelectedClipIds(list);
    setSelectedClipId(primary);
    setSelectedKey(null);
    if (!primary) return;
    for (const track of sceneRef.current.flow?.tracks || []) {
      const clip = track.clips?.find((c) => c.id === primary);
      if (clip) { setSelectedLayerId(track.layerId); setSelectedLayerIds([track.layerId]); return; }
    }
  }, []);

  /** Delete every clip in the multi-selection from its track. */
  const handleDeleteSelectedClips = useCallback(() => {
    const ids = selectedClipIdsRef.current;
    if (!ids || !ids.length) return false;
    const idSet = new Set(ids);
    setScene((prev) => {
      const tracks = (prev.flow?.tracks || []).map((tr) => ({
        ...tr,
        clips: (tr.clips || []).filter((c) => !idSet.has(c.id))
      }));
      return { ...prev, flow: deriveFlowGraph({ ...(prev.flow || {}), tracks }) };
    });
    setSelectedClipId(null);
    setSelectedClipIds([]);
    return true;
  }, [setScene]);

  // ── Timeline keyframe selection + clipboard ─────────────────────────

  const handleSelectKey = useCallback((ref) => {
    if (!ref) { setSelectedKey(null); setSelectedKeys([]); return; }
    const { clip } = findClipById(sceneRef.current, ref.clipId);
    const stamped = clip ? selKeyWithKid(clip, ref) : ref;
    setSelectedKey(stamped);
    setSelectedKeys([stamped]);
  }, []);

  /**
   * Multi-select keyframes within a single clip (marquee + ctrl/shift-click).
   * `list` is the full set of { clipId, name, comp, kid, idx }; `primary` drives
   * the inspector / move-by-frame. All entries must share one clipId. Entries
   * arriving from the graph editor may carry idx only — stamp the kid here so
   * every selection is identified by its stable key id from then on.
   */
  const handleSelectKeys = useCallback((list, primary) => {
    const arr = Array.isArray(list) ? list : [];
    const clipId = arr[0]?.clipId ?? primary?.clipId ?? null;
    const { clip } = clipId ? findClipById(sceneRef.current, clipId) : { clip: null };
    const stamp = (s) => (clip && s ? selKeyWithKid(clip, s) : s);
    const stamped = arr.map(stamp);
    setSelectedKeys(stamped);
    setSelectedKey(primary ? stamp(primary) : (stamped.length ? stamped[stamped.length - 1] : null));
  }, []);

  // Keep the multi-selection cleared whenever the primary key clears (covers
  // every setSelectedKey(null) reset site without touching each one).
  useEffect(() => {
    if (!selectedKey) setSelectedKeys((prev) => (prev.length ? [] : prev));
  }, [selectedKey]);

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
                const baseV = baseChannelValue(name, baseT);
                const nextSub = insertCompKeyWithStartRamp(sub, localT, compVal, baseV?.[comp], { tm: defaultEaseRef.current });
                ch = { ...ch, split: true, perComp: { ...(ch.perComp || {}), [comp]: nextSub } };
              } else if (ch?.split) {
                // Whole-channel key on an already-split channel: key every comp.
                const comps = layout === 'vec2' ? ['x', 'y'] : layout === 'rgb' ? ['r', 'g', 'b'] : [];
                const full = currentValue(name, ch);
                const baseV = baseChannelValue(name, baseT);
                const nextPerComp = { ...(ch.perComp || {}) };
                for (const cc of comps) {
                  const sub = nextPerComp[cc] || { keys: [] };
                  nextPerComp[cc] = insertCompKeyWithStartRamp(sub, localT, Number(full?.[cc] ?? 0), baseV?.[cc], { tm: defaultEaseRef.current });
                }
                ch = { ...ch, perComp: nextPerComp };
              } else {
                // Linked write.
                const v = currentValue(name, ch);
                ch = insertKeyWithStartRamp(ch || { keys: [] }, localT, v, baseChannelValue(name, baseT), { tm: defaultEaseRef.current });
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

  /**
   * Move or scale a marquee selection of keyframes within one clip.
   *
   * `snapshotClip` is the clip captured at drag-start (so repeated calls during
   * a drag are idempotent). `selected` is [{ name, comp, idx }] (clipId implied).
   * `transform` is { kind:'move', delta } or { kind:'scale', pivot, factor } in
   * clip-local seconds. Selected keys that map past the clip's range expand the
   * clip's start/duration into the free space beside it (`transformClipKeys`).
   */
  const handleTransformKeys = useCallback((snapshotClip, selected, transform) => {
    if (!snapshotClip || !selected?.length) return;
    const clipId = snapshotClip.id;
    const sceneNow = sceneRef.current;
    const rawDur = Number(sceneNow.stage?.duration);
    const sceneDur = Number.isFinite(rawDur) ? Math.max(0.01, Math.min(300, rawDur)) : 5;
    let trackId = null;
    let siblings = [];
    for (const tr of sceneNow.flow?.tracks || []) {
      if (tr.clips?.some((c) => c.id === clipId)) {
        trackId = tr.id;
        siblings = tr.clips.filter((c) => c.id !== clipId);
        break;
      }
    }
    if (!trackId) return;
    // Free space to grow into on each side (to neighbouring clip / timeline edge).
    const start = snapshotClip.start;
    const end = snapshotClip.start + snapshotClip.duration;
    let leftRoom = start;
    let rightRoom = sceneDur - end;
    for (const sib of siblings) {
      const sEnd = sib.start + sib.duration;
      if (sEnd <= start) leftRoom = Math.min(leftRoom, start - sEnd);
      else if (sib.start >= end) rightRoom = Math.min(rightRoom, sib.start - end);
    }
    const mapT = transform.kind === 'scale'
      ? (t) => transform.pivot + (t - transform.pivot) * transform.factor
      : (t) => t + transform.delta;
    const next = transformClipKeys(snapshotClip, selected, mapT, { leftRoom, rightRoom });
    if (!next) return;
    setScene((prev) => {
      const tracks = (prev.flow?.tracks || []).map((tr) => {
        if (tr.id !== trackId) return tr;
        return {
          ...tr,
          clips: tr.clips.map((c) =>
            c.id === clipId
              ? { ...c, start: next.start, duration: next.duration, channels: next.channels, autoFitDuration: false }
              : c
          )
        };
      });
      return { ...prev, flow: deriveFlowGraph({ ...(prev.flow || {}), tracks }) };
    });
  }, [setScene]);

  /** Shift the selected key by `dir` frames (±1). Clamps to clip bounds. */
  const handleMoveKeyByFrame = useCallback((dir) => {
    const sel = selectedKeyRef.current;
    if (!sel) return;
    const fps = sceneRef.current.stage?.fps || 60;
    const dt = dir / fps;
    const { clip } = findClipById(sceneRef.current, sel.clipId);
    if (!clip) return;
    const idx = resolveSelIdx(clip, sel);
    if (idx < 0) return;
    const keys = channelKeyList(clip.channels, sel.name, sel.comp);
    const keyT = keys?.[idx]?.t;
    if (typeof keyT !== 'number') return;
    const newT = Math.max(0, Math.min(clip.duration, keyT + dt));
    handleMoveKey(sel.clipId, sel.name, idx, sel.comp, newT);
  }, [handleMoveKey]);

  /** Delete every selected keyframe (whole marquee selection). */
  const handleDeleteSelectedKeys = useCallback(() => {
    const sel = selectedKeysRef.current;
    if (!sel?.length) return false;
    // clipId → ('name|comp' → Set(kid)) — delete by stable kid, not index.
    const byClip = new Map();
    for (const s of sel) {
      if (s.kid == null) continue;
      if (!byClip.has(s.clipId)) byClip.set(s.clipId, new Map());
      const byList = byClip.get(s.clipId);
      const lk = `${s.name}|${s.comp || ''}`;
      if (!byList.has(lk)) byList.set(lk, new Set());
      byList.get(lk).add(s.kid);
    }
    if (!byClip.size) return false;
    setScene((prev) => {
      const tracks = (prev.flow?.tracks || []).map((tr) => ({
        ...tr,
        clips: tr.clips.map((c) => {
          const byList = byClip.get(c.id);
          if (!byList) return c;
          const channels = { ...(c.channels || {}) };
          for (const [lk, kidSet] of byList) {
            if (!kidSet.size) continue;
            const [name, comp] = lk.split('|');
            const ch = channels[name];
            if (!ch) continue;
            if (comp && ch.split) {
              const sub = ch.perComp?.[comp];
              if (!sub?.keys) continue;
              const keys = sub.keys.filter((k) => !kidSet.has(k.kid));
              const perComp = { ...ch.perComp };
              if (keys.length) perComp[comp] = { ...sub, keys };
              else delete perComp[comp];
              if (Object.keys(perComp).length) channels[name] = { ...ch, perComp };
              else delete channels[name];
            } else if (Array.isArray(ch.keys)) {
              const keys = ch.keys.filter((k) => !kidSet.has(k.kid));
              if (keys.length) channels[name] = { ...ch, keys };
              else delete channels[name];
            }
          }
          return { ...c, channels: Object.keys(channels).length ? channels : null };
        })
      }));
      return { ...prev, flow: deriveFlowGraph({ ...(prev.flow || {}), tracks }) };
    });
    setSelectedKey(null);
    setSelectedKeys([]);
    return true;
  }, [setScene]);

  /** Copy the selected keyframe sequence (relative timing) to the clipboard. */
  const handleCopySelectedKeys = useCallback(() => {
    const sel = selectedKeysRef.current;
    if (!sel?.length) return false;
    const clipId = sel[0].clipId;
    let clip = null;
    for (const tr of sceneRef.current.flow?.tracks || []) {
      const c = tr.clips?.find((cl) => cl.id === clipId);
      if (c) { clip = c; break; }
    }
    if (!clip) return false;
    const items = [];
    for (const s of sel) {
      const keys = channelKeyList(clip.channels, s.name, s.comp);
      let k = null;
      if (s.kid != null) k = keys?.find((kk) => kk.kid === s.kid);
      if (!k) k = keys?.[s.idx];
      if (!k) continue;
      items.push({ name: s.name, comp: s.comp ?? null, t: k.t,
        key: { v: k.v, out: k.out, tm: k.tm, ti: k.ti, to: k.to } });
    }
    if (!items.length) return false;
    const minT = Math.min(...items.map((i) => i.t));
    setClipboard({ kind: 'keys', items: items.map((i) => ({ name: i.name, comp: i.comp, dt: i.t - minT, key: i.key })) });
    return true;
  }, []);

  /** Paste a copied keyframe sequence onto the selected clip at the playhead. */
  const handlePasteKeys = useCallback(() => {
    const cb = clipboardRef.current;
    if (cb?.kind !== 'keys') return false;
    const clipId = selectedClipIdRef.current;
    if (!clipId) return false;
    let targetTrackId = null;
    let targetClip = null;
    for (const tr of sceneRef.current.flow?.tracks || []) {
      const c = tr.clips?.find((cl) => cl.id === clipId);
      if (c) { targetClip = c; targetTrackId = tr.id; break; }
    }
    if (!targetClip) return false;
    const baseT = clipLocalSeconds(targetClip, flowRef.current.time, { clampPastEnd: true });
    setScene((prev) => {
      const tracks = (prev.flow?.tracks || []).map((tr) => {
        if (tr.id !== targetTrackId) return tr;
        return {
          ...tr,
          clips: tr.clips.map((c) => {
            if (c.id !== clipId) return c;
            const channels = { ...(c.channels || {}) };
            for (const it of cb.items) {
              const tT = Math.max(0, Math.min(c.duration, baseT + it.dt));
              const opts = { out: it.key.out || 'linear', tm: it.key.tm || defaultEaseRef.current };
              if (it.comp) {
                let ch = channels[it.name];
                if (!ch) ch = { split: true, perComp: {} };
                else if (!ch.split) ch = splitChannel(ch, it.name);
                const sub = ch.perComp?.[it.comp] || { keys: [] };
                const nextSub = insertOrUpdateKey(sub, tT, it.key.v, opts);
                channels[it.name] = { ...ch, split: true, perComp: { ...(ch.perComp || {}), [it.comp]: nextSub } };
              } else {
                const existing = channels[it.name] || { keys: [] };
                channels[it.name] = insertOrUpdateKey(existing, tT, it.key.v, opts);
              }
            }
            return { ...c, channels };
          })
        };
      });
      return { ...prev, flow: deriveFlowGraph({ ...(prev.flow || {}), tracks }) };
    });
    return true;
  }, [setScene]);

  /** Copy the selected clip(s) (relative timing + track) to the clipboard. */
  const handleCopySelectedClips = useCallback(() => {
    const ids = selectedClipIdsRef.current;
    if (!ids?.length) return false;
    const idSet = new Set(ids);
    const items = [];
    for (const tr of sceneRef.current.flow?.tracks || []) {
      for (const c of tr.clips || []) {
        if (idSet.has(c.id)) items.push({ trackId: tr.id, start: c.start, clip: c });
      }
    }
    if (!items.length) return false;
    const minStart = Math.min(...items.map((i) => i.start));
    const clone = (c) => { const { id, ...rest } = c; return JSON.parse(JSON.stringify(rest)); };
    setClipboard({ kind: 'clips', items: items.map((i) => ({ trackId: i.trackId, dt: i.start - minStart, clip: clone(i.clip) })) });
    return true;
  }, []);

  /** Paste copied clip(s) at the playhead, onto their original tracks. */
  const handlePasteClips = useCallback(() => {
    const cb = clipboardRef.current;
    if (cb?.kind !== 'clips') return false;
    const baseStart = flowRef.current.time;
    const rawDur = Number(sceneRef.current.stage?.duration);
    const sceneDur = Number.isFinite(rawDur) ? Math.max(0.01, Math.min(300, rawDur)) : 5;
    const newIds = [];
    setScene((prev) => {
      const tracks = prev.flow?.tracks || [];
      const tracksById = new Map(tracks.map((t) => [t.id, t]));
      const additions = new Map(); // trackId → clip[]
      for (const it of cb.items) {
        const tr = tracksById.get(it.trackId);
        if (!tr) continue; // track removed since copy
        const dur = Math.max(0.05, Number(it.clip.duration) || 1);
        const startT = Math.max(0, Math.min(sceneDur - 0.05, baseStart + it.dt));
        const existing = [...(tr.clips || []), ...(additions.get(it.trackId) || [])];
        const slot = findFreeSlotIn(existing, startT, dur, sceneDur);
        if (!slot) continue;
        const nid = uid('C');
        newIds.push(nid);
        const nc = { ...it.clip, id: nid, start: slot.start, duration: slot.duration };
        if (!additions.has(it.trackId)) additions.set(it.trackId, []);
        additions.get(it.trackId).push(nc);
      }
      const nextTracks = tracks.map((tr) => {
        const add = additions.get(tr.id);
        if (!add) return tr;
        return { ...tr, clips: [...(tr.clips || []), ...add].sort((a, b) => a.start - b.start) };
      });
      return { ...prev, flow: deriveFlowGraph({ ...(prev.flow || {}), tracks: nextTracks }) };
    });
    if (newIds.length) { setSelectedClipIds(newIds); setSelectedClipId(newIds[newIds.length - 1]); }
    return newIds.length > 0;
  }, [setScene]);

  // Copy / paste / delete routed by what's selected: keyframes win over clips.
  const handleCopySelection = useCallback(() => {
    if (selectedKeysRef.current?.length) return handleCopySelectedKeys();
    if (selectedClipIdsRef.current?.length) return handleCopySelectedClips();
    return false;
  }, [handleCopySelectedKeys, handleCopySelectedClips]);

  const handlePasteSelection = useCallback(() => {
    return handlePasteKeys() || handlePasteClips();
  }, [handlePasteKeys, handlePasteClips]);

  /** Duplicate the selection in place at the playhead (Ctrl+D). */
  const handleDuplicateSelection = useCallback(() => {
    if (!handleCopySelection()) return false;
    return handlePasteSelection();
  }, [handleCopySelection, handlePasteSelection]);

  // Keep selectedKey's cached idx in sync with its stable kid (keys re-sort on
  // move / paste), and drop it if its clip / channel / key no longer exist.
  useEffect(() => {
    if (!selectedKey) return;
    const { clip } = findClipById(scene, selectedKey.clipId);
    if (!clip) { setSelectedKey(null); return; }
    const idx = resolveSelIdx(clip, selectedKey);
    if (idx < 0) { setSelectedKey(null); return; }
    if (idx !== selectedKey.idx) setSelectedKey((p) => (p ? { ...p, idx } : p));
  }, [scene, selectedKey]);

  // Re-derive every selected keyframe's idx from its kid after any scene change
  // (the post-sort re-derivation that keeps the live selection pointing at the
  // right keys), and prune any whose key no longer exists (delete / undo).
  useEffect(() => {
    if (!selectedKeys.length) return;
    let changed = false;
    const next = [];
    for (const s of selectedKeys) {
      const { clip } = findClipById(scene, s.clipId);
      if (!clip) { changed = true; continue; }
      const idx = resolveSelIdx(clip, s);
      if (idx < 0) { changed = true; continue; }
      if (idx !== s.idx) { changed = true; next.push({ ...s, idx }); }
      else next.push(s);
    }
    if (changed) setSelectedKeys(next);
  }, [scene, selectedKeys]);

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
        if (handleDuplicateSelection()) e.preventDefault();
        return;
      }
      if (meta && e.key.toLowerCase() === 'c') {
        if (handleCopySelection()) e.preventDefault();
        return;
      }
      if (meta && e.key.toLowerCase() === 'v') {
        if (handlePasteSelection()) e.preventDefault();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        // Priority: selected keyframe(s) win; otherwise delete selected clip(s).
        if (handleDeleteSelectedKeys()) { e.preventDefault(); return; }
        if (handleDeleteSelectedClips()) { e.preventDefault(); return; }
        return;
      }
      // Space = play / pause toggle for whatever transport owns the viewport:
      // wizard preview → direct scenario playhead → animate flow. Setup mode is
      // a deliberate no-op (it used to toggle the HIDDEN animate flow).
      if (e.key === ' ') {
        e.preventDefault();
        if (wizardActiveRef.current) {
          wizardPreviewControlsRef.current?.togglePlay?.();
          return;
        }
        if (studioModeRef.current === 'direct') {
          handleScenarioTransport(scenarioPlayheadRef.current.playing ? 'pause' : 'play');
          return;
        }
        if (studioModeRef.current === 'animate') {
          setFlowState((prev) => prev.playing ? flowPause(prev) : flowPlay(prev));
        }
        return;
      }
      // Arrow keys = stop playback + step one frame (animate mode only — in
      // other modes they'd invisibly step the hidden animate flow)
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        if (wizardActiveRef.current || studioModeRef.current !== 'animate') return;
        e.preventDefault();
        const dir = e.key === 'ArrowLeft' ? -1 : 1;
        const fps = sceneRef.current.stage?.fps || 60;
        setFlowState((prev) => {
          const stopped = flowPause(prev);
          const next = Math.max(0, Math.min(sceneRef.current.stage?.duration ?? 5, prev.time + dir / fps));
          return flowSeek(sceneRef.current, stopped, next);
        });
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, handleDuplicateSelection, handleCopySelection, handlePasteSelection, handleDeleteSelectedKeys, handleDeleteSelectedClips, handleScenarioTransport]);

  /**
   * Selecting a layer (via hierarchy, viewport click, or timeline label)
   * keeps the current clip selection if the clip already lives on the
   * newly-selected layer. This is what makes "click sprite on stage,
   * then edit transform → auto-key" work — clicking the sprite shouldn't
   * un-arm recording.
   */
  const handleSelectLayer = useCallback((layerId) => {
    setSelectedLayerId(layerId);
    setSelectedLayerIds(layerId ? [layerId] : []);
    setSelectedClipId((curClipId) => {
      if (!curClipId) { setSelectedClipIds([]); return null; }
      const tracks = sceneRef.current.flow?.tracks || [];
      for (const tr of tracks) {
        if (tr.clips?.some((c) => c.id === curClipId)) {
          if (tr.layerId !== layerId) {
            setSelectedKey(null);
            setSelectedClipIds([]);
            return null;
          }
          return curClipId;
        }
      }
      setSelectedKey(null);
      setSelectedClipIds([]);
      return null;
    });
  }, []);

  /**
   * Multi-select entrypoint for the hierarchy (ctrl/shift-click). `ids` is the
   * full selected set; `primaryId` is the last-clicked layer that drives the
   * inspector/viewport + clip sync (same rules as single-select).
   */
  const handleSelectLayers = useCallback((ids, primaryId) => {
    const list = Array.isArray(ids) ? ids.filter(Boolean) : [];
    const primary = primaryId ?? (list.length ? list[list.length - 1] : null);
    setSelectedLayerIds(list);
    setSelectedLayerId(primary);
    setSelectedClipId((curClipId) => {
      if (!curClipId) { setSelectedClipIds([]); return null; }
      const tracks = sceneRef.current.flow?.tracks || [];
      for (const tr of tracks) {
        if (tr.clips?.some((c) => c.id === curClipId)) {
          if (tr.layerId !== primary) { setSelectedKey(null); setSelectedClipIds([]); return null; }
          return curClipId;
        }
      }
      setSelectedKey(null);
      setSelectedClipIds([]);
      return null;
    });
  }, []);

  const handleSave = useCallback(async () => {
    setBusy(true);
    try {
      // Commit the live flow into the active timeline, fold the working scene
      // back into the project, then persist the whole project.
      const synced = syncFlowToActiveTimeline(sceneRef.current);
      const projToSave = foldSceneIntoProject(projectRef.current, synced);
      const result = await saveProject(projToSave, rootHandle);
      log(
        result.mode === 'scaffold'
          ? `Scene Studio: saved to ${rootHandle.name}/${result.path}`
          : 'Scene Studio: project.json downloaded',
        'ok'
      );
    } catch (e) {
      log(`Scene Studio save failed: ${e.message || e}`, 'err');
    } finally {
      setBusy(false);
    }
  }, [rootHandle, log]);

  // Commit project.json straight to the repo branch. Only reachable when the
  // workspace is a repo handle whose token has write access (canCommit gate).
  const handleCommit = useCallback(async () => {
    const meta = rootHandle?.repoMeta;
    if (!meta || meta.kind !== 'repo' || !meta.repo?.canWrite) return;
    setBusy(true);
    try {
      let token = '';
      try { token = JSON.parse(localStorage.getItem(LS_KEY) || '{}').token || ''; } catch { /* none */ }
      if (!token) throw new Error('no repo token available — reconnect the workspace');
      const synced = syncFlowToActiveTimeline(sceneRef.current);
      const projToSave = foldSceneIntoProject(projectRef.current, synced);
      const { text, baseRel } = serializeProject(projToSave);
      const repoPath = [meta.subPath, baseRel, 'project.json'].filter(Boolean).join('/');
      const result = await commitFile(
        meta.provider, token, meta.baseUrl, meta.repo, repoPath, text,
        `Update ${projToSave.name || 'project'} (Scene Studio)`
      );
      log(`Scene Studio: committed ${result.path}@${result.branch}`, 'ok');
    } catch (e) {
      log(`Scene Studio commit failed: ${e.message || e}`, 'err');
    } finally {
      setBusy(false);
    }
  }, [rootHandle, log]);

  const handleLoad = useCallback(async () => {
    setBusy(true);
    try {
      const loaded = await loadProjectFromFile();
      if (!loaded) return;
      replaceProjectNoHistory(loaded);
      resetEditorStateForScene();
      setAssetDescriptors({});
      log('Scene Studio: project loaded', 'ok');
    } catch (e) {
      log(`Scene Studio load failed: ${e.message || e}`, 'err');
    } finally {
      setBusy(false);
    }
  }, [log, replaceProjectNoHistory, resetEditorStateForScene]);

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
      setAlpha: (id, alpha) => handlePatchTransform(id, { alpha: Math.max(0, Math.min(1, alpha)) }),
      setVisibility: (id, visible) => {
        // Back-compat shim: visibility is alpha now. Only toggle if the current
        // shown/hidden state disagrees with the requested one.
        const shown = alphaForLayer(id) > 0.0001;
        if (shown !== !!visible) handleToggleVisibility(id);
      },
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
      selectKey: (clipId, name, idx) => handleSelectKey({ clipId, name, idx }),
      deleteSelectedKey: () => handleDeleteSelectedKeys(),
      duplicateSelectedKey: () => handleDuplicateSelection(),
      copySelectedKey: () => handleCopySelection(),
      pasteKey: () => handlePasteSelection()
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
      {/* Session restore banner — shown once on mount if IDB has a saved scene */}
      {sessionDraft && (
        <div className="scene-session-banner">
          {sessionDraft.schemaVersion === PROJECT_SCHEMA ? (
            <>
              <span className="scene-session-banner__text">
                Previous session: <strong>{sessionDraft.project?.name || 'Untitled'}</strong>
                {' '}({sessionLayerCount(sessionDraft.project)} layer{sessionLayerCount(sessionDraft.project) !== 1 ? 's' : ''}
                {sessionDraft.savedAt ? `, ${new Date(sessionDraft.savedAt).toLocaleString()}` : ''})
              </span>
              <button className="scene-btn scene-btn--primary scene-btn--sm" onClick={handleRestoreSession}>
                Restore
              </button>
              <button className="scene-btn scene-btn--sm" onClick={handleDismissSession}>
                Discard
              </button>
            </>
          ) : (
            <>
              <span className="scene-session-banner__text">
                Saved session is from a different version ({sessionDraft.schemaVersion}).
              </span>
              <button className="scene-btn scene-btn--sm" onClick={handleDownloadOldSession}>
                Download copy
              </button>
              <button className="scene-btn scene-btn--ghost scene-btn--sm" onClick={handleDismissSession}>
                Discard
              </button>
            </>
          )}
        </div>
      )}

      {/* Missing-asset banner — folder structure changed since the project was
          saved and auto-relink couldn't match some assets by name. */}
      {unresolvedAssets.length > 0 && !relinkBannerDismissed && (
        <div className="scene-session-banner" style={{ borderColor: 'var(--warn, #e0b34a)' }}>
          <span className="scene-session-banner__text">
            ⚠ {unresolvedAssets.length} asset{unresolvedAssets.length !== 1 ? 's' : ''} in this project
            {' '}could not be located in the current workspace.
          </span>
          <button className="scene-btn scene-btn--primary scene-btn--sm" onClick={() => setShowRelinkDialog(true)}>
            Relink…
          </button>
          <button className="scene-btn scene-btn--ghost scene-btn--sm" onClick={() => setRelinkBannerDismissed(true)}>
            Dismiss
          </button>
        </div>
      )}

      {showRelinkDialog && (
        <RelinkAssetsDialog
          assets={unresolvedAssets}
          scanItems={assetItems}
          onApply={handleApplyRelink}
          onClose={() => setShowRelinkDialog(false)}
        />
      )}

      {/* New project confirm dialog */}
      {newProjectPending && (
        <div className="scene-confirm-overlay">
          <div className="scene-confirm-card">
            <div className="scene-confirm-title">Nowy projekt</div>
            <div className="scene-confirm-body">Zapisać obecną scenę przed zamknięciem?</div>
            <div className="scene-confirm-actions">
              <button
                className="scene-btn scene-btn--primary"
                onClick={async () => { await handleSave(); handleConfirmNewProject(); }}
                disabled={busy}
              >
                Zapisz i nowy
              </button>
              <button className="scene-btn" onClick={handleConfirmNewProject}>
                Odrzuć zmiany
              </button>
              <button className="scene-btn scene-btn--ghost" onClick={() => setNewProjectPending(false)}>
                Anuluj
              </button>
            </div>
          </div>
        </div>
      )}

      <StudioToolbar
        scene={scene}
        onRename={handleRename}
        onSave={handleSave}
        onLoad={handleLoad}
        canCommit={!!rootHandle?.repoMeta?.repo?.canWrite}
        onCommit={handleCommit}
        onNewProject={handleNewProject}
        projectScenes={project.scenes}
        activeSceneId={project.activeSceneId}
        onSelectScene={handleSelectScene}
        onNewScene={handleNewSceneRequest}
        onNewVariant={handleNewVariant}
        onToggleOrientation={handleToggleOrientation}
        overlayMode={overlayMode}
        onSetOverlayMode={setOverlayMode}
        defaultEase={defaultEase}
        onSetDefaultEase={setDefaultEase}
        studioMode={studioMode}
        onSetStudioMode={handleSetStudioMode}
        easyMode={easyMode}
        busy={busy}
        onUndo={undo}
        onRedo={redo}
        canUndo={historyDepth.undo > 0}
        canRedo={historyDepth.redo > 0}
        onUnityExport={() => setShowUnityExport(true)}
        onWebMExport={() => setShowWebMExport(true)}
        onPngExport={handlePngExport}
      />

      {/* Wizards render embedded in the bottom-center slot (full-focus) — see
          the center stack below — not as modal overlays. */}

      {showUnityExport && (
        <UnityExportDialog
          scene={scene}
          rootHandle={rootHandle}
          sceneBasePath={scene.projectRoot || null}
          onClose={() => setShowUnityExport(false)}
          log={log}
        />
      )}

      {showWebMExport && (
        <WebMExportDialog
          scene={scene}
          viewportRef={pixiViewportRef}
          sources={videoExportSources}
          makeFrameProvider={makeVideoFrameProvider}
          onClose={() => setShowWebMExport(false)}
          log={log}
        />
      )}

      <div
        className={'scene-studio-body' + (!rootHandle ? ' scene-studio-body--locked' : '')}
        style={{ gridTemplateColumns: wizardActive ? `1fr ${wizardW}px` : `${leftW}px 1fr ${rightW}px` }}
      >
        {/* T8: the wizard panel resizes like every other panel — was the one
            fixed-width exception (WIZARD_PANEL_W) with no drag handle. */}
        {wizardActive && (
          <div
            className="scene-resize-handle scene-resize-handle--col"
            style={{ right: wizardW, marginRight: -4 }}
            title="Drag to resize the wizard panel"
            onPointerDown={(e) => beginPanelResize(e, {
              axis: 'x', base: wizardW, min: PANEL_SIZES.wizard.min, max: PANEL_SIZES.wizard.max, sign: -1, set: setWizardW
            })}
          />
        )}
        {/* Side-panel resize handles — hidden in full-focus wizard mode. */}
        {!wizardActive && (
          <div
            className="scene-resize-handle scene-resize-handle--col"
            style={{ left: leftW, marginLeft: -4 }}
            title="Drag to resize the hierarchy / workspace panel"
            onPointerDown={(e) => beginPanelResize(e, {
              axis: 'x', base: leftW, min: PANEL_SIZES.left.min, max: PANEL_SIZES.left.max, sign: 1, set: setLeftW
            })}
          />
        )}
        {!wizardActive && (
          <div
            className="scene-resize-handle scene-resize-handle--col"
            style={{ right: rightW, marginRight: -4 }}
            title="Drag to resize the inspector panel"
            onPointerDown={(e) => beginPanelResize(e, {
              axis: 'x', base: rightW, min: PANEL_SIZES.right.min, max: PANEL_SIZES.right.max, sign: -1, set: setRightW
            })}
          />
        )}
        {!wizardActive && (
        <div className="scene-left-stack">
          {studioMode === 'direct' ? (
            <ScenarioTimelineList
              timelines={projectTimelines}
              activeScenario={activeScenario}
              onJumpToTimeline={handleJumpToTimelineInAnimate}
              onAddNode={handleAddTimelineNodeChained}
            />
          ) : (
            <>
              <HierarchyPanel
                scene={scene}
                selectedLayerId={selectedLayerId}
                selectedLayerIds={selectedLayerIds}
                onSelect={handleSelectLayer}
                onSelectMany={handleSelectLayers}
                onToggleVisibility={handleToggleVisibility}
                alphaForLayer={alphaForLayer}
                flowTime={flowState.time}
                studioMode={studioMode}
                onRemove={handleRemoveLayer}
                onReorder={handleReorder}
                onRenameScene={handleRename}
              />
              <AssetBrowserPanel
                items={assetItems}
                onAddItem={addAssetItemFromBrowser}
                hasRoot={!!rootHandle}
                rootHandle={rootHandle}
                onPickRoot={handlePickRoot}
                onPickFolderFallback={handlePickFolderFallback}
                onRefreshAssets={handleRefreshAssets}
                canRefreshAssets={!!rootHandle}
                onClearRoot={handleClearRoot}
                busy={busy}
                pickError={pickError}
                onDismissPickError={() => setPickError(null)}
              />
            </>
          )}
        </div>
        )}

        <div
          ref={centerStackRef}
          className={'scene-center-stack'
            + ((!wizardActive && studioMode !== 'setup') ? '' : ' scene-center-stack--no-timeline')
            + ((!wizardActive && studioMode === 'setup') ? ' scene-center-stack--toolkit' : '')}
          style={(!wizardActive && studioMode !== 'setup') ? { gridTemplateRows: `1fr ${timelineH}px` } : undefined}
        >
          {(!wizardActive && studioMode !== 'setup') && (
            <div
              className="scene-resize-handle scene-resize-handle--row"
              style={{ bottom: timelineH, marginBottom: -4 }}
              title="Drag to resize the panel height"
              onPointerDown={(e) => beginPanelResize(e, {
                axis: 'y',
                base: timelineH,
                min: PANEL_SIZES.timeline.min,
                max: Math.max(PANEL_SIZES.timeline.min, Math.min(PANEL_SIZES.timeline.max, (centerStackRef.current?.clientHeight || 600) - 160)),
                sign: -1,
                set: setTimelineH
              })}
            />
          )}
          <div ref={dropRef} className="scene-viewport-wrap">
            <button
              className={'scene-fullscreen-btn scene-gizmo-toggle-btn' + (showGizmo ? '' : ' is-off')}
              onClick={() => setShowGizmo((v) => !v)}
              title={showGizmo ? 'Hide gizmo (pivot cross + transform handles)' : 'Show gizmo'}
              aria-label={showGizmo ? 'Hide gizmo' : 'Show gizmo'}
            >
              {showGizmo ? '✥' : '⊘'}
            </button>
            <button
              className="scene-fullscreen-btn"
              onClick={toggleFullscreen}
              title={isFullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen the scene view'}
              aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen scene view'}
            >
              {isFullscreen ? '🗗' : '⛶'}
            </button>
            <PixiErrorBoundary>
              <PixiViewport
                ref={pixiViewportRef}
                scene={wizardActive
                  ? (wizardPreviewScene || blankPreviewScene)
                  : (studioMode === 'direct' && directPreview ? directPreview.scene : sceneWithRuntime)}
                rootHandle={rootHandle}
                selectedLayerId={(wizardActive || studioMode === 'direct') ? null : selectedLayerId}
                selectedClip={(wizardActive || studioMode === 'direct') ? null : selectedClipContext}
                onSelectLayer={wizardActive ? undefined : handleSelectLayer}
                onTransformLayer={handleTransformLayer}
                onAssetReady={handleAssetReady}
                onSpinnerAnimDurations={handleSpinnerAnimDurations}
                flowTime={wizardActive
                  ? wizardPreviewTime
                  : (studioMode === 'direct' && directPreview ? directPreview.flowTime : flowState.time)}
                livePreview={livePreview}
                overlayMode={overlayMode}
                refreshNonce={refreshNonce}
                studioMode={wizardActive ? 'animate' : studioMode}
                onViewportClick={() => handleFlowAction('clickResume')}
                onSeekToKey={(t) => handleFlowAction('seek', t)}
                onPathEdit={handlePathEdit}
                onDiag={sceneDebug ? ((msg) => { console.log('[SceneStudio]', msg); log(msg, 'info'); }) : null}
                showGizmo={showGizmo}
              />
            </PixiErrorBoundary>
            {!wizardActive && scene.layers.length === 0 && (
              <div className="scene-viewport-empty">
                <div className="scene-viewport-empty-icon">🎬</div>
                <div>drop PNG / video / Spine files here</div>
                <div className="scene-viewport-empty-hint">or use assets panel from selected project root</div>
              </div>
            )}
          </div>

          {/* Toolkit — creation bar at the BOTTOM (where the timeline sits in
              animate), setup-only. Taller row with larger wizard buttons. */}
          {(!wizardActive && studioMode === 'setup') && (
            <div className="scene-toolkit-bar">
              <span className="scene-toolkit-bar-label">🧰 toolkit</span>
              <button
                className="scene-btn scene-toolkit-launch"
                onClick={handleAddSceneSetup}
                disabled={busy}
                title="Build a scene from base elements (background, machine frame, animation) + optional Free Spins / Bonus / Pick&Click"
              >🎬 Scene Setup</button>
              <button
                className="scene-btn scene-toolkit-launch"
                onClick={handleAddSpinner}
                disabled={busy}
                title="Add a Spinner (slot reel machine) object via the setup wizard"
              >🎰 Spinner</button>
              <button
                className="scene-btn scene-toolkit-launch"
                onClick={handleAddWinSeq}
                disabled={busy}
                title="Add a Win-Sequence object (chained win-tier animations) via the setup wizard"
              >🏆 Win Sequences</button>
              <button
                className="scene-btn scene-toolkit-launch"
                onClick={handleAddEmptyStatic}
                disabled={busy}
                title="Add an empty static object — a plain square you can scale, position and tint (colour)"
              >◻ Static</button>
              <button
                className="scene-btn scene-toolkit-launch"
                onClick={handleAddFolder}
                disabled={busy}
                title="Add an empty folder — a plain container you can parent other layers under (like the groups Scene Setup creates)"
              >📁 Folder</button>
              <span className="scene-toolkit-bar-hint">click / drop assets from the workspace to add statics</span>
            </div>
          )}

          {!wizardActive && studioMode === 'animate' && (
          <TimelinePanel
            scene={scene}
            flowState={flowState}
            timelines={scene.timelines || []}
            activeTimelineId={scene.activeTimelineId}
            onSelectTimeline={handleSelectTimeline}
            onAddTimeline={handleAddTimeline}
            onRenameTimeline={handleRenameTimeline}
            onRemoveTimeline={handleRemoveTimeline}
            selectedLayerId={selectedLayerId}
            selectedLayerAssetType={selectedLayerAssetType}
            selectedClipId={selectedClipId}
            selectedClipIds={selectedClipIds}
            selectedKey={selectedKey}
            selectedKeys={selectedKeys}
            assetDescriptors={assetDescriptors}
            autoKey={autoKey}
            onToggleAutoKey={() => setAutoKey((v) => !v)}
            onAddKeys={handleAddKeys}
            onSelectLayer={handleSelectLayer}
            onSelectClip={handleSelectClip}
            onSelectClips={handleSelectClips}
            onSelectKey={handleSelectKey}
            onSelectKeys={handleSelectKeys}
            onMoveKey={handleMoveKey}
            onTransformKeys={handleTransformKeys}
            onDeleteKey={handleDeleteSelectedKeys}
            onMoveKeyByFrame={handleMoveKeyByFrame}
            onPatchFlow={patchFlow}
            onFlowAction={handleFlowAction}
          />
          )}
          {!wizardActive && studioMode === 'direct' && (
          <ScenarioGraphPanel
            project={project}
            scenario={activeScenario}
            projectTimelines={projectTimelines}
            timeline={scenarioTimeline}
            time={scenarioPlayhead.time}
            playing={scenarioPlayhead.playing}
            focusRequest={graphFocus}
            onTransport={handleScenarioTransport}
            onScrub={handleScenarioScrub}
            selectedNodeId={selectedNodeId}
            selectedEdgeId={selectedEdgeId}
            onSelectScenario={handleSelectScenario}
            onAddScenario={handleAddScenario}
            onDuplicateScenario={handleDuplicateScenario}
            onRenameScenario={handleRenameScenario}
            onRemoveScenario={handleRemoveScenario}
            onAddTimelineNode={handleAddTimelineNode}
            onConnect={handleScenarioConnect}
            onDisconnect={handleScenarioDisconnect}
            onDeleteEdge={handleScenarioDeleteEdge}
            onSetActiveEdge={handleScenarioSetActiveEdge}
            onRemoveNode={handleScenarioRemoveNode}
            onMoveNode={handleScenarioMoveNode}
            onAddOutputPin={handleScenarioAddOutputPin}
            onRemoveOutputPin={handleScenarioRemoveOutputPin}
            onSetNodeLabel={handleScenarioSetNodeLabel}
            onSetView={handleScenarioSetView}
            onSelectNode={setSelectedNodeId}
            onSelectEdge={setSelectedEdgeId}
          />
          )}
          {/* Wizards render in the right-side column (see below), not here. */}
        </div>

        {wizardActive ? (
          <div className="scene-wizard-dock">
            {(showSpinnerWizard || editSpinnerTarget) && (
              <SpinnerWizard
                key={editSpinnerTarget ? `edit-${editSpinnerTarget.assetId}` : 'create'}
                embedded
                scene={scene}
                assetItems={assetItems}
                rootHandle={rootHandle}
                existingConfig={editSpinnerTarget?.config || null}
                existingName={editSpinnerTarget?.name || null}
                refreshNonce={refreshNonce}
                onPreviewScene={setWizardPreviewScene}
                onPreviewTime={setWizardPreviewTime}
                previewControlsRef={wizardPreviewControlsRef}
                onBakeSpinePose={(spineAsset, animName, loop, skin, sigma, feather, atFraction) =>
                  pixiViewportRef.current?.bakeSpinePosePng(spineAsset, animName, loop, skin, sigma, feather, atFraction ?? 0, sceneRef.current?.projectRoot || null)}
                onRenderSpinePose={handleRenderSpinePose}
                onClose={() => { setShowSpinnerWizard(false); setEditSpinnerTarget(null); }}
                onCreate={
                  editSpinnerTarget
                    ? (payload) => handleUpdateSpinner(editSpinnerTarget, payload)
                    : handleCreateSpinner
                }
              />
            )}
            {(showWinSeqWizard || editWinSeqTarget) && (
              <WinSequenceWizard
                key={editWinSeqTarget ? `edit-${editWinSeqTarget.assetId}` : 'create'}
                embedded
                scene={scene}
                assetItems={assetItems}
                rootHandle={rootHandle}
                existingConfig={editWinSeqTarget?.config || null}
                existingName={editWinSeqTarget?.name || null}
                existingSkeleton={editWinSeqTarget?.skeleton || null}
                initialStep={editWinSeqTarget?.initialStep || null}
                onPreviewScene={setWizardPreviewScene}
                onPreviewTime={setWizardPreviewTime}
                previewControlsRef={wizardPreviewControlsRef}
                onClose={() => { setShowWinSeqWizard(false); setEditWinSeqTarget(null); }}
                onCreate={
                  editWinSeqTarget
                    ? (payload) => handleUpdateWinSeq(editWinSeqTarget, payload)
                    : handleCreateWinSeq
                }
              />
            )}
            {showSceneSetupWizard && (
              <SceneSetupWizard
                key={editSceneSetupTarget ? `edit-${editSceneSetupTarget.layerId}` : 'create'}
                embedded
                scene={scene}
                assetItems={assetItems}
                existingConfig={editSceneSetupTarget?.config || null}
                onPreviewScene={setWizardPreviewScene}
                onClose={() => { setShowSceneSetupWizard(false); setEditSceneSetupTarget(null); }}
                onCreate={handleCreateSceneSetup}
              />
            )}
          </div>
        ) : studioMode === 'direct' ? (
          <ScenarioInspectorSections
            scenario={activeScenario}
            project={project}
            selectedNodeId={selectedNodeId}
            selectedEdgeId={selectedEdgeId}
            onSetNodeLabel={handleScenarioSetNodeLabel}
            onSetNodeEntry={handleScenarioSetNodeEntry}
            onAddOutputPin={handleScenarioAddOutputPin}
            onRemoveOutputPin={handleScenarioRemoveOutputPin}
            onRemoveNode={handleScenarioRemoveNode}
            onSetEdgeTransition={handleScenarioSetEdgeTransition}
            onDeleteEdge={handleScenarioDeleteEdge}
            onJumpToTimeline={handleJumpToTimelineInAnimate}
          />
        ) : (
          <InspectorPanel
            scene={scene}
            selectedLayerId={selectedLayerId}
            selectedClip={selectedClipContext}
            assetDescriptors={assetDescriptors}
            flowTime={flowState.time}
            selectedKey={selectedKey}
            onSelectKey={handleSelectKey}
            onDeleteKey={handleDeleteSelectedKeys}
            onMoveKeyByFrame={handleMoveKeyByFrame}
            onPatchLayer={handlePatchLayer}
            onPatchTransform={handlePatchTransform}
            onAddKeys={handleAddKeys}
            onResetPortrait={handleResetPortrait}
            onPatchFlow={patchFlow}
            onFlowAction={handleFlowAction}
            defaultTangentMode={defaultEase}
            onSwapAsset={handleSwapLayerAsset}
            onSwapAssetFromBrowserId={handleSwapLayerAssetFromBrowserId}
            onPatchAsset={handlePatchAsset}
            onEditSpinner={handleEditSpinner}
            onEditWinSeq={handleEditWinSeq}
            onEditSceneSetup={handleEditSceneSetup}
            onGenerateWinSeqTimelines={handleGenerateWinSeqTimelines}
            onGenerateSpinnerTimeline={handleGenerateSpinnerTimeline}
            wagerPreview={wagerPreview}
            onSetWagerPreview={setWagerPreview}
            studioMode={studioMode}
          />
        )}

        {/* No workspace linked: grey out the body and force a load from the
            centered gate (the body's children are non-interactive). */}
        {!rootHandle && (
          <WorkspaceLockOverlay
            onPickRoot={handlePickRoot}
            onPickFolderFallback={handlePickFolderFallback}
            onPickRepo={() => setShowRepoPicker(true)}
            busy={busy}
            pickError={pickError}
            onDismissPickError={() => setPickError(null)}
            rootDropHover={rootDropHover}
            onRootDragOver={handleRootDragOver}
            onRootDragLeave={handleRootDragLeave}
            onRootDrop={handleRootDrop}
          />
        )}
      </div>
      <RepoWorkspacePicker
        open={showRepoPicker}
        onClose={() => setShowRepoPicker(false)}
        onConfirm={handlePickRepoRoot}
      />
      {prefetch && (
        <div className="scene-confirm-overlay">
          <div className="scene-prefetch-card">
            <div className="scene-confirm-title">⬇ Downloading workspace assets</div>
            <div className="scene-prefetch-sub">
              {prefetch.repo} — {prefetch.done} / {prefetch.total}
            </div>
            <div className="scene-prefetch-bar">
              <div
                className="scene-prefetch-fill"
                style={{ width: `${prefetch.total ? Math.round((prefetch.done / prefetch.total) * 100) : 0}%` }}
              />
            </div>
            <div className="scene-prefetch-actions">
              <button className="scene-btn" onClick={handleSkipPrefetch}>
                Skip — load on demand
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
