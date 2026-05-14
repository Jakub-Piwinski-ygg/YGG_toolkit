export function FieldRow({ label, children, hint }) {
  return (
    <div className="ct-field-row">
      <label className="ct-field-label">{label}</label>
      <div className="ct-field-control">{children}</div>
      {hint ? <div className="ct-field-hint">{hint}</div> : null}
    </div>
  );
}

export function RangeRow({ label, fromValue, toValue, onFromChange, onToChange, fromError, toError }) {
  return (
    <div className="ct-range-row">
      <label className="ct-field-label">{label}</label>
      <input
        type="number"
        value={fromValue ?? ''}
        placeholder="From"
        step="0.1"
        onChange={(e) => onFromChange(e.target.value)}
        className={fromError ? 'ct-invalid' : ''}
        title={fromError || ''}
      />
      <span className="ct-range-sep">—</span>
      <input
        type="number"
        value={toValue ?? ''}
        placeholder="To"
        step="0.1"
        onChange={(e) => onToChange(e.target.value)}
        className={toError ? 'ct-invalid' : ''}
        title={toError || ''}
      />
    </div>
  );
}
