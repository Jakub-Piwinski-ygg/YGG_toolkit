// Unit tests for the asset-URL resolution helper (engine/persist.js).
// Run with: node --test src/tools/SceneStudio/engine/

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveAssetUrl, relinkSceneAssetsToScan } from './persist.js';

test('resolveAssetUrl: data:/blob:/http(s): sources resolve directly, no rootHandle needed', async () => {
  assert.deepEqual(await resolveAssetUrl('data:image/png;base64,AAAA', null), { url: 'data:image/png;base64,AAAA' });
  assert.deepEqual(await resolveAssetUrl('blob:http://localhost:5173/abc-123', null), { url: 'blob:http://localhost:5173/abc-123' });
  assert.deepEqual(await resolveAssetUrl('https://example.com/a.png', null), { url: 'https://example.com/a.png' });
  assert.deepEqual(await resolveAssetUrl('http://example.com/a.png', null), { url: 'http://example.com/a.png' });
});

test('resolveAssetUrl: relative paths need a rootHandle, else null', async () => {
  assert.equal(await resolveAssetUrl('Symbols/h1.png', null), null);
});

test('resolveAssetUrl: non-string src returns null', async () => {
  assert.equal(await resolveAssetUrl(undefined, null), null);
  assert.equal(await resolveAssetUrl(null, null), null);
  assert.equal(await resolveAssetUrl(123, null), null);
});

// ── relinkSceneAssetsToScan ──────────────────────────────────────────────

const scan = [
  { type: 'png',   name: 'h1.png', folder: 'New/02_Symbols/StaticArt', path: 'New/02_Symbols/StaticArt/h1.png' },
  { type: 'spine', name: 'symbol_h1', folder: 'New/02_Symbols/Animations',
    jsonPath: 'New/02_Symbols/Animations/symbol_h1.json',
    atlasPath: 'New/02_Symbols/Animations/symbol_h1.atlas',
    texturePath: 'New/02_Symbols/Animations/symbol_h1.png' },
];

test('relink: repoints a moved png to its new path by filename', () => {
  const scene = { projectRoot: '', assets: [{ id: 'a1', type: 'png', src: 'Old/Symbols/h1.png' }] };
  const { scene: out, relinked, missing } = relinkSceneAssetsToScan(scene, scan);
  assert.deepEqual(relinked, ['h1.png']);
  assert.equal(missing.length, 0);
  assert.equal(out.assets[0].src, 'New/02_Symbols/StaticArt/h1.png');
});

test('relink: repoints a moved spine and restores atlas+texture', () => {
  const scene = { projectRoot: '', assets: [{ id: 's1', type: 'spine', src: 'Old/Anim/symbol_h1.json', atlas: 'Old/Anim/symbol_h1.atlas', texture: 'Old/Anim/symbol_h1.png' }] };
  const { scene: out, relinked } = relinkSceneAssetsToScan(scene, scan);
  assert.deepEqual(relinked, ['symbol_h1.json']);
  assert.equal(out.assets[0].src, 'New/02_Symbols/Animations/symbol_h1.json');
  assert.equal(out.assets[0].atlas, 'New/02_Symbols/Animations/symbol_h1.atlas');
  assert.equal(out.assets[0].texture, 'New/02_Symbols/Animations/symbol_h1.png');
});

test('relink: never disturbs an asset whose path still resolves', () => {
  const scene = { projectRoot: '', assets: [{ id: 'a1', type: 'png', src: 'New/02_Symbols/StaticArt/h1.png' }] };
  const { scene: out, relinked } = relinkSceneAssetsToScan(scene, scan);
  assert.equal(relinked.length, 0);
  assert.equal(out, scene); // unchanged reference when nothing relinked
});

test('relink: honors projectRoot prefix when judging resolvability', () => {
  // src is projectRoot-relative; the real file sits under base + src.
  const scene = { projectRoot: 'New/02_Symbols', assets: [{ id: 'a1', type: 'png', src: 'StaticArt/h1.png' }] };
  const { relinked } = relinkSceneAssetsToScan(scene, scan);
  assert.equal(relinked.length, 0); // already resolvable via base prefix → untouched
});

test('relink: reports a filename with no match as missing', () => {
  const scene = { projectRoot: '', assets: [{ id: 'x', type: 'png', src: 'Old/gone.png', meta: { originalName: 'gone.png' } }] };
  const { relinked, missing } = relinkSceneAssetsToScan(scene, scan);
  assert.equal(relinked.length, 0);
  assert.deepEqual(missing, ['gone.png']);
});

test('relink: same filename in two folders → picks the longest trailing-path match', () => {
  const dupScan = [
    { type: 'png', name: 'h1.png', folder: 'A/Symbols/StaticArt', path: 'A/Symbols/StaticArt/h1.png' },
    { type: 'png', name: 'h1.png', folder: 'B/Other', path: 'B/Other/h1.png' },
  ];
  const scene = { projectRoot: '', assets: [{ id: 'a1', type: 'png', src: 'Old/Symbols/StaticArt/h1.png' }] };
  const { scene: out, relinked, ambiguous } = relinkSceneAssetsToScan(scene, dupScan);
  assert.deepEqual(relinked, ['h1.png']);
  assert.equal(ambiguous.length, 0);
  assert.equal(out.assets[0].src, 'A/Symbols/StaticArt/h1.png'); // shares StaticArt/h1.png tail
});

test('relink: leaves data: and blob: sources untouched', () => {
  const scene = { projectRoot: '', assets: [
    { id: 'd', type: 'png', src: 'data:image/png;base64,AAAA' },
    { id: 'b', type: 'png', src: 'blob:http://localhost/xyz' },
  ] };
  const { relinked, missing } = relinkSceneAssetsToScan(scene, scan);
  assert.equal(relinked.length, 0);
  assert.equal(missing.length, 0);
});
