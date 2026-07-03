// domZoom.js — the global UI scale (see hooks/useUiScale.js) applies CSS `zoom`
// to #root. Under `zoom`, an element's getBoundingClientRect() reports VISUAL
// (zoomed) pixels, while its layout metrics (offsetWidth, scrollLeft) and any
// content coordinates computed in layout px (CSS `left`, a px-per-second
// constant, etc.) stay UNzoomed. So mapping a pointer's clientX/Y into content
// space via `clientX - rect.left` is off by the zoom factor — the source of the
// timeline-scrub / clip-drag / node-link offsets when scaled up.
//
// `elementZoom` measures the actual ratio for a given element. It returns 1
// when there is no discrepancy (scale 1, or a browser that already keeps the
// two coordinate systems consistent), so dividing a pointer delta by it is
// always safe — it corrects exactly when needed and is a no-op otherwise.

export function elementZoom(el) {
  if (!el) return 1;
  const layoutW = el.offsetWidth;
  if (!layoutW) return 1;
  const visualW = el.getBoundingClientRect().width;
  const z = visualW / layoutW;
  return z > 0 && Number.isFinite(z) ? z : 1;
}

// The global ui-scale is `zoom` on #root, so #root's own ratio IS the factor.
// Handy for pure pointer DELTAS (clip drag, box move) where no local element
// rect is otherwise needed. Safe (returns 1) if #root is missing.
export function rootZoom() {
  return elementZoom(typeof document !== 'undefined' ? document.getElementById('root') : null);
}
