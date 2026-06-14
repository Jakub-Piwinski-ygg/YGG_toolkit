// Scene Studio — Project document model (schema ygg-project/1).
//
// A Project is the top-level saved document. It owns a SHARED asset pool and
// references multiple scenes. Scenes are stored inline in memory as `.data`
// (a full scene object minus its `assets`, which live in the project pool).
// On disk a project may be one inline project.json (quick mode) or a manifest
// + one file per scene (scaffold mode) — see engine/persist.js.

import { createEmptyScene, validateScene, uid } from './sceneModel.js';

export const PROJECT_SCHEMA = 'ygg-project/1';
export const PROJECT_VERSION = 1;

/** Strip the shared `assets` off a scene, returning just the per-scene data. */
function splitScene(scene) {
  const { assets, ...rest } = scene;
  return { assets: Array.isArray(assets) ? assets : [], data: rest };
}

/** Merge `incoming` assets into `pool` (dedupe by id). Mutates + returns pool. */
export function mergeAssets(pool, incoming) {
  if (!Array.isArray(incoming)) return pool;
  const have = new Set(pool.map((a) => a.id));
  for (const a of incoming) {
    if (a && a.id && !have.has(a.id)) { pool.push(a); have.add(a.id); }
  }
  return pool;
}

/** @returns {object} a new project with one empty scene. */
export function createEmptyProject(name = 'Untitled project') {
  const scene = createEmptyScene('Scene 1');
  const { assets, data } = splitScene(scene);
  const sceneId = uid('S');
  return {
    $schema: PROJECT_SCHEMA,
    version: PROJECT_VERSION,
    name,
    assets,
    scenes: [{ id: sceneId, name: data.name, file: null, variantOf: null, data }],
    activeSceneId: sceneId,
    exports: {},
    meta: { createdAt: new Date().toISOString(), toolkitVersion: '0.0.0' }
  };
}

/** Wrap a single (already-validated) scene as a 1-scene project. */
export function projectFromScene(scene, projectName) {
  const { assets, data } = splitScene(scene);
  const id = uid('S');
  return {
    $schema: PROJECT_SCHEMA,
    version: PROJECT_VERSION,
    name: projectName || scene.name || 'Untitled project',
    assets,
    scenes: [{ id, name: data.name || 'Scene', file: scene.__file || null, variantOf: null, data }],
    activeSceneId: id,
    exports: {},
    meta: { createdAt: new Date().toISOString(), toolkitVersion: '0.0.0' }
  };
}

/** The active scene's manifest entry (with inline `.data`). */
export function activeSceneEntry(project) {
  const list = project?.scenes || [];
  return list.find((s) => s.id === project.activeSceneId) || list[0] || null;
}

/**
 * Materialize the working scene from the project: the active scene's data
 * plus the project's shared asset pool. This is the object the editor and
 * all scene.flow consumers operate on.
 */
export function deriveWorkingScene(project) {
  const entry = activeSceneEntry(project);
  if (!entry || !entry.data) return createEmptyScene('Scene 1');
  return { ...entry.data, assets: project.assets || [] };
}

/**
 * Fold an edited working scene back into the project: its assets become the
 * shared pool, the rest replaces the active scene's `.data`.
 */
export function foldSceneIntoProject(project, scene) {
  const { assets, data } = splitScene(scene);
  const activeId = project.activeSceneId;
  return {
    ...project,
    assets: assets ?? project.assets,
    scenes: (project.scenes || []).map((s) => (s.id === activeId
      ? { ...s, name: data.name ?? s.name, data }
      : s))
  };
}

/** Validate a parsed project.json (or wrap a bare scene). Throws on garbage. */
export function validateProject(parsed) {
  if (parsed && typeof parsed === 'object'
      && typeof parsed.$schema === 'string' && parsed.$schema.startsWith('ygg-scene/')) {
    return projectFromScene(validateScene(parsed));
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Project file is not a JSON object.');
  }
  if (parsed.$schema && !String(parsed.$schema).startsWith('ygg-project/')) {
    throw new Error(`Unknown schema: ${parsed.$schema}`);
  }
  if (!Array.isArray(parsed.scenes)) {
    // A loose scene-like object (no $schema) → treat as a scene.
    if (parsed.stage && Array.isArray(parsed.layers)) return projectFromScene(validateScene(parsed));
    throw new Error('Not a YGG project or scene.');
  }
  const project = createEmptyProject(parsed.name || 'Untitled project');
  project.assets = Array.isArray(parsed.assets) ? parsed.assets.slice() : [];
  const scenes = [];
  for (const s of parsed.scenes) {
    if (!s || typeof s !== 'object') continue;
    let data = null;
    if (s.data && typeof s.data === 'object') {
      const scene = validateScene({ ...s.data, assets: s.data.assets || [] });
      const { assets, data: rest } = splitScene(scene);
      mergeAssets(project.assets, assets);
      data = rest;
    }
    scenes.push({
      id: s.id || uid('S'),
      name: s.name || data?.name || 'Scene',
      file: s.file || null,
      variantOf: s.variantOf || null,
      data
    });
  }
  if (!scenes.length) return createEmptyProject(parsed.name || 'Untitled project');
  project.scenes = scenes;
  project.activeSceneId = parsed.activeSceneId && scenes.some((s) => s.id === parsed.activeSceneId)
    ? parsed.activeSceneId
    : scenes[0].id;
  project.exports = parsed.exports || {};
  project.meta = { ...project.meta, ...(parsed.meta || {}) };
  return project;
}

/** Add a new empty scene (shared pool untouched). Returns { project, sceneId }. */
export function addScene(project, name) {
  const scene = createEmptyScene(name || `Scene ${(project.scenes?.length || 0) + 1}`);
  const { data } = splitScene(scene);
  const id = uid('S');
  const entry = { id, name: data.name, file: null, variantOf: null, data };
  return {
    project: { ...project, scenes: [...(project.scenes || []), entry], activeSceneId: id },
    sceneId: id
  };
}

/**
 * Duplicate a scene as a variant (Unity-prefab-variant style). Deep-copies the
 * scene data, records `variantOf` = source id, and makes the copy active.
 * Internal ids (layers/timelines/clips) are left as-is — they're scoped to the
 * scene object so they never collide across scenes; only `assets` (the shared
 * pool, referenced by id) are common.
 */
export function duplicateSceneAsVariant(project, sourceId, name) {
  const src = (project.scenes || []).find((s) => s.id === sourceId) || activeSceneEntry(project);
  if (!src || !src.data) return { project, sceneId: null };
  const id = uid('S');
  const data = structuredClone(src.data);
  data.name = name || `${src.name} variant`;
  const entry = { id, name: data.name, file: null, variantOf: src.id, data };
  const idx = (project.scenes || []).findIndex((s) => s.id === src.id);
  const scenes = [...project.scenes];
  scenes.splice(idx >= 0 ? idx + 1 : scenes.length, 0, entry);
  return { project: { ...project, scenes, activeSceneId: id }, sceneId: id };
}

/** Switch the active scene by id. */
export function setActiveScene(project, sceneId) {
  if (!(project.scenes || []).some((s) => s.id === sceneId)) return project;
  return { ...project, activeSceneId: sceneId };
}

/** Remove a scene. Never leaves a project with zero scenes. */
export function removeScene(project, sceneId) {
  let scenes = (project.scenes || []).filter((s) => s.id !== sceneId);
  if (!scenes.length) {
    const fresh = createEmptyProject(project.name);
    scenes = fresh.scenes;
    return { ...project, scenes, activeSceneId: scenes[0].id };
  }
  const activeSceneId = project.activeSceneId === sceneId ? scenes[0].id : project.activeSceneId;
  return { ...project, scenes, activeSceneId };
}

/** Rename a scene by id (also reflected in the working scene's name). */
export function renameScene(project, sceneId, name) {
  return {
    ...project,
    scenes: (project.scenes || []).map((s) => (s.id === sceneId
      ? { ...s, name, data: s.data ? { ...s.data, name } : s.data }
      : s))
  };
}
