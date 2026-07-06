// Eye glyphs for the hierarchy visibility toggle. Monochrome, inline SVG so
// they inherit `currentColor` and theme with the rest of the UI (no bundled
// PNGs). Recreated from the supplied Show.png / Hide.png artwork.

/** Open eye — almond outline with an iris ring + pupil (visible). */
export function EyeOpen({ size = 16, className, ...rest }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      className={className}
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {/* evenodd: almond body, minus iris annulus, plus pupil disc → black
          almond / light ring / black pupil, all from currentColor. */}
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M16 256C90 130 168 96 256 96C344 96 422 130 496 256C422 382 344 416 256 416C168 416 90 382 16 256ZM136 256a120 120 0 1 0 240 0a120 120 0 1 0 -240 0ZM186 256a70 70 0 1 0 140 0a70 70 0 1 0 -140 0Z"
      />
    </svg>
  );
}

/** Closed eye — a downward lid curve with lashes (hidden). */
export function EyeClosed({ size = 16, className, ...rest }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      className={className}
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="34"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* Lid: shallow curve bulging downward. */}
        <path d="M48 210C130 320 382 320 464 210" />
        {/* Lashes. */}
        <path d="M96 288L64 348" />
        <path d="M188 322L176 388" />
        <path d="M324 322L336 388" />
        <path d="M416 288L448 348" />
      </g>
    </svg>
  );
}
