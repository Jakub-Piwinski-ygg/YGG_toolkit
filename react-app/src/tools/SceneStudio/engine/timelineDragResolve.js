// Scene Studio — Timeline clip drag resolution (T3).
//
// Pure geometry, no React/DOM — kept separate from TimelinePanel.jsx so the
// core "can this clip sit here without overlapping a sibling" logic is
// independently testable. A move-drag no longer walls the clip off at the
// nearest neighbor (that's the historic "can't drag past a neighbor" bug) —
// it tracks the pointer freely and only gets resolved against whatever it's
// currently sitting on ONCE, at drop.

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * The tightest [minStart, maxEnd] window a clip anchored at
 * [anchorStart, anchorEnd) can occupy without overlapping a sibling on the
 * same track. Anchoring to the clip's CURRENT position (live drag origin, or
 * the dropped position at commit) determines which neighbors act as walls —
 * anchor at drag-start to block crossing (the old, buggy per-frame use), or
 * anchor at the dropped position to resolve a landed overlap (T3's new
 * commit-time use).
 */
export function neighbourBounds(siblings, duration, anchorStart, anchorEnd) {
  let minStart = 0;
  let maxEnd = duration;
  for (const s of siblings || []) {
    const sEnd = s.start + s.duration;
    if (sEnd <= anchorStart) minStart = Math.max(minStart, sEnd);
    else if (s.start >= anchorEnd) maxEnd = Math.min(maxEnd, s.start);
  }
  return { minStart, maxEnd };
}

/**
 * Resolve a freely-dropped clip position against its siblings: nudges it to
 * the nearest non-overlapping slot around wherever it currently sits, rather
 * than reverting it to before the drag. This is what turns "drag past a
 * neighbor" into a deterministic order swap — the dragged clip commits on
 * the far side of whichever sibling it crossed; that sibling's own start is
 * never touched, so their relative order simply flips.
 *
 * Iterative de-penetration, not `neighbourBounds`: that function only walls
 * off siblings ENTIRELY outside the anchor window (it assumes the anchor
 * never overlaps anything, true for a drag's ORIGIN but not for an arbitrary
 * dropped position) — it can't see a sibling the clip is actually sitting on
 * top of. Each pass pushes against whichever overlapping sibling conflicts
 * the MOST, past its near or far edge depending on which side the clip's
 * center is on. Cycle detection (a repeated resolved position) bails out
 * deterministically for a genuine squeeze — two siblings closer together
 * than the dragged clip's own duration, which no single-clip move can
 * resolve without also moving one of them.
 *
 * @returns the resolved start (unchanged from `droppedStart`, aside from the
 *          stage-bounds clamp, if it didn't land on anything).
 */
export function resolveClipDrop(siblings, duration, droppedStart, clipDuration) {
  let start = clamp(droppedStart, 0, Math.max(0, duration - clipDuration));
  const seen = new Set();
  for (let i = 0; i < 8; i++) {
    const end = start + clipDuration;
    const overlapping = (siblings || []).filter((s) => s.start < end && s.start + s.duration > start);
    if (!overlapping.length) break;
    let blocker = overlapping[0];
    let blockerOverlap = Math.min(end, blocker.start + blocker.duration) - Math.max(start, blocker.start);
    for (const s of overlapping.slice(1)) {
      const ov = Math.min(end, s.start + s.duration) - Math.max(start, s.start);
      if (ov > blockerOverlap) { blocker = s; blockerOverlap = ov; }
    }
    const center = start + clipDuration / 2;
    const blockerCenter = blocker.start + blocker.duration / 2;
    const next = center < blockerCenter ? blocker.start - clipDuration : blocker.start + blocker.duration;
    const key = next.toFixed(6);
    if (seen.has(key)) break; // cycle — a genuine squeeze; keep the last value
    seen.add(key);
    start = clamp(next, 0, Math.max(0, duration - clipDuration));
  }
  return start;
}
