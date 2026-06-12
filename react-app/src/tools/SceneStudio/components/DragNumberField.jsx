// DragNumberField — number input with Figma/Blender-style scrub-on-drag.
//
// Click + drag horizontally on the input  → live-scrubs the value
//                                            (no focus; pointer is captured)
// Click without drag                       → focuses the input for keyboard edit
// Hover                                    → shows ew-resize cursor
//
// The drag delta is multiplied by `step` to derive the value change. Hold
// Shift while dragging for 10× sensitivity, Alt for 0.1×.

import { useRef, useState } from 'react';

const DRAG_THRESHOLD = 3; // px movement before we commit to "scrub" mode

export function DragNumberField({ label, value, step = 1, suffix, min, max, onChange }) {
  const inputRef = useRef(null);
  const stateRef = useRef({ active: false, scrubbing: false, startX: 0, startValue: 0 });
  // While the field is focused the user types into this local string; the
  // input always renders it verbatim, so the parent's clamped state can't
  // rewrite "1" to the minimum mid-way through typing "120". The parent
  // still receives clamped live values; blur / Enter commits, Esc reverts.
  const [editText, setEditText] = useState(null); // null = not editing
  const preEditRef = useRef(0);                   // value to restore on Esc

  const clamp = (v) => {
    if (typeof min === 'number') v = Math.max(min, v);
    if (typeof max === 'number') v = Math.min(max, v);
    return v;
  };

  const onMouseDown = (e) => {
    // Ignore drags initiated while the field is already focused — let the
    // user select text and type normally.
    if (document.activeElement === inputRef.current) return;
    if (e.button !== 0) return;
    e.preventDefault();
    stateRef.current = {
      active: true,
      scrubbing: false,
      startX: e.clientX,
      startValue: Number.isFinite(value) ? value : 0
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const onMouseMove = (e) => {
    const st = stateRef.current;
    if (!st.active) return;
    const dx = e.clientX - st.startX;
    if (!st.scrubbing && Math.abs(dx) < DRAG_THRESHOLD) return;
    st.scrubbing = true;
    let mult = 1;
    if (e.shiftKey) mult = 10;
    else if (e.altKey) mult = 0.1;
    const delta = dx * step * mult;
    onChange(clamp(st.startValue + delta));
  };

  const onMouseUp = (e) => {
    const st = stateRef.current;
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
    stateRef.current = { active: false, scrubbing: false, startX: 0, startValue: 0 };
    // If user didn't drag, treat as click and focus the input
    if (!st.scrubbing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  };

  const display = Number.isFinite(value) ? Number(value.toFixed(3)) : 0;

  const cancelRef = useRef(false); // Esc pressed — blur must not re-commit

  const commitEdit = () => {
    if (!cancelRef.current && editText !== null) {
      const v = parseFloat(editText);
      if (Number.isFinite(v)) onChange(clamp(v));
    }
    cancelRef.current = false;
    setEditText(null);
  };

  return (
    <label className="scene-field scene-field--inline scene-field--scrub">
      <span
        className="scene-field-scrub-handle"
        onMouseDown={onMouseDown}
        title="Drag to scrub · click to type · Shift = 10× · Alt = 0.1×"
      >
        {label}
      </span>
      <input
        ref={inputRef}
        type="number"
        step={step}
        value={editText !== null ? editText : display}
        onMouseDown={onMouseDown}
        onFocus={() => {
          preEditRef.current = display;
          setEditText(String(display));
        }}
        onChange={(e) => {
          setEditText(e.target.value);
          // Parent state stays valid (clamped); the raw text stays local.
          const v = parseFloat(e.target.value);
          if (Number.isFinite(v)) onChange(clamp(v));
        }}
        onBlur={commitEdit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') inputRef.current?.blur();
          else if (e.key === 'Escape') {
            cancelRef.current = true;
            onChange(clamp(preEditRef.current));
            inputRef.current?.blur();
          }
        }}
      />
      {suffix && <em className="scene-field-suffix">{suffix}</em>}
    </label>
  );
}
