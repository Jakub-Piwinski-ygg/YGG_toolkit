// components/SpinnerInspectorSections.jsx
// Inspector sections for the 'spinner' asset type — Phase 5 (SPINNER.md §4).
//
// SpinnerSection   — asset-level settings (shown when a spinner layer is selected).
// SpinnerClipSection — clip-level settings (action-specific; shown inside ClipSection).
// BoardGridEditor  — reels×rows grid of symbol selects used by stopSpin clip inspector.

import { DragNumberField } from './DragNumberField.jsx';
import {
  SPINNER_ACTIONS,
  normalizeSpinnerConfig,
  generateNonWinningBoard,
  generateWinningBoard,
  evalWaysWins,
  classifySymbols,
  defaultSpinnerBounce,
  spinnerStartSpinDuration,
  spinnerStopSpinDuration,
  spinnerPresentWinDuration,
  SPINNER_DEFAULT_SPIN_DURATION
} from '../engine/spinner/spinnerModel.js';

const BOUNCE_CURVES = [
  { value: 'linear',    label: 'linear (none)' },
  { value: 'easeOut',   label: 'easeOut (smooth)' },
  { value: 'backOut',   label: 'backOut (overshoot)' },
  { value: 'overshoot', label: 'overshoot (sharp)' },
];

// T12: same threshold set as the Direct-mode director node inspector
// (ScenarioInspectorSections.jsx) — kept as a small local duplicate rather
// than a cross-inspector import for five label strings.
const SPIN_OUTCOME_LABELS = [
  { value: 'default', label: 'default (as authored)' },
  { value: 'noWin', label: 'no win' },
  { value: 'smallWin', label: 'small win' },
  { value: 'bigWin', label: 'big win' },
  { value: 'wildWin', label: 'wild win' }
];

/**
 * The "set clip duration = computed time" action for a spinner action clip.
 * Returns { duration, label, title } or null when the action has no
 * meaningful auto-duration (e.g. holdResult). Rendered at the top of the
 * clip inspector by ClipSection so the calc button is always one click away.
 */
export function spinnerClipDurationAction(config, clip) {
  if (!config) return null;
  const action = clip?.action;
  const sp = clip?.spinner || {};
  if (action === 'startSpin') {
    const d = spinnerStartSpinDuration(config, sp.perReelStartDelay);
    return { duration: d, label: `set duration = spin-up (${d.toFixed(2)}s)`,
      title: 'Set duration to the spin-up time (all reels reach full speed)' };
  }
  if (action === 'spin') {
    return { duration: SPINNER_DEFAULT_SPIN_DURATION,
      label: `set duration = ${SPINNER_DEFAULT_SPIN_DURATION}s (idle)`,
      title: 'Set a default ~2s idle spin' };
  }
  if (action === 'stopSpin') {
    const d = spinnerStopSpinDuration(config, sp.perReelStopDelay);
    return { duration: d, label: `set duration = until all landed (${d.toFixed(2)}s)`,
      title: 'Set duration to the exact time until all reels land and every land animation finishes' };
  }
  if (action === 'presentWin') {
    const stagger = Number(sp.reelWinStagger ?? 0);
    const d = spinnerPresentWinDuration(config, stagger, sp.perReelWinDelay);
    return { duration: d, label: `set duration = until all wins played (${d.toFixed(2)}s)`,
      title: "Set duration so every reel's win animation finishes (stagger·(reels-1) + win anim length)" };
  }
  return null;
}

// ── SpinnerSection ────────────────────────────────────────────────────────────

/**
 * Asset-level spinner settings: timing, blur thresholds.
 * Shown in the inspector when a spinner layer is hierarchy-selected.
 *
 * @param {{ asset, onPatchAsset }} props
 *   onPatchAsset(assetId, assetPatch) — patches `scene.assets[]` via SceneStudioInner
 */
export function SpinnerSection({ asset, onPatchAsset }) {
  const config = normalizeSpinnerConfig(asset?.spinner);
  if (!config) return null;

  const { grid, timing, blur, symbols, events } = config;

  const patchSpinner = (patch) => {
    const prev = asset.spinner || {};
    onPatchAsset?.(asset.id, {
      spinner: { ...prev, ...patch, rev: ((prev.rev || 0) + 1) }
    });
  };
  const patchTiming  = (patch) => patchSpinner({ timing: { ...(asset.spinner?.timing || {}), ...patch } });
  const patchBlur    = (patch) => patchSpinner({ blur: { ...(asset.spinner?.blur || {}), ...patch } });
  const patchBounce  = (patch) => patchSpinner({ bounce: { ...(asset.spinner?.bounce || defaultSpinnerBounce()), ...patch } });
  const patchEvents  = (patch) => patchSpinner({ events: { ...(asset.spinner?.events || {}), ...patch } });

  const { bounce } = config;

  return (
    <div className="scene-field-group">
      <div className="scene-field-group-head">
        spinner · {grid.reels}×{grid.rows}
        <span className="scene-pill">{symbols.length} sym</span>
      </div>

      <div className="scene-field-group-sub">timing</div>
      <DragNumberField label="spin speed c/s" value={timing.spinSpeed} step={0.5} min={1}
        onChange={(v) => patchTiming({ spinSpeed: Math.max(1, v) })} />
      <DragNumberField label="start dur s" value={timing.startDuration} step={0.05} min={0.05}
        onChange={(v) => patchTiming({ startDuration: Math.max(0.05, v) })} />
      <DragNumberField label="stop dur s" value={timing.stopDuration} step={0.05} min={0.05}
        onChange={(v) => patchTiming({ stopDuration: Math.max(0.05, v) })} />
      <DragNumberField label="stagger start s" value={timing.reelStaggerStart} step={0.01} min={0}
        onChange={(v) => patchTiming({ reelStaggerStart: Math.max(0, v) })} />
      <DragNumberField label="stagger stop s" value={timing.reelStaggerStop} step={0.01} min={0}
        onChange={(v) => patchTiming({ reelStaggerStop: Math.max(0, v) })} />

      <div className="scene-field-group-sub">blur crossfade</div>
      <label className="scene-field scene-field--check">
        <input type="checkbox" checked={blur.enabled}
          onChange={(e) => patchBlur({ enabled: e.target.checked })} />
        <span>enable blur crossfade</span>
      </label>
      {blur.enabled && (
        <>
          <DragNumberField label="blur start c/s" value={blur.vLo} step={0.5} min={0}
            onChange={(v) => patchBlur({ vLo: Math.max(0, v) })} />
          <DragNumberField label="blur full c/s" value={blur.vHi} step={0.5} min={0}
            onChange={(v) => patchBlur({ vHi: Math.max(0, v) })} />
        </>
      )}

      <div className="scene-field-group-sub">land / win timing</div>
      <DragNumberField label="land anim dur s" value={events.landAnimDuration} step={0.05} min={0.05}
        onChange={(v) => patchEvents({ landAnimDuration: Math.max(0.05, v) })} />
      <DragNumberField label="win anim dur s" value={events.winAnimDuration} step={0.05} min={0.05}
        onChange={(v) => patchEvents({ winAnimDuration: Math.max(0.05, v) })} />
      <DragNumberField label="auto win delay s" value={events.winDelay} step={0.05} min={0}
        onChange={(v) => patchEvents({ winDelay: Math.max(0, v) })} />
      <div className="scene-spinner-meta">
        Set "win anim dur" to your Spine win animation's real length — it sizes the win
        window (so it doesn't cut off) and the present-win clip's auto duration.
      </div>

      <div className="scene-field-group-sub">stop bounce</div>
      <label className="scene-field">
        <span>curve</span>
        <select value={bounce.curve} onChange={(e) => patchBounce({ curve: e.target.value })}>
          {BOUNCE_CURVES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </label>
      <DragNumberField label="amplitude" value={bounce.amplitude} step={0.01} min={0} max={2}
        onChange={(v) => patchBounce({ amplitude: Math.max(0, Math.min(2, v)) })} />
      <DragNumberField label="duration frac" value={bounce.durationFrac} step={0.01} min={0.05} max={1}
        onChange={(v) => patchBounce({ durationFrac: Math.max(0.05, Math.min(1, v)) })} />

      <div className="scene-spinner-meta">
        {symbols.length} symbols · strips {config.strips[0]?.length ?? 0} cells · seed {config.seed}
      </div>
    </div>
  );
}

// ── SpinnerClipSection ────────────────────────────────────────────────────────

/**
 * Clip-level spinner settings for action clips on a spinner layer.
 * Shown inside ClipSection when `clip.action` is a SPINNER_ACTION.
 *
 * @param {{ config, clip, patchClip }} props
 */
export function SpinnerClipSection({ config, clip, patchClip }) {
  const action = clip?.action;
  if (!SPINNER_ACTIONS.includes(action)) return null;

  const sp = clip.spinner || {};
  const patchSp = (patch) => patchClip({ spinner: { ...sp, ...patch } });

  if (action === 'stopSpin') {
    const randomResult = sp.randomResult === true;
    const outcome = sp.outcome || 'default';
    const hasWild = !!(config && classifySymbols(config).wildId);
    return (
      <div className="scene-field-group">
        <div className="scene-field-group-head">stop spin · target board</div>
        <label className="scene-field">
          <span>outcome</span>
          <select
            value={outcome}
            onChange={(e) => patchSp({ outcome: e.target.value })}
          >
            {SPIN_OUTCOME_LABELS.map((o) => (
              <option key={o.value} value={o.value} disabled={o.value === 'wildWin' && !hasWild}>
                {o.label}{o.value === 'wildWin' && !hasWild ? ' — name a symbol “wild”' : ''}
              </option>
            ))}
          </select>
          {outcome !== 'default' && (
            <button
              type="button"
              className="scene-btn scene-btn--sm scene-btn--ghost"
              title="Re-seed within the same threshold (T12) — same category, different board"
              onClick={() => patchSp({ rerollSeed: (sp.rerollSeed || 0) + 1 })}
            >
              🎲 Re-roll
            </button>
          )}
        </label>
        {outcome !== 'default' && (
          <div className="scene-spinner-meta">
            Board is generated for this outcome (seeded from config seed + clip id + re-roll count) —
            the "random result" / target-board options below are ignored while an outcome is set.
          </div>
        )}
        <label className="scene-field scene-field--check">
          <input type="checkbox" checked={randomResult} disabled={outcome !== 'default'}
            onChange={(e) => patchSp({ randomResult: e.target.checked })} />
          <span title="Generate a seeded non-winning board each playthrough instead of a fixed one">
            random result (auto non-win)
          </span>
        </label>
        {outcome !== 'default' ? null : randomResult ? (
          <div className="scene-spinner-meta">
            Board is generated automatically (non-winning, seeded from config seed + clip id).
          </div>
        ) : config ? (
          <BoardGridEditor
            config={config}
            board={sp.targetBoard}
            onChange={(board) => patchSp({ targetBoard: board })}
          />
        ) : (
          <div className="scene-empty" style={{ padding: '6px 12px', fontSize: 10 }}>
            spinner config not loaded yet
          </div>
        )}
        <label className="scene-field scene-field--check">
          <input type="checkbox" checked={sp.matchEntrySpeed !== false}
            onChange={(e) => patchSp({ matchEntrySpeed: e.target.checked })} />
          <span title="Round stop distance to whole cells and rescale stop duration so entry velocity is exact">
            match entry speed (rescale dur)
          </span>
        </label>
        {config && (
          <PerReelDelayEditor
            reelCount={config.grid.reels}
            delays={sp.perReelStopDelay}
            onChange={(d) => patchSp({ perReelStopDelay: d })}
          />
        )}
      </div>
    );
  }

  if (action === 'startSpin') {
    return (
      <div className="scene-field-group">
        <div className="scene-field-group-head">start spin</div>
        <div className="scene-spinner-meta">
          Ramps each reel from rest to spin speed. At the end of this clip every reel is at full speed.
          The "+" button adds a spin clip to the right.
        </div>
      </div>
    );
  }

  if (action === 'spin') {
    return (
      <div className="scene-field-group">
        <div className="scene-field-group-head">spin</div>
        <div className="scene-spinner-meta">
          Reels scroll at constant speed (the idle hold). Extend this clip to control spin duration.
          The "+" button adds a stopSpin clip to the right.
        </div>
      </div>
    );
  }

  if (action === 'presentWin') {
    const stagger = Number(sp.reelWinStagger ?? 0);
    return (
      <div className="scene-field-group">
        <div className="scene-field-group-head">present win</div>
        <div className="scene-spinner-meta">
          Plays the win animation for the winning symbols of the preceding stopSpin board.
          Place this clip where you want the win to fire.
        </div>
        <DragNumberField
          label="reel win stagger s"
          value={Number(stagger.toFixed(3))}
          step={0.02}
          min={0}
          onChange={(v) => patchSp({ reelWinStagger: Math.max(0, v) })}
        />
        <div className="scene-spinner-meta">
          0 = all winning symbols play at once · &gt;0 = cascade reel 0 → reel 1 → …
        </div>
        {config && (
          <PerReelDelayEditor
            label="per-reel win delay (s)"
            reelCount={config.grid.reels}
            delays={sp.perReelWinDelay}
            onChange={(d) => patchSp({ perReelWinDelay: d })}
          />
        )}
      </div>
    );
  }

  if (action === 'holdResult') {
    return (
      <div className="scene-field-group">
        <div className="scene-field-group-head">hold result</div>
        <div className="scene-spinner-meta">
          Reels are stationary showing the final stopped board.
        </div>
      </div>
    );
  }

  return null;
}

// ── PerReelDelayEditor ────────────────────────────────────────────────────────

function PerReelDelayEditor({ reelCount, delays, onChange, label = 'per-reel stop delay (s)' }) {
  const arr = Array.from({ length: reelCount }, (_, i) => {
    const v = Number(delays?.[i] ?? 0);
    return Number.isFinite(v) ? v : 0;
  });
  return (
    <div>
      <div className="scene-field-group-sub">{label}</div>
      <div className="scene-spinner-reel-delays">
        {arr.map((d, i) => (
          <DragNumberField
            key={i}
            label={`r${i}`}
            value={Number(d.toFixed(3))}
            step={0.02}
            min={0}
            onChange={(v) => {
              const next = [...arr];
              next[i] = Math.max(0, v);
              onChange(next);
            }}
          />
        ))}
      </div>
    </div>
  );
}

// ── BoardGridEditor ───────────────────────────────────────────────────────────

/**
 * Editable reels×rows symbol grid for a stopSpin clip's targetBoard.
 * Highlights winning cells. Re-roll buttons to randomize.
 */
export function BoardGridEditor({ config, board, onChange }) {
  if (!config) return null;
  const { reels, rows } = config.grid;
  const symbols = config.symbols || [];

  const getCell = (r, j) => board?.[r]?.[j] ?? (symbols[0]?.id || '');

  const patchCell = (r, j, symId) => {
    const next = Array.from({ length: reels }, (_, ri) =>
      Array.from({ length: rows }, (_, ji) => (ri === r && ji === j ? symId : getCell(ri, ji)))
    );
    onChange(next);
  };

  const rerollNoWin = () => {
    if (!symbols.length) return;
    const ids = symbols.map((s) => s.id);
    const seed = Math.floor(Math.random() * 0xFFFFFF) + 1;
    onChange(generateNonWinningBoard(ids, reels, rows, seed));
  };

  const rerollWin = () => {
    if (!symbols.length) return;
    const ids = symbols.map((s) => s.id);
    const seed = Math.floor(Math.random() * 0xFFFFFF) + 1;
    onChange(generateWinningBoard(ids, reels, rows, seed));
  };

  // Build board matrix and check wins.
  const mat = Array.from({ length: reels }, (_, r) =>
    Array.from({ length: rows }, (_, j) => getCell(r, j))
  );
  const wins = board ? evalWaysWins(mat) : [];
  const winSet = new Set(wins.flatMap((w) => w.cells.map((c) => `${c.reel},${c.row}`)));

  return (
    <div className="spinner-board-editor">
      <div className="spinner-board-grid" style={{ gridTemplateColumns: `repeat(${reels}, 1fr)` }}>
        {Array.from({ length: reels }, (_, r) => (
          <div key={r} className="spinner-board-col">
            <div className="spinner-board-col-head">r{r}</div>
            {Array.from({ length: rows }, (_, j) => {
              const isWin = winSet.has(`${r},${j}`);
              return (
                <select
                  key={j}
                  className={'spinner-board-cell' + (isWin ? ' is-win' : '')}
                  value={getCell(r, j)}
                  onChange={(e) => patchCell(r, j, e.target.value)}
                >
                  {symbols.map((s) => (
                    <option key={s.id} value={s.id}>{s.name || s.id}</option>
                  ))}
                </select>
              );
            })}
          </div>
        ))}
      </div>
      <div className="spinner-board-actions">
        <button type="button" className="scene-btn scene-btn--ghost" onClick={rerollNoWin}>↺ no-win</button>
        <button type="button" className="scene-btn scene-btn--ghost" onClick={rerollWin}>↺ win</button>
        {wins.length > 0 && (
          <span className="spinner-board-win-label">{wins.length} way{wins.length !== 1 ? 's' : ''} win ✓</span>
        )}
      </div>
    </div>
  );
}
