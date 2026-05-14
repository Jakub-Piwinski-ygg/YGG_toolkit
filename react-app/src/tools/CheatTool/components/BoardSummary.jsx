import { symColor } from '../lib/symbolColors.js';
import { getBoardSymbols } from '../lib/jsonBuilder.js';

export function BoardSummary({ grid }) {
  const counts = getBoardSymbols(grid);
  if (counts.length === 0) {
    return <div className="ct-board-summary"><span className="ct-board-summary-empty">Brak symboli — wypełnij board</span></div>;
  }
  return (
    <div className="ct-board-summary">
      {counts.map(({ symbol, count }) => {
        const c = symColor(symbol);
        return (
          <div
            key={symbol}
            className="ct-sum-chip"
            style={{ color: c, borderColor: c + '40', background: c + '12' }}
          >
            {symbol}
            <span className="ct-sum-count">{count}</span>
          </div>
        );
      })}
    </div>
  );
}
