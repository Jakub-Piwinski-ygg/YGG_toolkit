import { useState } from 'react';
import { symColor } from '../lib/symbolColors.js';

// Paint-mode board grid. Drag-paint by mousedown + mouseenter while held.
// Right-click clears the cell. (Drag/type/autocomplete modes from the original
// are deferred — see CHEAT_TOOL.md.)
export function BoardGrid({ board, activeBrush, onPaint }) {
  const [painting, setPainting] = useState(false);

  const handleDown = (ri, ci) => {
    if (board.grid[ri]?.[ci] === null) return;
    setPainting(true);
    onPaint(ri, ci, activeBrush);
  };
  const handleEnter = (ri, ci) => {
    if (!painting) return;
    if (board.grid[ri]?.[ci] === null) return;
    onPaint(ri, ci, activeBrush);
  };
  const handleContextMenu = (e, ri, ci) => {
    e.preventDefault();
    if (board.grid[ri]?.[ci] === null) return;
    onPaint(ri, ci, '');
  };

  const stopPainting = () => setPainting(false);

  if (board.megawaysMode) {
    return (
      <div className="ct-board-grid-wrap" onMouseUp={stopPainting} onMouseLeave={stopPainting}>
        <div className="ct-board-reel-labels">
          {board.reelHeights.map((_, i) => (
            <div key={i} className="ct-reel-label mw-label">R{i + 1}</div>
          ))}
        </div>
        <div className="ct-board-grid mw">
          {board.reelHeights.map((h, ci) => (
            <div key={ci} className="ct-board-reel">
              {Array.from({ length: h }, (_, ri) => {
                const sym = board.grid[ri]?.[ci];
                return (
                  <Cell
                    key={ri}
                    sym={sym}
                    onMouseDown={() => handleDown(ri, ci)}
                    onMouseEnter={() => handleEnter(ri, ci)}
                    onContextMenu={(e) => handleContextMenu(e, ri, ci)}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="ct-board-grid-wrap" onMouseUp={stopPainting} onMouseLeave={stopPainting}>
      <div className="ct-board-reel-labels">
        {Array.from({ length: board.reels }, (_, i) => (
          <div key={i} className="ct-reel-label">R{i + 1}</div>
        ))}
      </div>
      <div className="ct-board-grid">
        {board.grid.map((row, ri) => (
          <div key={ri} className="ct-board-row">
            {row.map((sym, ci) => (
              <Cell
                key={ci}
                sym={sym}
                onMouseDown={() => handleDown(ri, ci)}
                onMouseEnter={() => handleEnter(ri, ci)}
                onContextMenu={(e) => handleContextMenu(e, ri, ci)}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function Cell({ sym, onMouseDown, onMouseEnter, onContextMenu }) {
  if (sym === null) return <div className="ct-board-cell inactive" />;
  const color = sym ? symColor(sym) : null;
  const style = color ? { color, borderColor: color + '55', background: color + '14' } : undefined;
  return (
    <div
      className="ct-board-cell"
      style={style}
      onMouseDown={onMouseDown}
      onMouseEnter={onMouseEnter}
      onContextMenu={onContextMenu}
    >
      {sym || '·'}
    </div>
  );
}
