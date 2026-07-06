// Node test: node structuralHash.test.mjs
import assert from 'node:assert';
import {
  sceneStructuralHash, sceneStructuralParts, diffStructuralParts,
  spinnerStructuralSig, winseqNumberSig,
} from './structuralHash.js';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓', name); };

const baseScene = () => ({
  activeCanvasId: 'c1',
  canvases: [{ id: 'c1', name: 'Canvas', visible: true }],
  assets: [
    { id: 'a1', type: 'png', src: 'data:image/png;base64,AAAA' },
    { id: 'a2', type: 'spine', src: 'x.json', atlas: 'x.atlas', texture: 'x.png' },
    { id: 'a3', type: 'video', src: 'v.webm' },
    {
      id: 'a4', type: 'spinner',
      spinner: {
        rev: 1, seed: 7,
        grid: { reels: 5, rows: 3, cellW: 200, cellH: 200, spacingX: 0, spacingY: 0 },
        symbols: [
          { id: 's1', assetId: 'a1', blurAssetId: null, landAnim: null, winAnim: { kind: 'spine', assetId: 'a2', anim: 'win', loop: true } },
          { id: 's2', assetId: 'a1', blurAssetId: null, landAnim: null, winAnim: null },
        ],
        strips: [['s1', 's2']], initialBoard: [['s1', 's2', 's1']],
        timing: { spinUp: 0.2 }, blur: { mix: 1 }, events: {}, perReel: [], direction: 1,
      },
    },
    {
      id: 'a5', type: 'winseq', src: 'w.json', atlas: 'w.atlas', texture: 'w.png',
      winseq: {
        rev: 3,
        tiers: [{ key: 'small', begin: '01a', idle: '01b', end: '01c', enabled: true }],
        setupPose: { sequenceId: null, t: 0 },
        number: { fontSrc: 'font.png', cell: 256, cols: 8, rows: 8, charLayout: '0123456789', glyphScale: 1, wager: 1, decimals: 2 },
      },
    },
    { id: 'a6', type: 'winnumber', parentAssetId: 'a5' },
  ],
  layers: [
    { id: 'L1', assetId: 'a1', canvasId: 'c1', parentId: null, visible: true, blend: 'normal', transforms: { landscape: { x: 0, y: 0 } } },
    { id: 'L2', assetId: 'a2', canvasId: 'c1', parentId: 'L1', spine: { defaultAnimation: 'idle', loop: true, defaultMix: 0, skin: null } },
    { id: 'L3', assetId: 'a3', canvasId: 'c1', parentId: null, video: { loop: true, muted: true } },
    { id: 'L4', assetId: 'a4', canvasId: 'c1', parentId: null },
    { id: 'L5', assetId: 'a5', canvasId: 'c1', parentId: null },
    { id: 'L6', assetId: 'a6', canvasId: 'c1', parentId: 'L5' },
  ],
  flow: { tracks: [] },
  stage: { activeOrientation: 'landscape' },
});

const hash = (mut) => {
  const s = baseScene();
  mut?.(s);
  return sceneStructuralHash(s);
};
const H0 = hash();

// ── runtime edits must NOT change the hash ──────────────────────────────────
ok('transform / eye / blend edits are not structural', () => {
  assert.equal(hash((s) => { s.layers[0].transforms.landscape.x = 500; }), H0);
  assert.equal(hash((s) => { s.layers[0].visible = false; }), H0);
  assert.equal(hash((s) => { s.layers[0].blend = 'screen'; }), H0);
});
ok('timeline (flow) edits are not structural', () => {
  assert.equal(hash((s) => { s.flow = { tracks: [{ id: 't', layerId: 'L1', clips: [{ id: 'c', start: 0, duration: 2 }] }] }; }), H0);
});
ok('spine layer defaults are not structural', () => {
  assert.equal(hash((s) => { s.layers[1].spine = { defaultAnimation: 'run', loop: false, defaultMix: 0.2, skin: 'alt' }; }), H0);
});
ok('video layer options are not structural', () => {
  assert.equal(hash((s) => { s.layers[2].video = { loop: false, muted: false }; }), H0);
});
ok('spinner runtime fields (rev/timing/blur/board/strips/seed) are not structural', () => {
  assert.equal(hash((s) => {
    const sp = s.assets[3].spinner;
    sp.rev = 99; sp.timing = { spinUp: 1.5 }; sp.blur = { mix: 0 };
    sp.initialBoard = [['s2', 's1', 's2']]; sp.strips = [['s2', 's1']]; sp.seed = 123;
  }), H0);
});
ok('spinner cell size / spacing are geometry, not structural (live relayout)', () => {
  assert.equal(hash((s) => {
    const g = s.assets[3].spinner.grid;
    g.cellW = 260; g.cellH = 180; g.spacingX = 12; g.spacingY = 8;
  }), H0);
});
ok('spinner resolved anim durations are not structural', () => {
  assert.equal(hash((s) => { s.assets[3].spinner.symbols[0].winAnim.duration = 0.8; }), H0);
});
ok('winseq runtime fields (rev/tiers/setupPose/number formatting) are not structural', () => {
  assert.equal(hash((s) => {
    const ws = s.assets[4].winseq;
    ws.rev = 42; ws.tiers = [{ key: 'mega', begin: '06a', idle: '06b', end: '06c', enabled: true }];
    ws.setupPose = { sequenceId: 'f1', t: 2 };
    ws.number = { ...ws.number, glyphScale: 2, wager: 50, decimals: 0, currency: '€', letterSpacing: 4 };
  }), H0);
});

// ── structural edits MUST change the hash ───────────────────────────────────
ok('asset src swap is structural', () => {
  assert.notEqual(hash((s) => { s.assets[0].src = 'data:image/png;base64,BBBBBB'; }), H0);
});
ok('spine atlas/texture repair is structural', () => {
  assert.notEqual(hash((s) => { s.assets[1].atlas = 'fixed.atlas'; }), H0);
});
ok('layer add / remove / reorder / reparent / canvas move are structural', () => {
  assert.notEqual(hash((s) => { s.layers.push({ id: 'L9', assetId: 'a1', canvasId: 'c1', parentId: null }); }), H0);
  assert.notEqual(hash((s) => { s.layers.splice(0, 1); }), H0);
  assert.notEqual(hash((s) => { s.layers.reverse(); }), H0);
  assert.notEqual(hash((s) => { s.layers[3].parentId = 'L1'; }), H0);
  assert.notEqual(hash((s) => { s.layers[3].canvasId = 'c2'; }), H0);
});
ok('active canvas switch + canvas visibility are structural', () => {
  assert.notEqual(hash((s) => { s.activeCanvasId = 'c2'; }), H0);
  assert.notEqual(hash((s) => { s.canvases[0].visible = false; }), H0);
});
ok('spinner grid / symbol set / anim specs are structural', () => {
  assert.notEqual(hash((s) => { s.assets[3].spinner.grid.reels = 6; }), H0);
  assert.notEqual(hash((s) => { s.assets[3].spinner.symbols.push({ id: 's3', assetId: 'a1' }); }), H0);
  assert.notEqual(hash((s) => { s.assets[3].spinner.symbols[0].winAnim.anim = 'win2'; }), H0);
  assert.notEqual(hash((s) => { s.assets[3].spinner.symbols[1].blurAssetId = 'a1'; }), H0);
});
ok('winseq skeleton + number glyph structure are structural', () => {
  assert.notEqual(hash((s) => { s.assets[4].src = 'other.json'; }), H0);
  assert.notEqual(hash((s) => { s.assets[4].winseq.number.fontSrc = 'font2.png'; }), H0);
  assert.notEqual(hash((s) => { s.assets[4].winseq.number.charLayout = '0123456789,.'; }), H0);
  assert.notEqual(hash((s) => { s.assets[4].winseq.number.cols = 16; }), H0);
});
ok('winnumber parent swap is structural', () => {
  assert.notEqual(hash((s) => { s.assets[5].parentAssetId = 'a4'; }), H0);
});

// ── signatures + diff ───────────────────────────────────────────────────────
ok('spinnerStructuralSig ignores runtime + geometry, tracks topology', () => {
  const sp = baseScene().assets[3].spinner;
  const sig = spinnerStructuralSig(sp);
  assert.equal(spinnerStructuralSig({ ...sp, timing: { spinUp: 9 }, rev: 7, strips: [] }), sig);
  assert.equal(spinnerStructuralSig({ ...sp, grid: { ...sp.grid, cellW: 300, spacingY: 20 } }), sig);
  assert.notEqual(spinnerStructuralSig({ ...sp, grid: { ...sp.grid, rows: 4 } }), sig);
});
ok('winseqNumberSig ignores formatting, tracks glyph set', () => {
  const ws = baseScene().assets[4].winseq;
  const sig = winseqNumberSig(ws);
  assert.equal(winseqNumberSig({ ...ws, number: { ...ws.number, wager: 9, glyphScale: 3 } }), sig);
  assert.notEqual(winseqNumberSig({ ...ws, number: { ...ws.number, cell: 128 } }), sig);
  assert.equal(winseqNumberSig({ tiers: [] }), '-');
});
ok('diffStructuralParts names the changed entry', () => {
  const a = baseScene();
  const b = baseScene();
  b.layers[3].parentId = 'L1';
  const diff = diffStructuralParts(sceneStructuralParts(a), sceneStructuralParts(b));
  assert.ok(diff.some((d) => d.includes('layer:L4')), JSON.stringify(diff));
  assert.deepEqual(diffStructuralParts(null, sceneStructuralParts(b)), ['initial build']);
  assert.deepEqual(diffStructuralParts(sceneStructuralParts(a), sceneStructuralParts(a)), []);
  const c = baseScene();
  c.layers.reverse(); // pure z-order change — same part set, different sequence
  assert.deepEqual(diffStructuralParts(sceneStructuralParts(a), sceneStructuralParts(c)), ['order changed (reorder)']);
});

console.log(`structuralHash: ${pass} checks passed`);
