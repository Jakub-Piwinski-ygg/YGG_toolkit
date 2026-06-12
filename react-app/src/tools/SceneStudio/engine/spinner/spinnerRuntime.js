// engine/spinner/spinnerRuntime.js
//
// Pixi v8 renderer for the Spinner object — Phase 5, SPINNER.md §2/§4.
// Thin view over the pure evaluator: builds masked reel containers with a
// static + blurred sprite pair per visible cell, and on every frame maps
// evaluateSpinner(config, resolved, t) onto sprite positions, textures and
// alphas. NO timing or spin logic lives here.
//
// Dependencies (resolveAssetUrl, loadTexture) are injected by pixiApp.js so
// this module stays import-cycle-free and unit-mockable.
//
// Object shape:
//   root Container            ← transform applied by rebuildScene like any layer
//     board Container         ← offset by −W/2,−H/2 so the root origin is centered
//       reel[r] Container     ← x = r·(cellW+spacingX), rect-masked to the rows window
//         cell[j] Container   ← j = −1…rows (one buffer row above and below)
//           staticSprite
//           blurSprite        ← alpha = blurMix crossfade
//     fx Container            ← land/win overlays (M5)

import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import { normalizeSpinnerConfig, SPINNER_ACTIONS } from './spinnerModel.js';
import { resolveSpinnerTrack, evaluateSpinner, spinnerResolveKey } from './spinnerEval.js';

function fitSpriteToCell(sprite, cellW, cellH) {
  const tex = sprite.texture;
  if (!tex || !tex.width || !tex.height) return;
  const k = Math.min(cellW / tex.width, cellH / tex.height);
  sprite.scale.set(k);
}

function useSpineOverlay(spinePool, key, x, y, stateT) {
  const pool = spinePool.get(key);
  if (!pool || pool.nextFree >= pool.instances.length) return;
  const inst = pool.instances[pool.nextFree++];
  inst.container.visible = true;
  inst.container.x = x;
  inst.container.y = y;
  inst.setTrackTime(stateT);
}

/**
 * Build the Pixi object for a `spinner` asset.
 * @param {object} asset  scene asset with `.spinner` config
 * @param {object} layer  owning SceneLayer (unused today, kept for parity)
 * @param {object} deps   { scene, rootHandle, sceneBasePath, resolveAssetUrl, loadTexture }
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

  const reelViews = [];
  for (let r = 0; r < reels; r++) {
    const reelC = new Container();
    reelC.label = `reel-${r}`;
    reelC.x = r * (cellW + spacingX);
    const mask = new Graphics().rect(0, 0, cellW, H).fill(0xffffff);
    reelC.addChild(mask);
    reelC.mask = mask;

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
    board.addChild(reelC);
    reelViews.push({ reelC, cells });
  }

  const fx = new Container();
  fx.label = 'spinner-fx';
  root.addChild(fx);

  // Symbol lookup map for land/win anim dispatch in applySpinnerAtTime.
  const symbolMap = new Map(config.symbols.map((s) => [s.id, s]));

  // Spine overlay pool — pre-built containers for land/win Spine animations.
  // deps.createSpineContainer(assetId, animName, loop) → {container, setTrackTime(t)} | null
  const spinePool = new Map();
  const createSpine = deps.createSpineContainer || null;
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
      for (let i = 0; i < poolCount; i++) {
        const inst = await createSpine(spec.assetId, spec.anim, spec.loop);
        if (!inst) break;
        inst.container.visible = false;
        fx.addChild(inst.container);
        instances.push(inst);
      }
      if (instances.length) spinePool.set(key, { instances, nextFree: 0 });
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
          cell.staticSprite.texture = texPair.tex;
          cell.blurSprite.texture = texPair.blurTex;
          fitSpriteToCell(cell.staticSprite, cellW, cellH);
          fitSpriteToCell(cell.blurSprite, cellW, cellH);
        }
        cell.symbolId = data.symbolId;
      }
      cell.blurSprite.alpha = reel.blurMix;
      cell.staticSprite.alpha = 1 - reel.blurMix;

      // Land/win Spine overlay animations. Overshoot feel comes from the bounce
      // curve in the evaluator (bounceOffset on the reel scroll), not symbol scale.
      const isVisible = data.gridRow >= 0 && data.gridRow < rows;
      const sym = symbolMap.get(data.symbolId);

      if (isVisible && data.state === 'landing') {
        const animConf = sym?.landAnim;
        if (animConf?.kind === 'spine') {
          const spKey = `${animConf.assetId}:${animConf.anim}:1`;
          const cellY = -H / 2 + (data.gridRow + dispFrac) * pitchY + cellH / 2;
          useSpineOverlay(spinePool, spKey, cellCenterX, cellY, data.stateT);
        }
      } else if (isVisible && data.state === 'win') {
        const animConf = sym?.winAnim;
        if (animConf?.kind === 'spine') {
          const loop = animConf.loop !== false;
          const spKey = `${animConf.assetId}:${animConf.anim}:${loop ? '1' : '0'}`;
          const cellY = -H / 2 + (data.gridRow + dispFrac) * pitchY + cellH / 2;
          useSpineOverlay(spinePool, spKey, cellCenterX, cellY, data.stateT);
        }
      }
      cell.cellC.scale.set(1);
    }
  }
}
