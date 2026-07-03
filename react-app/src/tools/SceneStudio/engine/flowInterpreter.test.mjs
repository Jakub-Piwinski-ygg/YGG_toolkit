// T4 visibility-contract helper tests.
// Run: node --test src/tools/SceneStudio/engine/flowInterpreter.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layerHasDrivingClip } from './flowInterpreter.js';

test('layerHasDrivingClip is false with no tracks / no clips', () => {
  assert.equal(layerHasDrivingClip([], 5), false);
  assert.equal(layerHasDrivingClip([{ clips: [] }], 5), false);
  assert.equal(layerHasDrivingClip(null, 5), false);
});

test('layerHasDrivingClip is false before the first clip starts', () => {
  const tracks = [{ clips: [{ start: 2, duration: 1 }] }];
  assert.equal(layerHasDrivingClip(tracks, 0), false);
  assert.equal(layerHasDrivingClip(tracks, 1.999), false);
});

test('layerHasDrivingClip is true once a clip has started, mid-clip and past its end (held)', () => {
  const tracks = [{ clips: [{ start: 2, duration: 1 }] }];
  assert.equal(layerHasDrivingClip(tracks, 2), true, 'exactly at start');
  assert.equal(layerHasDrivingClip(tracks, 2.5), true, 'mid-clip');
  assert.equal(layerHasDrivingClip(tracks, 100), true, 'held long past the end');
});

test('layerHasDrivingClip checks across multiple tracks', () => {
  const tracks = [{ clips: [] }, { clips: [{ start: 10, duration: 1 }] }];
  assert.equal(layerHasDrivingClip(tracks, 5), false);
  assert.equal(layerHasDrivingClip(tracks, 10), true);
});
