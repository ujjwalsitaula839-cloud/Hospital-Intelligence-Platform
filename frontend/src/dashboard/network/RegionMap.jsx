import { ESI, ambulancePosition } from "./ems";

// Schematic region: 100 x 100 grid shared with the backend (app/ems.py ZONES / HOSPITALS).
export default function RegionMap({ hospitals, zones, ambulances, now, highlight, onPick }) {
  return (
    <div className="rmap">
      <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Region map with hospitals and ambulances">
        <defs>
          <radialGradient id="rmap-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#1d4ed8" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#1d4ed8" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect x="0" y="0" width="100" height="100" className="rmap-bg" />
        {/* River and two arterial roads, for orientation only. */}
        <path d="M-2 62 C 18 56, 30 70, 48 64 S 78 52, 102 60" className="rmap-river" />
        <path d="M50 0 L 50 100" className="rmap-road" />
        <path d="M0 48 L 100 48" className="rmap-road" />
        <path d="M8 90 L 92 12" className="rmap-road is-minor" />

        {zones.map((zone) => (
          <g key={zone.name} className="rmap-zone">
            <circle cx={zone.x} cy={zone.y} r="7" />
            <text x={zone.x} y={zone.y + 11.5} textAnchor="middle">{zone.name}</text>
          </g>
        ))}

        {ambulances.map((run) => {
          const spot = ambulancePosition(run, now);
          const color = ESI[run.esi]?.color || "#ef4444";
          const { from, to } = run.route;
          return (
            <g key={run.code} className={run.status === "diverted" ? "rmap-run is-diverted" : "rmap-run"}>
              <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={color} />
              <circle cx={spot.x} cy={spot.y} r="2.4" fill={color} className="rmap-amb" />
              <text x={spot.x + 3} y={spot.y - 2.4}>{run.unit}</text>
            </g>
          );
        })}

        {hospitals.map((hospital) => {
          const { x, y } = hospital.position;
          const diverting = hospital.ems_status === "diverting";
          return (
            <g
              key={hospital.name}
              className={`rmap-h${highlight === hospital.name ? " is-picked" : ""}${diverting ? " is-diverting" : ""}${hospital.data === "live" ? " is-live" : ""}`}
              onClick={onPick ? () => onPick(hospital.name) : undefined}
            >
              {hospital.data === "live" && <circle cx={x} cy={y} r="11" fill="url(#rmap-glow)" />}
              <circle cx={x} cy={y} r="5.2" className="rmap-ring" />
              <rect x={x - 3.2} y={y - 3.2} width="6.4" height="6.4" rx="1.6" className="rmap-pin" />
              <path d={`M${x - 1.6} ${y}h3.2M${x} ${y - 1.6}v3.2`} className="rmap-cross" />
              <text x={x} y={y + 9.5} textAnchor="middle" className="rmap-label">{hospital.short}</text>
            </g>
          );
        })}
      </svg>
      <ul className="rmap-key">
        <li><i className="is-accepting" />Accepting</li>
        <li><i className="is-diverting" />On diversion</li>
        <li><i className="is-amb" />Ambulance · colour = ESI</li>
      </ul>
    </div>
  );
}
