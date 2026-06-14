// IndexedDB-backed autosave for Scene Studio.
// Persists the current scene JSON + project-root FileSystemDirectoryHandle
// (Chrome 86+: handles are structurally-cloneable and survive IDB round-trips).
// A debounced write is triggered from SceneStudioInner on every scene change.

import { PROJECT_SCHEMA } from './projectModel.js';

const DB_NAME = 'ygg-scene-studio';
const DB_VERSION = 1;
const STORE = 'session';
const KEY = 'current';

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB unavailable'));
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Write the current scene + root handle to IndexedDB (debounced by caller).
 * Silent on failure — autosave must never interrupt the user.
 */
export async function saveSession(project, rootHandle) {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(
        { project, rootHandle: rootHandle ?? null, savedAt: new Date().toISOString(), schemaVersion: PROJECT_SCHEMA },
        KEY
      );
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (e) {
    console.warn('[SceneStudio] autosave failed', e);
  }
}

/**
 * Read the stored session record. Returns null when absent or on error.
 * Shape: { project, rootHandle, savedAt, schemaVersion }
 */
export async function loadSession() {
  try {
    const db = await openDb();
    const record = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return record;
  } catch (e) {
    console.warn('[SceneStudio] session load failed', e);
    return null;
  }
}

/** Remove the stored session (called on "New project"). */
export async function clearSession() {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(KEY);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (e) {
    console.warn('[SceneStudio] session clear failed', e);
  }
}
