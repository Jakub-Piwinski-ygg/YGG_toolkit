// Baked spinner reel hierarchy in the prefab YAML (Unity feedback round 2).
// Run: node --test src/tools/SceneStudio/unity/prefab.spinner.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrefab } from './prefab.js';
import { normalizeSpinnerConfig } from '../engine/spinner/spinnerModel.js';

const GUID_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const GUID_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const GUID_MASK = 'cccccccccccccccccccccccccccccccc';
const SPINNER_SCRIPT = 'dddddddddddddddddddddddddddddddd';

const REELS = 3;
const ROWS = 3;

function makeSpec(variant, maskGuid = null) {
  const config = normalizeSpinnerConfig({
    symbols: [{ id: 'a' }, { id: 'b' }],
    grid: { reels: REELS, rows: ROWS, cellW: 100, cellH: 100, spacingX: 10, spacingY: 5 },
    seed: 7
  });
  assert.ok(config, 'normalizeSpinnerConfig produced a config');
  return {
    canvasName: 'Scene_Canvas',
    variant,
    stage: { w: 1920, h: 1080 },
    pixelsPerUnit: 100,
    spinnerMaskSpriteGuid: maskGuid,
    spineScriptGuid: '',
    spinnerScriptGuid: SPINNER_SCRIPT,
    player: {
      scriptGuid: 'ee000000000000000000000000000000',
      clipGuid: 'ee111111111111111111111111111111',
      descriptorGuid: 'ee222222222222222222222222222222',
      durationSeconds: 5,
      spineCues: []
    },
    nodes: [{
      key: 'layer1',
      name: 'Spinner',
      kind: 'spinner',
      active: true,
      pos: { x: 0, y: 0 },
      scale: { x: 1, y: 1 },
      rotDeg: 0,
      alpha: 1,
      size: { w: 320, h: 310 },
      spriteGuid: null,
      spine: null,
      spinner: {
        configJson: '{"reels":3}',
        clipsJson: '{"clips":[]}',
        bindings: [
          { symbolId: 'a', staticGuid: GUID_A, blurGuid: null, staticSize: { w: 200, h: 100 }, blurSize: null },
          { symbolId: 'b', staticGuid: GUID_B, blurGuid: GUID_B, staticSize: { w: 100, h: 100 }, blurSize: { w: 100, h: 100 } }
        ],
        config
      },
      children: []
    }]
  };
}

const count = (hay, needle) => hay.split(needle).length - 1;

test('UI variant bakes layered Statics/Blurs/Fx with per-reel RectMask2D', async () => {
  const yaml = await buildPrefab(makeSpec('ui'));

  for (const name of ['Board', 'Statics', 'Blurs', 'Fx']) {
    assert.equal(count(yaml, `m_Name: ${name}\n`), 1, `${name} GO present once`);
  }
  // One reel column per layer (statics + blurs).
  for (let r = 0; r < REELS; r++) {
    assert.equal(count(yaml, `m_Name: Reel_${r}\n`), 2, `Reel_${r} in both layers`);
  }
  // rows+2 cells per reel per layer.
  for (let j = -1; j <= ROWS; j++) {
    assert.equal(count(yaml, `m_Name: Cell_${j}\n`), 2 * REELS, `Cell_${j} count`);
  }
  // RectMask2D per reel per layer.
  assert.equal(count(yaml, '3312d7739989d2b4e91e6319e9a96d76'), 2 * REELS, 'RectMask2D count');
  // No SpriteMask in UI variant.
  assert.equal(count(yaml, 'SpriteMask:'), 0);
  // Cells carry initial-board sprites (both symbol guids appear somewhere).
  assert.ok(yaml.includes(GUID_A) && yaml.includes(GUID_B), 'initial sprites referenced');
  // Component flags.
  assert.ok(yaml.includes('worldVariant: 0'));
  assert.ok(yaml.includes('maskSprite: {fileID: 0}'));
  // Board hangs under the spinner node: the spinner GO's transform lists the
  // Board transform as its first child.
  const boardTr = yaml.match(/--- !u!224 &(\d+)\nRectTransform:\n(?:.*\n)*?\s+m_GameObject: \{fileID: (\d+)\}/);
  assert.ok(boardTr, 'rect transforms parse');
  const boardGoDoc = yaml.split('--- ').find((d) => d.includes('m_Name: Board\n'));
  const boardTrId = boardGoDoc.match(/- component: \{fileID: (\d+)\}/)[1];
  const spinnerGoDoc = yaml.split('--- ').find((d) => d.includes('m_Name: Spinner\n'));
  const spinnerTrId = spinnerGoDoc.match(/- component: \{fileID: (\d+)\}/)[1];
  const spinnerTrDoc = yaml.split('--- ').find((d) => d.startsWith(`!u!224 &${spinnerTrId}\n`));
  assert.ok(spinnerTrDoc.includes(`- {fileID: ${boardTrId}}`), 'Board is a child of the spinner node');
});

test('world variant bakes SpriteRenderer cells + per-reel SpriteMask', async () => {
  const yaml = await buildPrefab(makeSpec('world', GUID_MASK));

  // SpriteMask child per reel per layer, referencing the white mask sprite.
  assert.equal(count(yaml, 'SpriteMask:'), 2 * REELS, 'SpriteMask count');
  // 2×REELS SpriteMask refs + 1 on the YggSpinner.maskSprite field.
  assert.equal(count(yaml, GUID_MASK), 2 * REELS + 1, 'mask sprite guid count');
  // Every cell is a masked SpriteRenderer: statics order 0, blurs order 1.
  assert.equal(count(yaml, 'm_MaskInteraction: 1'), 2 * REELS * (ROWS + 2), 'masked cells');
  const srDocs = yaml.split('--- ').filter((d) => d.startsWith('!u!212 '));
  const blurSrs = srDocs.filter((d) => d.includes('m_SortingOrder: 1'));
  assert.equal(blurSrs.length, REELS * (ROWS + 2), 'blur layer sorting order');
  // Blur cells start invisible.
  assert.ok(blurSrs.every((d) => /m_Color: \{r: 1, g: 1, b: 1, a: 0\}/.test(d)), 'blur cells alpha 0');
  // Component flags.
  assert.ok(yaml.includes('worldVariant: 1'));
  assert.ok(yaml.includes(`maskSprite: {fileID: 21300000, guid: ${GUID_MASK}, type: 3}`));
  // World fit: symbol "a" is 200×100 in a 100×100 cell → scale 0.5 on some cell.
  assert.ok(/m_LocalScale: \{x: 0\.5, y: 0\.5, z: 1\}/.test(yaml), 'fit scale baked');
  // No UI components in world variant.
  assert.equal(count(yaml, 'RectTransform:'), 0);
  assert.equal(count(yaml, '3312d7739989d2b4e91e6319e9a96d76'), 0);
});

test('legacy spinner payload without config still exports (no baked docs)', async () => {
  const spec = makeSpec('ui');
  delete spec.nodes[0].spinner.config;
  const yaml = await buildPrefab(spec);
  assert.equal(count(yaml, 'm_Name: Board\n'), 0, 'no baked hierarchy');
  assert.ok(yaml.includes("configJson: '{\"reels\":3}'"), 'component still serialized');
});
