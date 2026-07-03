// ColorPicker — a swatch button that opens a proper HSV picker in a popover,
// replacing the native <input type="color"> (which pops the OS colour dialog).
// Drop-in: pass value (hex "#rrggbb") + onChange(hex). Extras: title, disabled,
// className, style forward to the swatch button. Where the browser supports it,
// an eyedropper button samples a colour from anywhere on screen.

import { useEffect, useRef, useState } from 'react';
import { HsvColorPicker } from './HsvColorPicker.jsx';

export function ColorPicker({ value = '#000000', onChange, title, disabled = false, className = '', style }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDocDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const hasEyeDropper = typeof window !== 'undefined' && 'EyeDropper' in window;
  const pickWithEyeDropper = async () => {
    try {
      const res = await new window.EyeDropper().open();
      if (res?.sRGBHex) onChange?.(res.sRGBHex);
    } catch { /* user cancelled */ }
  };

  return (
    <div className={'color-picker' + (className ? ' ' + className : '')} ref={wrapRef} style={style}>
      <button
        type="button"
        className="color-picker-swatch"
        title={title || 'Pick colour'}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        style={{ background: value }}
      />
      {open && (
        <div className="color-picker-popover" role="dialog" aria-label="Colour picker">
          <HsvColorPicker value={value} onChange={onChange} />
          {hasEyeDropper && (
            <button
              type="button"
              className="color-picker-eyedrop"
              onClick={pickWithEyeDropper}
              title="Sample a colour from anywhere on screen"
            >⦿ eyedropper</button>
          )}
        </div>
      )}
    </div>
  );
}
