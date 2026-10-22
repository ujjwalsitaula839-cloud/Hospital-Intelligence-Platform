import { ESI, UNIT_ORDER, blockingUnit, countdown, tightestUnit } from "./network/ems";
import { AnimatedNumber, Card, EtaTrack, HeroStat, PageHero } from "./ui";

// A real photo of each kind of room, from /public/rooms.
const UNIT_PHOTOS = {
  ed: "/rooms/ed-exam.png",
  icu: "/rooms/icu.png",
  inpatient: "/rooms/medsurg.png",
  or: "/rooms/or.png",
};

const LEVEL_TEXT = { open: "Room to spare", limited: "Getting tight", full: "Full", none: "Not offered" };
// Pending first, so the ones that need an answer are always on the home screen.
const ARRIVALS_SHOWN = 4;
// Hero tiles are narrow: one word per unit.
const SHORT_UNIT = { "Intensive care": "ICU", "Inpatient beds": "Inpatient", "Operating rooms": "Surgery" };

function greeting(now) {
  const hour = now.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function BriefingLines({ text }) {
  const lines = String(text || "")
    .split("\n")
    .map((line) => line.replace(/^\s*[-*•]\s*/, "").replace(/\*\*/g, "").trim())
    .filter(Boolean);
  return (
    <ol className="brief-lines">
      {lines.map((line, index) => (
        <li key={index} style={{ animationDelay: `${index * 0.08}s` }}>
          <span>{String(index + 1).padStart(2, "0")}</span>
          <p>{line}</p>
        </li>
      ))}
    </ol>
  );
}

function dueSoon(incoming) {
  return incoming.filter((run) => run.status === "arrived" || (run.eta_seconds ?? 9999) <= 900);
}

function arrivalRank(run) {
  if (run.status === "pending") return 0;
  if (run.status === "arrived") return 1;
  return 2;
}

// Admissions, discharges and transfers over the last 2 hours, under the briefing.
function FlowStrip({ totals }) {
  if (!totals) return null;
  const admit = Number.isFinite(Number(totals.admit ?? totals.admissions)) ? Number(totals.admit ?? totals.admissions) : 0;
  const discharge = Number.isFinite(Number(totals.discharge ?? totals.discharges)) ? Number(totals.discharge ?? totals.discharges) : 0;
  const transfer = Number.isFinite(Number(totals.transfer ?? totals.transfers)) ? Number(totals.transfer ?? totals.transfers) : 0;
  const net = admit - discharge - transfer;
  const cells = [
    ["Admitted", admit],
    ["Discharged", discharge],
    ["Transferred out", transfer],
    ["Net census", net, (value) => (value > 0 ? `+${value}` : String(value))],
  ];
  return (
    <div className="brief-flow">
      <p>Patient flow · last 2 hours</p>
      <dl>
        {cells.map(([label, value, format]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd><AnimatedNumber value={value} format={format} /></dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// Occupancy ring: one arc, the unit's level colour, value in the middle.
function Gauge({ pct }) {
  const safe = Math.max(0, Math.min(100, Number.isFinite(Number(pct)) ? Number(pct) : 0));
  return (
    <div className="gauge" role="img" aria-label={`${safe}% occupied`}>
      <svg viewBox="0 0 36 36">
        <circle cx="18" cy="18" r="15.5" className="gauge-track" />
        <circle
          cx="18"
          cy="18"
          r="15.5"
          className="gauge-arc"
          pathLength="100"
          strokeDasharray={`${safe} 100`}
          transform="rotate(-90 18 18)"
        />
      </svg>
      <b><AnimatedNumber value={safe} /><small>%</small></b>
    </div>
  );
}

function UnitCard({ id, unit, waitMin }) {
  const openCount = Number.isFinite(Number(unit?.open)) ? Number(unit.open) : 0;
  const totalCount = Number.isFinite(Number(unit?.total)) ? Number(unit.total) : 0;
  const inUseCount = Math.max(0, totalCount - openCount);

  return (
    <article className={`unit-card is-${unit.level}`}>
      <div className="unit-photo">
        <img src={UNIT_PHOTOS[id]} alt="" loading="lazy" />
        <span className="unit-level"><i />{LEVEL_TEXT[unit.level] || unit.level}</span>
      </div>
      <div className="unit-body">
        <Gauge pct={unit.occupancy_pct} />
        <div className="unit-text">
          <strong>{unit.label}</strong>
          <span><b>{openCount}</b> open of {totalCount}</span>
          {id === "ed" && waitMin != null && <small>~{waitMin} min wait for a walk-in</small>}
          {id !== "ed" && <small>{inUseCount} in use</small>}
        </div>
      </div>
    </article>
  );
}

export default function OverviewTab({ now, insights, briefing, onRefreshBriefing, capacity, incoming = [], onOpenAmbulances, onOpenRun }) {
  const totals = insights?.totals;
  const units = capacity?.units;
  const tight = tightestUnit(units);
  const blocker = blockingUnit(units);
  const pending = incoming.filter((run) => run.status === "pending");
  const soon = dueSoon(incoming).sort(
    (a, b) => arrivalRank(a) - arrivalRank(b) || (a.eta_seconds ?? 0) - (b.eta_seconds ?? 0),
  );
  const dateLabel = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  return (
    <div className="page has-hero ov2">
      <PageHero
        image="/main-hospital.jpg"
        position="center 38%"
        kicker={dateLabel}
        title={`${greeting(now)}. Can we take the next ambulance?`}
        sub="Live capacity in every unit of HIP Medical Center, the ambulances heading to our door, and what needs an answer now."
      >
        <div className="hero-stats">
          <HeroStat value={pending.length} label="Pre-alerts to answer" tone={pending.length ? "alert" : undefined} />
          <HeroStat value={soon.length} label="Arriving in 15 min" />
          <HeroStat value={units?.ed?.open ?? "—"} label="Emergency beds open" />
          <HeroStat value={tight ? SHORT_UNIT[tight.label] || tight.label : "—"} label={tight ? `Tightest · ${tight.open} open` : "Tightest unit"} tone={tight && tight.level !== "open" ? "warn" : "text"} />
        </div>
      </PageHero>

      <div className="ov2-top">
        <section className="brief">
          <div className="brief-glow" aria-hidden="true" />
          <header>
            <span className="brief-mark" aria-hidden="true">
              <svg viewBox="0 0 20 20" fill="none"><path d="M10 2.5 11.8 8.2 17.5 10l-5.7 1.8L10 17.5l-1.8-5.7L2.5 10l5.7-1.8L10 2.5Z" fill="currentColor" /></svg>
            </span>
            <div>
              <strong>Hourly briefing</strong>
              <small>
                {briefing.loading
                  ? "Reading the census…"
                  : briefing.source === "ai"
                    ? "Written by AI from the live database"
                    : "Computed from the live database"}
              </small>
            </div>
            <button type="button" onClick={onRefreshBriefing} disabled={briefing.loading} aria-label="Refresh briefing">
              <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={briefing.loading ? "is-spin" : ""}>
                <path d="M16.5 10a6.5 6.5 0 1 1-2-4.7M16.5 3.5v3.3h-3.3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </header>
          <BriefingLines text={briefing.text} />
          <FlowStrip totals={totals} />
        </section>

        <Card
          kicker="Next 15 minutes"
          title={soon.length === 1 ? "1 ambulance arriving" : soon.length ? `${soon.length} ambulances arriving` : "No ambulance due"}
          icon="transfer"
          className="ov2-arrivals"
          action={<button type="button" className="link-btn" onClick={onOpenAmbulances}>All ambulances →</button>}
        >
          <ul className="arrivals2">
            {soon.slice(0, ARRIVALS_SHOWN).map((run) => (
              <li
                key={run.id}
                className={run.status === "pending" ? "is-pending" : run.status === "arrived" ? "is-here" : ""}
                style={{ "--esi": ESI[run.esi]?.color, "--esi-soft": ESI[run.esi]?.soft }}
              >
                <span className="arr2-esi">ESI {run.esi}</span>
                <span className="arr2-main">
                  <strong>{run.complaint_label}</strong>
                  <small>{run.unit} · {run.bed_id ? `bed ${run.bed_id}` : "no bed yet"}</small>
                </span>
                <b className="arr2-when">{run.status === "arrived" ? "At bay" : countdown(run.eta_seconds)}</b>
                {run.status === "pending" && (
                  <button type="button" className="arr2-answer" onClick={() => onOpenRun(run)}>Answer</button>
                )}
                <EtaTrack run={run} />
              </li>
            ))}
            {!soon.length && <li className="empty-note">Pre-alerts from ambulance crews appear here the moment they are sent.</li>}
          </ul>
          {soon.length > ARRIVALS_SHOWN && (
            <button type="button" className="arr2-more" onClick={onOpenAmbulances}>
              +{soon.length - ARRIVALS_SHOWN} more in Ambulances →
            </button>
          )}
        </Card>
      </div>

      <section className="unit-gallery" aria-label="Capacity by unit">
        <header>
          <p className="card-kicker">Every unit, not only the emergency room</p>
          <h2>Where the next patient can go</h2>
        </header>
        <div className="unit-grid2">
          {units
            ? UNIT_ORDER.map((key) => (units[key] ? <UnitCard key={key} id={key} unit={units[key]} waitMin={capacity.ed_wait_min} /> : null))
            : UNIT_ORDER.map((key) => <div key={key} className="unit-card is-loading"><span className="skeleton is-chart" /></div>)}
        </div>
        {blocker && (
          <p className="ov-block">
            {blocker.label} is {blocker.level === "full" ? "full" : "almost full"} · {blocker.open} open.
            An ambulance that needs it can be diverted from the Ambulances tab.
          </p>
        )}
      </section>
    </div>
  );
}
