// engine/winseq/winNumberRuntime.js
//
// Per-frame driver for the Win-Sequence count-up NUMBER. The number Container is
// a Pixi CHILD of the parent win-sequence Spine (its layer.parentId is the
// winseq layer), so the bone's skeleton-space transform IS the child's local
// transform. We replicate spine-pixi-v8's own bone→child matrix (its
// `updateSlotObject`) against the bone's world transform, fully t-driven /
// scrub-safe —
// the TEXT_ bone has no slot and winseq is scrub-driven, so `addSlotObject` is
// unusable. The user offset/scale (the number layer's transform) is composed on
// top of the follow.

import { Matrix } from 'pixi.js';
import { winNumberValueAt, formatWinNumber } from './winNumberModel.js';
import { CHANNEL_DEFS } from '../animation/keyframes.js';

const _m = new Matrix();

/** True when two configs share the same sliced glyph set (font/grid/layout) —
 *  i.e. the built textures still apply and only layout/format differs. */
function sameGlyphSet(a, b) {
  return !!a && !!b && a.charLayout === b.charLayout && a.cell === b.cell && a.cols === b.cols;
}

/**
 * @param {object} numObj    the number Container (tagged `__winnumber = { num }`)
 * @param {object} parentObj the parent winseq Spine (tagged `__winseq` + `__wsActive`)
 * @param {object} layer     the number SceneLayer (for user offset/scale + visibility)
 * @param {object} ut        the resolved layer transform { x, y, scaleX, scaleY, rotation, alpha }
 * @param {number|null} sampleOverride  fixed value (wizard Number step) instead of the count-up
 * @param {object|null} liveNum  current config from the scene asset — lets cheap edits
 *        (glyph scale / spacing / currency / decimals) apply by re-laying out the
 *        existing glyphs, with NO scene rebuild. Falls back to the built config
 *        when the glyph set differs (a structural change rebuilds separately).
 * @param {{alpha?:number, tint?:{r:number,g:number,b:number}}|null} colorOverride
 *        keyframed colour from the number layer's clips (alpha multiplies the
 *        layer's static alpha; tint is applied straight). null = no animation.
 */
export function applyWinNumberAtTime(numObj, parentObj, layer, ut, sampleOverride = null, liveNum = null, colorOverride = null) {
  const built = numObj?.__winnumber?.num;
  if (!built) return;
  if (!parentObj?.skeleton) { numObj.visible = false; return; }
  const active = parentObj.__wsActive;

  // Use the live config for layout + formatting (cheap edits apply instantly),
  // but only when its glyph set matches the built textures.
  const num = (liveNum && sameGlyphSet(liveNum, built)) ? liveNum : built;
  numObj.__num = num; // the container's layout reads this
  // Re-layout when the layout-affecting fields change even if the string doesn't.
  const layoutSig = `${num.glyphScale}|${num.letterSpacing}|${num.baselineOffset}|${num.align}`;
  const forceRelayout = numObj.__layoutSig !== layoutSig;
  numObj.__layoutSig = layoutSig;

  // 1) value + text — relayout only when the rendered string changes.
  //   • a fixed sampleOverride (wizard Number step) always wins — it must show
  //     even before the win-sequence flow has been driven (fresh build), so it
  //     is NOT gated on __wsActive;
  //   • otherwise the live count-up needs an active flow; with none, hide.
  let v;
  if (sampleOverride != null) {
    v = sampleOverride;
  } else if (active) {
    v = winNumberValueAt(active.flow, active.durations, active.localT, {
      wager: num.wager,
      hangOnLastIdle: active.hangOnLastIdle,
    });
  } else {
    numObj.visible = false;
    return;
  }
  const str = formatWinNumber(v, num);
  if (forceRelayout || numObj.__lastStr !== str) {
    try { numObj.setText(str); } catch { /* ignore */ }
    numObj.__lastStr = str;
  }

  // 2) follow the bone (verbatim spine-pixi-v8 Y-down map; worldX/worldY un-negated).
  const bone = parentObj.skeleton.findBone(num.boneName);
  if (!bone) { numObj.visible = false; return; }
  // Spine 4.2 exposes the world transform on the bone directly; 4.3 moved it to
  // `bone.appliedPose`. Support either — same a/b/c/d/worldX/worldY fields.
  const p = bone.appliedPose || bone;
  _m.a = p.a; _m.b = p.c; _m.c = -p.b; _m.d = -p.d; _m.tx = p.worldX; _m.ty = p.worldY;
  numObj.setFromMatrix(_m);

  // 3) compose the user offset / scale / rotation on top of the follow.
  numObj.x += ut?.x ?? 0;
  numObj.y += ut?.y ?? 0;
  numObj.scale.x *= ut?.scaleX ?? 1;
  numObj.scale.y *= ut?.scaleY ?? 1;
  numObj.rotation += ut?.rotation ?? 0;

  // 4) colour: keyframed alpha multiplies the layer's static alpha (so a fade
  //    composes with a dimmed layer), tint applies straight (white = no tint).
  const baseAlpha = typeof ut?.alpha === 'number' ? ut.alpha : 1;
  const animAlpha = typeof colorOverride?.alpha === 'number' ? colorOverride.alpha : 1;
  numObj.alpha = Math.max(0, Math.min(1, baseAlpha * animAlpha));
  if (colorOverride?.tint) CHANNEL_DEFS.tint.apply(numObj, colorOverride.tint);
  else numObj.tint = 0xffffff;
  numObj.visible = layer.visible !== false;
}
