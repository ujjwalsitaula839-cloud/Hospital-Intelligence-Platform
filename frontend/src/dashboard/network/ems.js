import { useEffect, useState } from "react";

// Emergency Severity Index: the triage scale US emergency departments and EMS use.
export const ESI = {
  1: { label: "Resuscitation", color: "#b42318", soft: "#fde4e2" },
  2: { label: "Emergent", color: "#ea580c", soft: "#ffedd5" },
  3: { label: "Urgent", color: "#ca8a04", soft: "#fef6d8" },
  4: { label: "Less urgent", color: "#16a34a", soft: "#e7f6ee" },
  5: { label: "Non-urgent", color: "#2563eb", soft: "#e6eefc" },
};

export const COMPLAINTS = [
  { id: "trauma", label: "Trauma" },
  { id: "stroke", label: "Stroke" },
  { id: "cardiac", label: "Chest pain / STEMI" },
  { id: "respiratory", label: "Respiratory" },
  { id: "general", label: "General medical" },
];

export const ZONES = ["Downtown", "North", "East", "South", "West"];

export const UNIT_ORDER = ["ed", "icu", "inpatient", "or"];

const LEVEL_RANK = { full: 0, limited: 1, none: 2, open: 3 };

// The unit under the most pressure. A tie goes to the higher occupancy.
export function tightestUnit(units) {
  if (!units) return null;
  const rows = UNIT_ORDER.map((key) => units[key]).filter(Boolean);
  if (!rows.length) return null;
  return [...rows].sort((a, b) => {
    const rank = (LEVEL_RANK[a.level] ?? 9) - (LEVEL_RANK[b.level] ?? 9);
    if (rank) return rank;
    return b.occupancy_pct - a.occupancy_pct;
  })[0];
}

// A unit that can block the next ambulance, while the hospital is still accepting.
export function blockingUnit(units) {
  const tight = tightestUnit(units);
  if (!tight || (tight.level !== "full" && tight.level !== "limited")) return null;
  return tight;
}

export function countdown(seconds) {
  if (seconds == null) return "—";
  const safe = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(safe / 60);
  return `${minutes}:${String(safe % 60).padStart(2, "0")}`;
}

export function secondsUntil(iso, now) {
  if (!iso) return null;
  return (new Date(iso).getTime() - now) / 1000;
}

export function clockTime(iso) {
  if (!iso) return "—";
  const stamp = new Date(iso);
  return Number.isNaN(stamp.getTime()) ? "—" : stamp.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

// Where an ambulance is on the region map, from its pickup zone to its hospital.
export function ambulancePosition(run, now) {
  const start = new Date(run.created_at).getTime();
  const end = new Date(run.eta_at).getTime();
  const share = end > start ? Math.min(1, Math.max(0, (now - start) / (end - start))) : 1;
  const { from, to } = run.route;
  return { x: from.x + (to.x - from.x) * share, y: from.y + (to.y - from.y) * share, share };
}

import { getRegionalAvailability, getRegionalTraffic } from "../emsService";

// Public availability + ambulance traffic, refreshed like a live board.
export function useRegion() {
  const [data, setData] = useState(() => getRegionalAvailability());
  const [traffic, setTraffic] = useState(() => getRegionalTraffic());

  useEffect(() => {
    function refresh() {
      setData(getRegionalAvailability());
      setTraffic(getRegionalTraffic());
    }
    const timer = setInterval(refresh, 4000);
    window.addEventListener("hip:ems-updated", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("hip:ems-updated", refresh);
    };
  }, []);

  return {
    hospitals: data?.hospitals || [],
    zones: data?.zones || [],
    updatedAt: data?.updated_at || null,
    ambulances: traffic?.ambulances || [],
    offline: false,
  };
}

export function useNow(every = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(timer);
  }, [every]);
  return now;
}
