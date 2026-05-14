const PILLS = [
  { id: 'dev', label: 'DEV-02' },
  { id: 'staging', label: 'STAGING' },
  { id: 'prod', label: 'PROD' },
  { id: 'proxy', label: '⚡ LOCAL PROXY' },
  { id: 'custom', label: 'CUSTOM' }
];

export function EnvPills({ active, onSelect }) {
  return (
    <div className="ct-env-pills">
      {PILLS.map((p) => (
        <div
          key={p.id}
          className={`ct-env-pill ${p.id}${active === p.id ? ' active' : ''}`}
          onClick={() => onSelect(p.id)}
        >
          {p.label}
        </div>
      ))}
    </div>
  );
}
