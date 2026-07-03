// T3 timeline drag-resolve tests.
// Run: node --test src/tools/SceneStudio/engine/timelineDragResolve.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { neighbourBounds, resolveClipDrop } from './timelineDragResolve.js';

test('neighbourBounds is [0, duration] with no siblings', () => {
  const b = neighbourBounds([], 10, 3, 5);
  assert.deepEqual(b, { minStart: 0, maxEnd: 10 });
});

test('neighbourBounds walls off only siblings that flank the anchor window', () => {
  // sibling A ends at 2 (before anchor 3..5) -> minStart=2
  // sibling B starts at 7 (after anchor 3..5) -> maxEnd=7
  const siblings = [{ start: 0, duration: 2 }, { start: 7, duration: 1 }];
  const b = neighbourBounds(siblings, 10, 3, 5);
  assert.deepEqual(b, { minStart: 2, maxEnd: 7 });
});

test('resolveClipDrop leaves a drop that lands in open space untouched', () => {
  const siblings = [{ start: 0, duration: 1 }, { start: 8, duration: 1 }];
  assert.equal(resolveClipDrop(siblings, 10, 3, 2), 3);
});

test('resolveClipDrop nudges a drop that overlaps ONE sibling to touch it', () => {
  // Dragged clip (duration 2) dropped at 4, overlapping a sibling at [5,7).
  // Center of dragged (4..6, center 5) vs sibling center 6 -> dragged center
  // is left of sibling center, so it resolves to the LEFT of the sibling.
  const siblings = [{ start: 5, duration: 2 }];
  const resolved = resolveClipDrop(siblings, 20, 4, 2);
  assert.equal(resolved, 3, 'touches the sibling\'s left edge (5 - duration 2)');
});

test('resolveClipDrop: dragging past a neighbor swaps their order (T3 core case)', () => {
  // Clip A (the dragged one, duration 2) starts left of sibling B [start 5, duration 2].
  // Drop A so its center is past B's center (dropped at 6, window [6,8)) ->
  // A should land immediately after B (at 7), not be blocked at B's near
  // edge (the old wall-clamp bug) or left wherever it overlapped mid-drop.
  const siblingB = [{ start: 5, duration: 2 }];
  const resolved = resolveClipDrop(siblingB, 20, 6, 2);
  assert.equal(resolved, 7, 'A commits right after B - order has swapped (A now sorts after B)');
});

test('resolveClipDrop: dragging back past a neighbor from the other side swaps order back', () => {
  // Now the dragged clip is at 7 (after B at [5,7)) and gets dragged back to
  // the left, well past B's near edge (dropped at 1).
  const siblingB = [{ start: 5, duration: 2 }];
  const resolved = resolveClipDrop(siblingB, 20, 1, 2);
  assert.equal(resolved, 1, 'lands cleanly before B - no overlap, no nudge needed');
});

test('resolveClipDrop clamps to stage bounds when there is nowhere else to go', () => {
  const siblings = [{ start: 1, duration: 1 }];
  // Dropped at a negative start (dragged off the left edge of the stage).
  assert.equal(resolveClipDrop(siblings, 10, -5, 1), 0);
});

test('resolveClipDrop resolves a squeeze between two closer-than-duration neighbors deterministically (best-effort — no single-clip move can fully de-overlap it)', () => {
  const siblings = [{ start: 0, duration: 2 }, { start: 3, duration: 2 }];
  // Dragged clip (duration 2) dropped at 2.4, into a 1-wide gap [2,3) it
  // can't actually fit in. The de-penetration bounces between touching each
  // neighbor in turn; cycle detection stops it at a stable, reproducible
  // spot (touching sibling A's right edge) rather than looping forever.
  const resolved = resolveClipDrop(siblings, 10, 2.4, 2);
  assert.equal(resolved, 2);
  const first = resolveClipDrop(siblings, 10, 2.4, 2);
  const second = resolveClipDrop(siblings, 10, 2.4, 2);
  assert.equal(first, second, 'deterministic — same input always resolves the same way');
});
