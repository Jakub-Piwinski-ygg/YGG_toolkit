// ScenarioInspectorSections — Direct-mode right panel.
//
//  • Nothing selected  → scenario summary (counts + resolved active-path length
//    and total duration).
//  • Timeline node selected → label override, branch (output-pin) add/remove,
//    per-node entry options (speed / start offset / wait-for-click), open in
//    animate, delete.
//  • Edge selected → transition / key-mixing editor (§9): cut / crossfade /
//    hold, mix duration, per-channel blend toggles.

import {
  resolveWalk,
  resolveTimelineRef,
  nodeEntry,
  edgeTransition,
  TRANSITION_MODES,
  TRANSITION_CHANNELS
} from '../engine/scenarioModel.js';

const fmt = (s) => `${Math.round((s || 0) * 100) / 100}s`;

export function ScenarioInspectorSections({
  scenario,
  project,
  selectedNodeId,
  selectedEdgeId,
  onSetNodeLabel,
  onSetNodeEntry,
  onAddOutputPin,
  onRemoveOutputPin,
  onRemoveNode,
  onSetEdgeTransition,
  onDeleteEdge,
  onJumpToTimeline
}) {
  const node = selectedNodeId ? scenario?.nodes.find((n) => n.id === selectedNodeId) : null;
  const edge = selectedEdgeId ? scenario?.edges.find((e) => e.id === selectedEdgeId) : null;

  return (
    <div className="scene-panel scene-panel--right ss-insp">
      <div className="scene-panel-head">scenario</div>
      {edge ? (
        <EdgeSection scenario={scenario} edge={edge} onSetEdgeTransition={onSetEdgeTransition} onDeleteEdge={onDeleteEdge} />
      ) : node && node.type === 'timeline' ? (
        <NodeSection
          node={node}
          project={project}
          onSetNodeLabel={onSetNodeLabel}
          onSetNodeEntry={onSetNodeEntry}
          onAddOutputPin={onAddOutputPin}
          onRemoveOutputPin={onRemoveOutputPin}
          onRemoveNode={onRemoveNode}
          onJumpToTimeline={onJumpToTimeline}
        />
      ) : node ? (
        <div className="ss-insp-body"><div className="ss-insp-note">{node.type === 'start' ? '▶ Start node' : '■ End node'} — no settings.</div></div>
      ) : (
        <SummarySection scenario={scenario} project={project} />
      )}
    </div>
  );
}

function SummarySection({ scenario, project }) {
  if (!scenario) return <div className="ss-insp-body"><div className="ss-insp-note">No scenario.</div></div>;
  const walk = resolveWalk(scenario);
  const timelineNodes = scenario.nodes.filter((n) => n.type === 'timeline');
  let total = 0;
  for (const nid of walk.order) {
    const n = scenario.nodes.find((x) => x.id === nid);
    if (n?.type !== 'timeline') continue;
    const ref = resolveTimelineRef(project, n.sceneId, n.timelineId);
    if (!ref) continue;
    const e = nodeEntry(n);
    total += Math.max(0, ref.duration - e.startOffset) / (e.speed || 1);
  }
  const playedTimelines = walk.order.filter((id) => {
    const n = scenario.nodes.find((x) => x.id === id);
    return n?.type === 'timeline';
  }).length;
  return (
    <div className="ss-insp-body">
      <div className="ss-insp-title">{scenario.name}</div>
      <Row k="Timelines" v={timelineNodes.length} />
      <Row k="Edges" v={scenario.edges.length} />
      <div className="ss-insp-sep" />
      <Row k="Status" v={walk.ok ? (walk.loop ? '⚠ loop' : '✓ playable') : `⚠ ${walk.reason || 'no path'}`} />
      <Row k="Path length" v={`${playedTimelines} timeline${playedTimelines === 1 ? '' : 's'}`} />
      <Row k="Total duration" v={fmt(total)} />
      <div className="ss-insp-note">Select a node or an edge to edit it. Click an edge to pick the active branch.</div>
    </div>
  );
}

function NodeSection({ node, project, onSetNodeLabel, onSetNodeEntry, onAddOutputPin, onRemoveOutputPin, onRemoveNode, onJumpToTimeline }) {
  const ref = resolveTimelineRef(project, node.sceneId, node.timelineId);
  const entry = nodeEntry(node);
  return (
    <div className="ss-insp-body">
      <div className="ss-insp-title">{node.label || ref?.timelineName || 'timeline'}</div>
      {ref ? (
        <div className="ss-insp-meta">{ref.sceneName} · {ref.trackCount} trk · {fmt(ref.duration)}</div>
      ) : (
        <div className="ss-insp-warn">⚠ bound timeline no longer exists ({node.timelineId})</div>
      )}

      <label className="ss-insp-field">
        <span>Label</span>
        <input
          type="text"
          className="ss-insp-input"
          value={node.label || ''}
          placeholder={ref?.timelineName || 'timeline'}
          onChange={(e) => onSetNodeLabel?.(node.id, e.target.value)}
        />
      </label>

      <div className="ss-insp-sep" />
      <div className="ss-insp-subhead">Branches</div>
      {(node.outputs || []).map((pin, i) => (
        <div key={pin} className="ss-insp-branch">
          <span className="ss-pin ss-pin--inline" />
          <span className="ss-insp-branch-name">branch {i + 1}</span>
          <button
            className="scene-icon-btn"
            title="Remove this branch pin"
            disabled={(node.outputs || []).length <= 1}
            onClick={() => onRemoveOutputPin?.(node.id, pin)}
          >✕</button>
        </div>
      ))}
      <button className="scene-btn scene-btn--sm" onClick={() => onAddOutputPin?.(node.id)}>＋ add branch</button>

      <div className="ss-insp-sep" />
      <div className="ss-insp-subhead">Entry options</div>
      <label className="ss-insp-field">
        <span>Speed ×</span>
        <input
          type="number" step="0.1" min="0.1" className="ss-insp-input ss-insp-input--num"
          value={entry.speed}
          onChange={(e) => onSetNodeEntry?.(node.id, { speed: Number(e.target.value) })}
        />
      </label>
      <label className="ss-insp-field">
        <span>Start offset (s)</span>
        <input
          type="number" step="0.1" min="0" className="ss-insp-input ss-insp-input--num"
          value={entry.startOffset}
          onChange={(e) => onSetNodeEntry?.(node.id, { startOffset: Number(e.target.value) })}
        />
      </label>
      <label className="ss-insp-check">
        <input
          type="checkbox"
          checked={entry.waitForClick}
          onChange={(e) => onSetNodeEntry?.(node.id, { waitForClick: e.target.checked })}
        />
        <span>Wait for click before continuing</span>
        <span className="ss-insp-tag" title="Exported to Unity; not simulated in the web preview yet">export</span>
      </label>

      <div className="ss-insp-sep" />
      <div className="ss-insp-actions">
        {ref && (
          <button className="scene-btn scene-btn--sm" onClick={() => onJumpToTimeline?.(node.sceneId, node.timelineId)}>
            ✎ open in animate
          </button>
        )}
        <button className="scene-btn scene-btn--sm scene-btn--ghost" onClick={() => onRemoveNode?.(node.id)}>🗑 delete node</button>
      </div>
    </div>
  );
}

function EdgeSection({ scenario, edge, onSetEdgeTransition, onDeleteEdge }) {
  const t = edgeTransition(edge);
  const nameOf = (id) => {
    const n = scenario.nodes.find((x) => x.id === id);
    if (!n) return '?';
    if (n.type === 'start') return 'Start';
    if (n.type === 'end') return 'End';
    return n.label || 'timeline';
  };
  const showMix = t.mode !== 'cut';
  return (
    <div className="ss-insp-body">
      <div className="ss-insp-title">Transition</div>
      <div className="ss-insp-meta">{nameOf(edge.from.node)} → {nameOf(edge.to.node)}{edge.active ? '  · active' : ''}</div>

      <label className="ss-insp-field">
        <span>Mode</span>
        <select
          className="ss-insp-input"
          value={t.mode}
          onChange={(e) => onSetEdgeTransition?.(edge.id, { mode: e.target.value })}
        >
          {TRANSITION_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </label>

      {showMix && (
        <>
          <label className="ss-insp-field">
            <span>Mix duration (s)</span>
            <input
              type="number" step="0.05" min="0" className="ss-insp-input ss-insp-input--num"
              value={t.mixDuration}
              onChange={(e) => onSetEdgeTransition?.(edge.id, { mixDuration: Number(e.target.value) })}
            />
          </label>
          <div className="ss-insp-subhead">Blend channels</div>
          <div className="ss-insp-chips">
            {TRANSITION_CHANNELS.map((c) => (
              <label key={c} className={'ss-insp-chip' + (t.channels[c] ? ' is-on' : '')}>
                <input
                  type="checkbox"
                  checked={!!t.channels[c]}
                  onChange={(e) => onSetEdgeTransition?.(edge.id, { channels: { ...t.channels, [c]: e.target.checked } })}
                />
                {c}
              </label>
            ))}
          </div>
        </>
      )}

      <div className="ss-insp-note">
        {t.mode === 'cut'
          ? 'Cut — the next timeline starts instantly.'
          : 'Crossfade / hold is authored + exported to Unity. The web preview plays the hand-off as a cut for now.'}
      </div>

      <div className="ss-insp-sep" />
      <div className="ss-insp-actions">
        <button className="scene-btn scene-btn--sm scene-btn--ghost" onClick={() => onDeleteEdge?.(edge.id)}>🗑 delete branch</button>
      </div>
    </div>
  );
}

function Row({ k, v }) {
  return <div className="ss-insp-row"><span>{k}</span><span className="ss-insp-row-v">{v}</span></div>;
}
