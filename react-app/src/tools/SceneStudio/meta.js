// Scene Studio — public metadata + category registration.
// Kept separate from SceneStudioTool.jsx so the registry can read meta
// synchronously while the heavy implementation (Pixi, scene engine) loads
// lazily on first activation.
//
// See SCENE_STUDIO.md for the full design.

export const sceneStudioMeta = {
  id: 'scenestudio',
  label: 'Scene Studio',
  small: 'compose, sequence, export',
  icon: '🎬',
  needsMagick: false,
  batchMode: false,
  needsFiles: false,
  fullBleed: true,
  hideOutput: true,
  desc:
    'Compose PNG / Spine / video layers into a stage. Animate properties with multi-keyframe channels. ' +
    'Drive playback with a timeline + hold markers. Export landscape and portrait previews.'
};
