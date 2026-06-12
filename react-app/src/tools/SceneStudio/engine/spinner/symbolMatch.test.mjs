// Run: node symbolMatch.test.mjs (from this directory)
import { spineMatchScore, pickAnimName } from './symbolMatch.js';

let fails = 0;
const check = (label, actual, expected) => {
  const ok = actual === expected;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: ${JSON.stringify(actual)} ${ok ? '' : `(expected ${JSON.stringify(expected)})`}`);
};

const bestSpine = (sym, names) => {
  let best = null, bs = 0;
  for (const n of names) { const s = spineMatchScore(sym, n); if (s > bs) { bs = s; best = n; } }
  return best;
};

// User's exact case: Hp_5 static â†” Symbols_Hp5 spine
const spines = ['Symbols_Hp1', 'Symbols_Hp2', 'Symbols_Hp5', 'Symbols_Hp10', 'Symbols_Lp1', 'wild_anim'];
check('Hp_5 â†’ Symbols_Hp5', bestSpine('Hp_5', spines), 'Symbols_Hp5');
check('Hp_1 â†’ Symbols_Hp1 (not Hp10)', bestSpine('Hp_1', spines), 'Symbols_Hp1');
check('Hp_10 â†’ Symbols_Hp10', bestSpine('Hp_10', spines), 'Symbols_Hp10');
check('Lp_1 â†’ Symbols_Lp1', bestSpine('Lp_1', spines), 'Symbols_Lp1');
check('wild â†’ wild_anim', bestSpine('wild', spines), 'wild_anim');
check('scatter â†’ none', bestSpine('scatter', spines), null);

// User's exact case: Symbol_Hp1 file contains 'land_h1' â€” symbol Hp_1
check('anims [land_h1, win_h1, idle] land', pickAnimName(['land_h1', 'win_h1', 'idle'], 'land', 'Hp_1'), 'land_h1');
check('anims [land_h1, win_h1, idle] win', pickAnimName(['land_h1', 'win_h1', 'idle'], 'win', 'Hp_1'), 'win_h1');
// Shared file with many symbols: pick the right land for hp5 vs hp1
const shared = ['land_h1', 'land_h5', 'land_h10', 'win_h1', 'win_h5', 'idle'];
check('shared land Hp_5 â†’ land_h5', pickAnimName(shared, 'land', 'Hp_5'), 'land_h5');
check('shared land Hp_1 â†’ land_h1 (not h10)', pickAnimName(shared, 'land', 'Hp_1'), 'land_h1');
check('shared land Hp_10 â†’ land_h10', pickAnimName(shared, 'land', 'Hp_10'), 'land_h10');
// Per-symbol file with bare names
check('bare [land, win] land', pickAnimName(['land', 'win'], 'land', 'Hp_1'), 'land');
check('bare [land, win] win', pickAnimName(['land', 'win'], 'win', 'Hp_1'), 'win');
// CamelCase / no-separator variants
check('HP5 â†’ Symbols_Hp5', bestSpine('HP5', spines), 'Symbols_Hp5');
check('hp_05 zero-pad â†’ Symbols_Hp5', bestSpine('hp_05', spines), 'Symbols_Hp5');
// No land-like anim at all â†’ null (don't invent)
check('no land anim â†’ null', pickAnimName(['idle', 'loop'], 'land', 'Hp_1'), null);

console.log(fails ? `\n${fails} FAILURES` : '\nall passed');
process.exit(fails ? 1 : 0);
