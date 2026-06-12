// Unit tests for the pure spinner core (Phase 5 M1 — SPINNER.md §6).
// Run with:  node --test src/tools/SceneStudio/engine/spinner/
// No DOM, no Pixi — these modules are framework-agnostic by contract.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeSpinnerConfig,
  evalWaysWins,
  boardHasWin,
  generateNonWinningBoard,
  generateWinningBoard,
  mulberry32
} from './spinnerModel.js';
import {
  resolveSpinnerTrack,
  evaluateSpinner,
  spinnerResolveKey
} from './spinnerEval.js';

const SYMS = ['a', 'b', 'c', 'd', 'e', 'f'];

function makeConfig(over = {}) {
  return normalizeSpinnerConfig({
    symbols: SYMS.map((id) => ({ id })),
    grid: { reels: 5, rows: 3, cellW: 200, cellH: 200 },
    seed: 1234,
    ...over
  });
}

function clip(id, start, duration, action, spinner = {}) {
  return { id, start, duration, action, spinner };
}

/** startSpin → spin → stopSpin, exactly adjacent. */
function standardTrack(extra = {}) {
  return {
    clips: [
      clip('c1', 0.5, 0.5, 'startSpin'),
      clip('c2', 1.0, 2.0, 'spin'),
      clip('c3', 3.0, 2.0, 'stopSpin', extra.stop || {})
    ]
  };
}

// ── Ways win evaluation ────────────────────────────────────────────────

test('ways: 3+ consecutive reels from left wins, any rows', () => {
  const board = [
    ['a', 'b', 'c'],
    ['d', 'a', 'e'],
    ['f', 'e', 'a'],
    ['b', 'c', 'd'],
    ['e', 'f', 'b']
  ];
  const wins = evalWaysWins(board);
  assert.equal(wins.length, 1);
  assert.equal(wins[0].symbolId, 'a');
  assert.equal(wins[0].count, 3);
  assert.deepEqual(wins[0].cells, [
    { reel: 0, row: 0 }, { reel: 1, row: 1 }, { reel: 2, row: 2 }
  ]);
});

test('ways: run must start at reel 0 and be consecutive', () => {
  // 'a' on reels 1,2,3 — no win (does not start at reel 0).
  assert.equal(boardHasWin([
    ['b', 'c', 'd'],
    ['a', 'e', 'f'],
    ['a', 'b', 'c'],
    ['a', 'd', 'e'],
    ['f', 'b', 'c']
  ]), false);
  // 'a' on reels 0,1 then gap at 2 then 3 — run length 2, no win.
  assert.equal(boardHasWin([
    ['a', 'c', 'd'],
    ['a', 'e', 'f'],
    ['b', 'b', 'c'],
    ['a', 'd', 'e'],
    ['f', 'b', 'c']
  ]), false);
});

test('ways: counts all matching cells across the run', () => {
  const wins = evalWaysWins([
    ['a', 'a', 'b'],
    ['a', 'c', 'd'],
    ['e', 'a', 'a'],
    ['b', 'c', 'd']
  ]);
  assert.equal(wins.length, 1);
  assert.equal(wins[0].count, 3);
  assert.equal(wins[0].cells.length, 5); // 2 + 1 + 2
});

// ── Board generators ───────────────────────────────────────────────────

test('non-winning generator: never wins across 1000 seeds (5x3, 6 symbols)', () => {
  for (let seed = 0; seed < 1000; seed++) {
    assert.equal(boardHasWin(generateNonWinningBoard(SYMS, 5, 3, seed)), false, `seed ${seed}`);
  }
});

test('non-winning generator: stressed config (4 symbols, 3x4) still never wins', () => {
  const ids = ['a', 'b', 'c', 'd'];
  for (let seed = 0; seed < 1000; seed++) {
    assert.equal(boardHasWin(generateNonWinningBoard(ids, 3, 4, seed)), false, `seed ${seed}`);
  }
});

test('generators are deterministic per seed', () => {
  assert.deepEqual(
    generateNonWinningBoard(SYMS, 5, 3, 42),
    generateNonWinningBoard(SYMS, 5, 3, 42)
  );
  assert.deepEqual(generateWinningBoard(SYMS, 5, 3, 42), generateWinningBoard(SYMS, 5, 3, 42));
});

test('winning generator always wins', () => {
  for (let seed = 0; seed < 200; seed++) {
    assert.equal(boardHasWin(generateWinningBoard(SYMS, 5, 3, seed)), true, `seed ${seed}`);
  }
});

// ── Config normalization ───────────────────────────────────────────────

test('normalizeSpinnerConfig fills strips and a non-winning initial board', () => {
  const cfg = makeConfig();
  assert.equal(cfg.strips.length, 5);
  assert.ok(cfg.strips.every((s) => s.length >= cfg.grid.rows + 2));
  assert.equal(cfg.initialBoard.length, 5);
  assert.equal(boardHasWin(cfg.initialBoard), false);
});

// ── Continuity across clips ────────────────────────────────────────────

function continuityAt(cfg, resolved, tB, reel = 0) {
  const eps = 1e-7;
  const a = evaluateSpinner(cfg, resolved, tB - eps).reels[reel];
  const b = evaluateSpinner(cfg, resolved, tB + eps).reels[reel];
  return { ds: Math.abs(b.scroll - a.scroll), dv: Math.abs(b.speed - a.speed) };
}

test('scroll and speed are continuous across startSpin→spin→stopSpin', () => {
  const cfg = makeConfig();
  const resolved = resolveSpinnerTrack(cfg, standardTrack());
  for (const boundary of [0.5, 1.0, 3.0]) {
    for (let r = 0; r < cfg.grid.reels; r++) {
      const { ds, dv } = continuityAt(cfg, resolved, boundary, r);
      assert.ok(ds < 1e-4, `Δs=${ds} at t=${boundary} reel ${r}`);
      assert.ok(dv < 1e-3, `Δv=${dv} at t=${boundary} reel ${r}`);
    }
  }
});

test('truncated startSpin exits below vmax and the spin clip ramps the rest', () => {
  const cfg = makeConfig();
  // startSpin only 0.15s long but startDuration is 0.4s → truncated.
  const track = {
    clips: [
      clip('c1', 0, 0.15, 'startSpin'),
      clip('c2', 0.15, 2.0, 'spin')
    ]
  };
  const resolved = resolveSpinnerTrack(cfg, track);
  const atCut = evaluateSpinner(cfg, resolved, 0.15).reels[0];
  assert.ok(atCut.speed > 0, 'moving at the cut');
  assert.ok(atCut.speed < cfg.timing.spinSpeed - 1e-3, 'below vmax at the cut');
  const { ds, dv } = continuityAt(cfg, resolved, 0.15, 0);
  assert.ok(ds < 1e-4 && dv < 1e-3, `stitch broken: Δs=${ds} Δv=${dv}`);
  const later = evaluateSpinner(cfg, resolved, 1.5).reels[0];
  assert.ok(Math.abs(later.speed - cfg.timing.spinSpeed) < 1e-6, 'reaches vmax');
});

test('small authoring gaps between clips bridge at constant speed', () => {
  const cfg = makeConfig();
  const track = {
    clips: [
      clip('c1', 0, 0.5, 'startSpin'),
      clip('c2', 0.7, 1.0, 'spin') // 0.2s gap, like ADJACENT_ADD_MIN_GAP
    ]
  };
  const resolved = resolveSpinnerTrack(cfg, track);
  const inGap = evaluateSpinner(cfg, resolved, 0.6).reels[0];
  assert.ok(inGap.speed > 0, 'still moving in the gap');
  const { ds, dv } = continuityAt(cfg, resolved, 0.7, 0);
  assert.ok(ds < 1e-4 && dv < 1e-3, 'continuous into the next clip');
});

// ── Stop landing ───────────────────────────────────────────────────────

test('stopSpin lands exactly on the target board, integer scroll, no residue', () => {
  const cfg = makeConfig();
  const target = generateNonWinningBoard(SYMS, 5, 3, 777);
  const resolved = resolveSpinnerTrack(cfg, standardTrack({ stop: { targetBoard: target } }));
  const stop = resolved.stops[0];
  assert.ok(stop, 'stop event recorded');
  const t = stop.allLandedAt + 0.5;
  const res = evaluateSpinner(cfg, resolved, t);
  for (let r = 0; r < 5; r++) {
    const reel = res.reels[r];
    assert.equal(reel.frac, 0, `reel ${r} frac`);
    assert.equal(reel.speed, 0, `reel ${r} speed`);
    for (let j = 0; j < 3; j++) {
      const cell = reel.cells.find((c) => c.gridRow === j);
      assert.equal(cell.symbolId, target[r][j], `reel ${r} row ${j}`);
    }
  }
});

test('default (seeded) stop board is deterministic and non-winning', () => {
  const cfg = makeConfig();
  const r1 = resolveSpinnerTrack(cfg, standardTrack());
  const r2 = resolveSpinnerTrack(cfg, standardTrack());
  assert.deepEqual(r1.stops[0].target, r2.stops[0].target);
  assert.equal(boardHasWin(r1.stops[0].target), false);
  assert.equal(r1.stops[0].winCells.length, 0);
});

test('reel stagger cascades stop times', () => {
  const cfg = makeConfig();
  const resolved = resolveSpinnerTrack(cfg, standardTrack());
  const { landAt } = resolved.stops[0];
  for (let r = 1; r < 5; r++) {
    assert.ok(landAt[r] > landAt[r - 1], `reel ${r} lands after reel ${r - 1}`);
  }
});

test('matchEntrySpeed=false keeps the authored stop duration exactly', () => {
  const cfg = makeConfig();
  const resolved = resolveSpinnerTrack(cfg, standardTrack({ stop: { matchEntrySpeed: false } }));
  const { landAt } = resolved.stops[0];
  for (let r = 0; r < 5; r++) {
    const expected = 3.0 + r * cfg.timing.reelStaggerStop + cfg.timing.stopDuration;
    assert.ok(Math.abs(landAt[r] - expected) < 1e-9, `reel ${r}: ${landAt[r]} vs ${expected}`);
  }
});

test('win cells and win window derive from a winning target board', () => {
  const cfg = makeConfig();
  const target = generateWinningBoard(SYMS, 5, 3, 99);
  const resolved = resolveSpinnerTrack(cfg, standardTrack({ stop: { targetBoard: target } }));
  const stop = resolved.stops[0];
  assert.ok(stop.winCells.length >= 3);
  const tWin = stop.winStartAt + 0.1;
  const res = evaluateSpinner(cfg, resolved, tWin);
  for (const wc of stop.winCells) {
    const cell = res.reels[wc.reel].cells.find((c) => c.gridRow === wc.row);
    assert.equal(cell.state, 'win', `cell r${wc.reel} j${wc.row}`);
    assert.ok(Math.abs(cell.stateT - 0.1) < 1e-9);
  }
});

test('landing state plays per reel as it stops', () => {
  const cfg = makeConfig();
  const resolved = resolveSpinnerTrack(cfg, standardTrack());
  const { landAt } = resolved.stops[0];
  // Reel 0 landed, reel 4 still spinning.
  const t = landAt[0] + 0.1;
  assert.ok(t < landAt[4], 'stagger gives a window where reel 4 still spins');
  const res = evaluateSpinner(cfg, resolved, t);
  const r0 = res.reels[0].cells.find((c) => c.gridRow === 0);
  assert.equal(r0.state, 'landing');
  const r4 = res.reels[4].cells.find((c) => c.gridRow === 0);
  assert.equal(r4.state, 'spinning');
});

// ── Initial state & blur ───────────────────────────────────────────────

test('before the first clip the initial board shows, idle', () => {
  const cfg = makeConfig();
  const resolved = resolveSpinnerTrack(cfg, standardTrack());
  const res = evaluateSpinner(cfg, resolved, 0.1); // first clip starts at 0.5
  for (let r = 0; r < 5; r++) {
    assert.equal(res.reels[r].scroll, 0);
    assert.equal(res.reels[r].speed, 0);
    for (let j = 0; j < 3; j++) {
      const cell = res.reels[r].cells.find((c) => c.gridRow === j);
      assert.equal(cell.symbolId, cfg.initialBoard[r][j]);
      assert.equal(cell.state, 'idle');
    }
  }
});

test('blurMix is 0 at rest, 1 at full speed, monotone through the ramp', () => {
  const cfg = makeConfig();
  const resolved = resolveSpinnerTrack(cfg, standardTrack());
  assert.equal(evaluateSpinner(cfg, resolved, 0.1).reels[0].blurMix, 0);
  assert.equal(evaluateSpinner(cfg, resolved, 2.0).reels[0].blurMix, 1);
  let prev = -1;
  for (let t = 0.5; t <= 0.9; t += 0.02) {
    const mix = evaluateSpinner(cfg, resolved, t).reels[0].blurMix;
    assert.ok(mix >= prev - 1e-12, `blurMix not monotone at t=${t}`);
    prev = mix;
  }
});

test('bounce produces an offset inside the settle window and zero after landing', () => {
  const cfg = makeConfig();
  const resolved = resolveSpinnerTrack(cfg, standardTrack());
  const stop = resolved.stops[0];
  const land = stop.landAt[0];
  // Sample the last 35% of reel 0's decel — backOut−linear must produce a hump.
  let sawOffset = false;
  for (let k = 0; k <= 20; k++) {
    const decelStart = land - 0.0001; // probe just before landing backwards
    void decelStart;
    const t = land - (k / 20) * 0.2;
    const off = evaluateSpinner(cfg, resolved, t).reels[0].bounceOffset;
    if (Math.abs(off) > 1e-4) sawOffset = true;
  }
  assert.ok(sawOffset, 'bounce window produced no offset');
  assert.equal(evaluateSpinner(cfg, resolved, land + 0.2).reels[0].bounceOffset, 0);
});

// ── Purity / determinism ───────────────────────────────────────────────

test('evaluate is order-independent (pure)', () => {
  const cfg = makeConfig();
  const resolved = resolveSpinnerTrack(cfg, standardTrack());
  const rand = mulberry32(7);
  const times = Array.from({ length: 50 }, () => rand() * 6);
  const fresh = times.map((t) => JSON.stringify(evaluateSpinner(cfg, resolved, t)));
  const shuffled = times.map((t, i) => ({ t, i })).sort((a, b) => (a.t % 0.13) - (b.t % 0.13));
  for (const { t, i } of shuffled) {
    assert.equal(JSON.stringify(evaluateSpinner(cfg, resolved, t)), fresh[i]);
  }
});

test('normalizeClip roundtrips spinner action clips (scene.json load path)', async () => {
  const { normalizeClip } = await import('../sceneModel.js');
  const target = generateNonWinningBoard(SYMS, 5, 3, 5);
  const c = normalizeClip({
    id: 'x', start: 1, duration: 2, action: 'stopSpin',
    spinner: { targetBoard: target, matchEntrySpeed: false, perReelStopDelay: [0, 0.1, 0.2, 0.3, 0.4] }
  });
  assert.equal(c.action, 'stopSpin');
  assert.deepEqual(c.spinner.targetBoard, target);
  assert.equal(c.spinner.matchEntrySpeed, false);
  assert.deepEqual(c.spinner.perReelStopDelay, [0, 0.1, 0.2, 0.3, 0.4]);
  const plain = normalizeClip({ id: 'y', start: 0, duration: 1, anim: 'idle' });
  assert.equal(plain.action, null);
  assert.equal(plain.spinner, null);
  const bogus = normalizeClip({ id: 'z', start: 0, duration: 1, action: 'fly' });
  assert.equal(bogus.action, null);
});

test('resolve is deterministic and the memo key is stable', () => {
  const cfg = makeConfig();
  const track = standardTrack();
  assert.equal(spinnerResolveKey(cfg, track), spinnerResolveKey(makeConfig(), standardTrack()));
  const a = resolveSpinnerTrack(cfg, track);
  const b = resolveSpinnerTrack(cfg, track);
  assert.deepEqual(a.stops, b.stops);
  for (let r = 0; r < 5; r++) assert.deepEqual(a.segments[r], b.segments[r]);
});
