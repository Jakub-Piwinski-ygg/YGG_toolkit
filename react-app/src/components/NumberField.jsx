// NumberField — a drop-in <input type="number"> that does NOT clamp or coerce
// the value while the user is typing. See CLAUDE.md ("Do not clamp/coerce
// numeric inputs while the user is typing") — this is the shared component that
// rule points at, for plain inputs outside Scene Studio (which has its own
// scrub-capable DragNumberField).
//
// Behaviour:
//   - While focused, the user types into a local text buffer rendered verbatim,
//     so a parent that stores a clamped number can never rewrite "1" to the
//     minimum on the way to "120".
//   - Commit (parse + clamp + onChange) happens on Enter or blur. Esc reverts.
//   - Pass `live` for fields that must drive a real-time preview: the value is
//     forwarded on each keystroke, but only when it already parses in range, and
//     the raw text is still never touched.
//
// API mirrors the inline pattern it replaces:
//   <NumberField value={n} min={0} max={4} step={1} int onChange={(v) => …} />
// Extra props (className, placeholder, title, disabled, style, id, aria-*) pass
// through to the underlying <input>.

import { useRef, useState } from 'react';

export function NumberField({
  value,
  onChange,
  min,
  max,
  step = 1,
  int = false,
  live = false,
  fallback = 0,
  className,
  ...rest
}) {
  const inputRef = useRef(null);
  const [editText, setEditText] = useState(null); // null = not editing
  const preEditRef = useRef(0);
  const cancelRef = useRef(false);

  const clamp = (v) => {
    if (typeof min === 'number') v = Math.max(min, v);
    if (typeof max === 'number') v = Math.min(max, v);
    return v;
  };
  const parse = (s) => (int ? parseInt(s, 10) : parseFloat(s));

  const display = Number.isFinite(value) ? value : '';

  const commit = () => {
    if (!cancelRef.current && editText !== null) {
      const v = parse(editText);
      onChange(Number.isFinite(v) ? clamp(v) : fallback);
    }
    cancelRef.current = false;
    setEditText(null);
  };

  return (
    <input
      ref={inputRef}
      type="number"
      step={step}
      min={min}
      max={max}
      className={className}
      value={editText !== null ? editText : display}
      onFocus={() => {
        preEditRef.current = value;
        setEditText(String(display));
      }}
      onChange={(e) => {
        setEditText(e.target.value);
        if (live) {
          const v = parse(e.target.value);
          if (Number.isFinite(v) && v === clamp(v)) onChange(v);
        }
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') inputRef.current?.blur();
        else if (e.key === 'Escape') {
          cancelRef.current = true;
          setEditText(String(Number.isFinite(preEditRef.current) ? preEditRef.current : ''));
          inputRef.current?.blur();
        }
      }}
      {...rest}
    />
  );
}
