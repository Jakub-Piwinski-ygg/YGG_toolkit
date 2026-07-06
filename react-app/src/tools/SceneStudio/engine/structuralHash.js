// engine/structuralHash.js
//
// Pure structural-identity model for the scene → Pixi rebuild gate. The
// viewport rebuilds the Pixi scene graph ONLY when something here changes;
// everything else (transforms, timeline edits, spine/video layer settings,
// spinner/winseq runtime fields, win-number formatting) is applied live by
// syncTransforms / applyFlowAtTime / applyRuntimeConfigs (pixiApp.js).
// Kept import-cycle-free and renderer-free so it unit-tests under node.

/** Compact identity of an asset src (data URLs share a long common prefix, so
 *  the length is part of the signature, not just the head). */
function srcSig(s) {
  return s ? `${s.length}#${s.slice(0, 32)}` : '';
}

/**
 * Structural signature of a spinner config — ONLY the fields that decide the
 * built Pixi object's TOPOLOGY: reel/row counts (container tree) and the
 * symbol set with its land/win anim specs (texture map, overlay pool, T7 idle
 * bake). Cell size + spacing are geometry — relayoutSpinnerGeometry resizes
 * the built containers in place. Everything else (timing / bounce / blur
 * params / strips / initialBoard / seed / direction / events / perReel / rev)
 * is consumed per-frame by applySpinnerAtTime and live-patches via
 * applyRuntimeConfigs.
 */
export function spinnerStructuralSig(spinner) {
  if (!spinner) return '-';
  const anim = (a) => (a && a.kind === 'spine' ? `${a.assetId}~${a.anim}~${a.loop !== false ? 1 : 0}` : '-');
  const syms = (spinner.symbols || [])
    .map((s) => [s.id, s.assetId || '-', s.blurAssetId || '-', anim(s.landAnim), anim(s.winAnim)].join(','))
    .join(';');
  const g = spinner.grid || {};
  return `${g.reels}x${g.rows}|${syms}`;
}

/**
 * Structural signature of a win-sequence's count-up number — the glyph-set
 * fields buildWinNumberContainer bakes (font texture + sheet slicing). All
 * other number fields (scale / spacing / align / currency / decimals / wager /
 * bone) are read live per frame (`liveNum` in applyFlowAtTime). Tiers and
 * setupPose are runtime too — applyWinSeqAtTime reads them from __winseq.config.
 */
export function winseqNumberSig(winseq) {
  const n = winseq?.number;
  if (!n?.fontSrc) return '-';
  return [srcSig(n.fontSrc), n.cell ?? 256, n.cols ?? 8, n.rows ?? 8, n.charLayout || '-'].join(',');
}

/**
 * Structural parts of a scene — one labeled string per canvas/asset/layer,
 * covering everything that, when changed, requires tearing down and rebuilding
 * the Pixi scene graph. Kept as an array so the viewport can DIFF two
 * generations and log WHY a rebuild fired (see diffStructuralParts).
 *
 * Deliberately NOT structural (live-patched instead):
 *   - transforms / visibility / blend / tint, scene.flow (all timeline edits)
 *   - layer.spine (defaultAnimation/loop/defaultMix/skin), layer.video
 *     (loop/muted)
 *   - spinner runtime fields — see spinnerStructuralSig
 *   - winseq tiers/setupPose + number formatting — see winseqNumberSig
 */
export function sceneStructuralParts(scene) {
  const parts = [];
  // Only the active canvas is built — switching it must rebuild.
  parts.push(`active:${scene.activeCanvasId || scene.canvases?.[0]?.id || '-'}`);
  for (const c of scene.canvases || []) parts.push(`canvas:${c.id}:${c.visible ? 1 : 0}`);
  for (const a of scene.assets) {
    let p = `asset:${a.id}:${a.type}:${srcSig(a.src)}`;
    // Spine atlas/texture are part of the structure: when the self-heal recovers
    // a missing atlas+texture, the object must rebuild (e.g. so a spinner's
    // land/win overlay pool re-loads with the now-valid skeleton).
    if (a.type === 'spine') p += `:${srcSig(a.atlas)}:${srcSig(a.texture)}`;
    if (a.type === 'winseq') p += `:${srcSig(a.atlas)}:${srcSig(a.texture)}:num[${winseqNumberSig(a.winseq)}]`;
    // Win-number objects rebuild from their parent winseq's number config — the
    // parent ref is structural so a re-parent / parent swap rebuilds the glyphs.
    if (a.type === 'winnumber') p += `:parent:${a.parentAssetId || '-'}`;
    if (a.type === 'spinner') p += `:spin[${spinnerStructuralSig(a.spinner)}]`;
    parts.push(p);
  }
  // Layer order + parentage are structural — reorder/reparent must rebuild
  // the Pixi tree (children physically move between containers).
  for (const l of scene.layers) {
    parts.push(`layer:${l.id}:${l.assetId}:${l.canvasId || '-'}:${l.parentId || '-'}`);
  }
  return parts;
}

/**
 * Build a structural hash of a scene — the joined structural parts. Pure
 * transform / visibility / blend / timeline / runtime-config changes don't
 * bump the hash; those go through the cheap sync + live-patch path.
 */
export function sceneStructuralHash(scene) {
  return sceneStructuralParts(scene).join('\n');
}

/**
 * Human-readable diff between two structural-parts generations — the "why did
 * this rebuild fire" trace. Returns up to `max` changed entries.
 */
export function diffStructuralParts(prev, next, max = 3) {
  if (!prev) return ['initial build'];
  const prevSet = new Set(prev);
  const nextSet = new Set(next);
  const out = [];
  for (const p of next) {
    if (!prevSet.has(p)) { out.push(`+ ${p.slice(0, 140)}`); if (out.length >= max) return out; }
  }
  for (const p of prev) {
    if (!nextSet.has(p)) { out.push(`- ${p.slice(0, 140)}`); if (out.length >= max) return out; }
  }
  // Same part SET but a different sequence = a pure reorder (layer z-order) —
  // the set diff above can't see it, but the joined hash did change.
  if (!out.length && prev.length === next.length && prev.join('\n') !== next.join('\n')) {
    out.push('order changed (reorder)');
  }
  return out;
}
