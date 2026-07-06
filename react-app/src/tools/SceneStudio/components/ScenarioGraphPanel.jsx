// ScenarioGraphPanel — Direct-mode center-bottom panel: a header bar (scenario
// picker / new / rename / delete + transport placeholder + validity chip) over
// a pan/zoom node canvas.
//
// P1: scenario management, validity chip, drop-to-add nodes, static render.
// P2 (this file): middle-mouse pan + wheel zoom (around cursor), left-drag to
// move nodes, and pin drag-to-connect (output pin → input pin) with a live
// rubber-band. Active-edge click selection. Playback transport is P3.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { elementZoom, rootZoom } from '../../../utils/domZoom.js';
import {
  resolveWalk,
  resolveTimelineRef,
  activeEdgeFrom,
  START_PIN,
  END_PIN,
  TIMELINE_IN_PIN,
  SCENARIO_TL_W,
  SCENARIO_SE_W,
  SCENARIO_NODE_H
} from '../engine/scenarioModel.js';
import { sampleScenario } from '../engine/scenarioTimeline.js';
import { TIMELINE_REF_MIME } from './ScenarioTimelineList.jsx';

// Node geometry (graph units) — shared with the model (chained placement) so
// render + placement can't drift.
const TL_W = SCENARIO_TL_W;   // timeline node width
const SE_W = SCENARIO_SE_W;   // start / end node width
const NODE_H = SCENARIO_NODE_H;
const PIN_IN_Y = 20;  // input pin centre, relative to node top
const TL_OUT_Y0 = 20; // first output pin centre
const TL_OUT_DY = 16; // vertical spacing between branch output pins
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 3;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const nodeWidth = (n) => (n.type === 'timeline' ? TL_W : SE_W);

/** Output-pin anchor in graph space. `pin` is the pin id (timeline) or START_PIN. */
function outAnchor(n, pin) {
  if (n.type === 'timeline') {
    const i = Math.max(0, (n.outputs || []).indexOf(pin));
    return { x: n.x + TL_W, y: n.y + TL_OUT_Y0 + i * TL_OUT_DY };
  }
  return { x: n.x + nodeWidth(n), y: n.y + PIN_IN_Y };
}
/** Input-pin anchor in graph space. */
function inAnchor(n) {
  return { x: n.x, y: n.y + PIN_IN_Y };
}

export function ScenarioGraphPanel({
  project,
  scenario,
  timeline = { segments: [], total: 0 },
  time = 0,
  playing = false,
  focusRequest = null,
  onTransport,
  onScrub,
  selectedNodeId,
  selectedEdgeId,
  onSelectScenario,
  onAddScenario,
  onDuplicateScenario,
  onRenameScenario,
  onRemoveScenario,
  onAddTimelineNode,
  onConnect,
  onDisconnect,
  onDeleteEdge,
  onSetActiveEdge,
  onRemoveNode,
  onMoveNode,
  onSetView,
  onSelectNode,
  onSelectEdge
}) {
  const canvasRef = useRef(null);
  const scenarios = project?.scenarios || [];
  const walk = scenario ? resolveWalk(scenario) : { ok: false, reason: 'no scenario', loop: false };

  // ── Local view (pan / zoom). Synced from scenario.view on scenario switch,
  // committed back to the model on interaction end. ──────────────────────────
  const [view, setView] = useState(() => scenario?.view || { panX: 0, panY: 0, zoom: 1 });
  useEffect(() => {
    setView(scenario?.view || { panX: 0, panY: 0, zoom: 1 });
  // resync only when the scenario identity changes, not on every node edit.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenario?.id]);
  const viewRef = useRef(view);
  viewRef.current = view;
  const commitTimer = useRef(0);
  const commitView = useCallback((v) => {
    clearTimeout(commitTimer.current);
    commitTimer.current = setTimeout(() => onSetView?.(v), 200);
  }, [onSetView]);
  useEffect(() => () => clearTimeout(commitTimer.current), []);

  // Live node-drag position + rubber-band link state.
  const [drag, setDrag] = useState(null);   // { nodeId, x, y } | null
  const [link, setLink] = useState(null);    // { fromNode, fromPin, x, y } | null

  // ── Focus-on-node: pan (zoom unchanged) to centre a freshly spawned node.
  // Tweened over ~280ms; any user wheel/pointer input cancels the tween.
  const focusRafRef = useRef(0);
  const consumedFocusRef = useRef(0);
  const cancelFocusTween = useCallback(() => cancelAnimationFrame(focusRafRef.current), []);
  useEffect(() => {
    if (!focusRequest || focusRequest.token === consumedFocusRef.current) return;
    const node = (scenario?.nodes || []).find((n) => n.id === focusRequest.nodeId);
    // The request can land one render before the node exists in `scenario` —
    // leave the token unconsumed so the re-run (scenario dep) picks it up.
    if (!node) return;
    consumedFocusRef.current = focusRequest.token;
    const el = canvasRef.current;
    const rect = el?.getBoundingClientRect();
    if (!rect) return;
    const z = elementZoom(el); // same layout-px space as screenToGraph
    const cw = rect.width / z;
    const ch = rect.height / z;
    const from = { ...viewRef.current };
    const target = {
      panX: cw / 2 - (node.x + nodeWidth(node) / 2) * from.zoom,
      panY: ch / 2 - (node.y + NODE_H / 2) * from.zoom,
      zoom: from.zoom
    };
    cancelAnimationFrame(focusRafRef.current);
    const t0 = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - t0) / 280);
      const e = 1 - Math.pow(1 - p, 3); // cubic ease-out
      setView({
        panX: from.panX + (target.panX - from.panX) * e,
        panY: from.panY + (target.panY - from.panY) * e,
        zoom: from.zoom
      });
      if (p < 1) focusRafRef.current = requestAnimationFrame(step);
      else commitView(target);
    };
    focusRafRef.current = requestAnimationFrame(step);
  }, [focusRequest, scenario, commitView]);
  useEffect(() => () => cancelAnimationFrame(focusRafRef.current), []);

  const screenToGraph = useCallback((clientX, clientY) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    const v = viewRef.current;
    if (!rect) return { x: 0, y: 0 };
    // Undo the global CSS ui-scale on the pointer term first: pan/zoom + node
    // positions live in the canvas's own (layout-px) space.
    const z = elementZoom(canvasRef.current);
    return { x: ((clientX - rect.left) / z - v.panX) / v.zoom, y: ((clientY - rect.top) / z - v.panY) / v.zoom };
  }, []);

  // Wheel zoom around the cursor — attached non-passively so we can preventDefault.
  useLayoutEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      cancelFocusTween();
      const rect = el.getBoundingClientRect();
      const z = elementZoom(el);
      const cx = (e.clientX - rect.left) / z;
      const cy = (e.clientY - rect.top) / z;
      const v = viewRef.current;
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const zoom = clamp(v.zoom * factor, ZOOM_MIN, ZOOM_MAX);
      const gx = (cx - v.panX) / v.zoom;
      const gy = (cy - v.panY) / v.zoom;
      const next = { panX: cx - gx * zoom, panY: cy - gy * zoom, zoom };
      setView(next);
      commitView(next);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [commitView, cancelFocusTween]);

  // ── Drop a timeline from the left list to spawn a node ──────────────────────
  const onCanvasDragOver = (e) => {
    if (e.dataTransfer.types.includes(TIMELINE_REF_MIME)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  };
  const onCanvasDrop = (e) => {
    const raw = e.dataTransfer.getData(TIMELINE_REF_MIME);
    if (!raw) return;
    e.preventDefault();
    let ref;
    try { ref = JSON.parse(raw); } catch { return; }
    if (!ref?.sceneId || !ref?.timelineId) return;
    const p = screenToGraph(e.clientX, e.clientY);
    onAddTimelineNode?.(ref.sceneId, ref.timelineId, p.x - TL_W / 2, p.y - NODE_H / 2);
  };

  // ── Canvas pointer: middle-mouse pan, left-click empty = clear selection ────
  const onCanvasPointerDown = (e) => {
    cancelFocusTween();
    if (e.button === 1) {
      e.preventDefault();
      const sx = e.clientX;
      const sy = e.clientY;
      const base = { x: viewRef.current.panX, y: viewRef.current.panY };
      const move = (ev) => { const z = rootZoom(); setView((v) => ({ ...v, panX: base.x + (ev.clientX - sx) / z, panY: base.y + (ev.clientY - sy) / z })); };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        document.body.style.cursor = '';
        commitView(viewRef.current);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      document.body.style.cursor = 'grabbing';
      return;
    }
    if (e.button === 0) { onSelectNode?.(null); onSelectEdge?.(null); }
  };

  // ── Node drag (left button) ─────────────────────────────────────────────────
  const startNodeDrag = (e, node) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const sx = e.clientX;
    const sy = e.clientY;
    const orig = { x: node.x, y: node.y };
    let moved = false;
    setDrag({ nodeId: node.id, x: node.x, y: node.y });
    const move = (ev) => {
      const z = rootZoom();
      const dx = (ev.clientX - sx) / z / viewRef.current.zoom;
      const dy = (ev.clientY - sy) / z / viewRef.current.zoom;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) moved = true;
      setDrag({ nodeId: node.id, x: orig.x + dx, y: orig.y + dy });
    };
    const up = (ev) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const z = rootZoom();
      const dx = (ev.clientX - sx) / z / viewRef.current.zoom;
      const dy = (ev.clientY - sy) / z / viewRef.current.zoom;
      setDrag(null);
      if (moved) onMoveNode?.(node.id, orig.x + dx, orig.y + dy);
      else onSelectNode?.(node.id);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // ── Pin drag-to-connect ─────────────────────────────────────────────────────
  const findInputTarget = (cx, cy) => {
    let el = document.elementFromPoint(cx, cy);
    while (el && el !== document.body) {
      if (el.dataset && el.dataset.nodeId) {
        if (el.dataset.nodeType === 'start') return null; // start has no input
        return { nodeId: el.dataset.nodeId, pin: el.dataset.nodeType === 'end' ? END_PIN : TIMELINE_IN_PIN };
      }
      el = el.parentElement;
    }
    return null;
  };
  const startLink = (e, node, pin) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const p0 = screenToGraph(e.clientX, e.clientY);
    setLink({ fromNode: node.id, fromPin: pin, x: p0.x, y: p0.y });
    const move = (ev) => {
      const p = screenToGraph(ev.clientX, ev.clientY);
      setLink({ fromNode: node.id, fromPin: pin, x: p.x, y: p.y });
    };
    const up = (ev) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const target = findInputTarget(ev.clientX, ev.clientY);
      setLink(null);
      if (target && target.nodeId !== node.id) {
        onConnect?.({ node: node.id, pin }, { node: target.nodeId, pin: target.pin });
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // ── Keyboard: Delete removes the selected node / edge ───────────────────────
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const tag = (e.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (selectedNodeId) { onRemoveNode?.(selectedNodeId); e.preventDefault(); }
      else if (selectedEdgeId) { (onDeleteEdge || onDisconnect)?.(selectedEdgeId); e.preventDefault(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedNodeId, selectedEdgeId, onRemoveNode, onDisconnect, onDeleteEdge]);

  // Apply the live drag position when laying out / drawing edges.
  const posOf = (n) => (drag && drag.nodeId === n.id ? { ...n, x: drag.x, y: drag.y } : n);

  const handlePickScenario = (e) => {
    const v = e.target.value;
    if (v === '__new__') onAddScenario?.();
    else if (v === '__dup__') scenario && onDuplicateScenario?.(scenario.id);
    else if (v) onSelectScenario?.(v);
  };
  const handleRename = () => {
    if (!scenario) return;
    const name = window.prompt('Rename scenario', scenario.name);
    if (name && name.trim()) onRenameScenario?.(scenario.id, name.trim());
  };
  const handleDelete = () => {
    if (!scenario) return;
    if (window.confirm(`Delete scenario "${scenario.name}"? Timelines are not affected.`)) {
      onRemoveScenario?.(scenario.id);
    }
  };

  const hasTimelineNode = scenario?.nodes?.some((n) => n.type === 'timeline');
  // Resolve the playhead → current segment, its node, and progress through it.
  const sample = timeline.total > 0 ? sampleScenario(timeline, time) : null;
  const curSeg = sample?.segment || null;
  const curNodeId = curSeg?.nodeId || null;
  const curProgress = curSeg ? Math.max(0, Math.min(1, (time - curSeg.t0) / Math.max(1e-4, curSeg.t1 - curSeg.t0))) : 0;
  const running = playing;
  // The active edge leaving the currently-playing node pulses while running.
  const liveEdgeId = (playing && scenario && curNodeId)
    ? activeEdgeFrom(scenario, curNodeId)?.id || null
    : null;

  return (
    <div className="scene-panel ss-graph">
      <div className="ss-graph-header">
        <select
          className="scene-toolbar-select ss-graph-picker"
          value={scenario?.id || ''}
          onChange={handlePickScenario}
          title="Switch scenario"
        >
          {!scenario && <option value="">(no scenario)</option>}
          {scenarios.map((sc) => <option key={sc.id} value={sc.id}>{sc.name}</option>)}
          <option value="__new__">＋ new scenario…</option>
          {scenario && <option value="__dup__">⎘ duplicate…</option>}
        </select>
        <button className="scene-icon-btn" onClick={handleRename} disabled={!scenario} title="Rename scenario">✎</button>
        <button className="scene-icon-btn" onClick={handleDelete} disabled={!scenario} title="Delete scenario">🗑</button>

        <div className="scene-toolbar-divider" />

        {/* Transport — drives the scenario playhead. */}
        <div className="ss-graph-transport" role="group" aria-label="Scenario playback">
          <button
            className="scene-btn scene-btn--sm"
            onClick={() => onTransport?.('seekStart')}
            disabled={time === 0}
            title="Jump to start"
          >⏮</button>
          {playing ? (
            <button className="scene-btn scene-btn--sm" onClick={() => onTransport?.('pause')} title="Pause">⏸</button>
          ) : (
            <button
              className="scene-btn scene-btn--sm scene-btn--primary"
              onClick={() => onTransport?.('play')}
              disabled={!walk.ok}
              title="Play scenario"
            >▶</button>
          )}
          <button className="scene-btn scene-btn--sm" onClick={() => onTransport?.('stop')} disabled={time === 0 && !playing} title="Stop (rewind to start)">⏹</button>
        </div>

        <div className="scene-toolbar-spacer" />

        <span
          className={'ss-graph-chip' + (walk.ok ? ' ss-graph-chip--ok' : ' ss-graph-chip--warn')}
          title={walk.ok ? 'Scenario has a playable path from Start' : (walk.reason || 'not playable')}
        >
          {walk.ok ? (walk.loop ? '⚠ loop' : '✓ playable') : `⚠ ${walk.reason || 'no path'}`}
        </span>
      </div>

      <ScenarioScrubber timeline={timeline} time={time} onScrub={onScrub} activeNodeId={curNodeId} playing={playing} />

      <div
        ref={canvasRef}
        className="ss-graph-canvas"
        onPointerDown={onCanvasPointerDown}
        onDragOver={onCanvasDragOver}
        onDrop={onCanvasDrop}
      >
        <div
          className="ss-graph-world"
          style={{ transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})` }}
        >
          <EdgeLayer
            scenario={scenario}
            posOf={posOf}
            link={link}
            selectedEdgeId={selectedEdgeId}
            liveEdgeId={liveEdgeId}
            onSelectEdge={onSelectEdge}
            onSetActiveEdge={onSetActiveEdge}
            onDeleteEdge={onDeleteEdge}
          />
          {(scenario?.nodes || []).map((node) => (
            <ScenarioNodeBox
              key={node.id}
              node={posOf(node)}
              project={project}
              selected={node.id === selectedNodeId}
              current={node.id === curNodeId}
              playing={playing}
              progress={node.id === curNodeId ? curProgress : 0}
              onStartDrag={startNodeDrag}
              onStartLink={startLink}
              onRemove={onRemoveNode}
            />
          ))}
        </div>

        {!hasTimelineNode && (
          <div className="ss-graph-empty">
            <div className="ss-graph-empty-icon">🎬➜🎬</div>
            <div>Drag a timeline from the left (or click ＋ on a row) to add a node.</div>
            <div className="ss-graph-empty-hint">Drag a pin from one node to another to wire Start → timelines → End. Middle-drag to pan, wheel to zoom.</div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Scrubber bar: segment blocks proportional to play-duration + a draggable playhead. */
function ScenarioScrubber({ timeline, time, onScrub, activeNodeId = null, playing = false }) {
  const barRef = useRef(null);
  const { segments, total } = timeline;

  const scrubTo = (clientX) => {
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect || total <= 0) return;
    const f = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    onScrub?.(f * total);
  };
  const onDown = (e) => {
    if (e.button !== 0 || total <= 0) return;
    e.preventDefault();
    scrubTo(e.clientX);
    const move = (ev) => scrubTo(ev.clientX);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const pct = (v) => `${(total > 0 ? (v / total) * 100 : 0)}%`;
  return (
    <div className="ss-scrub">
      <div
        ref={barRef}
        className={'ss-scrub-track' + (total <= 0 ? ' is-empty' : '')}
        onPointerDown={onDown}
        title={total > 0 ? 'Drag to scrub the scenario' : 'Connect Start → timelines to build a flow'}
      >
        {segments.map((s) => (
          <div
            key={s.nodeId}
            className={'ss-scrub-seg'
              + (s.missing ? ' is-missing' : '')
              + (s.overlapIn > 0 ? ' has-xfade' : '')
              + (s.nodeId === activeNodeId ? ' is-current' : '')
              + (s.nodeId === activeNodeId && playing ? ' is-running' : '')}
            style={{ left: pct(s.t0), width: pct(s.t1 - s.t0) }}
            title={`${s.label} · ${Math.round(s.playDur * 100) / 100}s`}
          >
            <span className="ss-scrub-seg-label">{s.label}</span>
          </div>
        ))}
        {total > 0 && <div className="ss-scrub-playhead" style={{ left: pct(Math.min(time, total)) }} />}
        {total <= 0 && <span className="ss-scrub-empty">connect Start → timelines to build a flow</span>}
      </div>
      <div className="ss-scrub-time">{(Math.round(time * 100) / 100).toFixed(2)} / {(Math.round(total * 100) / 100).toFixed(2)}s</div>
    </div>
  );
}

/** One node box (HTML, crisp text). Positions in graph space; the world layer scales. */
function ScenarioNodeBox({ node, project, selected, current, playing, progress = 0, onStartDrag, onStartLink, onRemove }) {
  const cls = `ss-node ss-node--${node.type}`
    + (selected ? ' is-selected' : '')
    + (current && node.type === 'timeline' ? ' is-playing' : '');
  const style = { left: node.x, top: node.y, width: nodeWidth(node) };
  // Grow the node tall enough to fit all output pins down its right edge.
  if (node.type === 'timeline') {
    const pinCount = (node.outputs || []).length || 1;
    style.minHeight = Math.max(NODE_H, TL_OUT_Y0 + (pinCount - 1) * TL_OUT_DY + 14);
  }

  let body;
  if (node.type === 'start') body = <div className="ss-node-title">▶ Start</div>;
  else if (node.type === 'end') body = <div className="ss-node-title">■ End</div>;
  else {
    const ref = resolveTimelineRef(project, node.sceneId, node.timelineId);
    body = (
      <>
        <div className="ss-node-title">{node.label || ref?.timelineDisplayName || ref?.timelineName || 'timeline'}</div>
        {ref ? (
          <div className="ss-node-meta">{ref.sceneName} · {ref.trackCount} trk · {Math.round(ref.duration * 10) / 10}s</div>
        ) : (
          <div className="ss-node-missing" title="The bound timeline no longer exists">⚠ missing timeline</div>
        )}
      </>
    );
  }

  return (
    <div
      className={cls}
      style={style}
      data-node-id={node.id}
      data-node-type={node.type}
      onPointerDown={(e) => onStartDrag(e, node)}
    >
      {node.type === 'timeline' && (
        <div className="ss-node-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
      )}
      {node.type !== 'start' && (
        <span className="ss-pin ss-pin--in" style={{ top: PIN_IN_Y - 4.5 }} title="input" />
      )}
      {body}
      {node.type === 'start' && (
        <span
          className="ss-pin ss-pin--out"
          style={{ top: PIN_IN_Y - 4.5 }}
          title="drag to a node's input to connect"
          onPointerDown={(e) => onStartLink(e, node, START_PIN)}
        />
      )}
      {node.type === 'timeline' && (node.outputs || []).map((pin, i) => (
        <span
          key={pin}
          className="ss-pin ss-pin--out"
          style={{ top: TL_OUT_Y0 + i * TL_OUT_DY - 4.5 }}
          title="drag to a node's input to connect (branch)"
          onPointerDown={(e) => onStartLink(e, node, pin)}
        />
      ))}
      {node.type === 'timeline' && selected && (
        <button
          className="ss-node-del"
          title="Delete node (Del)"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onRemove?.(node.id); }}
        >✕</button>
      )}
    </div>
  );
}

/** SVG edge layer: cubic béziers from output pins to input pins, plus rubber-band. */
function EdgeLayer({ scenario, posOf, link, selectedEdgeId, liveEdgeId, onSelectEdge, onSetActiveEdge, onDeleteEdge }) {
  if (!scenario) return null;
  const byId = new Map(scenario.nodes.map((n) => [n.id, posOf(n)]));

  const path = (a, b) => {
    const dx = Math.max(40, Math.abs(b.x - a.x) * 0.5);
    return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
  };

  let rubber = null;
  if (link) {
    const from = byId.get(link.fromNode);
    if (from) rubber = path(outAnchor(from, link.fromPin), { x: link.x, y: link.y });
  }

  return (
    <svg className="ss-graph-edges" width="100%" height="100%">
      {scenario.edges.map((e) => {
        const from = byId.get(e.from.node);
        const to = byId.get(e.to.node);
        if (!from || !to) return null;
        const d = path(outAnchor(from, e.from.pin), inAnchor(to));
        const cls = 'ss-edge'
          + (e.active ? ' ss-edge--active' : '')
          + (e.id === selectedEdgeId ? ' is-selected' : '')
          + (e.id === liveEdgeId ? ' ss-edge--live' : '');
        return (
          <g key={e.id}>
            <path d={d} className={cls} fill="none" />
            <path
              d={d}
              stroke="transparent"
              strokeWidth="14"
              fill="none"
              style={{ cursor: 'pointer' }}
              onPointerDown={(ev) => {
                if (ev.button === 2) return; // let contextmenu handle right-click
                ev.stopPropagation();
                onSelectEdge?.(e.id);
                onSetActiveEdge?.(e.id);
              }}
              onContextMenu={(ev) => { ev.preventDefault(); ev.stopPropagation(); onDeleteEdge?.(e.id); }}
            />
          </g>
        );
      })}
      {rubber && <path d={rubber} className="ss-edge ss-edge--linking" fill="none" />}
    </svg>
  );
}
