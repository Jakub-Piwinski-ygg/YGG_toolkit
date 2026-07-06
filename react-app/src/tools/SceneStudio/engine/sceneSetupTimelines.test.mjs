// Scene Setup idle-timeline generator tests.
// Run: node --test src/tools/SceneStudio/engine/sceneSetupTimelines.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSceneSetupIdleTimelines,
  buildSceneSetupAuxTimelines,
  resolveSceneSetupPhaseClips,
  SCENE_SETUP_IDLE_DURATION,
  SCENE_SETUP_AUX_DURATION
} from './sceneSetupTimelines.js';

const MODES = [
  { key: 'base', label: 'Base Game', layerId: null },
  { key: 'freespins', label: 'Free Spins', layerId: 'L_fs' },
  { key: 'bonus', label: 'Bonus Game', layerId: 'L_bn' }
];

function alphaOf(tl, layerId) {
  const track = tl.tracks.find((t) => t.layerId === layerId);
  return track.clips[0].channels.alpha.keys[0].v;
}

test('one idle timeline per mode, one track per FEATURE group', () => {
  const built = buildSceneSetupIdleTimelines(MODES);
  assert.deepEqual(built.map((t) => t.name), ['Base Game Idle', 'Free Spins Idle', 'Bonus Game Idle']);
  for (const tl of built) {
    assert.equal(tl.tracks.length, 2, 'base has no group layer — only feature groups get tracks');
    assert.equal(tl.tracks[0].clips[0].duration, SCENE_SETUP_IDLE_DURATION);
  }
});

test('each idle poses its own group at 1 and the others at 0', () => {
  const [base, fs, bonus] = buildSceneSetupIdleTimelines(MODES);
  assert.equal(alphaOf(base, 'L_fs'), 0);
  assert.equal(alphaOf(base, 'L_bn'), 0);
  assert.equal(alphaOf(fs, 'L_fs'), 1);
  assert.equal(alphaOf(fs, 'L_bn'), 0);
  assert.equal(alphaOf(bonus, 'L_fs'), 0);
  assert.equal(alphaOf(bonus, 'L_bn'), 1);
});

test('no feature groups → no timelines', () => {
  assert.deepEqual(buildSceneSetupIdleTimelines([MODES[0]]), []);
  assert.deepEqual(buildSceneSetupIdleTimelines([]), []);
});

test('mode idles can gate aux groups off by default', () => {
  const all = [...MODES, { key: 'splash', label: 'Splash', layerId: 'L_sp' }];
  const [base] = buildSceneSetupIdleTimelines(MODES, all);
  assert.equal(alphaOf(base, 'L_sp'), 0);
});

test('aux timelines isolate only their own group', () => {
  const all = [...MODES, { key: 'splash', label: 'Splash', layerId: 'L_sp' }];
  const [splash] = buildSceneSetupAuxTimelines([
    { key: 'splash', label: 'Splash Intro', layerId: 'L_sp', type: 'splash', phase: 'splash', contentLayerId: 'L_content', contentKind: 'spine' }
  ], all);
  assert.equal(splash.tracks.find((t) => t.layerId === 'L_sp')?.clips[0]?.duration, SCENE_SETUP_AUX_DURATION);
  assert.equal(alphaOf(splash, 'L_sp'), 1);
  assert.equal(splash.tracks.some((t) => t.layerId === 'L_fs'), false, 'aux timeline should not gate unrelated mode groups');
  assert.equal(splash.tracks.some((t) => t.layerId === 'L_bn'), false, 'aux timeline should not gate unrelated mode groups');
  assert.ok(splash.tracks.some((t) => t.layerId === 'L_content'), 'content track added for spine aux timeline');
});

test('phase resolver maps intro/idle/outro style names in order', () => {
  const clips = resolveSceneSetupPhaseClips(
    ['fs_intro', 'fs_idle_loop', 'fs_outro'],
    { fs_intro: 0.4, fs_idle_loop: 1.2, fs_outro: 0.5 },
    'intro'
  );
  assert.equal(clips.length, 3);
  assert.equal(clips[0].anim, 'fs_intro');
  assert.equal(clips[1].anim, 'fs_idle_loop');
  assert.equal(clips[2].anim, 'fs_outro');
  assert.equal(clips[0].duration, 0.4);
  assert.equal(clips[1].duration, 1.2);
  assert.equal(clips[2].duration, 0.5);
});
