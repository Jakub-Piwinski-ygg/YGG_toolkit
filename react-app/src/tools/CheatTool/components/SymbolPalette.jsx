import { symColor } from '../lib/symbolColors.js';

// Palette of symbols (paint mode). Clicking a chip selects the active brush.
// The eraser chip ('') clears cells. Caller owns `active` and reports clicks.
export function SymbolPalette({ symbols, active, onSelect, hint }) {
  return (
    <div className="ct-palette-wrap">
      {hint ? <div className="ct-palette-hint">{hint}</div> : null}
      <div className="ct-palette">
        <div className="ct-palette-symbols">
          {symbols.length === 0 ? (
            <span className="ct-palette-empty">Fetch game config to load symbols</span>
          ) : (
            symbols.map((s) => {
              const c = symColor(s);
              const isActive = active === s;
              return (
                <span
                  key={s}
                  className={`ct-pal-sym${isActive ? ' active' : ''}`}
                  style={{ color: c, borderColor: c + '40', background: c + '12' }}
                  onClick={() => onSelect(s)}
                >
                  {s}
                </span>
              );
            })
          )}
        </div>
        <div className="ct-pal-group">
          <span
            className={`ct-pal-sym eraser${active === '' ? ' active' : ''}`}
            onClick={() => onSelect('')}
          >
            ✕ Clear
          </span>
        </div>
      </div>
    </div>
  );
}
