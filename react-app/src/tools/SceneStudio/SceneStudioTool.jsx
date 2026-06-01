// Lazy wrapper for Scene Studio. The heavy bundle (Pixi v8 + scene engine)
// only loads when the user activates the tool. Meta is re-exported
// synchronously so the registry can list it without dragging in Pixi.

import { lazy, Suspense } from 'react';

export { sceneStudioMeta } from './meta.js';

const SceneStudioInner = lazy(() => import('./SceneStudioInner.jsx'));

export function SceneStudioTool() {
  return (
    <Suspense fallback={<div className="scene-studio-loading">loading Scene Studio…</div>}>
      <SceneStudioInner />
    </Suspense>
  );
}
