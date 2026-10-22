import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { UNIT_ORDER, clockTime } from "./network/ems";
import { Card, HeroStat, PageHero } from "./ui";

// Simulation: the bulletin is built from our live capacity, but it is never sent anywhere.
const BROADCAST_EVERY_MS = 6000;
const FIRST_BULLETIN = 1024;

// Fictional regional ambulance companies and their fleets.
const AGENCIES = [
  { id: "tre", name: "Metro Region EMS", units: 8, x: 80, y: 18, color: "#60a5fa" },
  { id: "riv", name: "Riverside Ambulance", units: 5, x: 80, y: 50, color: "#34d399" },
  { id: "mfr", name: "Metro Fire Rescue", units: 6, x: 80, y: 82, color: "#fbbf24" },
];
const HUB = { x: 20, y: 50 };

const SHARED = [
  "Open beds in Emergency, ICU, inpatient units and operating rooms",
  "Estimated wait in the emergency department",
  "Services: trauma level, stroke center, CT",
  "Whether we are accepting ambulances",
  "How many ambulances are already on their way",
];
const NEVER = [
  "Patient names, ages or photos",
  "Vital signs, complaints or diagnoses",
  "Which patient is in which bed",
  "Staff names or schedules",
];

// One simulated delivery per ambulance company for a bulletin.
function deliveries(seq) {
  const stamp = new Date().toISOString();
  return AGENCIES.map((agency) => ({
    id: `${seq}-${agency.id}`,
    time: stamp,
    bulletin: `TMH-${String(seq).padStart(5, "0")}`,
    agency: agency.name,
    color: agency.color,
    units: agency.units,
    latency: 60 + Math.round(Math.random() * 180),
  }));
}

function buildBulletin(hospital, incoming, seq) {
  const units = {};
  for (const key of UNIT_ORDER) {
    const unit = hospital?.units?.[key];
    if (unit) units[key] = { open: unit.open, total: unit.total, occupancy_pct: unit.occupancy_pct, level: unit.level };
  }
  const caps = hospital?.capabilities || {};
  return {
    bulletin: `TMH-${String(seq).padStart(5, "0")}`,
    issued_at: new Date().toISOString(),
    hospital: "HIP Medical Center",
    accepting_ambulances: hospital ? hospital.ems_status !== "diverting" : true,
    ed_wait_min: hospital?.ed_wait_min ?? null,
    units,
    services: {
      trauma_level: caps.trauma_level ?? null,
      stroke_center: Boolean(caps.stroke_center),
      ct: Boolean(caps.ct),
    },
    ambulances_on_the_way: incoming.filter((run) => ["pending", "accepted"].includes(run.status)).length,
    contains_patient_data: false,
  };
}

function JsonView({ value }) {
  const text = JSON.stringify(value, null, 2);
  const parts = text.split(/("(?:\\.|[^"\\])*"(?:\s*:)?|\b-?\d+(?:\.\d+)?\b|\btrue\b|\bfalse\b|\bnull\b)/g);
  return (
    <pre className="code-view od2-code">
      {parts.map((part, index) => {
        let kind = "";
        if (/^".*":$/.test(part.replace(/\s/g, ""))) kind = "k";
        else if (part.startsWith('"')) kind = "s";
        else if (/^-?\d/.test(part)) kind = "n";
        else if (/^(true|false|null)$/.test(part)) kind = "l";
        return kind ? <span key={index} className={`tok-${kind}`}>{part}</span> : <Fragment key={index}>{part}</Fragment>;
      })}
    </pre>
  );
}

function levelLabel(level) {
  return { open: "Open", limited: "Tight", full: "Full", none: "—" }[level] || level;
}

export default function OpenDataTab({ hospital, incoming = [] }) {
  const [seq, setSeq] = useState(FIRST_BULLETIN);
  const [log, setLog] = useState(() => deliveries(FIRST_BULLETIN));
  const seqRef = useRef(FIRST_BULLETIN);
  const [sentAt, setSentAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const latest = useRef({ hospital, incoming });
  latest.current = { hospital, incoming };

  useEffect(() => {
    const clock = setInterval(() => setNow(Date.now()), 500);
    const timer = setInterval(() => {
      seqRef.current += 1;
      const rows = deliveries(seqRef.current);
      setSeq(seqRef.current);
      setLog((old) => [...rows, ...old].slice(0, 12));
      setSentAt(Date.now());
    }, BROADCAST_EVERY_MS);
    return () => {
      clearInterval(clock);
      clearInterval(timer);
    };
  }, []);

  const bulletin = useMemo(() => buildBulletin(hospital, incoming, seq), [hospital, incoming, seq]);
  const reached = AGENCIES.reduce((sum, agency) => sum + agency.units, 0);
  const since = Math.max(0, Math.round((now - sentAt) / 1000));
  const nextIn = Math.max(0, Math.ceil((BROADCAST_EVERY_MS - (now - sentAt)) / 1000));
  const lastLatency = log[0]?.latency;
  const accepting = bulletin.accepting_ambulances;

  return (
    <div className="page has-hero od2">
      <PageHero
        video="/videos/corridor.mp4"
        poster="/videos/corridor.jpg"
        position="center 40%"
        kicker="Open data · live simulation"
        title="Our capacity, on every ambulance screen."
        sub="Every few seconds HIP Medical Center publishes a capacity bulletin for the ambulance companies in the region, so crews choose the right door before they turn the corner. In this demo the bulletin is built from our live database, and nothing leaves this browser."
      >
        <div className="hero-stats">
          <HeroStat value={`#${seq}`} label="Bulletins published" />
          <HeroStat value={AGENCIES.length} label="Ambulance companies" />
          <HeroStat value={reached} label="Crews receiving" />
          <HeroStat value={lastLatency ? <>{lastLatency}<small>ms</small></> : "—"} label="Last delivery (simulated)" />
        </div>
      </PageHero>

      <div className="od2-top">
        <section className="card od2-net" aria-label="Broadcast to ambulance companies">
          <header className="card-head">
            <span className="card-icon" aria-hidden="true">
              <svg className="glyph" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><circle cx="10" cy="10" r="2.2" /><path d="M5.6 5.6a6.2 6.2 0 0 0 0 8.8M14.4 5.6a6.2 6.2 0 0 1 0 8.8M3.2 3.2a9.6 9.6 0 0 0 0 13.6M16.8 3.2a9.6 9.6 0 0 1 0 13.6" /></svg>
            </span>
            <div className="card-titles">
              <p className="card-kicker">Bulletin {bulletin.bulletin} · every {BROADCAST_EVERY_MS / 1000} s</p>
              <h2>Sent {since}s ago to {reached} crews</h2>
            </div>
            <span className="od2-next">Next in {nextIn}s</span>
            <span className="od2-sim">Simulation</span>
          </header>
          <div className="od2-stage">
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              {AGENCIES.map((agency) => (
                <line key={agency.id} x1={HUB.x} y1={HUB.y} x2={agency.x} y2={agency.y} stroke={agency.color} vectorEffect="non-scaling-stroke" />
              ))}
            </svg>
            {AGENCIES.map((agency, index) => (
              <i
                key={`${seq}-${agency.id}`}
                className="od2-packet"
                style={{
                  "--x1": `${HUB.x}%`,
                  "--y1": `${HUB.y}%`,
                  "--x2": `${agency.x}%`,
                  "--y2": `${agency.y}%`,
                  "--c": agency.color,
                  animationDelay: `${index * 0.12}s`,
                }}
              />
            ))}
            <div className="od2-hub" style={{ left: `${HUB.x}%`, top: `${HUB.y}%` }}>
              <img src="/logo_tight.png" alt="" />
              <strong>HIP Medical Center</strong>
              <small className={accepting ? "is-ok" : "is-no"}>{accepting ? "Accepting ambulances" : "On diversion"}</small>
            </div>
            {AGENCIES.map((agency) => (
              <div key={agency.id} className="od2-agency" style={{ left: `${agency.x}%`, top: `${agency.y}%`, "--c": agency.color }}>
                <strong>{agency.name}</strong>
                <span className="od2-fleet">
                  {Array.from({ length: agency.units }, (_, index) => <i key={index} />)}
                </span>
                <small>✓ {agency.units} crews synced · {since}s ago</small>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="od2-mid">
        <section className="od2-crew" aria-label="What an ambulance crew sees">
          <div className="od2-crew-bg" aria-hidden="true" />
          <div className="od2-crew-copy">
            <p className="card-kicker">What the crew sees</p>
            <h2>On the tablet in the ambulance, before they choose a hospital.</h2>
            <p>The same bulletin, turned into the three things a paramedic needs: can they take us, which unit has room, and how long the wait is.</p>
          </div>
          <div className="tablet">
            <div className="tablet-screen">
              <header>
                <span>Medic 12 · Metro Region EMS</span>
                <span className="tablet-sync"><i />{since}s ago</span>
              </header>
              <div className="tablet-hosp">
                <strong>HIP Medical Center</strong>
                <span className={accepting ? "is-ok" : "is-no"}>{accepting ? "Accepting" : "Diverting"}</span>
              </div>
              <div className="tablet-grid">
                {UNIT_ORDER.map((key) => {
                  const unit = bulletin.units[key];
                  if (!unit) return null;
                  return (
                    <div key={key} className={`is-${unit.level}`}>
                      <small>{hospital?.units?.[key]?.label?.replace("Inpatient beds", "Inpatient") || key}</small>
                      <b>{unit.open}</b>
                      <span>{levelLabel(unit.level)}</span>
                    </div>
                  );
                })}
              </div>
              <div className="tablet-row">
                <span>ED wait ~{bulletin.ed_wait_min ?? "—"} min</span>
                {bulletin.services.trauma_level ? <span>Trauma level {"I".repeat(bulletin.services.trauma_level)}</span> : null}
                {bulletin.services.stroke_center && <span>Stroke</span>}
                {bulletin.services.ct && <span>CT</span>}
              </div>
              <footer>{bulletin.bulletin} · {bulletin.ambulances_on_the_way} ambulances already heading there</footer>
            </div>
          </div>
        </section>

        <Card kicker="Privacy by design" title="Capacity is shared. Patients never are." icon="alert" className="od2-privacy">
          <div className="od2-lists">
            <div>
              <p className="od2-list-title is-ok">In the bulletin</p>
              <ul>{SHARED.map((item) => <li key={item} className="is-ok">{item}</li>)}</ul>
            </div>
            <div>
              <p className="od2-list-title is-no">Never leaves the hospital</p>
              <ul>{NEVER.map((item) => <li key={item} className="is-no">{item}</li>)}</ul>
            </div>
          </div>
        </Card>
      </div>

      <Card kicker="Delivery log" title="Every bulletin, every company" icon="list" className="od2-log">
        <div className="amb-table-wrap overflow-y-auto max-h-[500px] overflow-x-auto w-full">
          <table className="amb-table">
            <thead>
              <tr><th>Time</th><th>Bulletin</th><th>Ambulance company</th><th>Crews</th><th>Latency</th><th>Status</th></tr>
            </thead>
            <tbody>
              {log.map((row) => (
                <tr key={row.id}>
                  <td>{clockTime(row.time)}</td>
                  <td className="mono">{row.bulletin}</td>
                  <td><i className="od2-dot" style={{ background: row.color }} />{row.agency}</td>
                  <td>{row.units}</td>
                  <td>{row.latency} ms</td>
                  <td><span className="od2-status">Delivered · simulated</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <details className="od2-raw">
          <summary>See bulletin {bulletin.bulletin} as data (JSON)</summary>
          <JsonView value={bulletin} />
        </details>
        <p className="card-foot">Demo simulation: no data is sent to any company. In production this bulletin would go out over the regional EMS network.</p>
      </Card>
    </div>
  );
}
