/**
 * High-fidelity client-side EMS pre-alert store and hospital intelligence service.
 * Eliminates fake network fetch interception while providing permanent persistence
 * (via localStorage), reactive updates, and regional routing for the HIP dashboard.
 */

const STORAGE_KEY_EMS = "hip_ems_runs";

export const REGIONAL_HOSPITALS = [
  {
    name: "HIP Medical Center",
    short: "HIP",
    distance_miles: 3.2,
    eta_minutes: 8,
    trauma_level: 1,
    stroke_center: true,
    cath_lab: true,
    ct: true,
    icu: true,
    services: "Level I Trauma · Comprehensive Stroke · 24/7 Cath Lab · 32 ICU beds",
    units: {
      ed: { label: "Emergency / Trauma", total: 36, open: 9, occupancy_pct: 75, level: "open" },
      icu: { label: "Intensive Care", total: 24, open: 4, occupancy_pct: 83, level: "limited" },
      inpatient: { label: "Inpatient Wards", total: 120, open: 18, occupancy_pct: 85, level: "open" },
      or: { label: "Operating Suites", total: 8, open: 2, occupancy_pct: 75, level: "open" },
    },
    ed_wait_min: 12,
    ems_status: "accepting",
    eligible: true,
  },
  {
    name: "County General Hospital",
    short: "CGH",
    distance_miles: 6.4,
    eta_minutes: 14,
    trauma_level: 2,
    stroke_center: true,
    cath_lab: false,
    ct: true,
    icu: true,
    services: "Level II Trauma · Stroke Ready · General Surgery · CT",
    units: {
      ed: { label: "Emergency", total: 28, open: 6, occupancy_pct: 79, level: "open" },
      icu: { label: "Intensive Care", total: 16, open: 2, occupancy_pct: 88, level: "limited" },
      inpatient: { label: "Inpatient Wards", total: 80, open: 12, occupancy_pct: 85, level: "open" },
      or: { label: "OR", total: 4, open: 1, occupancy_pct: 75, level: "open" },
    },
    ed_wait_min: 22,
    ems_status: "accepting",
    eligible: true,
  },
  {
    name: "Metro Heart & Vascular Center",
    short: "MHV",
    distance_miles: 8.1,
    eta_minutes: 18,
    trauma_level: 0,
    stroke_center: false,
    cath_lab: true,
    ct: true,
    icu: true,
    services: "Cardiovascular Specialty · STEMI Receiving · 3 Cath Labs",
    units: {
      ed: { label: "Emergency", total: 14, open: 4, occupancy_pct: 71, level: "open" },
      icu: { label: "Cardiac ICU", total: 18, open: 5, occupancy_pct: 72, level: "open" },
      inpatient: { label: "Cardiac Ward", total: 60, open: 10, occupancy_pct: 83, level: "open" },
      or: { label: "Hybrid OR", total: 3, open: 1, occupancy_pct: 67, level: "open" },
    },
    ed_wait_min: 15,
    ems_status: "accepting",
    eligible: true,
  },
  {
    name: "St. Jude Regional Medical",
    short: "SJR",
    distance_miles: 11.5,
    eta_minutes: 24,
    trauma_level: 3,
    stroke_center: false,
    cath_lab: false,
    ct: true,
    icu: true,
    services: "Community Emergency · Urgent Observation",
    units: {
      ed: { label: "Emergency", total: 18, open: 2, occupancy_pct: 89, level: "limited" },
      icu: { label: "ICU", total: 8, open: 0, occupancy_pct: 100, level: "full" },
      inpatient: { label: "Medical Ward", total: 45, open: 4, occupancy_pct: 91, level: "limited" },
      or: { label: "OR", total: 2, open: 0, occupancy_pct: 100, level: "full" },
    },
    ed_wait_min: 40,
    ems_status: "diverting",
    eligible: false,
  },
];

// No active runs auto-spawned. Only past completed history is seeded once if empty.
const INITIAL_PAST_RUNS = [
  {
    id: "hist-4870",
    code: "RUN-4870",
    unit: "Medic 4",
    agency: "Metro Fire Rescue",
    destination: "HIP Medical Center",
    esi: 3,
    complaint: "Abdominal pain / GI bleed",
    complaint_label: "Abdominal pain / GI bleed",
    zone: "West / Zone 3",
    patient_name: "David Miller",
    age: 51,
    gender: "MALE",
    status: "handed_off",
    bed_id: null,
    needs: ["Cardiac monitor"],
    vitals: { heart_rate: 88, systolic: 120, diastolic: 78, spo2: 98, respiratory_rate: 16, gcs: 15 },
    created_at: new Date(Date.now() - 3600000).toISOString(),
    eta_at: new Date(Date.now() - 2400000).toISOString(),
    eta_seconds: 0,
    handed_off_at: new Date(Date.now() - 2100000).toISOString(),
    offload_seconds: 720,
    route: { from: { x: 10, y: 48 }, to: { x: 47, y: 44 } },
  },
];

export function getEmsRuns(activeOnly = null) {
  let runs = [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY_EMS);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        // Strip out any stale dummy seeded runs (101, 102, or RESUS-1)
        runs = parsed.filter(
          (r) => r && r.id !== 101 && r.id !== 102 && r.bed_id !== "RESUS-1"
        );
      }
    } else {
      // First run: only seed past history, NEVER auto-seed active pending/accepted ambulances
      runs = [...INITIAL_PAST_RUNS];
      saveEmsRuns(runs);
    }
  } catch {}

  const now = Date.now();
  // Strictly deduplicate by run.id
  const seen = new Set();
  const clean = [];
  for (const r of runs) {
    if (!r || !r.id) continue;
    const key = String(r.id);
    if (!seen.has(key)) {
      seen.add(key);
      const etaMillis = r.eta_at ? new Date(r.eta_at).getTime() - now : 0;
      clean.push({
        ...r,
        eta_seconds: Math.max(0, Math.round(etaMillis / 1000)),
      });
    }
  }

  if (activeOnly === true) {
    return clean.filter((r) => ["pending", "accepted", "arrived"].includes(r.status));
  }
  if (activeOnly === false) {
    return clean.filter((r) => ["handed_off", "diverted"].includes(r.status));
  }
  return clean;
}

export function saveEmsRuns(runs) {
  try {
    localStorage.setItem(STORAGE_KEY_EMS, JSON.stringify(runs));
  } catch {}
}

export function createEmsRun(body) {
  const runs = getEmsRuns();
  const etaMin = Number(body.etaMinutes) || 8;
  const now = Date.now();
  const newRun = {
    id: body.id || `ems-${now}`,
    code: body.code || `RUN-${Math.floor(1000 + Math.random() * 9000)}`,
    unit: body.unit || "Medic 12",
    agency: body.agency || "Metro Region EMS",
    destination: "HIP Medical Center",
    esi: Number(body.esi) || 2,
    complaint: body.complaint || "Emergent assessment",
    complaint_label: body.complaint_label || body.complaint || "Emergent assessment",
    zone: body.zone || "Metro Zone 4",
    patient_name: body.patientName || body.patient_name || "Unknown Patient",
    age: body.age ?? 45,
    gender: body.gender || "MALE",
    status: body.status || (body.bedCode || body.bed_id ? "accepted" : "pending"),
    bed_id: body.bedCode || body.bed_id || null,
    needs: body.needs || [],
    vitals: body.vitals || { heart_rate: 80, systolic: 120, diastolic: 80, spo2: 98, respiratory_rate: 16, gcs: 15 },
    created_at: new Date(now).toISOString(),
    eta_at: body.eta_at || new Date(now + etaMin * 60000).toISOString(),
    eta_seconds: etaMin * 60,
    summary: body.summary || `${body.complaint || "EMS Inbound"} · ESI ${body.esi || 2} · ${body.agency || "EMS"}`,
    route: { from: { x: 30, y: 30 }, to: { x: 47, y: 44 } },
  };

  const updated = [newRun, ...runs.filter((r) => String(r.id) !== String(newRun.id))];
  saveEmsRuns(updated);
  window.dispatchEvent(new CustomEvent("hip:ems-updated", { detail: newRun }));
  return newRun;
}

export function acceptEmsRun(runId, bedId) {
  const runs = getEmsRuns();
  const target = runs.find((r) => String(r.id) === String(runId));
  if (target) {
    target.status = "accepted";
    target.responded_at = new Date().toISOString();
    if (bedId) target.bed_id = bedId;
    saveEmsRuns(runs);
    window.dispatchEvent(new CustomEvent("hip:ems-updated", { detail: target }));
    return target;
  }
  return null;
}

export function divertEmsRun(runId, to = "County General Hospital") {
  const runs = getEmsRuns();
  const target = runs.find((r) => String(r.id) === String(runId));
  if (target) {
    target.status = "diverted";
    target.diverted_to = to;
    target.responded_at = new Date().toISOString();
    saveEmsRuns(runs);
    window.dispatchEvent(new CustomEvent("hip:ems-updated", { detail: target }));
    return target;
  }
  return null;
}

export function handoffEmsRun(runId) {
  const runs = getEmsRuns();
  const target = runs.find((r) => String(r.id) === String(runId));
  if (target) {
    target.status = "handed_off";
    target.handed_off_at = new Date().toISOString();
    target.offload_seconds = Math.max(
      60,
      Math.round((Date.now() - new Date(target.created_at || Date.now()).getTime()) / 1000)
    );
    saveEmsRuns(runs);
    window.dispatchEvent(new CustomEvent("hip:ems-updated", { detail: target }));
    return target;
  }
  return null;
}

export function getEmsSummary() {
  const runs = getEmsRuns();
  const active = runs.filter((r) => ["pending", "accepted", "arrived"].includes(r.status));
  const waiting = runs.filter((r) => r.status === "pending");
  const handedOff = runs.filter((r) => r.status === "handed_off");
  const avgOffload = handedOff.length
    ? Math.round(handedOff.reduce((acc, r) => acc + (r.offload_seconds || 840), 0) / handedOff.length)
    : 840;

  return {
    open_ed_beds: 9,
    active_runs: active.length,
    en_route: active.length,
    waiting_runs: waiting.length,
    pending: waiting.length,
    diverted_runs: runs.filter((r) => r.status === "diverted").length,
    avg_offload_seconds: avgOffload,
    arrivals_today: 14 + handedOff.length,
    arrivals_24h: 14 + handedOff.length,
  };
}

export function getEmsStatus() {
  return {
    ems_status: "accepting",
    reason: null,
    updated_at: new Date().toISOString(),
    active_protocol: "Standard Trauma / ESI Protocol v2.4",
  };
}

export function getRegionalRoute(esi = 2, complaint = "general", zone = "Downtown") {
  const options = REGIONAL_HOSPITALS.map((h, i) => ({
    hospital: h.name,
    short: h.short,
    eligible: h.eligible,
    distance_miles: h.distance_miles,
    eta_minutes: h.eta_minutes,
    open_ed: h.units.ed.open,
    open_icu: h.units.icu.open,
    score: Math.max(98 - i * 12, 50),
    reason: h.eligible ? "Full capability match ready" : "Currently on partial diversion",
  }));
  return { esi, complaint, zone, options };
}

export function getRegionalAvailability() {
  return {
    region: "Metro Emergency Health Network",
    hospitals: REGIONAL_HOSPITALS,
    updated_at: new Date().toISOString(),
  };
}

export function getRegionalTraffic() {
  const runs = getEmsRuns(true);
  return { ambulances: runs };
}

export function getStaffRoster() {
  return [
    { id: 1, name: "Dr. Jonah Okonkwo", role: "Attending", department: "EMERGENCY", status: "ON_DUTY" },
    { id: 2, name: "RN Elena Brooks", role: "Charge Nurse", department: "EMERGENCY", status: "ON_DUTY" },
    { id: 3, name: "Dr. Leena Patel", role: "Intensivist", department: "ICU", status: "ON_DUTY" },
    { id: 4, name: "RN Chris Novak", role: "ICU Specialist", department: "ICU", status: "ON_DUTY" },
  ];
}

export function getTransfersList() {
  return [
    { id: 1, patient: "Sarah Connor", from: "St. Jude Clinic", to: "HIP ED-105", priority: "URGENT", status: "EN_ROUTE" },
  ];
}

export function getOpsData() {
  return {
    activeCleans: 2,
    dischargesPending: 3,
    waitingInbound: 2,
    edBoardingTimeMin: 18,
    status: "STABLE",
  };
}

const STORAGE_KEY_FLOW = "hip_patient_flow";

export function getPatientFlow() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_FLOW);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { admit: 16, discharge: 19, transfer: 3 };
}

export function recordPatientAdmit() {
  const flow = getPatientFlow();
  flow.admit = (flow.admit || 0) + 1;
  try {
    localStorage.setItem(STORAGE_KEY_FLOW, JSON.stringify(flow));
  } catch {}
  window.dispatchEvent(new CustomEvent("hip:flow-updated", { detail: flow }));
  return flow;
}

export function recordPatientDischarge() {
  const flow = getPatientFlow();
  flow.discharge = (flow.discharge || 0) + 1;
  try {
    localStorage.setItem(STORAGE_KEY_FLOW, JSON.stringify(flow));
  } catch {}
  window.dispatchEvent(new CustomEvent("hip:flow-updated", { detail: flow }));
  return flow;
}

export function getInsightsData() {
  const flow = getPatientFlow();
  const points = [];
  for (let i = 12; i >= 0; i--) {
    points.push({
      minute: i * 10,
      ed_occupancy: 68 + Math.round(Math.sin(i) * 8),
      icu_occupancy: 78 + Math.round(Math.cos(i) * 5),
      arrivals: Math.max(1, Math.round(3 + Math.sin(i) * 2)),
    });
  }
  return {
    bucket_minutes: 10,
    points,
    totals: {
      admit: flow.admit,
      admissions: flow.admit,
      discharge: flow.discharge,
      discharges: flow.discharge,
      transfer: flow.transfer,
      transfers: flow.transfer,
      arrivals: 24,
    },
  };
}

export function getAiBriefing() {
  return "HIP Clinical Command Center: Hospital capacity is green across ED and Inpatient floors. Active EMS pre-alerts en route with trauma bay staged. Cath lab is operational on Standby A.";
}

export function queryClinicalCopilot(message, beds = []) {
  const query = (message || "").toLowerCase();
  let freeEd = 0;
  let freeIcu = 0;
  if (Array.isArray(beds)) {
    freeEd = beds.filter((b) => (b.department || "").toUpperCase().includes("EMERG") && (b.status || "").toUpperCase() === "AVAILABLE").length;
    freeIcu = beds.filter((b) => (b.department || "").toUpperCase().includes("ICU") && (b.status || "").toUpperCase() === "AVAILABLE").length;
  }

  if (query.includes("bed") || query.includes("capacity")) {
    return `Current Capacity: Emergency Department has ${freeEd || 9} available beds. Intensive Care (ICU) has ${freeIcu || 4} available beds.`;
  }
  if (query.includes("ambulance") || query.includes("ems")) {
    const runs = getEmsRuns(true);
    return `Inbound EMS Status: There are currently ${runs.length} active ambulances en route to HIP Medical Center.`;
  }
  return "Clinical Copilot: Hospital bed status is stable. Emergency and ICU beds are accepting patients.";
}
