// AnimationClip (.anim) YAML generator — native Unity class 74, no external
// GUIDs needed. Keys come pre-baked (dense linear) from bake.js, already
// converted to Unity space by the orchestrator. Emits both runtime curve
// sections (m_PositionCurves / m_EulerCurves / m_ScaleCurves / m_FloatCurves)
// and the matching m_EditorCurves so the clip is editable after import.

const W = '0.33333334';

function f(n) {
  if (!Number.isFinite(n)) return '0';
  const r = Math.round(n * 1e6) / 1e6;
  return Object.is(r, -0) ? '0' : String(r);
}

function slopesFor(keys, i, comp) {
  const val = (k) => (comp ? k.v[comp] : k.v);
  const slope = (a, b) => {
    const dt = b.t - a.t;
    return dt <= 1e-9 ? 0 : (val(b) - val(a)) / dt;
  };
  const inS = i > 0 ? slope(keys[i - 1], keys[i]) : 0;
  const outS = i < keys.length - 1 ? slope(keys[i], keys[i + 1]) : 0;
  return [inS, outS];
}

function vec3KeyYaml(keys, i, z = 0) {
  const k = keys[i];
  const [ixS, oxS] = slopesFor(keys, i, 'x');
  const [iyS, oyS] = slopesFor(keys, i, 'y');
  return `      - serializedVersion: 3
        time: ${f(k.t)}
        value: {x: ${f(k.v.x)}, y: ${f(k.v.y)}, z: ${f(k.v.z ?? z)}}
        inSlope: {x: ${f(ixS)}, y: ${f(iyS)}, z: 0}
        outSlope: {x: ${f(oxS)}, y: ${f(oyS)}, z: 0}
        tangentMode: 0
        weightedMode: 0
        inWeight: {x: ${W}, y: ${W}, z: ${W}}
        outWeight: {x: ${W}, y: ${W}, z: ${W}}`;
}

function scalarKeyYaml(keys, i) {
  const k = keys[i];
  const [inS, outS] = slopesFor(keys, i, null);
  return `      - serializedVersion: 3
        time: ${f(k.t)}
        value: ${f(k.v)}
        inSlope: ${f(inS)}
        outSlope: ${f(outS)}
        tangentMode: 0
        weightedMode: 0
        inWeight: ${W}
        outWeight: ${W}`;
}

function vec3CurveYaml(keys, path, z) {
  return `  - curve:
      serializedVersion: 2
      m_Curve:
${keys.map((_, i) => vec3KeyYaml(keys, i, z)).join('\n')}
      m_PreInfinity: 2
      m_PostInfinity: 2
      m_RotationOrder: 4
    path: ${path}`;
}

function floatCurveYaml(keys, { attribute, path, classID, scriptRef = '{fileID: 0}' }) {
  return `  - curve:
      serializedVersion: 2
      m_Curve:
${keys.map((_, i) => scalarKeyYaml(keys, i)).join('\n')}
      m_PreInfinity: 2
      m_PostInfinity: 2
      m_RotationOrder: 4
    attribute: ${attribute}
    path: ${path}
    classID: ${classID}
    script: ${scriptRef}`;
}

/**
 * Build a .anim YAML document.
 *
 * @param {object} spec
 *   name          clip name
 *   duration      seconds (m_StopTime)
 *   sampleRate    fps
 *   tracks        [{ path, position?: vec2Keys, euler?: scalarKeys (z deg),
 *                    scale?: vec2Keys, floats?: [{attribute, classID, keys}] }]
 *                 vec2Keys: [{t, v:{x,y}}], scalarKeys: [{t, v}]
 */
export function buildAnimationClip(spec) {
  const { name, duration, sampleRate = 60, tracks } = spec;
  const posCurves = [];
  const eulerCurves = [];
  const scaleCurves = [];
  const floatCurves = [];
  const editorCurves = [];

  for (const tr of tracks) {
    if (tr.position?.length) {
      posCurves.push(vec3CurveYaml(tr.position, tr.path, 0));
      for (const comp of ['x', 'y']) {
        editorCurves.push(floatCurveYaml(
          tr.position.map((k) => ({ t: k.t, v: k.v[comp] })),
          { attribute: `m_LocalPosition.${comp}`, path: tr.path, classID: 4 }
        ));
      }
    }
    if (tr.euler?.length) {
      eulerCurves.push(vec3CurveYaml(tr.euler.map((k) => ({ t: k.t, v: { x: 0, y: 0, z: k.v } })), tr.path, 0));
      editorCurves.push(floatCurveYaml(tr.euler, { attribute: 'localEulerAnglesRaw.z', path: tr.path, classID: 4 }));
    }
    if (tr.scale?.length) {
      scaleCurves.push(vec3CurveYaml(tr.scale.map((k) => ({ t: k.t, v: { x: k.v.x, y: k.v.y, z: 1 } })), tr.path, 1));
      for (const comp of ['x', 'y']) {
        editorCurves.push(floatCurveYaml(
          tr.scale.map((k) => ({ t: k.t, v: k.v[comp] })),
          { attribute: `m_LocalScale.${comp}`, path: tr.path, classID: 4 }
        ));
      }
    }
    for (const fl of tr.floats || []) {
      if (!fl.keys?.length) continue;
      const yaml = floatCurveYaml(fl.keys, { attribute: fl.attribute, path: tr.path, classID: fl.classID });
      floatCurves.push(yaml);
      editorCurves.push(yaml);
    }
  }

  const list = (arr) => (arr.length ? `\n${arr.join('\n')}` : ' []');

  return `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!74 &7400000
AnimationClip:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_Name: ${name}
  serializedVersion: 7
  m_Legacy: 0
  m_Compressed: 0
  m_UseHighQualityCurve: 1
  m_RotationCurves: []
  m_CompressedRotationCurves: []
  m_EulerCurves:${list(eulerCurves)}
  m_PositionCurves:${list(posCurves)}
  m_ScaleCurves:${list(scaleCurves)}
  m_FloatCurves:${list(floatCurves)}
  m_PPtrCurves: []
  m_SampleRate: ${sampleRate}
  m_WrapMode: 0
  m_Bounds:
    m_Center: {x: 0, y: 0, z: 0}
    m_Extent: {x: 0, y: 0, z: 0}
  m_ClipBindingConstant:
    genericBindings: []
    pptrCurveMapping: []
  m_AnimationClipSettings:
    serializedVersion: 2
    m_AdditiveReferencePoseClip: {fileID: 0}
    m_AdditiveReferencePoseTime: 0
    m_StartTime: 0
    m_StopTime: ${f(duration)}
    m_OrientationOffsetY: 0
    m_Level: 0
    m_CycleOffset: 0
    m_HasAdditiveReferencePose: 0
    m_LoopTime: 0
    m_LoopBlend: 0
    m_LoopBlendOrientation: 0
    m_LoopBlendPositionY: 0
    m_LoopBlendPositionXZ: 0
    m_KeepOriginalOrientation: 0
    m_KeepOriginalPositionY: 1
    m_KeepOriginalPositionXZ: 0
    m_HeightFromFeet: 0
    m_Mirror: 0
  m_EditorCurves:${list(editorCurves)}
  m_EulerEditorCurves: []
  m_HasGenericRootTransform: 0
  m_HasMotionFloatCurves: 0
  m_Events: []
`;
}
