import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSpineScene } from '../hooks/useSpineScene.js';
import { HsvColorPicker, hexToRgb01 } from './HsvColorPicker.jsx';

// Preset background options: name → { hex (for CSS), rgba (for GL clear) }
const BG_PRESETS = [
  { id: 'black',   label: 'Black',   hex: '#000000' },
  { id: 'dark',    label: 'Dark',    hex: '#111319' },
  { id: 'mid',     label: 'Mid',     hex: '#383c4a' },
  { id: 'light',   label: 'Light',   hex: '#d4d8e2' },
  { id: 'checker', label: 'Check',   hex: 'checker' },
];

const DEFAULT_HEX = 'checker';

// ── SpinePlayer ───────────────────────────────────────────────────────────────
//
// Props:
//   open         bool
//   spec         { name, dir, jsonPath, atlasPath, textures: [{path, relName}] }
//   resolveUrl   async (path) => blobUrl
//   onClose      () => void
export function SpinePlayer({ open, spec, resolveUrl, onClose }) {
  const canvasRef = useRef(null);

  // UI state that drives controls but also needs rendering
  const [speed, setSpeed] = useState(1);
  const [alpha, setAlpha] = useState(1);
  const [bgHex, setBgHex] = useState(DEFAULT_HEX);
  const [showPicker, setShowPicker] = useState(false);
  const pickerRef = useRef(null);

  const { status, error, animations, currentAnim, skins, currentSkin, controls, progressRef } =
    useSpineScene({ open, canvasRef, spec, resolveUrl });

  // Stable ref so SpineScrubber's effect never needs to restart on re-renders
  const controlsRef = useRef(controls);
  controlsRef.current = controls;

  // Esc to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Close picker when clicking outside
  useEffect(() => {
    if (!showPicker) return;
    const handler = (e) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) {
        setShowPicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showPicker]);

  // Reset transient UI when a new spec is loaded
  useEffect(() => {
    setSpeed(1);
    setAlpha(1);
    controls.setSpeed(1);
    controls.setAlpha(1);
  }, [spec]); // eslint-disable-line react-hooks/exhaustive-deps

  // Wheel zoom — must be a non-passive native listener so preventDefault()
  // actually suppresses the page scroll that React's synthetic onWheel cannot stop.
  // Zoom direction: scroll down = zoom in (positive deltaY → larger zoom).
  const stageRef = useRef(null);
  useEffect(() => {
    const el = stageRef.current;
    if (!el || !open) return;
    const handler = (e) => {
      e.preventDefault();
      controlsRef.current.zoomAt(e.deltaY * 0.001, e.clientX, e.clientY);
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [open]); // controlsRef is stable — no need in deps

  // Drag-to-pan
  const isDragging = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });

  const onMouseDown = (e) => {
    if (e.button !== 0) return;
    isDragging.current = true;
    lastMouse.current = { x: e.clientX, y: e.clientY };
  };
  const onMouseMove = (e) => {
    if (!isDragging.current) return;
    const dx = e.clientX - lastMouse.current.x;
    const dy = e.clientY - lastMouse.current.y;
    lastMouse.current = { x: e.clientX, y: e.clientY };
    controls.panWorld(dx, dy);
  };
  const stopDrag = () => { isDragging.current = false; };

  // Apply bg change to GL + CSS
  const applyBg = (hex) => {
    setBgHex(hex);
    if (hex === 'checker') {
      controls.setBg({ r: 0, g: 0, b: 0, a: 0 }); // transparent GL clear
    } else {
      const { r, g, b } = hexToRgb01(hex);
      controls.setBg({ r, g, b, a: 1 });
    }
  };

  const onSpeedChange = (v) => { setSpeed(v); controls.setSpeed(v); };
  const onAlphaChange = (v) => { setAlpha(v); controls.setAlpha(v); };

  const isChecker = bgHex === 'checker';

  return (
    <AnimatePresence>
      {open && spec && (
        <motion.div
          className="sp-overlay"
          onClick={onClose}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <motion.div
            className="sp-modal"
            onClick={(e) => e.stopPropagation()}
            initial={{ scale: 0.97, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.97, opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            {/* ── Header ── */}
            <div className="sp-header">
              <span className="sp-title">🦴 {spec.name}</span>
              <div className="sp-header-right">
                {status === 'ready' && (
                  <span className="sp-hint">scroll = zoom · drag = pan</span>
                )}
                <button className="btn sp-close" onClick={onClose}>✕</button>
              </div>
            </div>

            {/* ── Stage ── */}
            <div
              ref={stageRef}
              className={`sp-stage${isChecker ? ' sp-checker' : ''}`}
              style={!isChecker ? { background: bgHex } : undefined}
              onMouseDown={onMouseDown}
              onMouseMove={onMouseMove}
              onMouseUp={stopDrag}
              onMouseLeave={stopDrag}
            >
              <canvas ref={canvasRef} className="sp-canvas" />
              {status === 'loading' && (
                <div className="sp-stage-msg">
                  <span className="sp-spinner" /> Loading runtime &amp; assets…
                </div>
              )}
              {status === 'error' && (
                <div className="sp-stage-msg sp-stage-err">
                  <pre>{error}</pre>
                </div>
              )}
            </div>

            {/* ── Controls ── */}
            <div className="sp-controls">
              <div className="sp-ctrl-row">
                {/* Play / pause */}
                <button
                  className="btn sp-play-btn"
                  onClick={controls.togglePause}
                  disabled={status !== 'ready'}
                  title={controls.paused ? 'Play' : 'Pause'}
                >
                  {controls.paused ? '▶' : '⏸'}
                </button>

                {/* Reset view */}
                <button
                  className="btn sp-icon-btn"
                  onClick={controls.resetView}
                  disabled={status !== 'ready'}
                  title="Reset view"
                >
                  ⊙
                </button>

                <div className="sp-divider" />

                {/* Speed */}
                <label className="sp-ctrl-label">
                  Speed <span className="sp-val">{speed.toFixed(2)}×</span>
                </label>
                <input
                  className="sp-range"
                  type="range" min="0" max="3" step="0.05"
                  value={speed}
                  onChange={(e) => onSpeedChange(parseFloat(e.target.value))}
                  disabled={status !== 'ready'}
                />

                {/* Alpha */}
                <label className="sp-ctrl-label">
                  Alpha <span className="sp-val">{alpha.toFixed(2)}</span>
                </label>
                <input
                  className="sp-range"
                  type="range" min="0" max="1" step="0.01"
                  value={alpha}
                  onChange={(e) => onAlphaChange(parseFloat(e.target.value))}
                  disabled={status !== 'ready'}
                />

                <div className="sp-divider" />

                {/* BG presets */}
                <div className="sp-bg-presets">
                  {BG_PRESETS.map((p) => (
                    <button
                      key={p.id}
                      className={`sp-bg-preset${bgHex === p.hex ? ' active' : ''}`}
                      title={p.label}
                      onClick={() => { applyBg(p.hex); setShowPicker(false); }}
                      style={p.hex !== 'checker' ? { background: p.hex } : undefined}
                    >
                      {p.hex === 'checker' && <span className="sp-checker-icon" />}
                    </button>
                  ))}

                  {/* Custom HSV picker trigger */}
                  <div className="sp-bg-custom-wrap" ref={pickerRef}>
                    <button
                      className={`sp-bg-custom-btn${showPicker ? ' active' : ''}`}
                      title="Custom colour"
                      onClick={() => setShowPicker((v) => !v)}
                      style={{
                        background: bgHex !== 'checker' ? bgHex : undefined,
                      }}
                    >
                      🎨
                    </button>
                    {showPicker && (
                      <div className="sp-picker-popover">
                        <HsvColorPicker
                          value={bgHex !== 'checker' ? bgHex : DEFAULT_HEX}
                          onChange={(hex) => applyBg(hex)}
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Progress scrubber */}
              <SpineScrubber
                progressRef={progressRef}
                controlsRef={controlsRef}
                disabled={status !== 'ready'}
              />

              {/* Animation chips */}
              {animations.length > 0 && (
                <div className="sp-anim-row">
                  {animations.map((a) => (
                    <button
                      key={a.name}
                      className={`sp-anim-chip${currentAnim === a.name ? ' active' : ''}`}
                      onClick={() => controls.setAnimation(a.name)}
                      title={`${a.duration.toFixed(2)}s`}
                    >
                      {a.name}
                    </button>
                  ))}
                </div>
              )}

              {/* Skin chips — only shown when the skeleton has more than one skin */}
              {skins.length > 1 && (
                <div className="sp-skin-row">
                  <span className="sp-skin-label">Skin</span>
                  {skins.map((s) => (
                    <button
                      key={s}
                      className={`sp-anim-chip sp-skin-chip${currentSkin === s ? ' active' : ''}`}
                      onClick={() => controls.setSkin(s)}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── SpineScrubber ─────────────────────────────────────────────────────────────
//
// Renders a progress bar + draggable pin.  Updates the DOM directly via refs
// at 60fps (no React state) so the main component never re-renders on tick.
// Drag immediately pauses playback; resume with the play button.
function SpineScrubber({ progressRef, controlsRef, disabled }) {
  const innerRef = useRef(null);
  const fillRef = useRef(null);
  const pinRef = useRef(null);
  const dragging = useRef(false);

  // Poll progressRef at animation frame rate and update DOM imperatively
  useEffect(() => {
    if (disabled) return;
    let rafId;
    const tick = () => {
      if (!dragging.current && fillRef.current && pinRef.current) {
        const p = Math.max(0, Math.min(1, progressRef.current));
        const pct = (p * 100).toFixed(2) + '%';
        fillRef.current.style.width = pct;
        pinRef.current.style.left = pct;
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [disabled]); // progressRef + controlsRef are stable refs — no restart needed

  const applySeek = (e) => {
    if (!innerRef.current) return;
    const rect = innerRef.current.getBoundingClientRect();
    const t = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    controlsRef.current.seek(t);
    const pct = (t * 100).toFixed(2) + '%';
    if (fillRef.current) fillRef.current.style.width = pct;
    if (pinRef.current) pinRef.current.style.left = pct;
  };

  const onPointerDown = (e) => {
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = true;
    // Pause on drag start; user resumes with play button
    if (!controlsRef.current.paused) controlsRef.current.togglePause();
    applySeek(e);
  };

  const onPointerMove = (e) => {
    if (!dragging.current) return;
    applySeek(e);
  };

  const onPointerUp = () => { dragging.current = false; };

  return (
    <div
      className={`sp-scrubber${disabled ? ' sp-scrubber-disabled' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <div className="sp-scrubber-inner" ref={innerRef}>
        <div className="sp-scrubber-fill" ref={fillRef} />
        <div className="sp-scrubber-pin" ref={pinRef} />
      </div>
    </div>
  );
}
