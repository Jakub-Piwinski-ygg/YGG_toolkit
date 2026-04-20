import { useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext.jsx';

export function OutputLog() {
  const { logEntries } = useApp();
  const ref = useRef(null);

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [logEntries]);

  return (
    <div className="output-log" ref={ref}>
      {logEntries.map((entry, i) => (
        <span key={i} className={`log-line ${entry.type}`}>
          {entry.msg}
          <br />
        </span>
      ))}
    </div>
  );
}
