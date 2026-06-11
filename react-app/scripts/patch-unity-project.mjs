// One-off hotfix: regenerate the YggSceneStudio scripts inside an existing
// Unity project from the current toolkit generator (asmdef + YGG_HAS_TIMELINE
// guard), with the new package-independent GUIDs, and rewrite any old
// YggScenePlayer GUID references in prefabs/scenes.
// Run: node scripts/patch-unity-project.mjs <unityProjectPath> [oldPlayerGuid]

import { mkdirSync, writeFileSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { guidFor } from '../src/tools/SceneStudio/unity/guid.js';
import { monoMeta, asmdefMeta, folderMeta } from '../src/tools/SceneStudio/unity/metaFiles.js';
import {
  SCRIPT_PATHS,
  scenePlayerSource,
  scenePlayerEditorSource,
  timelineBuilderSource,
  packageBootstrapSource,
  spineAutoWireSource,
  runtimeAsmdefSource,
  editorAsmdefSource
} from '../src/tools/SceneStudio/unity/csharp.js';

const [, , projectRoot, oldPlayerGuid] = process.argv;
if (!projectRoot) {
  console.error('usage: node scripts/patch-unity-project.mjs <unityProjectPath> [oldPlayerGuid]');
  process.exit(1);
}

const FILES = [
  [SCRIPT_PATHS.player, scenePlayerSource(), monoMeta],
  [SCRIPT_PATHS.playerEditor, scenePlayerEditorSource(), monoMeta],
  [SCRIPT_PATHS.timelineBuilder, timelineBuilderSource(), monoMeta],
  [SCRIPT_PATHS.packageBootstrap, packageBootstrapSource(), monoMeta],
  [SCRIPT_PATHS.spineAutoWire, spineAutoWireSource(), monoMeta],
  [SCRIPT_PATHS.runtimeAsmdef, runtimeAsmdefSource(), asmdefMeta],
  [SCRIPT_PATHS.editorAsmdef, editorAsmdefSource(), asmdefMeta]
];

let newPlayerGuid = null;
for (const [relPath, content, metaFn] of FILES) {
  const guid = await guidFor(`shared:${relPath}`);
  if (relPath === SCRIPT_PATHS.player) newPlayerGuid = guid;
  const abs = join(projectRoot, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content.replace(/\n/g, '\r\n'), 'utf8');
  writeFileSync(`${abs}.meta`, metaFn(guid), 'utf8');
  console.log(`wrote ${relPath}  (guid ${guid})`);
}

// Folder metas for Runtime/Editor/YggSceneStudio (path-seeded, idempotent)
for (const dir of ['Assets/YggSceneStudio', 'Assets/YggSceneStudio/Runtime', 'Assets/YggSceneStudio/Editor']) {
  const guid = await guidFor(`shared:${dir}`);
  writeFileSync(join(projectRoot, `${dir}.meta`), folderMeta(guid), 'utf8');
}

// Rewrite old player GUID references (prefabs, scenes)
if (oldPlayerGuid && oldPlayerGuid !== newPlayerGuid) {
  const exts = /\.(prefab|unity|asset)$/i;
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) { if (!/Library|Temp|obj|\.git/.test(name)) walk(p); continue; }
      if (!exts.test(name)) continue;
      const text = readFileSync(p, 'utf8');
      if (text.includes(oldPlayerGuid)) {
        writeFileSync(p, text.replaceAll(oldPlayerGuid, newPlayerGuid), 'utf8');
        console.log(`re-pointed player guid in ${p}`);
      }
    }
  };
  walk(join(projectRoot, 'Assets'));
}

console.log(`\nDone. New YggScenePlayer guid: ${newPlayerGuid}`);
