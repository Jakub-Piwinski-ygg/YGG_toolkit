// Scene Setup idle-timeline generator tests.
// Run: node --test src/tools/SceneStudio/engine/sceneSetupTimelines.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSceneSetupIdleTimelines, SCENE_SETUP_IDLE_DURATION } from './sceneSetupTimelines.js';

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
