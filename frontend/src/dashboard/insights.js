// Clinical scores and bed-turnover estimates for the room card and the floor plan.
// Everything here is derived from the live census; nothing is invented.

const TICK_SECONDS = 9; // backend/app/sim.py
export const NURSE_LOAD = 4; // backend/app/ops_snapshot.py

export function stayLabel(ticks) {
  if (ticks == null) return null;
  const minutes = Math.round((ticks * TICK_SECONDS) / 60);
  if (minutes < 1) return "Just arrived";
  if (minutes < 60) return `${minutes} min in bed`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min in bed`;
}

// Simplified NEWS2 from the last recorded vitals (no consciousness or O2 terms).
export function earlyWarning(room) {
  if (room?.heartRate == null) return null;
  const rows = [];
  const rr = room.respiratoryRate;
  const spo2 = room.spo2;
  const sbp = room.systolic;
  const hr = room.heartRate;
  const temp = room.temperature == null ? null : room.temperature / 10;
  if (rr != null) rows.push({ label: "RR", value: rr, score: rr <= 8 ? 3 : rr <= 11 ? 1 : rr <= 20 ? 0 : rr <= 24 ? 2 : 3 });
  if (spo2 != null) rows.push({ label: "SpO₂", value: `${spo2}%`, score: spo2 <= 91 ? 3 : spo2 <= 93 ? 2 : spo2 <= 95 ? 1 : 0 });
  if (sbp != null) {
    rows.push({
      label: "BP",
      value: `${sbp}/${room.diastolic ?? "—"}`,
      score: sbp <= 90 ? 3 : sbp <= 100 ? 2 : sbp <= 110 ? 1 : sbp <= 219 ? 0 : 3,
    });
  }
  rows.push({ label: "HR", value: hr, score: hr <= 40 ? 3 : hr <= 50 ? 1 : hr <= 90 ? 0 : hr <= 110 ? 1 : hr <= 130 ? 2 : 3 });
  if (temp != null) {
    rows.push({
      label: "Temp",
      value: `${temp.toFixed(1)}°`,
      score: temp <= 35 ? 3 : temp <= 36 ? 1 : temp <= 38 ? 0 : temp <= 39 ? 1 : 2,
    });
  }
  const total = rows.reduce((sum, row) => sum + row.score, 0);
  const level = total >= 7 ? "high" : total >= 5 || rows.some((row) => row.score === 3) ? "medium" : "low";
  const advice = {
    high: "Emergency response. Continuous monitoring.",
    medium: "Urgent review by the attending.",
    low: "Routine observation.",
  }[level];
  return { total, level, advice, rows };
}

const CLEAN_TICKS = { stat: 2, standard: 4, terminal: 8 }; // backend/app/sim.py
const LINEN_FLOW = [
  { id: "pickup", label: "Soiled pickup", ticks: 1 },
  { id: "wash", label: "Wash", ticks: 2 },
  { id: "deliver", label: "Clean delivery", ticks: 1 },
];
const WAIT_TICKS = 3; // typical wait for a free housekeeper or linen aide

function cleanTrack(room) {
  const total = CLEAN_TICKS[room.cleanType] || CLEAN_TICKS.standard;
  const left = Math.max(0, room.ticksLeft ?? total);
  const done = left === 0;
  const waiting = !done && !room.housekeeper;
  return { total, left, done, waiting, remaining: left + (waiting ? WAIT_TICKS : 0) };
}

function linenTrack(room) {
  const total = LINEN_FLOW.reduce((sum, stage) => sum + stage.ticks, 0);
  const index = LINEN_FLOW.findIndex((stage) => stage.id === room.linenStage);
  if (!room.linenStage || room.linenStage === "ready" || index < 0) {
    return { total, left: 0, done: true, waiting: false, remaining: 0, index: LINEN_FLOW.length };
  }
  const current = Math.max(1, room.linenTicks ?? LINEN_FLOW[index].ticks);
  const left = current + LINEN_FLOW.slice(index + 1).reduce((sum, stage) => sum + stage.ticks, 0);
  const waiting = !room.linenAide;
  return { total, left, done: false, waiting, remaining: left + (waiting ? WAIT_TICKS : 0), index };
}

// Seconds until a bed in turnover opens. Cleaning and linen run in parallel; the slower one decides.
export function cleanEtaSeconds(room) {
  if (room?.status !== "cleaning") return null;
  return Math.max(cleanTrack(room).remaining, linenTrack(room).remaining) * TICK_SECONDS;
}

// Everything the room card needs to explain a bed in turnover: progress, both tracks, and the blocker.
export function turnoverPlan(room, queuePlace = null) {
  const clean = cleanTrack(room);
  const linen = linenTrack(room);
  const totalTicks = clean.total + linen.total;
  const rawPct = totalTicks > 0 ? Math.round((doneTicks / totalTicks) * 100) : 100;
  const pct = Number.isFinite(rawPct) ? rawPct : 100;
  const eta = Math.max(clean.remaining, linen.remaining) * TICK_SECONDS;
  let blocker = null;
  if (!clean.done || !linen.done) {
    const cleanSlower = clean.remaining >= linen.remaining;
    if (cleanSlower && clean.waiting) blocker = `No housekeeper yet${queuePlace ? ` · #${queuePlace} in the queue` : ""}`;
    else if (cleanSlower) blocker = `Cleaning in progress · ${room.housekeeper}`;
    else if (linen.waiting) blocker = "Waiting for a linen aide";
    else blocker = `Linen: ${LINEN_FLOW[linen.index].label.toLowerCase()}`;
  }
  return {
    pct: clean.done && linen.done ? 100 : Math.min(99, pct),
    eta,
    ready: clean.done && linen.done,
    blocker,
    clean: {
      state: clean.done ? "done" : clean.waiting ? "waiting" : "active",
      type: room.cleanType || "standard",
      who: room.housekeeper,
      eta: clean.remaining * TICK_SECONDS,
    },
    linen: {
      state: linen.done ? "done" : linen.waiting ? "waiting" : "active",
      who: room.linenAide,
      eta: linen.remaining * TICK_SECONDS,
      stages: LINEN_FLOW.map((stage, index) => ({
        ...stage,
        state: index < linen.index ? "done" : index === linen.index ? (linen.waiting ? "waiting" : "active") : "todo",
      })),
    },
    nextFor: room.holdFor || null,
  };
}

export function formatEta(seconds) {
  if (seconds == null) return "—";
  if (seconds <= 0) return "now";
  if (seconds < 60) return `${Math.max(5, Math.round(seconds / 5) * 5)}s`;
  return `${Math.round(seconds / 60)}m`;
}
