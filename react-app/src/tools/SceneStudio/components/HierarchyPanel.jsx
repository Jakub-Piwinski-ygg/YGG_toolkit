// HierarchyPanel — tree view of canvas → objects → nested children.
//
// Drag-drop UX (Unity-style):
//   Mouse in top 33% of a target row  → drop ABOVE as sibling
//   Mouse in middle 66%               → drop INTO as child
//   Mouse in bottom 33%               → drop BELOW as sibling
//
// Draw order: items at the top of the list are drawn first (= behind).
// Items at the bottom are drawn last (= on top). Matches Unity UI Canvas.

import { useMemo, useRef, useState } from 'react';
import { buildLayerTree, layerTypeIcon } from '../engine/sceneModel.js';

const INDENT_PX = 14;

export function HierarchyPanel({
  scene,
  selectedLayerId,
  onSelect,
  onToggleVisibility,
  onRemove,
  onReorder, // (draggedId, targetId, mode) — mode: 'above' | 'below' | 'inside' | 'canvasRoot'
  onRenameScene // (name) — rename the active scene (shown as the panel head title)
}) {
  const trees = useMemo(() => buildLayerTree(scene), [scene]);
  const assetsById = useMemo(() => new Map((scene.assets || []).map((a) => [a.id, a])), [scene.assets]);
  const activeCanvasId = scene.activeCanvasId || scene.canvases?.[0]?.id;
  const [expanded, setExpanded] = useState(() => new Set()); // collapsed by default? expanded by default? Default expanded.
  const [dragId, setDragId] = useState(null);
  const [dropTarget, setDropTarget] = useState(null); // { id, mode } | { canvasId, mode: 'canvasRoot' }

  const isExpanded = (id) => !expanded.has(id); // default = expanded; the set holds COLLAPSED ids
  const toggleExpand = (id) => setExpanded((s) => {
    const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n;
  });

  // ── DnD handlers ──
  // We tag the drag with two payloads:
  //  - `text/plain` carries the layer id and is what hierarchy's own
  //    onDrop reads when reparenting within the tree.
  //  - `application/x-ygg-layer-id` is a sentinel MIME the timeline
  //    listens for. Without it, timeline drop zones can't distinguish
  //    a layer-from-hierarchy drag from arbitrary text drops.
  const onDragStart = (id) => (e) => {
    e.stopPropagation();
    setDragId(id);
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', id); } catch {}
    try { e.dataTransfer.setData('application/x-ygg-layer-id', id); } catch {}
  };
  const onDragOver = (id) => (e) => {
    if (!dragId || dragId === id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    // Compute zone in row
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const h = rect.height;
    let mode;
    if (y < h * 0.33) mode = 'above';
    else if (y > h * 0.67) mode = 'below';
    else mode = 'inside';
    if (dropTarget?.id !== id || dropTarget?.mode !== mode) setDropTarget({ id, mode });
  };
  const onDropOnRow = (id) => (e) => {
    e.preventDefault();
    if (!dragId || !dropTarget) return;
    onReorder?.(dragId, dropTarget.id, dropTarget.mode);
    setDragId(null);
    setDropTarget(null);
  };
  const onDragEnd = () => { setDragId(null); setDropTarget(null); };

  // Drop into canvas root area (empty space below all rows in a canvas).
  const onCanvasDropZoneOver = (canvasId) => (e) => {
    if (!dragId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropTarget({ canvasId, mode: 'canvasRoot' });
  };
  const onCanvasDropZoneDrop = (canvasId) => (e) => {
    e.preventDefault();
    if (!dragId) return;
    onReorder?.(dragId, null, 'canvasRoot', canvasId);
    setDragId(null);
    setDropTarget(null);
  };

  return (
    <div className="scene-panel scene-panel--left" onDragEnd={onDragEnd}>
      <div className="scene-panel-head">hierarchy</div>

      {(scene.canvases || []).map((canvas) => {
        if (canvas.id !== activeCanvasId) return null; // single-canvas UI for now
        const roots = trees.get(canvas.id) || [];
        return (
          <div key={canvas.id} className="scene-canvas-block">
            <div className="scene-canvas-head">
              <span className="scene-canvas-icon">▼</span>
              <span className="scene-canvas-name" title={scene.name}>{scene.name || 'Scene'}</span>
              {onRenameScene && (
                <button
                  className="scene-icon-btn scene-canvas-rename"
                  title="Rename scene"
                  onClick={(e) => {
                    e.stopPropagation();
                    const name = window.prompt('Rename scene', scene.name || 'Scene');
                    if (name && name.trim()) onRenameScene(name.trim());
                  }}
                >
                  ✎
                </button>
              )}
              <span className="scene-canvas-count">{scene.layers.filter((l) => l.canvasId === canvas.id).length}</span>
            </div>

            {roots.length === 0 ? (
              <div
                className="scene-empty scene-empty--drop"
                onDragOver={onCanvasDropZoneOver(canvas.id)}
                onDrop={onCanvasDropZoneDrop(canvas.id)}
              >
                drop a PNG / spine / video onto the stage to add an object
              </div>
            ) : (
              <ul className="scene-layer-list">
                {renderNodes(roots, {
                  scene,
                  assetsById,
                  selectedLayerId,
                  dragId,
                  dropTarget,
                  isExpanded,
                  toggleExpand,
                  onSelect,
                  onToggleVisibility,
                  onRemove,
                  onDragStart,
                  onDragOver,
                  onDropOnRow
                })}
              </ul>
            )}

            {/* Tail drop zone: drop here to land at canvas root, after all siblings */}
            <div
              className={'scene-canvas-tail-drop' + (dropTarget?.canvasId === canvas.id ? ' active' : '')}
              onDragOver={onCanvasDropZoneOver(canvas.id)}
              onDrop={onCanvasDropZoneDrop(canvas.id)}
            />
          </div>
        );
      })}
    </div>
  );
}

function renderNodes(nodes, ctx) {
  return nodes.map((node) => {
    const { layer, depth, children } = node;
    const expanded = ctx.isExpanded(layer.id);
    const isDropTarget = ctx.dropTarget?.id === layer.id;
    const cls = [
      'scene-layer-row',
      layer.id === ctx.selectedLayerId ? 'selected' : '',
      ctx.dragId === layer.id ? 'dragging' : '',
      isDropTarget && ctx.dropTarget?.mode === 'inside' ? 'drop-inside' : '',
      isDropTarget && ctx.dropTarget?.mode === 'above' ? 'drop-above' : '',
      isDropTarget && ctx.dropTarget?.mode === 'below' ? 'drop-below' : ''
    ].filter(Boolean).join(' ');

    return (
      <li key={layer.id} className="scene-layer-li">
        <div
          className={cls + (layer.locked ? ' locked' : '')}
          style={{ paddingLeft: 8 + depth * INDENT_PX }}
          draggable={!layer.locked}
          onDragStart={ctx.onDragStart(layer.id)}
          onDragOver={ctx.onDragOver(layer.id)}
          onDrop={ctx.onDropOnRow(layer.id)}
          onClick={() => ctx.onSelect(layer.id)}
        >
          <span
            className={'scene-tree-twirly' + (children.length ? ' has-children' : '')}
            onClick={(e) => { e.stopPropagation(); if (children.length) ctx.toggleExpand(layer.id); }}
          >
            {children.length ? (expanded ? '▾' : '▸') : ''}
          </span>
          <button
            type="button"
            className="scene-layer-eye"
            title={layer.visible !== false ? 'Eye open — visible (click to hide)' : 'Eye closed — hidden (click to show)'}
            onClick={(e) => { e.stopPropagation(); ctx.onToggleVisibility(layer.id, layer.visible === false); }}
          >
            {layer.visible !== false ? '👁' : '🙈'}
          </button>
          <span className="scene-layer-type-icon" title={ctx.assetsById.get(layer.assetId)?.type || 'object'}>
            {layerTypeIcon(ctx.assetsById.get(layer.assetId))}
          </span>
          <span className="scene-layer-name">{layer.name}</span>
          {layer.locked ? (
            <span className="scene-icon-btn scene-layer-lock" title="Locked to its parent — removed with it">🔒</span>
          ) : (
            <button
              className="scene-icon-btn"
              onClick={(e) => { e.stopPropagation(); ctx.onRemove(layer.id); }}
              title="Remove object"
            >
              ✕
            </button>
          )}
        </div>
        {children.length > 0 && expanded && (
          <ul className="scene-layer-list scene-layer-list--nested">
            {renderNodes(children, ctx)}
          </ul>
        )}
      </li>
    );
  });
}
