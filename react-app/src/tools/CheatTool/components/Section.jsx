import { useState } from 'react';

// Card with icon + title + subtitle and a body. When `collapsible` is true the
// header acts as a button that hides/shows the body. The chevron uses a CSS
// rotation so we don't need any animation library.
export function Section({ icon, iconKind = 'orange', title, subtitle, rightSlot, collapsible = false, defaultOpen = true, children }) {
  const [open, setOpen] = useState(defaultOpen);
  const visible = !collapsible || open;
  return (
    <div className="ct-section">
      <div
        className={`ct-section-header${collapsible ? ' clickable' : ''}`}
        onClick={collapsible ? () => setOpen((o) => !o) : undefined}
      >
        <div className={`ct-section-icon ic-${iconKind}`}>{icon}</div>
        <span className="ct-section-title">{title}</span>
        {subtitle ? <span className="ct-section-subtitle">{subtitle}</span> : null}
        {rightSlot}
        {collapsible ? (
          <span className={`ct-section-chevron${open ? ' open' : ''}`}>▼</span>
        ) : null}
      </div>
      {visible ? <div className="ct-section-body">{children}</div> : null}
    </div>
  );
}
