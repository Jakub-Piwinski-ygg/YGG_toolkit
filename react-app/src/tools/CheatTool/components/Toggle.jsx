export function Toggle({ checked, onChange, label, id }) {
  return (
    <div className="ct-toggle-row">
      <label className="ct-toggle">
        <input type="checkbox" id={id} checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="ct-toggle-slider" />
      </label>
      {label ? <span className="ct-toggle-label">{label}</span> : null}
    </div>
  );
}
