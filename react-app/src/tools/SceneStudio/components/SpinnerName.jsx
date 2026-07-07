// SpinnerName — renders a spinner object's name as white-bold text where a
// single letter is highlighted in a vivid colour, and that highlight marches
// letter-by-letter along the word. Every time it advances (default 0.23s) it
// re-rolls the highlight colour from COMMON_COLORS. Purely cosmetic; used
// wherever a spinner is *named* (hierarchy, track labels, scenario nodes).

import { useEffect, useRef, useState } from 'react';
import { COMMON_COLORS } from '../engine/objectColors.js';

export function SpinnerName({ name = '', intervalMs = 230, className = '', title, animate = true }) {
  const text = String(name || '');
  const letters = [...text];
  // { idx: highlighted letter, color: its current colour }
  const [hi, setHi] = useState({ idx: 0, color: COMMON_COLORS[0] });
  const idxRef = useRef(0);

  useEffect(() => {
    idxRef.current = 0;
    setHi({ idx: 0, color: COMMON_COLORS[0] });
    if (!animate || letters.length <= 1) return undefined;
    const id = setInterval(() => {
      idxRef.current = (idxRef.current + 1) % letters.length;
      const color = COMMON_COLORS[Math.floor(Math.random() * COMMON_COLORS.length)];
      setHi({ idx: idxRef.current, color });
    }, Math.max(60, intervalMs));
    return () => clearInterval(id);
  // Re-arm when the word, cadence, or animate-gate changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, intervalMs, animate]);

  // When paused (e.g. an unselected spinner in setup mode) no letter is tinted —
  // it reads as plain white-bold until it's selected and the cycle resumes.
  const activeIdx = animate ? hi.idx : -1;

  return (
    <span className={'ss-kind-spinner ' + className} title={title ?? text}>
      {letters.map((ch, i) => (
        <span
          key={i}
          className="ss-spin-letter"
          style={i === activeIdx ? { color: hi.color, textShadow: `0 0 8px ${hi.color}` } : undefined}
        >
          {ch === ' ' ? ' ' : ch}
        </span>
      ))}
    </span>
  );
}
