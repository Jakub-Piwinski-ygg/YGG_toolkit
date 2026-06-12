// Prefab (.prefab) YAML generator. One prefab per Scene Studio canvas.
//
// Two variants:
//   'ui'    — RectTransform + CanvasRenderer + UnityEngine.UI.Image for
//             statics, SkeletonGraphic (spine-unity) for spines. Meant to be
//             dropped under an existing Canvas.
//   'world' — Transform + SpriteRenderer for statics, SkeletonAnimation for
//             spines.
//
// Spine components are only emitted when the corresponding script GUID is
// configured in the export settings (they vary per spine-unity install).
// Without a GUID the spine layer still exports as a correctly-placed
// GameObject the artist can attach the component to.
//
// The root carries Animator (binding target for the baked AnimationClip),
// PlayableDirector (assigned by the generated editor Timeline builder) and
// the generated YggScenePlayer MonoBehaviour.

import { fileIdFor } from './guid.js';

// UnityEngine.UI.Image — stable GUID shipped with UnityEngine.UI since 4.6.
export const UI_IMAGE_GUID = 'fe87c0e1cc204ed48ad3b37840f39efc';

function f(n) {
  if (!Number.isFinite(n)) return '0';
  const r = Math.round(n * 1e6) / 1e6;
  return Object.is(r, -0) ? '0' : String(r);
}

function commonHeader(classId, fileId, typeName) {
  return `--- !u!${classId} &${fileId}
${typeName}:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}`;
}

function gameObjectYaml(id, name, componentIds, { layer, active }) {
  return `${commonHeader(1, id, 'GameObject')}
  serializedVersion: 6
  m_Component:
${componentIds.map((c) => `  - component: {fileID: ${c}}`).join('\n')}
  m_Layer: ${layer}
  m_Name: ${name}
  m_TagString: Untagged
  m_Icon: {fileID: 0}
  m_NavMeshLayer: 0
  m_StaticEditorFlags: 0
  m_IsActive: ${active ? 1 : 0}`;
}

function quatZ(deg) {
  const half = (deg * Math.PI) / 360;
  return { z: Math.sin(half), w: Math.cos(half) };
}

function rectTransformYaml(id, goId, node, childIds, fatherId, rootOrder) {
  const q = quatZ(node.rotDeg || 0);
  const size = node.size || { w: 100, h: 100 };
  const pivot = node.pivot || { x: 0.5, y: 0.5 };
  return `${commonHeader(224, id, 'RectTransform')}
  m_GameObject: {fileID: ${goId}}
  m_LocalRotation: {x: 0, y: 0, z: ${f(q.z)}, w: ${f(q.w)}}
  m_LocalPosition: {x: 0, y: 0, z: 0}
  m_LocalScale: {x: ${f(node.scale?.x ?? 1)}, y: ${f(node.scale?.y ?? 1)}, z: 1}
  m_ConstrainProportionsScale: 0
  m_Children:
${childIds.length ? childIds.map((c) => `  - {fileID: ${c}}`).join('\n') : '  []'}
  m_Father: {fileID: ${fatherId}}
  m_RootOrder: ${rootOrder}
  m_LocalEulerAnglesHint: {x: 0, y: 0, z: ${f(node.rotDeg || 0)}}
  m_AnchorMin: {x: 0.5, y: 0.5}
  m_AnchorMax: {x: 0.5, y: 0.5}
  m_AnchoredPosition: {x: ${f(node.pos?.x ?? 0)}, y: ${f(node.pos?.y ?? 0)}}
  m_SizeDelta: {x: ${f(size.w)}, y: ${f(size.h)}}
  m_Pivot: {x: ${f(pivot.x)}, y: ${f(pivot.y)}}`.replace('m_Children:\n  []', 'm_Children: []');
}

function transformYaml(id, goId, node, childIds, fatherId, rootOrder) {
  const q = quatZ(node.rotDeg || 0);
  return `${commonHeader(4, id, 'Transform')}
  m_GameObject: {fileID: ${goId}}
  m_LocalRotation: {x: 0, y: 0, z: ${f(q.z)}, w: ${f(q.w)}}
  m_LocalPosition: {x: ${f(node.pos?.x ?? 0)}, y: ${f(node.pos?.y ?? 0)}, z: 0}
  m_LocalScale: {x: ${f(node.scale?.x ?? 1)}, y: ${f(node.scale?.y ?? 1)}, z: 1}
  m_ConstrainProportionsScale: 0
  m_Children:
${childIds.length ? childIds.map((c) => `  - {fileID: ${c}}`).join('\n') : '  []'}
  m_Father: {fileID: ${fatherId}}
  m_RootOrder: ${rootOrder}
  m_LocalEulerAnglesHint: {x: 0, y: 0, z: ${f(node.rotDeg || 0)}}`.replace('m_Children:\n  []', 'm_Children: []');
}

function canvasRendererYaml(id, goId) {
  return `${commonHeader(222, id, 'CanvasRenderer')}
  m_GameObject: {fileID: ${goId}}
  m_CullTransparentMesh: 1`;
}

function canvasGroupYaml(id, goId, alpha) {
  return `${commonHeader(225, id, 'CanvasGroup')}
  m_GameObject: {fileID: ${goId}}
  m_Enabled: 1
  m_Alpha: ${f(alpha ?? 1)}
  m_Interactable: 1
  m_BlocksRaycasts: 1
  m_IgnoreParentGroups: 0`;
}

function imageYaml(id, goId, spriteGuid, tint) {
  const c = tint || { r: 1, g: 1, b: 1 };
  return `${commonHeader(114, id, 'MonoBehaviour')}
  m_GameObject: {fileID: ${goId}}
  m_Enabled: 1
  m_EditorHideFlags: 0
  m_Script: {fileID: 11500000, guid: ${UI_IMAGE_GUID}, type: 3}
  m_Name:
  m_EditorClassIdentifier:
  m_Material: {fileID: 0}
  m_Color: {r: ${f(c.r)}, g: ${f(c.g)}, b: ${f(c.b)}, a: 1}
  m_RaycastTarget: 0
  m_RaycastPadding: {x: 0, y: 0, z: 0, w: 0}
  m_Maskable: 1
  m_OnCullStateChanged:
    m_PersistentCalls:
      m_Calls: []
  m_Sprite: {fileID: 21300000, guid: ${spriteGuid}, type: 3}
  m_Type: 0
  m_PreserveAspect: 0
  m_FillCenter: 1
  m_FillMethod: 4
  m_FillAmount: 1
  m_FillClockwise: 1
  m_FillOrigin: 0
  m_UseSpriteMesh: 0
  m_PixelsPerUnitMultiplier: 1`;
}

function spriteRendererYaml(id, goId, spriteGuid, alpha, tint) {
  const c = tint || { r: 1, g: 1, b: 1 };
  return `${commonHeader(212, id, 'SpriteRenderer')}
  m_GameObject: {fileID: ${goId}}
  m_Enabled: 1
  m_CastShadows: 0
  m_ReceiveShadows: 0
  m_DynamicOccludee: 1
  m_StaticShadowCaster: 0
  m_MotionVectors: 1
  m_LightProbeUsage: 1
  m_ReflectionProbeUsage: 1
  m_RayTracingMode: 0
  m_RayTraceProcedural: 0
  m_RenderingLayerMask: 1
  m_RendererPriority: 0
  m_Materials:
  - {fileID: 10754, guid: 0000000000000000f000000000000000, type: 0}
  m_StaticBatchInfo:
    firstSubMesh: 0
    subMeshCount: 0
  m_StaticBatchRoot: {fileID: 0}
  m_ProbeAnchor: {fileID: 0}
  m_LightProbeVolumeOverride: {fileID: 0}
  m_ScaleInLightmap: 1
  m_ReceiveGI: 1
  m_PreserveUVs: 0
  m_IgnoreNormalsForChartDetection: 0
  m_ImportantGI: 0
  m_StitchLightmapSeams: 1
  m_SelectedEditorRenderState: 0
  m_MinimumChartSize: 4
  m_AutoUVMaxDistance: 0.5
  m_AutoUVMaxAngle: 89
  m_LightmapParameters: {fileID: 0}
  m_SortingLayerID: 0
  m_SortingLayer: 0
  m_SortingOrder: 0
  m_Sprite: {fileID: 21300000, guid: ${spriteGuid}, type: 3}
  m_Color: {r: ${f(c.r)}, g: ${f(c.g)}, b: ${f(c.b)}, a: ${f(alpha ?? 1)}}
  m_FlipX: 0
  m_FlipY: 0
  m_DrawMode: 0
  m_Size: {x: 1, y: 1}
  m_AdaptiveModeThreshold: 0.5
  m_SpriteTileMode: 0
  m_WasSpriteAssigned: 1
  m_MaskInteraction: 0
  m_SpriteSortPoint: 0`;
}

// spine-unity UPM package material assets — stable GUIDs shipped with the
// package (verified against spine-runtimes 4.2).
const SPINE_GRAPHIC_MATERIALS = {
  base: '841cfbaa0261b0042b3a039c52637bb7',      // SkeletonGraphicDefault
  additive: '2e8245019faeb8c43b75f9ca3ac8ee34',
  multiply: 'e74a1f8978a7da348a721508d0d58834',
  screen: 'bab24c479f34eec45be6ea8595891569'
};

/** SkeletonGraphic (UI variant) — field layout matches spine-unity 4.2. */
function skeletonGraphicYaml(id, goId, scriptGuid, spine, size) {
  const ref = size || { w: 100, h: 100 };
  return `${commonHeader(114, id, 'MonoBehaviour')}
  m_GameObject: {fileID: ${goId}}
  m_Enabled: 1
  m_EditorHideFlags: 0
  m_Script: {fileID: 11500000, guid: ${scriptGuid}, type: 3}
  m_Name:
  m_EditorClassIdentifier:
  m_Material: {fileID: 2100000, guid: ${SPINE_GRAPHIC_MATERIALS.base}, type: 2}
  m_Color: {r: 1, g: 1, b: 1, a: 1}
  m_RaycastTarget: 0
  m_RaycastPadding: {x: 0, y: 0, z: 0, w: 0}
  m_Maskable: 1
  m_OnCullStateChanged:
    m_PersistentCalls:
      m_Calls: []
  skeletonDataAsset: {fileID: 0}
  additiveMaterial: {fileID: 2100000, guid: ${SPINE_GRAPHIC_MATERIALS.additive}, type: 2}
  multiplyMaterial: {fileID: 2100000, guid: ${SPINE_GRAPHIC_MATERIALS.multiply}, type: 2}
  screenMaterial: {fileID: 2100000, guid: ${SPINE_GRAPHIC_MATERIALS.screen}, type: 2}
  forceAdditiveMaterial: 0
  m_SkeletonColor: {r: 1, g: 1, b: 1, a: 1}
  initialSkinName: ${spine?.skin || 'default'}
  initialFlipX: 0
  initialFlipY: 0
  startingAnimation: ${spine?.defaultAnimation || ''}
  startingLoop: ${spine?.loop === false ? 0 : 1}
  timeScale: 1
  freeze: 0
  layoutScaleMode: 0
  referenceSize: {x: ${f(ref.w)}, y: ${f(ref.h)}}
  pivotOffset: {x: 0, y: 0}
  referenceScale: 1
  layoutScale: 1
  rectTransformSize: {x: ${f(ref.w)}, y: ${f(ref.h)}}
  editReferenceRect: 0
  updateWhenInvisible: 3
  allowMultipleCanvasRenderers: 0
  canvasRenderers: []
  separatorSlotNames: []
  enableSeparatorSlots: 0
  separatorParts: []
  updateSeparatorPartLocation: 1
  updateSeparatorPartScale: 0
  disableMeshAssignmentOnOverride: 1
  physicsPositionInheritanceFactor: {x: 1, y: 1}
  physicsRotationInheritanceFactor: 1
  physicsMovementRelativeTo: {fileID: 0}
  meshGenerator:
    settings:
      useClipping: 1
      zSpacing: 0
      tintBlack: 0
      canvasGroupCompatible: 1
      pmaVertexColors: 0
      addNormals: 0
      calculateTangents: 0
      immutableTriangles: 0
  updateTiming: 1
  unscaledTime: 0`;
}

/** SkeletonAnimation (world variant) — spine-unity 4.2 layout. */
function skeletonAnimationYaml(id, goId, scriptGuid, spine) {
  return `${commonHeader(114, id, 'MonoBehaviour')}
  m_GameObject: {fileID: ${goId}}
  m_Enabled: 1
  m_EditorHideFlags: 0
  m_Script: {fileID: 11500000, guid: ${scriptGuid}, type: 3}
  m_Name:
  m_EditorClassIdentifier:
  skeletonDataAsset: {fileID: 0}
  initialSkinName: ${spine?.skin || 'default'}
  fixPrefabOverrideViaMeshFilter: 2
  initialFlipX: 0
  initialFlipY: 0
  updateTiming: 1
  updateWhenInvisible: 3
  unscaledTime: 0
  physicsPositionInheritanceFactor: {x: 1, y: 1}
  physicsRotationInheritanceFactor: 1
  physicsMovementRelativeTo: {fileID: 0}
  _animationName: ${spine?.defaultAnimation || ''}
  loop: ${spine?.loop === false ? 0 : 1}
  timeScale: 1`;
}

/** Escape a JSON string for a single-quoted YAML scalar ('' = literal '). */
function yamlSq(s) {
  return String(s ?? '').replace(/'/g, "''");
}

/**
 * Generated YggSpinner component — pre-configured in the prefab: serialized
 * config + clips JSON (the component self-configures in Awake) and sprite
 * bindings per symbol so the reels render without any manual setup.
 */
function spinnerYaml(id, goId, scriptGuid, spinner) {
  const bindings = (spinner.bindings || []).map((b) => `  - symbolId: ${b.symbolId}
    staticSprite: ${b.staticGuid ? `{fileID: 21300000, guid: ${b.staticGuid}, type: 3}` : '{fileID: 0}'}
    blurSprite: ${b.blurGuid ? `{fileID: 21300000, guid: ${b.blurGuid}, type: 3}` : '{fileID: 0}'}`).join('\n');
  return `${commonHeader(114, id, 'MonoBehaviour')}
  m_GameObject: {fileID: ${goId}}
  m_Enabled: 1
  m_EditorHideFlags: 0
  m_Script: {fileID: 11500000, guid: ${scriptGuid}, type: 3}
  m_Name:
  m_EditorClassIdentifier:
  configJson: '${yamlSq(spinner.configJson)}'
  clipsJson: '${yamlSq(spinner.clipsJson)}'
  symbolBindings:
${bindings || '  []'}`.replace('symbolBindings:\n  []', 'symbolBindings: []');
}

function animatorYaml(id, goId) {
  return `${commonHeader(95, id, 'Animator')}
  m_Enabled: 1
  m_GameObject: {fileID: ${goId}}
  serializedVersion: 5
  m_Avatar: {fileID: 0}
  m_Controller: {fileID: 0}
  m_CullingMode: 0
  m_UpdateMode: 0
  m_ApplyRootMotion: 0
  m_LinearVelocityBlending: 0
  m_StabilizeFeet: 0
  m_WarningMessage:
  m_HasTransformHierarchy: 1
  m_AllowConstantClipSamplingOptimization: 1
  m_KeepAnimatorStateOnDisable: 0
  m_WriteDefaultValuesOnDisable: 0`;
}

function directorYaml(id, goId) {
  return `${commonHeader(320, id, 'PlayableDirector')}
  m_Enabled: 1
  m_GameObject: {fileID: ${goId}}
  serializedVersion: 3
  m_PlayableAsset: {fileID: 0}
  m_InitialState: 0
  m_WrapMode: 1
  m_DirectorUpdateMode: 1
  m_InitialTime: 0
  m_SceneBindings: []
  m_ExposedReferences:
    m_References: []`;
}

function scenePlayerYaml(id, goId, opts) {
  const { scriptGuid, directorId, clipGuid, descriptorGuid, durationSeconds, spineCues } = opts;
  const cues = (spineCues || []).map((c) => `  - target: ${c.target}
    animationName: ${c.anim}
    start: ${f(c.start)}
    duration: ${f(c.duration)}
    speed: ${f(c.speed ?? 1)}
    loop: ${c.loop ? 1 : 0}
    mixDuration: ${c.mixDuration == null ? -1 : f(c.mixDuration)}
    trackIndex: ${c.trackIndex ?? 0}`).join('\n');
  return `${commonHeader(114, id, 'MonoBehaviour')}
  m_GameObject: {fileID: ${goId}}
  m_Enabled: 1
  m_EditorHideFlags: 0
  m_Script: {fileID: 11500000, guid: ${scriptGuid}, type: 3}
  m_Name:
  m_EditorClassIdentifier:
  director: {fileID: ${directorId}}
  transformClip: {fileID: 7400000, guid: ${clipGuid}, type: 2}
  descriptor: {fileID: 4900000, guid: ${descriptorGuid}, type: 3}
  durationSeconds: ${f(durationSeconds)}
  spineCues:
${cues || '  []'}`.replace('spineCues:\n  []', 'spineCues: []');
}

/**
 * Build a prefab YAML for one canvas.
 *
 * @param {object} spec
 *   canvasName, variant ('ui'|'world'), stage {w,h},
 *   nodes — tree: [{ key, name, kind ('static'|'spine'|'group'),
 *                    active, pos {x,y}, scale {x,y}, rotDeg, alpha, tint,
 *                    size {w,h}|null, spriteGuid?, spine?, children: [] }]
 *   player — { scriptGuid, clipGuid, descriptorGuid, durationSeconds, spineCues }
 *   spineScriptGuid — SkeletonGraphic (ui) / SkeletonAnimation (world) GUID or ''
 *   spinnerScriptGuid — generated YggSpinner.cs GUID (spinner nodes carry a
 *     `spinner: { configJson, clipsJson, bindings }` payload)
 * @returns {Promise<string>} prefab YAML
 */
export async function buildPrefab(spec) {
  const { canvasName, variant, stage, nodes, player, spineScriptGuid, spinnerScriptGuid } = spec;
  const ui = variant === 'ui';
  const docs = [];

  const id = (seed) => fileIdFor(`${canvasName}:${seed}`);

  // Root object
  const rootGoId = await id('root:go');
  const rootTrId = await id('root:tr');
  const animatorId = await id('root:animator');
  const directorId = await id('root:director');
  const playerId = await id('root:player');
  const rootCgId = ui ? await id('root:cg') : null;

  const emitNode = async (node, fatherTrId, order, pathPrefix) => {
    const goId = await id(`${node.key}:go`);
    const trId = await id(`${node.key}:tr`);
    const comps = [trId];
    const extraDocs = [];

    let cgId = null;
    if (ui) {
      cgId = await id(`${node.key}:cg`);
    }

    if (node.kind === 'static' && node.spriteGuid) {
      if (ui) {
        const crId = await id(`${node.key}:cr`);
        const imgId = await id(`${node.key}:img`);
        comps.push(crId, imgId);
        extraDocs.push(canvasRendererYaml(crId, goId));
        extraDocs.push(imageYaml(imgId, goId, node.spriteGuid, node.tint));
      } else {
        const srId = await id(`${node.key}:sr`);
        comps.push(srId);
        extraDocs.push(spriteRendererYaml(srId, goId, node.spriteGuid, node.alpha, node.tint));
      }
    }
    if (node.kind === 'spine' && spineScriptGuid) {
      const spId = await id(`${node.key}:spine`);
      comps.push(spId);
      if (ui) {
        const crId = await id(`${node.key}:spinecr`);
        comps.splice(1, 0, crId);
        extraDocs.push(canvasRendererYaml(crId, goId));
        extraDocs.push(skeletonGraphicYaml(spId, goId, spineScriptGuid, node.spine, node.size));
      } else {
        extraDocs.push(skeletonAnimationYaml(spId, goId, spineScriptGuid, node.spine));
      }
    }
    if (node.kind === 'spinner' && node.spinner && spinnerScriptGuid) {
      const snId = await id(`${node.key}:spinner`);
      comps.push(snId);
      extraDocs.push(spinnerYaml(snId, goId, spinnerScriptGuid, node.spinner));
    }
    if (ui) {
      comps.push(cgId);
      extraDocs.push(canvasGroupYaml(cgId, goId, node.alpha));
    }

    const childTrIds = [];
    const childDocs = [];
    let childOrder = 0;
    for (const child of node.children || []) {
      const res = await emitNode(child, trId, childOrder++, `${pathPrefix}${node.name}/`);
      childTrIds.push(res.trId);
      childDocs.push(...res.docs);
    }

    const trYaml = ui
      ? rectTransformYaml(trId, goId, node, childTrIds, fatherTrId, order)
      : transformYaml(trId, goId, node, childTrIds, fatherTrId, order);

    return {
      trId,
      docs: [
        gameObjectYaml(goId, node.name, comps, { layer: ui ? 5 : 0, active: node.active !== false }),
        trYaml,
        ...extraDocs,
        ...childDocs
      ]
    };
  };

  const childTrIds = [];
  const childDocs = [];
  let order = 0;
  for (const node of nodes) {
    const res = await emitNode(node, rootTrId, order++, '');
    childTrIds.push(res.trId);
    childDocs.push(...res.docs);
  }

  const rootComps = [rootTrId, animatorId, directorId, playerId];
  if (rootCgId) rootComps.splice(1, 0, rootCgId);

  const rootNode = {
    pos: { x: 0, y: 0 },
    scale: { x: 1, y: 1 },
    rotDeg: 0,
    size: { w: stage.w, h: stage.h },
    pivot: { x: 0.5, y: 0.5 }
  };

  docs.push(gameObjectYaml(rootGoId, canvasName, rootComps, { layer: ui ? 5 : 0, active: true }));
  docs.push(ui
    ? rectTransformYaml(rootTrId, rootGoId, rootNode, childTrIds, '0', 0)
    : transformYaml(rootTrId, rootGoId, rootNode, childTrIds, '0', 0));
  if (rootCgId) docs.push(canvasGroupYaml(rootCgId, rootGoId, 1));
  docs.push(animatorYaml(animatorId, rootGoId));
  docs.push(directorYaml(directorId, rootGoId));
  docs.push(scenePlayerYaml(playerId, rootGoId, { ...player, directorId }));
  docs.push(...childDocs);

  return `%YAML 1.1\n%TAG !u! tag:unity3d.com,2011:\n${docs.join('\n')}\n`;
}
