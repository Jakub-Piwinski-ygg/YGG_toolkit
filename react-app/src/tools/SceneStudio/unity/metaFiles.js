// Unity .meta generators. Import settings live here — texture metas encode
// the per-category rules from the export-settings dialog (straight alpha,
// sprite mode, compression), so assets import correctly with zero clicks.

const COMMON_TAIL = `  userData: \n  assetBundleName: \n  assetBundleVariant: \n`;

export function folderMeta(guid) {
  return `fileFormatVersion: 2
guid: ${guid}
folderAsset: yes
DefaultImporter:
  externalObjects: {}
${COMMON_TAIL}`;
}

/**
 * TextureImporter meta. Options:
 *   compression: 'none' | 'lq' | 'normal' | 'hq'   (textureCompression)
 *   spriteMode:  1 single (default)
 *   pixelsPerUnit, alphaIsTransparency, mipmaps, maxSize, sRGB
 */
export function textureMeta(guid, opts = {}) {
  const {
    compression = 'none',
    pixelsPerUnit = 100,
    alphaIsTransparency = true,
    mipmaps = false,
    maxSize = 8192,
    sRGB = true,
    spriteMode = 1
  } = opts;
  const comp = { none: 0, normal: 1, hq: 2, lq: 3 }[compression] ?? 0;
  return `fileFormatVersion: 2
guid: ${guid}
TextureImporter:
  internalIDToNameTable: []
  externalObjects: {}
  serializedVersion: 11
  mipmaps:
    mipMapMode: 0
    enableMipMap: ${mipmaps ? 1 : 0}
    sRGBTexture: ${sRGB ? 1 : 0}
    linearTexture: 0
    fadeOut: 0
    borderMipMap: 0
    mipMapsPreserveCoverage: 0
    alphaTestReferenceValue: 0.5
    mipMapFadeDistanceStart: 1
    mipMapFadeDistanceEnd: 3
  bumpmap:
    convertToNormalMap: 0
    externalNormalMap: 0
    heightScale: 0.25
    normalMapFilter: 0
  isReadable: 0
  streamingMipmaps: 0
  streamingMipmapsPriority: 0
  vTOnly: 0
  ignoreMasterTextureLimit: 0
  grayScaleToAlpha: 0
  generateCubemap: 6
  cubemapConvolution: 0
  seamlessCubemap: 0
  textureFormat: 1
  maxTextureSize: ${maxSize}
  textureSettings:
    serializedVersion: 2
    filterMode: 1
    aniso: 1
    mipBias: 0
    wrapU: 1
    wrapV: 1
    wrapW: 1
  nPOTScale: 0
  lightmap: 0
  compressionQuality: 50
  spriteMode: ${spriteMode}
  spriteExtrude: 1
  spriteMeshType: 1
  alignment: 0
  spritePivot: {x: 0.5, y: 0.5}
  spritePixelsToUnits: ${pixelsPerUnit}
  spriteBorder: {x: 0, y: 0, z: 0, w: 0}
  spriteGenerateFallbackPhysicsShape: 1
  alphaUsage: 1
  alphaIsTransparency: ${alphaIsTransparency ? 1 : 0}
  spriteTessellationDetail: -1
  textureType: 8
  textureShape: 1
  singleChannelComponent: 0
  flipbookRows: 1
  flipbookColumns: 1
  maxTextureSizeSet: 0
  compressionQualitySet: 0
  textureFormatSet: 0
  ignorePngGamma: 0
  applyGammaDecoding: 0
  cookieLightType: 0
  platformSettings:
  - serializedVersion: 3
    buildTarget: DefaultTexturePlatform
    maxTextureSize: ${maxSize}
    resizeAlgorithm: 0
    textureFormat: -1
    textureCompression: ${comp}
    compressionQuality: 50
    crunchedCompression: 0
    allowsAlphaSplitting: 0
    overridden: 0
    androidETC2FallbackOverride: 0
    forceMaximumCompressionQuality_BC6H_BC7: 0
  spriteSheet:
    serializedVersion: 2
    sprites: []
    outline: []
    physicsShape: []
    bones: []
    spriteID: 5e97eb03825dee720800000000000000
    internalID: 0
    vertices: []
    indices:
    edges: []
    weights: []
    secondaryTextures: []
    nameFileIdTable: {}
  mipmapLimitGroupName:
  pSDRemoveMatte: 0
${COMMON_TAIL}`;
}

/** Text assets — spine .json and .atlas.txt files. */
export function textMeta(guid) {
  return `fileFormatVersion: 2
guid: ${guid}
TextScriptImporter:
  externalObjects: {}
${COMMON_TAIL}`;
}

/** Native Unity assets (.prefab, .anim, .playable). */
export function nativeMeta(guid, mainObjectFileID) {
  return `fileFormatVersion: 2
guid: ${guid}
NativeFormatImporter:
  externalObjects: {}
  mainObjectFileID: ${mainObjectFileID}
${COMMON_TAIL}`;
}

/** C# scripts. */
export function monoMeta(guid) {
  return `fileFormatVersion: 2
guid: ${guid}
MonoImporter:
  externalObjects: {}
  serializedVersion: 2
  defaultReferences: []
  executionOrder: 0
  icon: {instanceID: 0}
${COMMON_TAIL}`;
}

/** Assembly definition (.asmdef) files. */
export function asmdefMeta(guid) {
  return `fileFormatVersion: 2
guid: ${guid}
AssemblyDefinitionImporter:
  externalObjects: {}
${COMMON_TAIL}`;
}

/** Plain default importer — videos and anything else. */
export function defaultMeta(guid) {
  return `fileFormatVersion: 2
guid: ${guid}
DefaultImporter:
  externalObjects: {}
${COMMON_TAIL}`;
}
