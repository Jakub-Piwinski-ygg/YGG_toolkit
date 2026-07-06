// LayerListPanel — left panel listing all scene layers.
// Click to select; checkbox toggles visibility; trash button removes.
// NOTE: currently unused (HierarchyPanel superseded it) — kept for reference.
// Visibility is `transform.alpha` now (0 = hidden), not a `visible` boolean.

export function LayerListPanel({ scene, selectedLayerId, onSelect, onToggleVisibility, onRemove }) {
  return (
    <div className="scene-panel scene-panel--left">
      <div className="scene-panel-head">layers</div>
      {scene.layers.length === 0 ? (
        <div className="scene-empty">drop a PNG onto the stage to add a layer</div>
      ) : (
        <ul className="scene-layer-list">
          {scene.layers.slice().reverse().map((layer) => {
            const selected = layer.id === selectedLayerId;
            return (
              <li
                key={layer.id}
                className={'scene-layer-row' + (selected ? ' selected' : '')}
                onClick={() => onSelect(layer.id)}
              >
                <input
                  type="checkbox"
                  checked={(layer.transforms?.landscape?.alpha ?? 1) > 0.0001}
                  onChange={(e) => {
                    e.stopPropagation();
                    onToggleVisibility(layer.id);
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
                <span className="scene-layer-name">{layer.name}</span>
                <button
                  className="scene-icon-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(layer.id);
                  }}
                  title="Remove layer"
                >
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
