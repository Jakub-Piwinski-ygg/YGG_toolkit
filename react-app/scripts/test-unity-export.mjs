// Headless smoke test for the Scene Studio Unity exporter.
// Run: node scripts/test-unity-export.mjs
// Builds a synthetic scene (1 animated static PNG + 1 group child), exports
// the .unitypackage, gunzips it, parses the tar and asserts the structure.

import { gunzipSync } from 'node:zlib';
import { exportUnityPackage } from '../src/tools/SceneStudio/unity/exportUnityPackage.js';

const PNG_1x1 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const scene = {
  $schema: 'ygg-scene/1',
  version: 1,
  name: 'SmokeTest',
  projectRoot: null,
  stage: {
    fps: 60,
    duration: 2,
    orientations: { landscape: { w: 1920, h: 1080 }, portrait: { w: 1080, h: 2160 } },
    activeOrientation: 'landscape',
    background: { type: 'checker' }
  },
  canvases: [{ id: 'c1', name: 'Main', visible: true }],
  activeCanvasId: 'c1',
  assets: [
    { id: 'a1', type: 'png', src: PNG_1x1, meta: { originalName: 'hero.png' } },
    {
      id: 'a2', type: 'spine',
      src: 'data:application/json,{"skeleton":{"spine":"4.2"}}',
      atlas: 'data:text/plain,wins.png%0Asize:1,1',
      texture: PNG_1x1,
      meta: { originalName: 'wins' }
    }
  ],
  layers: [
    {
      id: 'L1', name: 'Hero', canvasId: 'c1', parentId: null, assetId: 'a1',
      visible: true, blend: 'normal',
      transforms: {
        landscape: { x: 960, y: 540, scaleX: 1, scaleY: 1, rotation: 0, anchor: [0.5, 0.5], alpha: 1, tint: { r: 1, g: 1, b: 1 } },
        portrait: null
      }
    },
    {
      id: 'L2', name: 'Child', canvasId: 'c1', parentId: 'L1', assetId: 'a1',
      visible: true, blend: 'normal',
      transforms: {
        landscape: { x: 100, y: 50, scaleX: 0.5, scaleY: 0.5, rotation: 0.5, anchor: [0.5, 0.5], alpha: 0.8, tint: { r: 1, g: 1, b: 1 } },
        portrait: null
      }
    },
    {
      id: 'L3', name: 'wins', canvasId: 'c1', parentId: null, assetId: 'a2',
      visible: true, blend: 'normal',
      spine: { skin: 'default', defaultAnimation: 'big_win_idle', loop: true },
      transforms: {
        landscape: { x: 960, y: 540, scaleX: 1, scaleY: 1, rotation: 0, anchor: [0.5, 0.5], alpha: 1, tint: { r: 1, g: 1, b: 1 } },
        portrait: null
      }
    }
  ],
  effects: [],
  flow: {
    tracks: [{
      id: 'T1', layerId: 'L1', name: null,
      clips: [{
        id: 'C1', start: 0.25, duration: 1.0, loop: false, curve: 'linear', anim: null,
        speed: 1, mixDuration: null, autoFitDuration: false,
        channels: {
          position: { keys: [
            { t: 0, v: { x: 960, y: 540 }, out: 'easeInOut' },
            { t: 1, v: { x: 1460, y: 240 }, out: 'linear' }
          ] },
          alpha: { keys: [
            { t: 0, v: 1, out: 'linear' },
            { t: 1, v: 0.2, out: 'linear' }
          ] },
          tint: { keys: [
            { t: 0, v: { r: 1, g: 1, b: 1 }, out: 'linear' },
            { t: 1, v: { r: 1, g: 0.25, b: 0 }, out: 'linear' }
          ] }
        }
      }]
    }, {
      id: 'T2', layerId: 'L3', name: null,
      clips: [{
        id: 'C2', start: 0.5, duration: 1.2, loop: true, curve: 'linear', anim: 'big_win_start',
        speed: 1, mixDuration: 0.2, autoFitDuration: false, channels: null
      }]
    }],
    markers: [], nodes: [], edges: []
  },
  exports: {},
  meta: {}
};

function parseTar(bytes) {
  const entries = [];
  let off = 0;
  const td = new TextDecoder();
  while (off + 512 <= bytes.length) {
    const block = bytes.subarray(off, off + 512);
    if (block.every((b) => b === 0)) break;
    const name = td.decode(block.subarray(0, 100)).replace(/\0+.*$/s, '');
    const size = parseInt(td.decode(block.subarray(124, 136)).replace(/\0/g, '').trim(), 8) || 0;
    const type = String.fromCharCode(block[156]);
    const data = bytes.subarray(off + 512, off + 512 + size);
    entries.push({ name, size, type, data });
    off += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}

const { blob, fileName, warnings, stats } = await exportUnityPackage({
  scene, rootHandle: null, sceneBasePath: null,
  settings: { packageName: 'SmokeTest', variant: 'ui', bakeFps: 30 }
});

const gz = new Uint8Array(await blob.arrayBuffer());
const tarBytes = gunzipSync(gz);
const entries = parseTar(tarBytes);

const td = new TextDecoder();
const byPathname = new Map();
for (const e of entries.filter((e) => e.name.endsWith('/pathname'))) {
  byPathname.set(td.decode(e.data), e.name.split('/')[0]);
}

const paths = [...byPathname.keys()].sort();
console.log(`${fileName}: ${entries.length} tar entries, ${paths.length} assets, ${stats.files} files, ${stats.canvases} canvas`);
console.log(paths.map((p) => `  ${p}`).join('\n'));
if (warnings.length) console.log('warnings:\n' + warnings.map((w) => `  ⚠ ${w}`).join('\n'));

const expect = [
  'Assets/SmokeTest/Art/StaticArt/hero.png',
  'Assets/SmokeTest/Scenes/SmokeTest/SmokeTest_Main.prefab',
  'Assets/SmokeTest/Scenes/SmokeTest/Main_Bake.anim',
  'Assets/SmokeTest/Scenes/SmokeTest/Main_timeline.json',
  'Assets/YggSceneStudio/Runtime/YggScenePlayer.cs',
  'Assets/YggSceneStudio/Editor/YggSceneTimelineBuilder.cs',
  'Assets/YggSceneStudio/Editor/YggScenePlayerEditor.cs',
  'Assets/YggSceneStudio/Runtime/Ygg.SceneStudio.Runtime.asmdef',
  'Assets/YggSceneStudio/Editor/Ygg.SceneStudio.Editor.asmdef',
  'Assets/YggSceneStudio/Editor/YggPackageBootstrap.cs',
  'Assets/YggSceneStudio/Editor/YggSpineAutoWire.cs'
];
let fail = 0;
for (const p of expect) {
  if (!byPathname.has(p)) { console.error(`✗ MISSING: ${p}`); fail++; }
}

// Every asset folder must contain pathname + asset.meta; files also asset.
const guids = new Set(entries.map((e) => e.name.split('/')[0]).filter(Boolean));
for (const g of guids) {
  const names = entries.filter((e) => e.name.startsWith(`${g}/`)).map((e) => e.name.slice(g.length + 1));
  if (!names.includes('pathname') || !names.includes('asset.meta')) {
    console.error(`✗ guid ${g} incomplete: ${names.join(', ')}`); fail++;
  }
}

// Sanity: prefab contains the animated child + player; anim has curves.
const get = (p) => {
  const guid = byPathname.get(p);
  const e = entries.find((e) => e.name === `${guid}/asset`);
  return e ? td.decode(e.data) : '';
};
const prefab = get('Assets/SmokeTest/Scenes/SmokeTest/SmokeTest_Main.prefab');
const anim = get('Assets/SmokeTest/Scenes/SmokeTest/Main_Bake.anim');
const builder = get('Assets/YggSceneStudio/Editor/YggSceneTimelineBuilder.cs');
const descriptor = get('Assets/SmokeTest/Scenes/SmokeTest/Main_timeline.json');
const checks = [
  [builder.includes('#if !YGG_HAS_TIMELINE'), 'timeline builder guarded for missing package'],
  [byPathname.has('Assets/SmokeTest/Art/Animations/wins/wins.json'), 'spine json placed (data-url named)'],
  [byPathname.has('Assets/SmokeTest/Art/Animations/wins/wins.atlas.txt'), 'spine atlas renamed .atlas.txt'],
  [prefab.includes('d85b887af7e6c3f45a2e2d2920d641bc'), 'prefab has SkeletonGraphic (default spine guid)'],
  [prefab.includes('startingAnimation: big_win_idle'), 'SkeletonGraphic starting animation set'],
  [prefab.includes('animationName: big_win_start'), 'spine cue serialized on player'],
  [descriptor.includes('"spineData": "wins"'), 'descriptor carries spineData for auto-assign'],
  [prefab.includes('m_Name: Hero'), 'prefab has Hero GO'],
  [prefab.includes('m_Name: Child'), 'prefab has Child GO'],
  [prefab.includes('PlayableDirector'), 'prefab has director'],
  [prefab.includes('fe87c0e1cc204ed48ad3b37840f39efc'), 'prefab uses UI.Image'],
  [prefab.includes('m_AnchoredPosition: {x: 0, y: 0}'), 'Hero centered → anchored 0,0'],
  [anim.includes('m_AnchoredPosition.x'), 'anim has anchored x curve'],
  [anim.includes('attribute: m_Alpha'), 'anim has CanvasGroup alpha curve'],
  [anim.includes('attribute: m_Color.g'), 'anim has tint color curve'],
  [anim.includes('script: {fileID: 11500000, guid: fe87c0e1cc204ed48ad3b37840f39efc, type: 3}'), 'tint curve bound to UI.Image script'],
  [anim.includes('path: Hero'), 'anim targets Hero path'],
  [/m_StopTime: 2\b/.test(anim), 'anim stop time = scene duration']
];
for (const [ok, label] of checks) {
  console.log(`${ok ? '✓' : '✗'} ${label}`);
  if (!ok) fail++;
}

if (fail) { console.error(`\n${fail} check(s) FAILED`); process.exit(1); }
console.log('\nAll checks passed.');
