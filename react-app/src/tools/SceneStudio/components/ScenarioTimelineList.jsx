// ScenarioTimelineList — Direct-mode left panel. Lists every timeline across
// all scenes in the project (each strongly bound to its origin scene) and acts
// as the drag source for spawning timeline nodes on the scenario canvas.
//
// Drag payload mime: application/x-ygg-timeline-ref → JSON { sceneId, timelineId }.

export const TIMELINE_REF_MIME = 'application/x-ygg-timeline-ref';

function fmtDur(s) {
  if (!s) return '0s';
  return `${(Math.round(s * 10) / 10)}s`;
}

export function ScenarioTimelineList({ timelines = [], activeScenario = null, onJumpToTimeline, onAddNode }) {
  // How many times each timeline ref appears as a node in the active scenario.
  const usageCount = new Map();
  for (const n of activeScenario?.nodes || []) {
    if (n.type !== 'timeline') continue;
    const key = `${n.sceneId}::${n.timelineId}`;
    usageCount.set(key, (usageCount.get(key) || 0) + 1);
  }

  // Group rows by origin scene to make the scene→timeline binding obvious.
  const byScene = [];
  const sceneIndex = new Map();
  for (const t of timelines) {
    let group = sceneIndex.get(t.sceneId);
    if (!group) {
      group = { sceneId: t.sceneId, sceneName: t.sceneName, items: [] };
      sceneIndex.set(t.sceneId, group);
      byScene.push(group);
    }
    group.items.push(t);
  }

  const onDragStart = (e, t) => {
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData(TIMELINE_REF_MIME, JSON.stringify({ sceneId: t.sceneId, timelineId: t.timelineId }));
  };

  return (
    <div className="scene-panel ss-scenario-list">
      <div className="scene-panel-head">
        <span className="scene-panel-title">timelines</span>
        <span className="scene-panel-sub">{timelines.length} across {byScene.length} scene{byScene.length === 1 ? '' : 's'}</span>
      </div>
      <div className="ss-scenario-list-body">
        {timelines.length === 0 && (
          <div className="ss-scenario-list-empty">
            No timelines yet. Author timelines in <strong>animate</strong> mode, then drag them onto the graph.
          </div>
        )}
        {byScene.map((group) => (
          <div key={group.sceneId} className="ss-scenario-list-group">
            <div className="ss-scenario-list-scene">🎬 {group.sceneName}</div>
            {group.items.map((t) => {
              const used = usageCount.get(`${t.sceneId}::${t.timelineId}`) || 0;
              return (
                <div
                  key={t.timelineId}
                  className="ss-tl-row"
                  draggable
                  onDragStart={(e) => onDragStart(e, t)}
                  onDoubleClick={() => onJumpToTimeline?.(t.sceneId, t.timelineId)}
                  title="Drag onto the graph to add a node · double-click to edit in animate mode"
                >
                  <span className="ss-tl-dot" />
                  <span className="ss-tl-name">{t.timelineDisplayName || t.timelineName}</span>
                  <span className="ss-tl-meta">{t.trackCount} trk · {fmtDur(t.duration)}</span>
                  {used > 0 && <span className="ss-tl-badge" title={`Used ${used}× in this scenario`}>×{used}</span>}
                  <button
                    className="ss-tl-add"
                    title="Add this timeline as a node chained after the last one"
                    disabled={!activeScenario}
                    onClick={(e) => { e.stopPropagation(); onAddNode?.(t.sceneId, t.timelineId); }}
                  >＋</button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div className="ss-scenario-list-hint">Drag a timeline onto the canvas, or click ＋ to chain it after the last node.</div>
    </div>
  );
}
