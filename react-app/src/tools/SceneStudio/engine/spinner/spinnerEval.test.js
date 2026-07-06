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
  generateOutcomeBoard,
  classifySymbols,
  spinnerPresentWinDuration,
  buildSpinnerTestClips,
  defaultSpinnerTiming,
  defaultSpinnerBlur,
  mulberry32
} from './spinnerModel.js';
import {
  resolveSpinnerTrack,
  evaluateSpinner,
  spinnerResolveKey
} from './spinnerEval.js';
import { normalizeTrack } from '../sceneModel.js';

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

// Regression: the wizard allows as few as 2 symbols and as many as 6 rows —
// a combination the two fixtures above never covered, and the exact gap that
// let generateNonWinningBoard silently return a winning board (the greedy
// reel-2 fixup could exhaust its "safe" replacement pool with only 2 symbols,
// e.g. seed 3 at 2 symbols/3 reels/5 rows used to still have a win).
test('non-winning generator: never wins across the wizard\'s full symbol/reel/row range (2-6 symbols)', () => {
  for (let nsym = 2; nsym <= 6; nsym++) {
    const ids = SYMS.slice(0, nsym);
    for (const reels of [3, 5, 9]) {
      for (const rows of [1, 3, 6]) {
        for (let seed = 0; seed < 100; seed++) {
          assert.equal(
            boardHasWin(generateNonWinningBoard(ids, reels, rows, seed)),
            false,
            `${nsym} symbols, ${reels}x${rows}, seed ${seed}`
          );
        }
      }
    }
  }
});

test('non-winning generator: wild-aware even at the 2-symbol edge (1 non-wild symbol left)', () => {
  // Only one non-wild symbol survives wild-filtering — genuinely impossible
  // to avoid a win (every reel must contain that symbol). Just confirm this
  // doesn't throw and still returns a well-shaped board.
  const board = generateNonWinningBoard(['a', 'wd'], 5, 3, 7, 'wd');
  assert.equal(board.length, 5);
  assert.ok(board.every((col) => col.length === 3 && col.every((id) => id === 'a')));
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
  // startSpin only 0.15s long but startDuration is 0.25s → truncated.
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

// ── Present-win clip (§A) ──────────────────────────────────────────────

/** standard track + a presentWin clip placed after the stop. */
function trackWithPresentWin(stopExtra, presentExtra, presentStart = 6.0) {
  return {
    clips: [
      clip('c1', 0.5, 0.5, 'startSpin'),
      clip('c2', 1.0, 2.0, 'spin'),
      clip('c3', 3.0, 2.0, 'stopSpin', stopExtra || {}),
      clip('c4', presentStart, 1.5, 'presentWin', presentExtra || {})
    ]
  };
}

test('presentWin clip drives win timing from its start, not the auto winDelay', () => {
  const cfg = makeConfig();
  const target = generateWinningBoard(SYMS, 5, 3, 99);
  const resolved = resolveSpinnerTrack(cfg, trackWithPresentWin({ targetBoard: target }, {}, 6.0));
  const stop = resolved.stops[0];
  assert.equal(stop.winExplicit, true, 'win is author-driven');
  // No win before the presentWin clip starts, even though reels landed earlier.
  const before = evaluateSpinner(cfg, resolved, stop.allLandedAt + 0.2);
  for (const wc of stop.winCells) {
    const cell = before.reels[wc.reel].cells.find((c) => c.gridRow === wc.row);
    assert.notEqual(cell.state, 'win', `no early win r${wc.reel} j${wc.row}`);
  }
  // Win plays right after the presentWin clip start (stagger 0 → all at once).
  const at = evaluateSpinner(cfg, resolved, 6.0 + 0.1);
  for (const wc of stop.winCells) {
    const cell = at.reels[wc.reel].cells.find((c) => c.gridRow === wc.row);
    assert.equal(cell.state, 'win', `win plays r${wc.reel} j${wc.row}`);
    assert.ok(Math.abs(cell.stateT - 0.1) < 1e-9);
  }
});

test('presentWin reelWinStagger cascades the win reel-by-reel', () => {
  const cfg = makeConfig();
  const target = generateWinningBoard(SYMS, 5, 3, 99);
  const resolved = resolveSpinnerTrack(cfg,
    trackWithPresentWin({ targetBoard: target }, { reelWinStagger: 0.25 }, 6.0));
  const stop = resolved.stops[0];
  // reel of the lowest index winning cell starts at 6.0; higher reels later.
  for (let r = 0; r < cfg.grid.reels; r++) {
    assert.ok(Math.abs(stop.winStartByReel[r] - (6.0 + r * 0.25)) < 1e-9, `reel ${r} win start`);
  }
  // At 6.1: reel 0 winning, reel 1 (start 6.25) not yet.
  const res = evaluateSpinner(cfg, resolved, 6.1);
  const win0 = stop.winCells.filter((c) => c.reel === 0);
  const win1 = stop.winCells.filter((c) => c.reel === 1);
  if (win0.length) assert.equal(res.reels[0].cells.find((c) => c.gridRow === win0[0].row).state, 'win');
  if (win1.length) assert.notEqual(res.reels[1].cells.find((c) => c.gridRow === win1[0].row).state, 'win');
});

test('no presentWin clip → auto win fallback unchanged', () => {
  const cfg = makeConfig();
  const target = generateWinningBoard(SYMS, 5, 3, 99);
  const resolved = resolveSpinnerTrack(cfg, standardTrack({ stop: { targetBoard: target } }));
  const stop = resolved.stops[0];
  assert.equal(stop.winExplicit, false);
  assert.ok(stop.winStartByReel.every((w) => Math.abs(w - stop.winStartAt) < 1e-12));
});

// ── Per-symbol win/land durations (real Spine length, no fixed cutoff) ──

/** Config whose winning symbol carries a specific win/land anim duration. */
function makeDurConfig(winningId, winDur, landDur = 0.5) {
  return normalizeSpinnerConfig({
    symbols: SYMS.map((id) => ({
      id,
      winAnim: id === winningId
        ? { kind: 'spine', assetId: 'sk', anim: 'win', loop: false, duration: winDur }
        : null,
      landAnim: { kind: 'spine', assetId: 'sk', anim: 'land', loop: false, duration: landDur }
    })),
    grid: { reels: 5, rows: 3, cellW: 200, cellH: 200 },
    seed: 1234,
    events: { winDelay: 0.15, landAnimDuration: 0.5, winAnimDuration: 2.0 }
  });
}

test('normalizeSymbol preserves a numeric anim duration', () => {
  const cfg = makeDurConfig('a', 3);
  const sym = cfg.symbols.find((s) => s.id === 'a');
  assert.equal(sym.winAnim.duration, 3);
  assert.equal(sym.landAnim.duration, 0.5);
});

test('win window uses the winning symbol real duration (3s plays for 3s, not the default)', () => {
  // Force a winning board where the winning symbol is "a" with a 3s win anim.
  const cfg = makeDurConfig('a', 3);
  const target = [
    ['a', 'b', 'c'], ['d', 'a', 'e'], ['f', 'e', 'a'], ['b', 'c', 'd'], ['e', 'f', 'b']
  ];
  const resolved = resolveSpinnerTrack(cfg, standardTrack({ stop: { targetBoard: target } }));
  const stop = resolved.stops[0];
  assert.equal(stop.winCells.length, 3, 'symbol a wins on reels 0,1,2');
  const wc = stop.winCells[0];
  const ws = stop.winStartByReel[wc.reel];
  // Still in 'win' at 2.5s (would have cut at the old 1s/2s default).
  const mid = evaluateSpinner(cfg, resolved, ws + 2.5).reels[wc.reel].cells.find((c) => c.gridRow === wc.row);
  assert.equal(mid.state, 'win', 'still winning at 2.5s');
  // Past the real 3s length → no longer 'win'.
  const after = evaluateSpinner(cfg, resolved, ws + 3.01).reels[wc.reel].cells.find((c) => c.gridRow === wc.row);
  assert.notEqual(after.state, 'win', 'win ended at its real 3s length');
});

test('a 1s-win symbol stops at 1s while a 3s-win symbol keeps playing', () => {
  const cfgShort = makeDurConfig('a', 1);
  const target = [
    ['a', 'b', 'c'], ['d', 'a', 'e'], ['f', 'e', 'a'], ['b', 'c', 'd'], ['e', 'f', 'b']
  ];
  const resolved = resolveSpinnerTrack(cfgShort, standardTrack({ stop: { targetBoard: target } }));
  const wc = resolved.stops[0].winCells[0];
  const ws = resolved.stops[0].winStartByReel[wc.reel];
  const at12 = evaluateSpinner(cfgShort, resolved, ws + 1.2).reels[wc.reel].cells.find((c) => c.gridRow === wc.row);
  assert.notEqual(at12.state, 'win', '1s win has ended by 1.2s');
});

test('unknown duration (0) falls back to events.winAnimDuration', () => {
  const cfg = makeDurConfig('a', 0); // 0 → unknown
  const target = [
    ['a', 'b', 'c'], ['d', 'a', 'e'], ['f', 'e', 'a'], ['b', 'c', 'd'], ['e', 'f', 'b']
  ];
  const resolved = resolveSpinnerTrack(cfg, standardTrack({ stop: { targetBoard: target } }));
  const wc = resolved.stops[0].winCells[0];
  const ws = resolved.stops[0].winStartByReel[wc.reel];
  // Within the 2s fallback → win; past it → not.
  assert.equal(evaluateSpinner(cfg, resolved, ws + 1.5).reels[wc.reel].cells.find((c) => c.gridRow === wc.row).state, 'win');
  assert.notEqual(evaluateSpinner(cfg, resolved, ws + 2.5).reels[wc.reel].cells.find((c) => c.gridRow === wc.row).state, 'win');
});

// ── T7: animations-only symbols hold their win pose at rest ─────────────

test('normalizeSymbol: animOnly defaults false and is NOT inferred from a missing assetId', () => {
  const cfg = makeDurConfig('a', 1); // makeDurConfig's symbols have no assetId at all
  const sym = cfg.symbols.find((s) => s.id === 'a');
  assert.equal(sym.assetId, null);
  assert.equal(sym.animOnly, false, 'missing assetId alone must not imply animOnly');
});

test('normalizeSymbol: animOnly true is preserved', () => {
  const cfg = makeDurConfig('a', 1);
  const raw = { ...cfg.symbols.find((s) => s.id === 'a'), animOnly: true };
  const cfg2 = normalizeSpinnerConfig({ ...cfg, symbols: cfg.symbols.map((s) => (s.id === 'a' ? raw : s)) });
  assert.equal(cfg2.symbols.find((s) => s.id === 'a').animOnly, true);
});

test('T7: an animOnly symbol holds "win" state indefinitely (no snap-back), an ordinary symbol still reverts', () => {
  const cfg = makeDurConfig('a', 1);
  cfg.symbols = cfg.symbols.map((s) => (s.id === 'a' ? { ...s, animOnly: true } : s));
  const target = [
    ['a', 'b', 'c'], ['d', 'a', 'e'], ['f', 'e', 'a'], ['b', 'c', 'd'], ['e', 'f', 'b']
  ];
  const resolved = resolveSpinnerTrack(cfg, standardTrack({ stop: { targetBoard: target } }));
  const wc = resolved.stops[0].winCells[0];
  const ws = resolved.stops[0].winStartByReel[wc.reel];
  const cellAt = (t) => evaluateSpinner(cfg, resolved, t).reels[wc.reel].cells.find((c) => c.gridRow === wc.row);
  assert.equal(cellAt(ws + 1.2).state, 'win', 'still win well past the authored 1s duration');
  assert.equal(cellAt(ws + 999).state, 'win', 'still win arbitrarily far in the future — this is the "hold last pose" contract');
  // Sanity: an ordinary (non-animOnly) symbol in the SAME config/time window
  // still reverts normally — this fix must not be a blanket change.
  const cfgOrdinary = makeDurConfig('a', 1); // fresh copy, animOnly left false
  const resolvedOrdinary = resolveSpinnerTrack(cfgOrdinary, standardTrack({ stop: { targetBoard: target } }));
  const cellOrdinary = evaluateSpinner(cfgOrdinary, resolvedOrdinary, ws + 1.2).reels[wc.reel].cells.find((c) => c.gridRow === wc.row);
  assert.notEqual(cellOrdinary.state, 'win', 'a non-animOnly symbol still snaps back after its win duration');
});

test('spinnerPresentWinDuration = maxReelDelay + longest win across mixed-length symbols', () => {
  const cfg = normalizeSpinnerConfig({
    symbols: [
      { id: 'a', winAnim: { kind: 'spine', assetId: 'sk', anim: 'w', loop: false, duration: 1 } },
      { id: 'b', winAnim: { kind: 'spine', assetId: 'sk', anim: 'w', loop: false, duration: 3 } },
      { id: 'c' }
    ],
    grid: { reels: 5, rows: 3, cellW: 200, cellH: 200 },
    seed: 7,
    events: { winDelay: 0.15, landAnimDuration: 0.5, winAnimDuration: 2.0 }
  });
  // stagger 0.25 over 5 reels → maxReelDelay = 4*0.25 = 1.0; longest win = 3.
  assert.ok(Math.abs(spinnerPresentWinDuration(cfg, 0.25) - (1.0 + 3)) < 1e-9);
  // With no stagger the duration is just the longest win.
  assert.ok(Math.abs(spinnerPresentWinDuration(cfg, 0) - 3) < 1e-9);
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

// ── Direct-mode outcome overrides (name-based tiers + wild) ─────────────

const NAMED_SYMS = [
  { id: 'l1', name: 'L1' }, { id: 'l2', name: 'lo_2' }, { id: 'l3', name: 'low ace' },
  { id: 'h1', name: 'H1' }, { id: 'h2', name: 'hi2' }, { id: 'h3', name: 'high_3' },
  { id: 'wd', name: 'Wild' }
];

function namedConfig(over = {}) {
  return normalizeSpinnerConfig({
    symbols: NAMED_SYMS,
    grid: { reels: 5, rows: 3, cellW: 200, cellH: 200 },
    seed: 1234,
    ...over
  });
}

test('classifySymbols: name convention → low/high pools + wild', () => {
  const { low, high, wildId } = classifySymbols(namedConfig());
  assert.deepEqual([...low].sort(), ['l1', 'l2', 'l3']);
  assert.deepEqual([...high].sort(), ['h1', 'h2', 'h3']);
  assert.equal(wildId, 'wd');
  // "gold" / "fish" must NOT classify as low/high by accident
  const cfg2 = normalizeSpinnerConfig({
    symbols: [{ id: 'g', name: 'gold' }, { id: 'f', name: 'fish' }, { id: 'x', name: 'axe' }, { id: 'y', name: 'orb' }],
    grid: { reels: 5, rows: 3, cellW: 200, cellH: 200 }, seed: 1
  });
  const c2 = classifySymbols(cfg2);
  assert.equal(c2.wildId, null);
  // order-based fallback: first half low, rest high
  assert.deepEqual(c2.low, ['g', 'f']);
  assert.deepEqual(c2.high, ['x', 'y']);
});

test('evalWaysWins with wild: substitution extends runs and joins cells', () => {
  const board = [
    ['l1', 'h1', 'h2'],
    ['wd', 'h3', 'l2'],
    ['l1', 'l3', 'h1'],
    ['h2', 'h3', 'l2'],
    ['l3', 'h1', 'h2']
  ];
  // Without a wild id, l1 stops at reel 1 → no win.
  assert.equal(boardHasWin(board), false);
  // With wd as wild: l1 spans reels 0,1(wild),2 → 3-of-a-kind incl. the wild cell.
  const wins = evalWaysWins(board, 'wd');
  const l1 = wins.find((w) => w.symbolId === 'l1');
  assert.ok(l1 && l1.count === 3);
  assert.ok(l1.cells.some((c) => board[c.reel][c.row] === 'wd'), 'wild cell joins the win');
  // The wild itself never appears as a winning symbol.
  assert.ok(!wins.some((w) => w.symbolId === 'wd'));
});

test('generateOutcomeBoard: noWin has no wilds and never wins (200 seeds)', () => {
  const cfg = namedConfig();
  for (let seed = 0; seed < 200; seed++) {
    const b = generateOutcomeBoard(cfg, 'noWin', seed);
    assert.equal(boardHasWin(b, 'wd'), false, `seed ${seed}`);
    assert.ok(!b.some((col) => col.includes('wd')), `seed ${seed} has a wild`);
  }
});

test('generateOutcomeBoard: smallWin = exactly one modest win (200 seeds)', () => {
  const cfg = namedConfig();
  for (let seed = 0; seed < 200; seed++) {
    const wins = evalWaysWins(generateOutcomeBoard(cfg, 'smallWin', seed), 'wd');
    assert.equal(wins.length, 1, `seed ${seed}: ${wins.length} wins`);
    assert.ok(wins[0].count >= 3 && wins[0].count <= 5, `seed ${seed}: count ${wins[0].count}`);
  }
});

test('generateOutcomeBoard: bigWin = multiple long high-symbol wins (200 seeds)', () => {
  const cfg = namedConfig();
  const high = new Set(['h1', 'h2', 'h3']);
  for (let seed = 0; seed < 200; seed++) {
    const wins = evalWaysWins(generateOutcomeBoard(cfg, 'bigWin', seed), 'wd');
    assert.ok(wins.length >= 2, `seed ${seed}: ${wins.length} wins`);
    assert.ok(wins.every((w) => w.count >= 4), `seed ${seed}: counts ${wins.map((w) => w.count)}`);
    assert.ok(wins.every((w) => high.has(w.symbolId)), `seed ${seed}: syms ${wins.map((w) => w.symbolId)}`);
  }
});

test('generateOutcomeBoard: wildWin = wilds substituting into several wins (200 seeds)', () => {
  const cfg = namedConfig();
  for (let seed = 0; seed < 200; seed++) {
    const b = generateOutcomeBoard(cfg, 'wildWin', seed);
    const wins = evalWaysWins(b, 'wd');
    assert.ok(wins.length >= 2, `seed ${seed}: ${wins.length} wins`);
    assert.ok(b.some((col) => col.includes('wd')), `seed ${seed}: no wilds placed`);
    assert.ok(
      wins.some((w) => w.cells.some((c) => b[c.reel][c.row] === 'wd')),
      `seed ${seed}: no win goes through a wild`
    );
  }
});

test('outcome overrides beat an authored targetBoard and change the resolve key', () => {
  const cfg = namedConfig();
  const authored = generateNonWinningBoard(['l1', 'l2', 'l3', 'h1', 'h2', 'h3'], 5, 3, 7);
  const track = standardTrack({ stop: { targetBoard: authored } });
  const plain = resolveSpinnerTrack(cfg, track);
  assert.deepEqual(plain.stops[0].target, authored, 'no outcome → authored board');
  const overridden = resolveSpinnerTrack(cfg, track, null, 'bigWin');
  assert.notDeepEqual(overridden.stops[0].target, authored);
  assert.ok(evalWaysWins(overridden.stops[0].target, 'wd').length >= 2);
  assert.notEqual(
    spinnerResolveKey(cfg, track, null, 'bigWin'),
    spinnerResolveKey(cfg, track, null, null)
  );
  // determinism: same outcome + seed → same board
  assert.deepEqual(
    resolveSpinnerTrack(cfg, track, null, 'bigWin').stops[0].target,
    overridden.stops[0].target
  );
});

// ── T12: reusable spin result randomization (re-roll) ───────────────────

test('T12: a clip\'s own authored outcome produces an outcome board with no Direct-mode override', () => {
  const cfg = namedConfig();
  const track = standardTrack({ stop: { outcome: 'bigWin', targetBoard: ['ignored'] } });
  const resolved = resolveSpinnerTrack(cfg, track); // no outcome override passed
  assert.ok(evalWaysWins(resolved.stops[0].target, 'wd').length >= 2, 'clip-authored outcome wins even with no Direct override');
});

test('T12: a Direct-mode override still beats the clip\'s own authored outcome', () => {
  const cfg = namedConfig();
  const track = standardTrack({ stop: { outcome: 'bigWin' } });
  const overridden = resolveSpinnerTrack(cfg, track, null, 'noWin');
  const wins = evalWaysWins(overridden.stops[0].target, 'wd');
  assert.equal(wins.length, 0, 'Direct override (noWin) wins over the clip\'s own bigWin');
});

test('T12: re-rolling the clip\'s OWN rerollSeed changes the board (no Direct override active)', () => {
  const cfg = namedConfig();
  const first = resolveSpinnerTrack(cfg, standardTrack({ stop: { outcome: 'bigWin' } })).stops[0].target;
  // With no Direct-mode override, resolveSpinnerTrack's own `outcomeReroll`
  // param is irrelevant — the clip's own rerollSeed field is what drives it.
  const rerolledViaClip = resolveSpinnerTrack(cfg, standardTrack({ stop: { outcome: 'bigWin', rerollSeed: 1 } })).stops[0].target;
  assert.notDeepEqual(rerolledViaClip, first, 'bumping the clip\'s own rerollSeed changes the board');
  assert.ok(evalWaysWins(rerolledViaClip, 'wd').length >= 2, 'still a valid bigWin board after reroll');
});

test('T12: re-rolling a Direct-mode override changes the board and the resolve key, same threshold', () => {
  const cfg = namedConfig();
  const track = standardTrack();
  const a = resolveSpinnerTrack(cfg, track, null, 'bigWin', 0).stops[0].target;
  const b = resolveSpinnerTrack(cfg, track, null, 'bigWin', 1).stops[0].target;
  assert.notDeepEqual(a, b, 're-roll 1 differs from re-roll 0');
  assert.ok(evalWaysWins(b, 'wd').length >= 2, 'still a valid bigWin board');
  assert.notEqual(
    spinnerResolveKey(cfg, track, null, 'bigWin', 0),
    spinnerResolveKey(cfg, track, null, 'bigWin', 1),
    'resolve key changes with the reroll counter so the memoized resolve actually re-runs'
  );
  // determinism: same outcome + same reroll → same board
  assert.deepEqual(resolveSpinnerTrack(cfg, track, null, 'bigWin', 1).stops[0].target, b);
});

test('T12: buildSpinnerTestClips carries outcome/rerollSeed into the stopSpin clip payload (wizard preview surface)', () => {
  const cfg = namedConfig();
  const { clips: defaultClips } = buildSpinnerTestClips(cfg);
  const stopDefault = defaultClips.find((c) => c.action === 'stopSpin');
  assert.ok(Array.isArray(stopDefault.spinner.targetBoard), 'default (no outcome) still lands a fixed seeded winning board');
  const { clips: outcomeClips } = buildSpinnerTestClips(cfg, 'noWin', 3);
  const stopOutcome = outcomeClips.find((c) => c.action === 'stopSpin');
  assert.equal(stopOutcome.spinner.outcome, 'noWin');
  assert.equal(stopOutcome.spinner.rerollSeed, 3);
  assert.equal(stopOutcome.spinner.targetBoard, undefined, 'outcome mode does not also carry a fixed targetBoard');
});

test('buildSpinnerTestClips: an explicit targetBoard wins over outcome and lands on it exactly (wizard Review-step Spin)', () => {
  const cfg = namedConfig();
  const explicitBoard = generateNonWinningBoard(['l1', 'l2', 'l3', 'h1', 'h2', 'h3'], 5, 3, 9);
  const { clips } = buildSpinnerTestClips(cfg, 'bigWin', 2, explicitBoard);
  const stop = clips.find((c) => c.action === 'stopSpin');
  assert.deepEqual(stop.spinner.targetBoard, explicitBoard, 'explicit board is carried verbatim, ignoring outcome/rerollSeed');
  assert.equal(stop.spinner.outcome, undefined);
  assert.equal(stop.spinner.rerollSeed, undefined);
  // The normalized clip resolves to exactly that board — no seed re-derivation.
  const track = normalizeTrack({ layerId: 'L1', clips });
  const resolved = resolveSpinnerTrack(cfg, track);
  assert.deepEqual(resolved.stops[0].target, explicitBoard);
});

// ── Regression: outcome/rerollSeed must survive normalizeTrack ──────────
// The T12 tests above all feed raw clips directly to resolveSpinnerTrack,
// bypassing normalizeTrack/normalizeSpinnerClipPayload entirely — which is
// exactly how the wizard's outcome dropdown shipped broken (the stopSpin
// branch of normalizeSpinnerClipPayload had a fixed key set that silently
// dropped `outcome`/`rerollSeed`). These tests route through normalizeTrack,
// the same path the wizard's test-spin and the timeline/director surfaces use.

test('normalizeTrack preserves stopSpin outcome + rerollSeed, drops invalid/default outcome names', () => {
  const raw = {
    layerId: 'L1',
    clips: [
      clip('c1', 0, 1, 'stopSpin', { outcome: 'bigWin', rerollSeed: 3 }),
      clip('c2', 1, 1, 'stopSpin', { outcome: 'bogus', rerollSeed: 2 }),
      clip('c3', 2, 1, 'stopSpin', { outcome: 'default', rerollSeed: 5 }),
      clip('c4', 3, 1, 'stopSpin', {})
    ]
  };
  const normalized = normalizeTrack(raw);
  assert.equal(normalized.clips[0].spinner.outcome, 'bigWin');
  assert.equal(normalized.clips[0].spinner.rerollSeed, 3);
  assert.equal(normalized.clips[1].spinner.outcome, null, 'unrecognized outcome name drops to null');
  assert.equal(normalized.clips[1].spinner.rerollSeed, 2, 'rerollSeed is preserved independent of outcome validity');
  assert.equal(normalized.clips[2].spinner.outcome, null, "'default' normalizes to null (matches buildSpinnerTestClips convention)");
  assert.equal(normalized.clips[3].spinner.outcome, null);
  assert.equal(normalized.clips[3].spinner.rerollSeed, 0, 'missing rerollSeed defaults to 0');
});

test('regression: an outcome authored via normalizeTrack still lands the requested outcome (was silently dropped)', () => {
  const cfg = namedConfig();
  const buildRaw = (rerollSeed) => ({
    layerId: 'L1',
    clips: [
      clip('c1', 0.5, 0.5, 'startSpin'),
      clip('c2', 1.0, 2.0, 'spin'),
      clip('c3', 3.0, 2.0, 'stopSpin', { outcome: 'noWin', rerollSeed })
    ]
  });
  const track = normalizeTrack(buildRaw(0));
  const resolved = resolveSpinnerTrack(cfg, track);
  const wins = evalWaysWins(resolved.stops[0].target, 'wd');
  assert.equal(wins.length, 0, 'noWin outcome, once it survives normalization, lands a genuinely non-winning board');

  // Determinism: same track resolves to the same board every time.
  const again = resolveSpinnerTrack(cfg, track);
  assert.deepEqual(again.stops[0].target, resolved.stops[0].target);

  // Re-roll (the clip's own rerollSeed) changes the board within the same outcome.
  const rerolled = resolveSpinnerTrack(cfg, normalizeTrack(buildRaw(1)));
  assert.notDeepEqual(rerolled.stops[0].target, resolved.stops[0].target);
  assert.equal(evalWaysWins(rerolled.stops[0].target, 'wd').length, 0, 'still noWin after reroll');
});

test('targetBoardForClip fallback (no outcome, no explicit board) is wild-aware — never a wild-substituted win (100 seeds)', () => {
  for (let seed = 0; seed < 100; seed++) {
    const cfg = namedConfig({ seed });
    const resolved = resolveSpinnerTrack(cfg, standardTrack());
    const wins = evalWaysWins(resolved.stops[0].target, 'wd');
    assert.equal(wins.length, 0, `seed ${seed}: unexpected win on the wild-blind fallback board`);
  }
});

test('normalizeSpinnerConfig initialBoard regen is wild-aware — never a wild-substituted win (100 seeds)', () => {
  for (let seed = 0; seed < 100; seed++) {
    const cfg = normalizeSpinnerConfig({
      symbols: NAMED_SYMS,
      grid: { reels: 5, rows: 3, cellW: 200, cellH: 200 },
      seed
    });
    assert.equal(evalWaysWins(cfg.initialBoard, 'wd').length, 0, `seed ${seed}`);
  }
});

// ── Grid schema: symbolScale + negative spacing ──────────────────────────

test('grid schema: symbolScale defaults to 1 and clamps to [0.05, 10]', () => {
  const cfg1 = makeConfig();
  assert.equal(cfg1.grid.symbolScale, 1);
  const cfg2 = makeConfig({ grid: { reels: 5, rows: 3, cellW: 200, cellH: 200, symbolScale: 0.001 } });
  assert.equal(cfg2.grid.symbolScale, 0.05);
  const cfg3 = makeConfig({ grid: { reels: 5, rows: 3, cellW: 200, cellH: 200, symbolScale: 50 } });
  assert.equal(cfg3.grid.symbolScale, 10);
});

test('grid schema: negative spacing is allowed, clamped so pitch (cell + spacing) stays >= 1', () => {
  const extreme = makeConfig({ grid: { reels: 5, rows: 3, cellW: 100, cellH: 80, spacingX: -500, spacingY: -500 } });
  assert.equal(extreme.grid.spacingX, -(100 - 1));
  assert.equal(extreme.grid.spacingY, -(80 - 1));
  assert.ok(extreme.grid.cellW + extreme.grid.spacingX >= 1);
  assert.ok(extreme.grid.cellH + extreme.grid.spacingY >= 1);

  const moderate = makeConfig({ grid: { reels: 5, rows: 3, cellW: 200, cellH: 200, spacingX: -50, spacingY: -20 } });
  assert.equal(moderate.grid.spacingX, -50);
  assert.equal(moderate.grid.spacingY, -20);
});

// ── Timing defaults snapshot ──────────────────────────────────────────────

test('defaultSpinnerTiming matches the updated design defaults', () => {
  assert.deepEqual(defaultSpinnerTiming(), {
    startDuration: 0.25,
    startEase: 'easeIn',
    spinSpeed: 30,
    stopDuration: 0.35,
    stopEase: 'easeOut',
    reelStaggerStart: 0.08,
    reelStaggerStop: 0.15,
    minSpinTime: 0.5
  });
});

test('grid schema: blur sigma/feather default and clamp, shared by static-symbol generation and the animOnly runtime bake', () => {
  assert.deepEqual(defaultSpinnerBlur(), { enabled: true, vLo: 4, vHi: 9, sigma: 8, feather: 4 });
  const cfg = makeConfig({ blur: { sigma: 0, feather: -5 } });
  assert.equal(cfg.blur.sigma, 1, 'clamped to the [1, 64] minimum');
  assert.equal(cfg.blur.feather, 0, 'clamped to the [0, 32] minimum');
  const cfg2 = makeConfig({ blur: { sigma: 999, feather: 999 } });
  assert.equal(cfg2.blur.sigma, 64);
  assert.equal(cfg2.blur.feather, 32);
});
