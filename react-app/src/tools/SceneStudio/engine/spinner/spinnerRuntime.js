// engine/spinner/spinnerRuntime.js
//
// Pixi v8 renderer for the Spinner object — Phase 5, SPINNER.md §2/§4.
// Thin view over the pure evaluator: builds masked reel containers with a
// static + blurred sprite pair per visible cell, and on every frame maps
// evaluateSpinner(config, resolved, t) onto sprite positions, textures and
// alphas. NO timing or spin logic lives here.
//
// Dependencies (resolveAssetUrl, loadTexture, createSpineContainer) are
// injected by pixiApp.js so this module stays import-cycle-free and
// unit-mockable.
//
// Object shape (§B — single machine mask + native 1:1 symbols):
//   root Container            ← transform applied by rebuildScene like any layer
//     board Container         ← offset by −W/2,−H/2 so the root origin is centered
//       masked Container      ← ONE machine-sized mask (W×H) clips ALL reels;
//         reel[r] Container   ← x = r·(cellW+spacingX), NO per-reel mask
//           cell[j] Container ← j = −1…rows (one buffer row above and below)
//             staticSprite    ← native 1:1 (scale 1, overflows its cell)
//             blurSprite      ← alpha = blurMix crossfade
//     fx Container            ← land/win overlays — OUTSIDE the mask (overflow)

import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import { normalizeSpinnerConfig, SPINNER_ACTIONS } from './spinnerModel.js';
import { resolveSpinnerTrack, evaluateSpinner, spinnerResolveKey } from './spinnerEval.js';

// §B: symbols render at native 1:1 (a 220px symbol stays 220px, overflowing
// its cell). No fit-shrink — keep scale 1; the single machine mask clips the
// reel window, neighbours overlap freely.

function useSpineOverlay(spinePool, key, x, y, stateT) {
  const pool = spinePool.get(key);
  if (!pool || pool.nextFree >= pool.instances.length) return false;
  const inst = pool.instances[pool.nextFree++];
  inst.container.visible = true;
  inst.container.x = x;
  inst.container.y = y;
  inst.setTrackTime(stateT);
  return true;
}

/**
 * Build the Pixi object for a `spinner` asset.
 * @param {object} asset  scene asset with `.spinner` config
 * @param {object} layer  owning SceneLayer (unused today, kept for parity)
 * @param {object} deps   { scene, rootHandle, sceneBasePath, resolveAssetUrl, loadTexture, createSpineContainer }
 */
export async function buildSpinnerObject(asset, layer, deps) {
  const config = normalizeSpinnerConfig(asset.spinner);
  if (!config) return null;
  const { reels, rows, cellW, cellH, spacingX, spacingY } = config.grid;
  const pitchY = cellH + spacingY;
  const W = reels * cellW + (reels - 1) * spacingX;
  const H = rows * cellH + (rows - 1) * spacingY;

  // symbolId → { tex, blurTex } resolved through ordinary png scene assets.
  const textures = new Map();
  const findAsset = (id) => deps.scene.assets.find((a) => a.id === id) || null;
  const load = async (assetId) => {
    const a = assetId ? findAsset(assetId) : null;
    if (!a?.src) return null;
    const resolved = await deps.resolveAssetUrl(a.src, deps.rootHandle, deps.sceneBasePath);
    if (!resolved) return null;
    try { return await deps.loadTexture(resolved.url); } catch { return null; }
  };
  for (const sym of config.symbols) {
    const tex = await load(sym.assetId);
    const blurTex = await load(sym.blurAssetId);
    textures.set(sym.id, { tex: tex || Texture.WHITE, blurTex: blurTex || tex || Texture.WHITE });
  }

  const root = new Container();
  const board = new Container();
  board.label = 'spinner-board';
  board.x = -W / 2;
  board.y = -H / 2;
  root.addChild(board);

  // §B: ONE machine-sized mask wraps Statics + Blurs (the reels). The board
  // window still clips the scrolling top/bottom buffer rows and the machine's
  // left/right edges; symbols overflow into neighbouring cells inside it. Fx
  // (land/win overlays) is added to the root OUTSIDE this mask so anims extend
  // beyond their cell and even past the machine frame.
  const masked = new Container();
  masked.label = 'spinner-masked';
  const boardMask = new Graphics().rect(0, 0, W, H).fill(0xffffff);
  masked.addChild(boardMask);
  masked.mask = boardMask;
  board.addChild(masked);

  const reelViews = [];
  for (let r = 0; r < reels; r++) {
    const reelC = new Container();
    reelC.label = `reel-${r}`;
    reelC.x = r * (cellW + spacingX);

    const cells = [];
    for (let j = -1; j <= rows; j++) {
      const cellC = new Container();
      cellC.x = cellW / 2;
      const staticSprite = new Sprite(Texture.EMPTY);
      staticSprite.anchor.set(0.5);
      const blurSprite = new Sprite(Texture.EMPTY);
      blurSprite.anchor.set(0.5);
      blurSprite.alpha = 0;
      cellC.addChild(staticSprite, blurSprite);
      reelC.addChild(cellC);
      cells.push({ cellC, staticSprite, blurSprite, symbolId: null });
    }
    masked.addChild(reelC);
    reelViews.push({ reelC, cells });
  }

  const fx = new Container();
  fx.label = 'spinner-fx';
  root.addChild(fx);

  // Symbol lookup map for land/win anim dispatch in applySpinnerAtTime.
  const symbolMap = new Map(config.symbols.map((s) => [s.id, s]));

  // Spine overlay pool — pre-built containers for land/win Spine animations.
  // deps.createSpineContainer(assetId, animName, loop) → {container, setTrackTime(t), duration} | null
  const spinePool = new Map();
  const createSpine = deps.createSpineContainer || null;
  // Real per-symbol Spine durations (seconds), learned while building the pool.
  // Written into the LOCAL normalized config below (fixes the web preview with
  // no persistence) and surfaced to the host via deps.onSpinnerAnimDurations
  // (persists to the model so the inspector + Unity bake see real lengths).
  const animDur = new Map(); // `${specKey}` → duration
  if (createSpine) {
    const specs = new Map();
    for (const sym of config.symbols) {
      for (const animConf of [sym.landAnim, sym.winAnim]) {
        if (!animConf || animConf.kind !== 'spine') continue;
        const loop = animConf.loop !== false;
        const key = `${animConf.assetId}:${animConf.anim}:${loop ? '1' : '0'}`;
        if (!specs.has(key)) specs.set(key, { assetId: animConf.assetId, anim: animConf.anim, loop });
      }
    }
    const poolCount = Math.min(reels * rows, 12);
    for (const [key, spec] of specs) {
      const instances = [];
      let dur = 0;
      for (let i = 0; i < poolCount; i++) {
        const inst = await createSpine(spec.assetId, spec.anim, spec.loop);
        if (!inst) break;
        if (inst.duration > 0) dur = inst.duration;
        inst.container.visible = false;
        fx.addChild(inst.container);
        instances.push(inst);
      }
      if (instances.length) spinePool.set(key, { instances, nextFree: 0 });
      if (dur > 0) animDur.set(key, dur);
    }
    // Write resolved durations into the local config symbols, and collect the
    // per-symbol {win,land} map for the host to persist.
    const persist = {};
    for (const sym of config.symbols) {
      let win = 0, land = 0;
      const animKey = (a) => (a && a.kind === 'spine'
        ? `${a.assetId}:${a.anim}:${a.loop !== false ? '1' : '0'}` : null);
      const wk = animKey(sym.winAnim);
      const lk = animKey(sym.landAnim);
      if (wk && animDur.has(wk)) { win = animDur.get(wk); sym.winAnim.duration = win; }
      if (lk && animDur.has(lk)) { land = animDur.get(lk); sym.landAnim.duration = land; }
      if (win > 0 || land > 0) persist[sym.id] = { win, land };
    }
    if (deps.onSpinnerAnimDurations && Object.keys(persist).length) {
      try { deps.onSpinnerAnimDurations(persist); }
      catch (e) { console.warn('[SceneStudio] onSpinnerAnimDurations failed', e); }
    }
  }

  // Selection metrics + transform-code compatibility (same stubs as Spine).
  root.__baseBounds = { x: -W / 2, y: -H / 2, width: W, height: H };
  if (!root.anchor) root.anchor = { x: 0.5, y: 0.5, set() {} };
  root.__spinner = {
    config,
    textures,
    reelViews,
    fx,
    pitchY,
    resolveKey: null,
    resolved: null,
    symbolMap,
    spinePool,
    W,
    H
  };

  // Show the initial board even before any timeline evaluation runs.
  applySpinnerAtTime(root, layer, [], 0);
  return root;
}

/** The action track is the first track carrying any spinner-action clip. */
function actionTrackOf(tracks) {
  for (const tr of tracks) {
    if ((tr.clips || []).some((c) => SPINNER_ACTIONS.includes(c.action))) return tr;
  }
  return tracks[0] || null;
}

/**
 * Per-frame application — strictly t-driven, scrub-safe in both directions.
 */
export function applySpinnerAtTime(obj, layer, tracks, t) {
  const sp = obj.__spinner;
  if (!sp) return;
  const { config, textures, reelViews, pitchY, symbolMap, spinePool, W, H } = sp;
  const { rows, cellW, cellH, spacingX } = config.grid;

  const track = actionTrackOf(tracks || []);
  const key = spinnerResolveKey(config, track);
  if (sp.resolveKey !== key) {
    sp.resolved = resolveSpinnerTrack(config, track);
    sp.resolveKey = key;
  }

  const res = evaluateSpinner(config, sp.resolved, t);

  // Reset spine overlay pool for this frame.
  for (const pool of spinePool.values()) {
    pool.nextFree = 0;
    for (const inst of pool.instances) inst.container.visible = false;
  }

  for (let r = 0; r < reelViews.length; r++) {
    const view = reelViews[r];
    const reel = res.reels[r];
    const dispFrac = (reel.frac + reel.bounceOffset) * config.direction;
    const cellCenterX = -W / 2 + r * (cellW + spacingX) + cellW / 2;

    for (let i = 0; i < view.cells.length; i++) {
      const cell = view.cells[i];
      const data = reel.cells[i]; // same order: gridRow −1 … rows
      cell.cellC.y = (data.gridRow + dispFrac) * pitchY + cellH / 2;
      if (cell.symbolId !== data.symbolId) {
        const texPair = textures.get(data.symbolId);
        if (texPair) {
          // §B: native 1:1 — assign the texture, leave scale at 1.
          cell.staticSprite.texture = texPair.tex;
          cell.blurSprite.texture = texPair.blurTex;
          cell.staticSprite.scale.set(1);
          cell.blurSprite.scale.set(1);
        }
        cell.symbolId = data.symbolId;
      }
      // Land/win symbol animations are Spine overlays ONLY — no procedural
      // scale-punch (removed per phase 3 §A1; it was unwanted). Symbols without
      // an assigned land/win Spine anim simply don't animate on land/win.
      // The land-anim timing offset (§B) lets the overlay fire slightly before
      // or after the exact land/win moment.
      const isVisible = data.gridRow >= 0 && data.gridRow < rows;
      const sym = symbolMap.get(data.symbolId);
      let overlayShown = false;

      const animConf = isVisible
        ? (data.state === 'landing' ? sym?.landAnim : data.state === 'win' ? sym?.winAnim : null)
        : null;
      if (animConf?.kind === 'spine') {
        const loop = animConf.loop !== false;
        const off = Number(animConf.offset) || 0;
        const localT = data.stateT - off;
        if (localT >= 0) {
          const spKey = `${animConf.assetId}:${animConf.anim}:${loop ? '1' : '0'}`;
          const cellY = -H / 2 + (data.gridRow + dispFrac) * pitchY + cellH / 2;
          overlayShown = useSpineOverlay(spinePool, spKey, cellCenterX, cellY, localT);
        }
      }

      // Hide the static + blur behind a playing overlay so the symbol isn't
      // visible underneath the animation.
      cell.blurSprite.alpha = overlayShown ? 0 : reel.blurMix;
      cell.staticSprite.alpha = overlayShown ? 0 : 1 - reel.blurMix;
      cell.cellC.scale.set(1);
    }
  }
}
