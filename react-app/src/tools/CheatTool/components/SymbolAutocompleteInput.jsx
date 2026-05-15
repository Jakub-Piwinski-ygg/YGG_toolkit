import { useEffect, useRef, useState } from 'react';

export function SymbolAutocompleteInput({ value, onChange, symbols, placeholder, inputStyle }) {
  const rootRef = useRef(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onDocPointerDown(e) {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    }
    document.addEventListener('pointerdown', onDocPointerDown);
    return () => document.removeEventListener('pointerdown', onDocPointerDown);
  }, []);

  return (
    <div className="ct-symbol-picker" ref={rootRef}>
      <input
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false);
        }}
        placeholder={placeholder}
        style={inputStyle}
      />

      {open && symbols.length > 0 ? (
        <div className="ct-symbol-picker-menu">
          {symbols.map((s) => (
            <button
              key={s}
              type="button"
              className={`ct-symbol-picker-item${value === s ? ' active' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange(s);
                setOpen(false);
              }}
            >
              {s}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
