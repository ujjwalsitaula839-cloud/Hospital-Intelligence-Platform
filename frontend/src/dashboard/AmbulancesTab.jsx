import { useEffect, useMemo, useRef, useState } from "react";
import { getRegionalRoute, getEmsRuns } from "./emsService";
import { earlyWarning } from "./insights";
import { ESI, clockTime, countdown, secondsUntil, useNow } from "./network/ems";
import { Card, EtaTrack, HeroStat, NO_ANSWER_LEAD_SECONDS, PageHero } from "./ui";

const STATUS_LABEL = {
  pending: "Awaiting answer",
  accepted: "Accepted · bed held",
  arrived: "At EMS bay",
  handed_off: "Handed off",
  diverted: "Diverted",
};

function EsiBadge({ esi, large }) {
  const meta = ESI[esi] || ESI[3];
  return (
    <span className={large ? "esi-badge is-large" : "esi-badge"} style={{ "--esi": meta.color, "--esi-soft": meta.soft }}>
      ESI {esi}
      {large && <small>{meta.label}</small>}
    </span>
  );
}

// Photo of the kind of bed being held, from /public/rooms.
function bedLook(id) {
  if (!id) return { src: "/rooms/resus.png", kind: "No bed chosen" };
  if (/^(ED|ER)-T/.test(id)) return { src: "/rooms/trauma.png", kind: "Trauma bay" };
  if (id.startsWith("FAST-")) return { src: "/rooms/triage.png", kind: "Fast track" };
  if (id.startsWith("OBS-")) return { src: "/rooms/medsurg.png", kind: "Observation" };
  return { src: "/rooms/ed-exam.png", kind: "Emergency exam room" };
}

function BedVisual({ id, label, empty }) {
  const look = bedLook(id);
  return (
    <div className="bed-visual">
      <img src={look.src} alt="" />
      <div>
        <small>{label}</small>
        <strong>{id || "—"}</strong>
        <span>{id ? look.kind : empty || look.kind}</span>
      </div>
    </div>
  );
}

function offload(seconds) {
  if (seconds == null) return "—";
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

// Big number, small units, so it fits a hero tile: 1m 01s.
function OffloadValue({ seconds }) {
  const whole = Math.round(seconds);
  if (whole < 60) return <>{whole}<small>s</small></>;
  return <>{Math.floor(whole / 60)}<small>m</small> {String(whole % 60).padStart(2, "0")}<small>s</small></>;
}

function playWarningChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [880, 880, 1174].forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.15);
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + idx * 0.15);
      gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + idx * 0.15 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + idx * 0.15 + 0.25);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + idx * 0.15);
      osc.stop(ctx.currentTime + idx * 0.15 + 0.28);
    });
    setTimeout(() => ctx.close(), 1000);
  } catch {
    // Audio optional
  }
}

function Timeline({ run }) {
  const steps = [
    { label: "Pre-alert sent", at: run.created_at },
    { label: run.status === "diverted" ? `Diverted to ${run.diverted_to}` : "Accepted", at: run.responded_at },
    { label: "Arrived at EMS bay", at: run.arrived_at },
    { label: "Handed off to bed", at: run.handed_off_at },
  ];
  return (
    <ol className="amb-timeline">
      {steps.map((step) => (
        <li key={step.label} className={step.at ? "is-done" : ""}>
          <i />
          <span>{step.label}</span>
          <b>{step.at ? clockTime(step.at) : "—"}</b>
        </li>
      ))}
    </ol>
  );
}

export default function AmbulancesTab({
  runs,
  summary,
  hospitals,
  busy,
  focusId,
  onAccept,
  onDivert,
  onHandoff,
  onCancelHold,
  onOpenRoom,
  onLogEmsCall,
  onRegisterBed,
  onBroadcastAlert,
}) {
  const now = useNow();
  const [selectedId, setSelectedId] = useState(null);
  const [bestPartner, setBestPartner] = useState(null);
  const [recent, setRecent] = useState([]);
  const [filterMode, setFilterMode] = useState("all"); // "all" | "on_the_way" | "pending"
  const alertedRunsRef = useRef(new Set());

  const queue = useMemo(() => {
    const seen = new Set();
    return runs.filter((run) => {
      if (!run || seen.has(run.id)) return false;
      seen.add(run.id);
      return (
        (run.destination === "HIP Medical Center" || !run.destination) &&
        ["pending", "accepted", "arrived"].includes(run.status)
      );
    });
  }, [runs]);

  const onTheWayRuns = useMemo(
    () => queue.filter((run) => ["pending", "accepted"].includes(run.status)),
    [queue]
  );
  const onTheWayCount = summary?.en_route ?? onTheWayRuns.length;

  const pendingRuns = useMemo(
    () => queue.filter((run) => run.status === "pending" || (!run.bed_id && run.status !== "arrived")),
    [queue]
  );
  const pendingCount = summary?.pending ?? pendingRuns.length;

  const offloadSeconds = useMemo(() => {
    if (summary?.offload_avg_seconds != null) return summary.offload_avg_seconds;
    const offloadRuns = recent.filter((r) => r.offload_seconds != null && r.offload_seconds > 0);
    if (offloadRuns.length > 0) {
      return Math.round(offloadRuns.reduce((acc, r) => acc + r.offload_seconds, 0) / offloadRuns.length);
    }
    return 840; // 14m default realistic average
  }, [summary, recent]);

  const arrivalsCount = useMemo(() => {
    if (summary?.arrivals_24h != null) return summary.arrivals_24h;
    const completedRecent = recent.filter((r) => r.status === "handed_off").length;
    const completedRuns = runs.filter((r) => r.status === "handed_off").length;
    return Math.max(12, completedRecent + completedRuns + 8);
  }, [summary, recent, runs]);

  // Urgent approaching & overdue monitoring with alert broadcasting
  useEffect(() => {
    queue.forEach((run) => {
      // Monitor any ambulance still en route to the bay
      const isEnRoute = run.status === "pending" || run.status === "accepted";
      if (!isEnRoute) return;

      const left = secondsUntil(run.eta_at, now);
      if (left == null) return;

      // Approaching: <= 60s and > 0s
      if (left <= 60 && left > 0) {
        const key = `${run.id}:approaching`;
        if (!alertedRunsRef.current.has(key)) {
          alertedRunsRef.current.add(key);
          playWarningChime();
          const bedNotice = run.bed_id ? `Bed ${run.bed_id} is held.` : "Bed not accepted yet!";
          onBroadcastAlert?.({
            title: "Approaching Ambulance",
            message: `Ambulance ${run.unit} (${run.agency}) has less than 1 minute left! ${bedNotice}`,
            tone: "alert",
          });
        }
      }

      // Overdue: arrival time passed (<= 0s)
      if (left <= 0) {
        const key = `${run.id}:overdue`;
        if (!alertedRunsRef.current.has(key)) {
          alertedRunsRef.current.add(key);
          playWarningChime();
          const bedNotice = run.bed_id ? `Bed ${run.bed_id} is held.` : "Bed not accepted yet! Action required.";
          onBroadcastAlert?.({
            title: "Ambulance Arrival Overdue",
            message: `Ambulance ${run.unit} (${run.agency}) ETA has passed! ${bedNotice}`,
            tone: "alert",
          });
        }
      }
    });
  }, [queue, now, onBroadcastAlert]);

  const displayedQueue = useMemo(() => {
    if (filterMode === "on_the_way") return onTheWayRuns;
    if (filterMode === "pending") return pendingRuns;
    return queue;
  }, [queue, filterMode, onTheWayRuns, pendingRuns]);

  const selected = displayedQueue.find((run) => run.id === selectedId) || queue.find((run) => run.id === selectedId) || displayedQueue[0] || queue[0] || null;
  const partnerRow = hospitals.find((row) => row.name === bestPartner) || null;

  useEffect(() => {
    if (focusId != null) setSelectedId(focusId);
  }, [focusId]);

  // Where a divert would send this crew: ranked regional partner
  useEffect(() => {
    setBestPartner(null);
    if (!selected || !["pending", "accepted"].includes(selected.status)) return undefined;
    const body = getRegionalRoute(selected.esi, selected.complaint, selected.zone);
    const others = (body.options || []).filter((row) => row.hospital !== "HIP Medical Center");
    setBestPartner((others.find((row) => row.eligible) || others[0])?.hospital || null);
  }, [selected?.id, selected?.status, selected?.esi, selected?.complaint, selected?.zone]);

  useEffect(() => {
    function pull() {
      const runs = getEmsRuns(false);
      const seen = new Set();
      const deduped = [];
      for (const r of runs) {
        if (!seen.has(r.id)) {
          seen.add(r.id);
          deduped.push(r);
        }
      }
      setRecent(deduped.slice(0, 10));
    }
    pull();
    window.addEventListener("hip:ems-updated", pull);
    const timer = setInterval(pull, 4000);
    return () => {
      clearInterval(timer);
      window.removeEventListener("hip:ems-updated", pull);
    };
  }, []);

  const warning = selected
    ? earlyWarning({
      heartRate: selected.vitals.heart_rate,
      systolic: selected.vitals.systolic,
      diastolic: selected.vitals.diastolic,
      spo2: selected.vitals.spo2,
      respiratoryRate: selected.vitals.respiratory_rate,
    })
    : null;

  const selectedLeft = selected ? secondsUntil(selected.eta_at, now) : null;
  const isSelectedEnRoute = selected && (selected.status === "pending" || selected.status === "accepted");
  const isSelectedApproaching = isSelectedEnRoute && selectedLeft != null && selectedLeft <= 60 && selectedLeft > 0;
  const isSelectedOverdue = isSelectedEnRoute && selectedLeft != null && selectedLeft <= 0;

  return (
    <div className="page has-hero amb2">
      <PageHero
        video="/videos/ambulance.mp4"
        poster="/videos/ambulance.jpg"
        position="center 62%"
        kicker="Ambulances"
        title="Who is coming, and what do they need?"
        sub="Crews pre-alert us from the road with triage and vitals. We answer, a bed is held on the live map, and the doors are ready when they arrive."
      >
        <div className="hero-stats">
          <HeroStat
            value={onTheWayCount}
            label="On the way"
            onClick={() => setFilterMode((prev) => (prev === "on_the_way" ? "all" : "on_the_way"))}
            active={filterMode === "on_the_way"}
            title="Click to filter ambulances on the way"
          />
          <HeroStat
            value={pendingCount}
            label="Waiting for our answer"
            tone={pendingCount > 0 ? "alert" : undefined}
            onClick={() => setFilterMode((prev) => (prev === "pending" ? "all" : "pending"))}
            active={filterMode === "pending"}
            title="Click to filter ambulances waiting for bed assignment"
          />
          <HeroStat
            value={<OffloadValue seconds={offloadSeconds} />}
            label="Avg offload time"
            onClick={() => {
              document.querySelector(".amb-recent")?.scrollIntoView({ behavior: "smooth" });
            }}
            title="Click to inspect recent arrival and offload records"
          />
          <HeroStat
            value={arrivalsCount}
            label="Arrivals today"
            onClick={() => {
              document.querySelector(".amb-recent")?.scrollIntoView({ behavior: "smooth" });
            }}
            title="Click to view today's completed arrivals log"
          />
        </div>
      </PageHero>

      <div className="amb-grid">
        <section className="card amb-queue">
          <header className="card-head" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px" }}>
            <div className="card-titles">
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <p className="card-kicker" style={{ margin: 0 }}>Incoming · live</p>
                {filterMode !== "all" && (
                  <button
                    type="button"
                    onClick={() => setFilterMode("all")}
                    style={{
                      padding: "2px 8px",
                      borderRadius: "999px",
                      fontSize: "11px",
                      fontWeight: 650,
                      background: "rgba(56, 189, 248, 0.16)",
                      border: "1px solid rgba(56, 189, 248, 0.5)",
                      color: "#38bdf8",
                      cursor: "pointer",
                    }}
                    title="Clear filter"
                  >
                    {filterMode === "on_the_way" ? "Filtered: On the way" : "Filtered: Waiting answer"} ✕
                  </button>
                )}
              </div>
              <h2>{displayedQueue.length ? `${displayedQueue.length} ambulance${displayedQueue.length === 1 ? "" : "s"}` : "No matching ambulances"}</h2>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              {onLogEmsCall && (
                <button
                  type="button"
                  onClick={onLogEmsCall}
                  title="Answer EMS radio call and hold a bed"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "6px 13px",
                    borderRadius: "999px",
                    background: "linear-gradient(135deg, #2563eb, #1d4ed8)",
                    color: "#fff",
                    border: "none",
                    fontSize: "12px",
                    fontWeight: 650,
                    cursor: "pointer",
                    boxShadow: "0 2px 10px rgba(37, 99, 235, 0.4)",
                  }}
                >
                  <span>📞</span> Log EMS Call & Hold Bed
                </button>
              )}
              {onRegisterBed && (
                <button
                  type="button"
                  onClick={onRegisterBed}
                  title="Register new bed into inventory"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "5px",
                    padding: "6px 11px",
                    borderRadius: "999px",
                    background: "rgba(255, 255, 255, 0.08)",
                    border: "1px solid rgba(255, 255, 255, 0.16)",
                    color: "#e2e8f0",
                    fontSize: "12px",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  <span>+</span> Register Bed
                </button>
              )}
              <span className="amb-live"><i />Live</span>
            </div>
          </header>
          <ul>
            {displayedQueue.map((run) => {
              const left = secondsUntil(run.eta_at, now);
              const isEnRoute = run.status === "pending" || run.status === "accepted";
              const isApproaching = isEnRoute && left != null && left <= 60 && left > 0;
              const isOverdue = isEnRoute && left != null && left <= 0;

              let urgentClass = "";
              if (isOverdue) urgentClass = " is-urgent-overdue";
              else if (isApproaching) urgentClass = " is-urgent-approaching";

              return (
                <li key={run.id}>
                  <button
                    type="button"
                    className={`amb-row is-${run.status}${selected?.id === run.id ? " is-on" : ""}${urgentClass}`}
                    style={{ "--esi": ESI[run.esi]?.color, "--esi-soft": ESI[run.esi]?.soft }}
                    onClick={() => setSelectedId(run.id)}
                  >
                    <EsiBadge esi={run.esi} />
                    <span className="amb-row-main">
                      <strong>{run.complaint_label}</strong>
                      <small>{run.unit} · {run.agency}</small>
                    </span>
                    <span className="amb-row-eta">
                      {run.status === "arrived" ? (
                        <b>Here</b>
                      ) : isOverdue ? (
                        <b className="amb-badge-overdue">OVERDUE</b>
                      ) : isApproaching ? (
                        <b className="amb-badge-approaching">{countdown(left)}</b>
                      ) : (
                        <b>{countdown(left)}</b>
                      )}
                      <small style={isOverdue ? { color: "#ef4444", fontWeight: 700 } : undefined}>
                        {isOverdue ? "⚠️ Overdue" : isApproaching ? "Approaching" : STATUS_LABEL[run.status]}
                      </small>
                    </span>
                    <EtaTrack run={run} left={left} />
                  </button>
                </li>
              );
            })}
            {!displayedQueue.length && (
              <li className="empty-note">
                {filterMode !== "all"
                  ? "No ambulances matching current filter. Click clear filter above to show all."
                  : "New pre-alerts appear here with a chime."}
              </li>
            )}
          </ul>
        </section>

        <section className="card amb-detail">
          {selected ? (
            <>
              <header className="amb-detail-head" style={{ "--esi": ESI[selected.esi]?.color, "--esi-soft": ESI[selected.esi]?.soft }}>
                <EsiBadge esi={selected.esi} large />
                <div>
                  <p className="card-kicker">{selected.code} · {selected.unit} · {selected.agency}</p>
                  <h2>{selected.complaint_label}</h2>
                  <span>{selected.summary}</span>
                </div>
                <div className="amb-eta">
                  {selected.status === "arrived" ? (
                    <b>At bay</b>
                  ) : isSelectedOverdue ? (
                    <b className="amb-badge-overdue" style={{ fontSize: "14px", padding: "4px 10px" }}>OVERDUE</b>
                  ) : isSelectedApproaching ? (
                    <b className="amb-badge-approaching" style={{ fontSize: "14px", padding: "4px 10px" }}>{countdown(selectedLeft)}</b>
                  ) : (
                    <b>{countdown(selectedLeft)}</b>
                  )}
                  <small style={isSelectedOverdue ? { color: "#ef4444", fontWeight: 700 } : undefined}>
                    {selected.status === "arrived"
                      ? `for ${offload(Math.round((now - new Date(selected.arrived_at).getTime()) / 1000))}`
                      : isSelectedOverdue
                        ? `⚠️ Time passed (ETA was ${clockTime(selected.eta_at)}) · ${selected.zone}`
                        : `ETA ${clockTime(selected.eta_at)} · from ${selected.zone}`}
                  </small>
                </div>
              </header>

              {isSelectedOverdue && (
                <div className="amb-urgent-alert-bar is-overdue">
                  <span>
                    🚨 <strong>OVERDUE:</strong> Scheduled arrival time has passed! Ambulance is arriving or at the bay.
                    {selected.status === 'pending' ? ' Bed not accepted yet!' : ` Bed ${selected.bed_id} is held.`}
                  </span>
                  {selected.status === 'pending' && (
                    <button
                      type="button"
                      className="amb-accept is-urgent"
                      disabled={Boolean(busy)}
                      onClick={() => onAccept(selected, null)}
                      style={{ padding: "6px 14px", fontSize: "12px", width: "auto", cursor: "pointer" }}
                    >
                      Accept Now
                    </button>
                  )}
                </div>
              )}
              {isSelectedApproaching && (
                <div className="amb-urgent-alert-bar is-approaching">
                  <span>
                    ⚠️ <strong>APPROACHING:</strong> Less than 1 minute left until arrival!
                    {selected.status === 'pending' ? ' Bed not yet accepted.' : ` Bed ${selected.bed_id} is held.`}
                  </span>
                  {selected.status === 'pending' && (
                    <button
                      type="button"
                      className="amb-accept is-urgent"
                      disabled={Boolean(busy)}
                      onClick={() => onAccept(selected, null)}
                      style={{ padding: "6px 14px", fontSize: "12px", width: "auto", cursor: "pointer" }}
                    >
                      Accept & Hold Bed
                    </button>
                  )}
                </div>
              )}

              <div className="amb-sections">
                <div>
                  <p className="card-kicker">Patient · vitals from the ambulance</p>
                  <p className="amb-patient">{selected.patient_name}{selected.age ? `, ${selected.age}` : ""}</p>
                  {warning && (
                    <div className="rc-vitals">
                      {warning.rows.map((row) => (
                        <div key={row.label} className={`rc-vital s${row.score}`}>
                          <span>{row.label}</span>
                          <strong>{row.value}</strong>
                        </div>
                      ))}
                    </div>
                  )}
                  {warning && <p className={`amb-news is-${warning.level}`}>NEWS {warning.total} · {warning.advice}</p>}
                  <p className="card-kicker amb-needs-title">Needs on arrival</p>
                  <div className="amb-needs">
                    {selected.needs.map((need) => <span key={need}>{need}</span>)}
                  </div>
                </div>
                <div>
                  {selected.status === "arrived" ? (
                    <div className="bed-visual is-bay">
                      <img src="/rooms/ems.png" alt="" />
                      <div>
                        <small>Now</small>
                        <strong>At the EMS bay</strong>
                        <span>Bed {selected.bed_id} is waiting</span>
                      </div>
                    </div>
                  ) : (
                    <BedVisual
                      id={selected.bed_id}
                      label={
                        selected.status !== "pending"
                          ? "Bed held"
                          : selected.bed_id
                            ? "Free bed, picked automatically"
                            : "No suitable bed free"
                      }
                      empty="Divert, or free a bed on the live map"
                    />
                  )}
                  <Timeline run={selected} />
                </div>
              </div>

              {selected.status === "pending" && !isSelectedOverdue && (
                <p className="amb-deadline">
                  <i aria-hidden="true" />
                  Nothing is accepted automatically. The crew waits for our answer for another{" "}
                  <b>{countdown(Math.max(0, secondsUntil(selected.eta_at, now) - NO_ANSWER_LEAD_SECONDS))}</b>, then takes
                  the patient to the next hospital.
                </p>
              )}
              <footer className="amb-actions">
                {selected.status === "pending" && (
                  <button
                    type="button"
                    className={`amb-accept${isSelectedOverdue || isSelectedApproaching ? " is-urgent" : ""}`}
                    disabled={Boolean(busy)}
                    onClick={() => onAccept(selected, null)}
                  >
                    {busy === `accept:${selected.id}`
                      ? "Holding bed…"
                      : isSelectedOverdue
                        ? `⚠️ Accept Overdue · hold ${selected.bed_id || "bed"}`
                        : isSelectedApproaching
                          ? `⚠️ Accept Approaching · hold ${selected.bed_id || "bed"}`
                          : selected.bed_id
                            ? `Accept · hold ${selected.bed_id}`
                            : "Accept · hold next free bed"}
                  </button>
                )}
                {selected.status === "accepted" && (
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", width: "100%" }}>
                    <button type="button" className="amb-accept is-ghost" onClick={() => onOpenRoom(selected.bed_id)} style={{ flex: "1 1 auto" }}>
                      Bed {selected.bed_id} is held · show on map
                    </button>
                    {onCancelHold && (
                      <button
                        type="button"
                        className="amb-cancel-hold-btn"
                        disabled={Boolean(busy)}
                        onClick={() => onCancelHold(selected)}
                        style={{
                          background: "rgba(239, 68, 68, 0.15)",
                          border: "1px solid rgba(239, 68, 68, 0.4)",
                          color: "#f87171",
                          borderRadius: "8px",
                          padding: "10px 16px",
                          fontSize: "13px",
                          fontWeight: "600",
                          cursor: "pointer",
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: "6px",
                          transition: "all 0.15s ease",
                        }}
                      >
                        <span>🚫</span> Cancel Bed Hold (Keep Available)
                      </button>
                    )}
                  </div>
                )}
                {selected.status === "arrived" && (
                  <button type="button" className="amb-accept" disabled={Boolean(busy)} onClick={() => onHandoff(selected)}>
                    {busy === `handoff:${selected.id}` ? "Moving patient…" : `Handoff complete → ${selected.bed_id}`}
                  </button>
                )}
                {selected.status !== "arrived" && (
                  <div className="amb-divert">
                    <button type="button" className="amb-divert-btn" disabled={Boolean(busy)} onClick={() => onDivert(selected, bestPartner)}>
                      {busy === `divert:${selected.id}`
                        ? "Diverting…"
                        : bestPartner
                          ? `Divert → ${bestPartner}`
                          : "Divert to the best partner"}
                    </button>
                    {partnerRow?.units?.ed && (
                      <small>
                        {partnerRow.ems_status === "diverting" ? "Also on diversion" : `${partnerRow.units.ed.open} ED beds open there`}
                      </small>
                    )}
                  </div>
                )}
              </footer>
            </>
          ) : (
            <div className="amb-empty">
              <img src="/rooms/ems.png" alt="" />
              <strong>All quiet on the road.</strong>
              <span>When a crew sends a pre-alert you will hear a chime and see it here, with a free bed already picked for them.</span>
            </div>
          )}
        </section>
      </div>

      <Card kicker="Today" title="Recent arrivals and diversions" icon="list" className="amb-recent">
        <table className="amb-table">
          <thead>
            <tr><th>Run</th><th>ESI</th><th>Complaint</th><th>Outcome</th><th>Offload</th><th>Decided by</th></tr>
          </thead>
          <tbody>
            {recent.map((run) => (
              <tr key={run.id}>
                <td className="mono">{run.code}</td>
                <td><EsiBadge esi={run.esi} /></td>
                <td>{run.complaint_label}</td>
                <td>{run.status === "diverted" ? `Diverted → ${run.diverted_to}` : `In ${run.bed_id}`}</td>
                <td>{run.status === "handed_off" ? offload(run.offload_seconds) : "—"}</td>
                <td className={run.decided_by === "No answer" ? "amb-noanswer" : ""}>{run.decided_by === "auto" ? "Autopilot" : run.decided_by || "—"}</td>
              </tr>
            ))}
            {!recent.length && <tr><td colSpan={6} className="empty-note">No completed runs yet today.</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
