import { useEffect, useRef, useState } from "react";
import { blockingUnit, tightestUnit } from "./network/ems";

const OCCUPIED = new Set(["critical", "warning", "normal"]);
// Mirrors the API: a crew waits for our answer until a minute out, then goes elsewhere.
export const NO_ANSWER_LEAD_SECONDS = 60;

// Beds the live census has not reported yet have no status and are left out.
function bedMix(beds) {
  const mix = { occupied: 0, open: 0, turnover: 0 };
  let total = 0;
  for (const bed of beds) {
    if (!bed.status) continue;
    total += 1;
    if (OCCUPIED.has(bed.status)) mix.occupied += 1;
    else if (bed.status === "available") mix.open += 1;
    else mix.turnover += 1;
  }
  return { ...mix, total, pct: total ? Math.round((mix.occupied / total) * 100) : 0 };
}

export function floorRows(hospital) {
  return hospital
    .map((level) => {
      const beds = level.rooms.filter((room) => room.census);
      return { id: level.id, code: level.code, name: level.subtitle || level.name, ...bedMix(beds) };
    })
    .filter((row) => row.total > 0);
}

function dueSoon(incoming) {
  return incoming.filter((run) => run.status === "arrived" || (run.eta_seconds ?? 9999) <= 900);
}

// Plain-language fallback so the home screen always has a briefing, even with the AI offline.
export function localBriefing({ emsStatus, capacity, incoming = [], totals }) {
  const diverting = emsStatus?.ems_status === "diverting";
  const units = capacity?.units;
  const tight = tightestUnit(units);
  const blocker = blockingUnit(units);
  const soon = dueSoon(incoming);
  const pending = incoming.filter((run) => run.status === "pending");
  const tightBit = tight ? `tightest unit: ${tight.label}, ${tight.open} open` : "unit capacity is still loading";
  const lines = [
    diverting
      ? `On diversion${emsStatus?.reason ? ` — ${emsStatus.reason}` : ""}. ${tightBit}.`
      : `${tightBit.charAt(0).toUpperCase()}${tightBit.slice(1)}.`,
  ];
  if (soon.length) {
    lines.push(
      `${soon.length} ambulance${soon.length === 1 ? "" : "s"} in the next 15 minutes${
        pending.length ? `, ${pending.length} still waiting for an answer` : ", every pre-alert answered"
      }.`,
    );
  } else if (pending.length) {
    lines.push(`No ambulance due in 15 minutes. ${pending.length} pre-alert${pending.length === 1 ? "" : "s"} still waiting for an answer.`);
  } else {
    lines.push("No ambulance due in the next 15 minutes.");
  }
  const first = [...pending].sort((a, b) => (a.eta_seconds ?? 0) - (b.eta_seconds ?? 0))[0];
  if (first) {
    lines.push(`Answer ${first.unit}: ESI ${first.esi} ${first.complaint_label}${first.bed_id ? `, bed ${first.bed_id}` : ""}.`);
  } else if (!diverting && blocker) {
    lines.push(`${blocker.label}: ${blocker.level === "full" ? "full" : "limited"}, ${blocker.open} open. Diversion is the lever if the next ambulance needs it.`);
  } else if (totals) {
    const net = totals.admit - totals.discharge - totals.transfer;
    lines.push(
      net > 0
        ? `No decision waiting. Census is filling, +${net} net in 2 hours.`
        : net < 0
          ? `No decision waiting. Census is emptying, ${net} net in 2 hours.`
          : "No decision waiting. Flow over the last 2 hours is balanced.",
    );
  } else {
    lines.push("No decision waiting.");
  }
  return lines.map((line) => `- ${line}`).join("\n");
}

const GLYPHS = {
  alert: <><path d="M10 2.8 18 16.6H2L10 2.8Z" /><path d="M10 8.2v3.6M10 14.2h.01" /></>,
  transfer: <><path d="M3 7h12.5M12 3.5 15.5 7 12 10.5" /><path d="M17 13H4.5M8 9.5 4.5 13 8 16.5" /></>,
  list: <><path d="M7 5h10M7 10h10M7 15h10" /><circle cx="3.5" cy="5" r=".6" /><circle cx="3.5" cy="10" r=".6" /><circle cx="3.5" cy="15" r=".6" /></>,
};

function Glyph({ name, className = "glyph" }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {GLYPHS[name]}
    </svg>
  );
}

const REDUCED_MOTION =
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// Full-bleed page header over a photo or a muted looping video from /public.
export function PageHero({ kicker, title, sub, image, video, poster, position = "center", children }) {
  const still = !video || REDUCED_MOTION;
  return (
    <section className="hero">
      <div className="hero-media" aria-hidden="true" style={{ "--hero-pos": position }}>
        {still ? (
          <img src={poster || image} alt="" />
        ) : (
          <video autoPlay muted loop playsInline preload="auto" poster={poster || image}>
            <source src={video} type="video/mp4" />
          </video>
        )}
      </div>
      <div className="hero-inner">
        <div className="hero-copy">
          <p className="page-kicker">{kicker}</p>
          <h1>{title}</h1>
          {sub && <p className="page-sub">{sub}</p>}
        </div>
        {children && <div className="hero-side">{children}</div>}
      </div>
    </section>
  );
}

// Counts up from the last shown value whenever a number changes.
export function AnimatedNumber({ value, format = String, duration = 800 }) {
  const valid = Number.isFinite(value);
  const [shown, setShown] = useState(REDUCED_MOTION && valid ? value : 0);
  const last = useRef(REDUCED_MOTION && valid ? value : 0);
  useEffect(() => {
    if (!valid) return undefined;
    const from = last.current;
    if (REDUCED_MOTION || from === value) {
      last.current = value;
      setShown(value);
      return undefined;
    }
    const start = performance.now();
    let frame = 0;
    const step = (time) => {
      const t = Math.min(1, (time - start) / duration);
      const current = Math.round(from + (value - from) * (1 - (1 - t) ** 3));
      last.current = current;
      setShown(current);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value, valid, duration]);
  return valid ? format(shown) : "—";
}

// Route line under an ambulance row: the van moves forward as the ETA runs down.
export function EtaTrack({ run, left }) {
  const total = (Date.parse(run.eta_at) - Date.parse(run.created_at)) / 1000;
  const remaining = run.status === "arrived" ? 0 : left ?? run.eta_seconds ?? 0;
  const raw = total > 0 ? (1 - remaining / total) * 100 : 100;
  const pct = Math.max(3, Math.min(100, Number.isFinite(raw) ? raw : 0));
  return (
    <span className={run.status === "arrived" ? "eta-track is-here" : "eta-track"} aria-hidden="true">
      <i style={{ width: `${pct}%` }} />
      <b style={{ left: `${pct}%` }}>
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <path d="M1.8 14.2V6.4h9.4v7.8M11.2 8.6h3.3l3.3 3.2v2.4h-1.4M5.4 14.2h5.2" />
          <circle cx="4.2" cy="14.6" r="1.5" />
          <circle cx="14.4" cy="14.6" r="1.5" />
        </svg>
      </b>
    </span>
  );
}

export function HeroStat({ value, label, tone, onClick, active, title }) {
  const isButton = Boolean(onClick);
  const Component = isButton ? "button" : "div";
  return (
    <Component
      type={isButton ? "button" : undefined}
      onClick={onClick}
      title={title}
      className={`hero-stat${tone ? ` is-${tone}` : ""}${isButton ? " is-clickable" : ""}${active ? " is-active" : ""}`}
      style={isButton ? { cursor: "pointer", background: "rgba(255, 255, 255, 0.09)", border: "1px solid rgba(255, 255, 255, 0.16)", textAlign: "left", font: "inherit", color: "inherit", width: "100%" } : undefined}
    >
      <b>{typeof value === "number" ? <AnimatedNumber value={value} /> : value}</b>
      <span>{label}</span>
    </Component>
  );
}

export function Card({ title, kicker, icon, action, className = "", children }) {
  return (
    <section className={`card ${className}`}>
      {(title || kicker || action) && (
        <header className="card-head">
          {icon && <span className="card-icon"><Glyph name={icon} /></span>}
          <div className="card-titles">
            {kicker && <p className="card-kicker">{kicker}</p>}
            {title && <h2>{title}</h2>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}
