import { UNIT_ORDER } from "./ems";

function Capability({ on, children }) {
  return <span className={on ? "cap-chip is-on" : "cap-chip"}>{children}</span>;
}

function traumaLabel(level) {
  if (!level) return "No trauma";
  return `Trauma L${"I".repeat(level)}`;
}

export default function HospitalBoard({ hospitals, highlight, onPick }) {
  return (
    <div className="hboard">
      {hospitals.map((hospital) => {
        const caps = hospital.capabilities;
        const diverting = hospital.ems_status === "diverting";
        return (
          <article
            key={hospital.name}
            className={`hcard${highlight === hospital.name ? " is-picked" : ""}${diverting ? " is-diverting" : ""}`}
            onClick={onPick ? () => onPick(hospital.name) : undefined}
          >
            <header>
              <span className="hcard-code">{hospital.short}</span>
              <div className="hcard-name">
                <strong>{hospital.name}</strong>
                <small>{hospital.services}</small>
              </div>
              <span className={hospital.data === "live" ? "data-badge is-live" : "data-badge"}>
                {hospital.data === "live" ? "Live" : "Emulated"}
              </span>
            </header>
            <div className={diverting ? "hstatus is-diverting" : "hstatus"}>
              <i />
              <strong>{diverting ? "On diversion" : "Accepting ambulances"}</strong>
              <span>{diverting ? hospital.reason || "At capacity" : `ED wait ~${hospital.ed_wait_min} min`}</span>
            </div>
            <ul className="hunits">
              {UNIT_ORDER.map((key) => {
                const unit = hospital.units[key];
                if (!unit || unit.total === 0) {
                  return (
                    <li key={key} className="is-none">
                      <span>{unit?.label || key}</span>
                      <em>Not offered</em>
                    </li>
                  );
                }
                return (
                  <li key={key} className={`is-${unit.level}`}>
                    <span>{unit.label}</span>
                    <div className="hunit-bar"><i style={{ width: `${unit.occupancy_pct}%` }} /></div>
                    <b>{unit.open}</b>
                    <small>open</small>
                  </li>
                );
              })}
            </ul>
            <div className="caps">
              <Capability on={caps.trauma_level > 0}>{traumaLabel(caps.trauma_level)}</Capability>
              <Capability on={caps.stroke_center}>Stroke</Capability>
              <Capability on={caps.cath_lab}>Cath lab</Capability>
              <Capability on={caps.ct}>CT</Capability>
              <Capability on={caps.icu}>ICU</Capability>
            </div>
          </article>
        );
      })}
    </div>
  );
}
