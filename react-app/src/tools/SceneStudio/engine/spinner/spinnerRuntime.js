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
import { normalizeSpinnerConfig } from './spinnerModel.js';
import { resolveSpinnerTrack, evaluateSpinner, spinnerResolveKey, pickSpinnerActionTrack } from './spinnerEval.js';
import { blurRenderedCanvas } from './spinnerBlur.js';

/**
 * T7 (animations-only symbols): bake a static texture from a spine pose at
 * `animName`'s first frame, so a symbol authored with ONLY land/win Spine
 * animations (no static PNG) still gets a real resting-cell texture instead
 * of the near-invisible `Texture.WHITE` fallback. Reuses the existing
 * `createSpineContainer` overlay factory rather than a bespoke spine build —
 * poses it at t=0, snapshots it, then throws the temporary instance away.
 * A live-updating Spine per idle cell was considered and rejected: the
 * overlay pool is deliberately capped (≤12 instances, see buildSpinnerObject
 * below) to bound Spine's per-instance render cost, and idle cells vastly
 * outnumber that cap on any board with more than a couple of reels — baking
 * to a texture is the only approach that scales to "every resting cell".
 *
 * Only captures the SHARP texture + a raw canvas of the same pose — cheap
 * (one Pixi `generateTexture`/`extract.canvas`, no WASM). The blur variant is
 * baked separately by `queueBlurBake` below, off the critical path: see its
 * docstring for why (2026-07-04 regression — this used to also run the
 * directional-blur WASM chain right here, blocking the whole scene from
 * appearing for multiple seconds on a handful of animOnly symbols).
 *
 * Also returns an `anchor` fraction (2026-07-04, position-jump fix):
 * `generateTexture` crops tightly to the posed container's bounding box and
 * has no memory of where the skeleton's own local origin (0,0) sat inside
 * it — but that origin is exactly the point every live land/win Spine
 * overlay is positioned BY (`useSpineOverlay` below sets `container.x/y`
 * with no anchor concept of its own). Artists author land/idle/win Spine
 * clips to share one rig origin specifically so they transition without a
 * jump; a plain `anchor.set(0.5)` (bbox-center) on the baked texture ignores
 * that origin and reintroduces the jump for any pose whose art isn't
 * symmetric around the rig root (feet-at-origin rigs, off-center win FX,
 * …). Capturing the bounds BEFORE `generateTexture` crops them away lets
 * the caller anchor the sprite at the origin fraction instead, so idle ↔
 * land/win lines up on the same point the Spine data was authored around.
 */
export async function bakeSpinePoseSharpTexture(deps, assetId, animName, loop, skin = null) {
  if (!deps.renderer || !deps.createSpineContainer) return null;
  let inst = null;
  try {
    inst = await deps.createSpineContainer(assetId, animName, loop, skin);
    if (!inst) return null;
    inst.setTrackTime(0); // first frame = the idle/resting pose
    // Same bounds computation generateTexture uses internally to crop —
    // capture it first so we know where (0,0) fell inside the crop.
    const bounds = inst.container.getLocalBounds();
    const anchor = (bounds.width > 0 && bounds.height > 0)
      ? { x: -bounds.x / bounds.width, y: -bounds.y / bounds.height }
      : { x: 0.5, y: 0.5 };
    const sharp = deps.renderer.generateTexture(inst.container);
    let canvas = null;
    // Extract from the TEXTURE we just generated, not the raw (unattached,
    // off-stage) container a second time through a different Pixi subsystem —
    // `sharp` already has well-defined bounds/dimensions since generateTexture
    // just produced it, whereas an arbitrary un-parented container's bounds
    // for `extract` are less certain to resolve the same way.
    try { canvas = deps.renderer.extract.canvas(sharp); } catch { /* blur bake becomes unavailable; sharp texture still works */ }
    return { sharp, canvas, anchor };
  } catch (e) {
    console.warn('[SceneStudio] spinner idle-pose bake failed', assetId, animName, e);
    return null;
  } finally {
    try { inst?.container?.destroy({ children: true }); } catch { /* ignore */ }
  }
}

// A single shared, strictly-sequential queue for every animOnly blur bake in
// the app (2026-07-04). Two things this must NOT do: (1) block
// buildSpinnerObject's caller — the directional-blur WASM chain is several
// round-trips and can take seconds across a handful of symbols, and nothing
// about it needs to finish before the scene can appear (the sharp texture is
// a perfectly good stand-in for both static AND blurred until the real blur
// lands); (2) run concurrently with itself — every ImageMagick WASM call in
// this app (not just this one) writes to FIXED temp filenames, so overlapping
// calls could clobber each other's files. Chaining through one module-level
// promise gets both: callers fire-and-forget, and the actual WASM work still
// happens one bake at a time.
let blurBakeQueue = Promise.resolve();
function queueBlurBake(deps, canvas, sigma, feather) {
  const result = blurBakeQueue
    .then(() => blurRenderedCanvas(canvas, sigma, feather))
    .then((blob) => deps.loadTexture(URL.createObjectURL(blob)));
  // Keep the shared queue alive even if this particular bake fails, so bakes
  // queued after it still run.
  blurBakeQueue = result.catch(() => {});
  return result;
}

// §B: symbols render at native 1:1 (a 220px symbol stays 220px, overflowing
// its cell). No fit-shrink — keep scale 1 (times the artist-set uniform
// symbolScale); the single machine mask clips the reel window, neighbours
// overlap freely.

function useSpineOverlay(spinePool, key, x, y, stateT, scale = 1) {
  const pool = spinePool.get(key);
  if (!pool || pool.nextFree >= pool.instances.length) return false;
  const inst = pool.instances[pool.nextFree++];
  inst.container.visible = true;
  inst.container.x = x;
  inst.container.y = y;
  inst.container.scale.set(scale);
  inst.setTrackTime(stateT);
  return true;
}

function redrawCellGizmo(sp) {
  if (!sp?.cellGizmo) return;
  const g = sp.cellGizmo;
  g.clear();
  if (!sp.showCellGizmo) return;
  const { reels, rows, cellW, cellH, spacingX, spacingY } = sp.config.grid;
  const line = 1;
  g.roundRect(0, 0, sp.W, sp.H, 8).stroke({ color: 0x74d9ff, width: line, alpha: 0.75 });
  for (let r = 0; r < reels; r++) {
    const x = r * (cellW + spacingX);
    for (let j = 0; j < rows; j++) {
      const y = j * (cellH + spacingY);
      g.rect(x, y, cellW, cellH).stroke({ color: 0x74d9ff, width: line, alpha: 0.42 });
    }
  }
}

export function setSpinnerCellGizmoVisible(obj, visible) {
  const sp = obj?.__spinner;
  if (!sp) return;
  const next = !!visible;
  if (sp.showCellGizmo === next) return;
  sp.showCellGizmo = next;
  redrawCellGizmo(sp);
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
    // Ordinary static-art symbols are always cell-centered — the artist's
    // static PNG and their Spine rig's origin are conventionally authored to
    // already agree on that center. Only the T7 bake below (no static PNG,
    // texture cropped from an arbitrary pose's bounding box) needs a
    // non-center anchor to line up with the rig origin instead.
    textures.set(sym.id, { tex: tex || Texture.WHITE, blurTex: blurTex || tex || Texture.WHITE, anchor: { x: 0.5, y: 0.5 } });
  }

  // T7: "animations-only" symbols — no static PNG authored, but a land/win
  // Spine animation exists — get their idle/resting texture baked from that
  // animation's first frame (landAnim preferred, winAnim as fallback) instead
  // of sitting on the near-invisible Texture.WHITE default above. The BLUR
  // texture may already be a real, persisted asset the wizard's "render +
  // blur idle pose" step generated (loaded like any other symbol in the loop
  // above, via `sym.blurAssetId`) — in that case it's kept as-is and the
  // automatic runtime bake-and-blur below is skipped entirely. That fallback
  // only fires for symbols that haven't been through the wizard step yet.
  for (const sym of config.symbols) {
    if (sym.assetId) continue; // has a real static — nothing to bake
    const animConf = sym.landAnim?.kind === 'spine' ? sym.landAnim
      : sym.winAnim?.kind === 'spine' ? sym.winAnim
      : null;
    if (!animConf?.assetId || !animConf?.anim) continue; // no anim either — stays Texture.WHITE
    const existing = textures.get(sym.id);
    const hasPersistedBlur = !!sym.blurAssetId && existing?.blurTex && existing.blurTex !== Texture.WHITE;
    const baked = await bakeSpinePoseSharpTexture(deps, animConf.assetId, animConf.anim, animConf.loop !== false, sym.skin || null);
    if (!baked?.sharp) continue;
    // Sharp texture stands in for the idle/resting slot immediately — the
    // scene can render right now. A persisted blur asset (if any) is used
    // as-is; otherwise the real directional blur (slow) lands later via the
    // background queue, once ready, without anyone waiting on it.
    textures.set(sym.id, { tex: baked.sharp, blurTex: hasPersistedBlur ? existing.blurTex : baked.sharp, anchor: baked.anchor });
    if (baked.canvas && !hasPersistedBlur) {
      const symId = sym.id;
      const sharpTex = baked.sharp;
      const anchor = baked.anchor;
      queueBlurBake(deps, baked.canvas, config.blur?.sigma ?? 8, config.blur?.feather ?? 4)
        // The blur canvas is a uniform downsample of the SAME crop as `sharpTex`
        // (spinnerBlur.js never re-crops), so the anchor fraction is unchanged.
        .then((blurTex) => { if (blurTex) textures.set(symId, { tex: sharpTex, blurTex, anchor }); })
        .catch((e) => console.warn('[SceneStudio] spinner idle-pose blur bake failed — keeping unblurred', symId, e));
    }
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

  const cellGizmo = new Graphics();
  cellGizmo.label = 'spinner-cell-gizmo';
  cellGizmo.eventMode = 'none';
  cellGizmo.visible = true;
  board.addChild(cellGizmo);

  // Symbol lookup map for land/win anim dispatch in applySpinnerAtTime.
  const symbolMap = new Map(config.symbols.map((s) => [s.id, s]));

  // Spine overlay pool — pre-built containers for land/win Spine animations.
  // deps.createSpineContainer(assetId, animName, loop, skin) → {container, setTrackTime(t), duration} | null
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
        const skin = sym.skin || '';
        const key = `${animConf.assetId}:${animConf.anim}:${loop ? '1' : '0'}:${skin}`;
        if (!specs.has(key)) specs.set(key, { assetId: animConf.assetId, anim: animConf.anim, loop, skin });
      }
    }
    const poolCount = Math.min(reels * rows, 12);
    for (const [key, spec] of specs) {
      const instances = [];
      let dur = 0;
      for (let i = 0; i < poolCount; i++) {
        const inst = await createSpine(spec.assetId, spec.anim, spec.loop, spec.skin || null);
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
        ? `${a.assetId}:${a.anim}:${a.loop !== false ? '1' : '0'}:${sym.skin || ''}` : null);
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
    // The raw asset.spinner this build normalized. The live-patch pass
    // (pixiApp.js applyRuntimeConfigs) compares by identity and swaps `config`
    // in place for runtime-only edits (timing/blur/board/strips/events/…).
    rawRef: asset.spinner,
    textures,
    reelViews,
    // board + mask refs so relayoutSpinnerGeometry can resize in place when
    // cell size / spacing change (reel/row COUNTS still rebuild — containers).
    board,
    boardMask,
    cellGizmo,
    fx,
    pitchY,
    resolveKey: null,
    resolved: null,
    symbolMap,
    spinePool,
    W,
    H,
    showCellGizmo: false
  };
  redrawCellGizmo(root.__spinner);

  // Show the initial board even before any timeline evaluation runs.
  applySpinnerAtTime(root, layer, [], 0);
  return root;
}

/**
 * Re-derive the board geometry (offsets, mask, reel/cell x-positions, base
 * bounds) from the CURRENT config's cell size + spacing, on the already-built
 * containers. Called by the live-patch pass after a runtime config swap so
 * cellW/cellH/spacingX/spacingY edits resize the machine in place — only the
 * reel/row COUNTS (container topology) and the symbol set (textures, overlay
 * pool) still require a full rebuild. Per-frame cell Y positions are computed
 * from sp.pitchY/W/H in applySpinnerAtTime, so updating them here is enough.
 */
export function relayoutSpinnerGeometry(obj) {
  const sp = obj.__spinner;
  if (!sp?.board || !sp?.boardMask) return;
  const { reels, rows, cellW, cellH, spacingX, spacingY } = sp.config.grid;
  const W = reels * cellW + (reels - 1) * spacingX;
  const H = rows * cellH + (rows - 1) * spacingY;
  sp.W = W;
  sp.H = H;
  sp.pitchY = cellH + spacingY;
  sp.board.x = -W / 2;
  sp.board.y = -H / 2;
  sp.boardMask.clear().rect(0, 0, W, H).fill(0xffffff);
  for (let r = 0; r < sp.reelViews.length; r++) {
    const view = sp.reelViews[r];
    view.reelC.x = r * (cellW + spacingX);
    for (const cell of view.cells) cell.cellC.x = cellW / 2;
  }
  obj.__baseBounds = { x: -W / 2, y: -H / 2, width: W, height: H };
  redrawCellGizmo(sp);
}

/**
 * Per-frame application — strictly t-driven, scrub-safe in both directions.
 *
 * `startBoard` (optional): direct-mode carry-in board (the result a preceding
 * scenario segment landed on) — threaded into the resolve so the reels HOLD
 * that board instead of snapping to `config.initialBoard` when this timeline
 * has no spin clips. Null in single-timeline (animate) mode → initial board.
 *
 * `outcome` (optional): direct-mode per-node result override — see
 * resolveSpinnerTrack. Null in animate mode → authored behavior.
 * `outcomeReroll` (optional, T12): the director node's re-roll counter.
 */
export function applySpinnerAtTime(obj, layer, tracks, t, startBoard = null, outcome = null, outcomeReroll = 0) {
  const sp = obj.__spinner;
  if (!sp) return;
  const { config, textures, reelViews, pitchY, symbolMap, spinePool, W, H } = sp;
  const { rows, cellW, cellH, spacingX, symbolScale } = config.grid;

  const track = pickSpinnerActionTrack(tracks || []);
  const key = spinnerResolveKey(config, track, startBoard, outcome, outcomeReroll);
  if (sp.resolveKey !== key) {
    sp.resolved = resolveSpinnerTrack(config, track, startBoard, outcome, outcomeReroll);
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
    // True only when the reel is EXACTLY at rest — no scroll, no bounce
    // wiggle (bounce always returns to exactly 0 once fully settled, see
    // spinnerEval.test.js). Buffer-row cells (gridRow -1 / rows) only need
    // to render while a symbol is actually transiting into/out of frame —
    // at rest their native-1:1 art (which can be taller than cellH, §B) has
    // nothing left to clip it but the outer mask, and can bleed past its
    // edge. Gating on dispFrac (not e.g. reel.speed) also covers the
    // post-land/win settle window for free, since bounce is additive on top
    // of the same value.
    const atRest = Math.abs(dispFrac) < 1e-4;

    for (let i = 0; i < view.cells.length; i++) {
      const cell = view.cells[i];
      const data = reel.cells[i]; // same order: gridRow −1 … rows
      cell.cellC.y = (data.gridRow + dispFrac) * pitchY + cellH / 2;
      if (cell.symbolId !== data.symbolId) {
        const texPair = textures.get(data.symbolId);
        if (texPair) {
          // §B: native 1:1 for the static — assign the texture, leave scale
          // at 1. The blur texture may be a different native resolution than
          // the static/sharp one (spinnerBlur.js's blurRenderedCanvas blurs
          // at reduced resolution for speed — see BLUR_DOWNSAMPLE — and never
          // upsamples the result; this applies identically to static-art
          // blur PNGs, wizard-generated animOnly blur PNGs, and the runtime's
          // own automatic animOnly bake-and-blur fallback) — scale it to
          // match the static texture's footprint exactly using actual
          // texture dimensions, not any hardcoded factor, so this stays
          // correct across all of them (and full-size legacy blur PNGs too,
          // ratio 1, no visual change).
          cell.staticSprite.texture = texPair.tex;
          cell.blurSprite.texture = texPair.blurTex;
          // Ordinary static-art symbols anchor at cell-center (0.5, 0.5) —
          // the artist's PNG and Spine rig origin already agree on that
          // point. A T7-baked (no static PNG) symbol instead anchors at the
          // fraction of its cropped bounding box where the Spine rig's own
          // local origin fell (spinnerRuntime.bakeSpinePoseSharpTexture) —
          // the SAME point `useSpineOverlay` below positions the live
          // land/win overlay BY, so idle ↔ land/win never jumps. The blur
          // texture shares the fraction: it's a uniform downsample of the
          // identical crop, never re-cropped (spinnerBlur.js).
          const ax = texPair.anchor?.x ?? 0.5, ay = texPair.anchor?.y ?? 0.5;
          cell.staticSprite.anchor.set(ax, ay);
          cell.blurSprite.anchor.set(ax, ay);
          cell.staticSprite.scale.set(1);
          const tw = texPair.tex?.width, th = texPair.tex?.height;
          const bw = texPair.blurTex?.width, bh = texPair.blurTex?.height;
          cell.blurSprite.scale.set(
            Number.isFinite(tw) && Number.isFinite(bw) && bw > 0 ? tw / bw : 1,
            Number.isFinite(th) && Number.isFinite(bh) && bh > 0 ? th / bh : 1
          );
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
          const spKey = `${animConf.assetId}:${animConf.anim}:${loop ? '1' : '0'}:${sym?.skin || ''}`;
          const cellY = -H / 2 + (data.gridRow + dispFrac) * pitchY + cellH / 2;
          overlayShown = useSpineOverlay(spinePool, spKey, cellCenterX, cellY, localT, symbolScale ?? 1);
        }
      }

      // Hide the static + blur behind a playing overlay so the symbol isn't
      // visible underneath the animation. Buffer-row cells additionally go
      // fully transparent once the reel is at rest (see `atRest` above) —
      // they only need to be visible while actively scrolling into place.
      const forceHidden = atRest && !isVisible;
      cell.blurSprite.alpha = forceHidden ? 0 : (overlayShown ? 0 : reel.blurMix);
      cell.staticSprite.alpha = forceHidden ? 0 : (overlayShown ? 0 : 1 - reel.blurMix);
      cell.cellC.scale.set(symbolScale ?? 1);
    }
  }
}
