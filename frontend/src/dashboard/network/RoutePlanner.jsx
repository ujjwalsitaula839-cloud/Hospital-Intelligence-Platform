import { useEffect, useState } from "react";
import { COMPLAINTS, ESI, ZONES } from "./ems";
import { getRegionalRoute, createEmsRun } from "../emsService";

// "Where should this ambulance go?" Ranks the region for one patient and sends the pre-alert.
export default function RoutePlanner({ onPick }) {
  const [esi, setEsi] = useState(2);
  const [complaint, setComplaint] = useState("stroke");
  const [zone, setZone] = useState("East");
  const [options, setOptions] = useState(null);
  const [sending, setSending] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    const res = getRegionalRoute(Number(esi) || 2, complaint, zone);
    setOptions(res.options);
    onPick?.(res.options.find((row) => row.eligible)?.hospital || null);
  }, [esi, complaint, zone, onPick]);

  async function send(destination) {
    setSending(destination);
    setNote("");
    try {
      const created = createEmsRun({
        esi,
        complaint,
        zone,
        destination,
        unit: "Medic 12",
        agency: "Metro Region EMS",
      });
      setNote(`${created.code} sent to ${destination} · ETA ${Math.max(1, Math.round((created.eta_seconds || 0) / 60))} min`);
    } catch (error) {
      setNote(error.message);
    } finally {
      setSending("");
    }
  }

  return (
    <section className="planner">
      <header>
        <p className="card-kicker">Route a patient</p>
        <h2>Where should this ambulance go?</h2>
      </header>
      <div className="planner-field">
        <span>Triage (ESI)</span>
        <div className="esi-pick" role="group" aria-label="ESI level">
          {[1, 2, 3, 4, 5].map((level) => (
            <button
              key={level}
              type="button"
              className={esi === level ? "is-on" : ""}
              style={{ "--esi": ESI[level].color, "--esi-soft": ESI[level].soft }}
              onClick={() => setEsi(level)}
              title={ESI[level].label}
            >
              <b>{level}</b>
              <small>{ESI[level].label}</small>
            </button>
          ))}
        </div>
      </div>
      <div className="planner-field">
        <span>Complaint</span>
        <div className="chip-pick">
          {COMPLAINTS.map((item) => (
            <button key={item.id} type="button" className={complaint === item.id ? "is-on" : ""} onClick={() => setComplaint(item.id)}>
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <div className="planner-field">
        <span>Pickup zone</span>
        <div className="chip-pick">
          {ZONES.map((name) => (
            <button key={name} type="button" className={zone === name ? "is-on" : ""} onClick={() => setZone(name)}>
              {name}
            </button>
          ))}
        </div>
      </div>

      <ol className="route-list">
        {(options || []).map((row, index) => (
          <li key={row.hospital} className={row.eligible ? "" : "is-out"}>
            <div className="route-head">
              <span className="route-rank">{row.eligible ? index + 1 : "✕"}</span>
              <div>
                <strong>{row.hospital}</strong>
                <small>{row.drive_minutes} min drive · {row.data === "live" ? "live capacity" : "emulated feed"}</small>
              </div>
              {row.eligible && (
                <button type="button" className="dark-btn" disabled={Boolean(sending)} onClick={() => send(row.hospital)}>
                  {sending === row.hospital ? "Sending…" : "Send pre-alert"}
                </button>
              )}
            </div>
            <ul className="route-why">
              {row.reasons.map((reason) => (
                <li key={reason.text} className={reason.ok ? "is-ok" : "is-no"}>{reason.ok ? "✓" : "✕"} {reason.text}</li>
              ))}
            </ul>
          </li>
        ))}
        {!options && <li className="route-empty">Asking the network…</li>}
      </ol>
      {note && <p className="planner-note">{note}</p>}
    </section>
  );
}
