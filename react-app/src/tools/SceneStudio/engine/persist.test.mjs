// Unit tests for the asset-URL resolution helper (engine/persist.js).
// Run with: node --test src/tools/SceneStudio/engine/

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveAssetUrl } from './persist.js';

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
