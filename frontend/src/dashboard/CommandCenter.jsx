import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import ElevatorPanel from "./ElevatorPanel";
import FloorPlan from "./FloorPlan";
import ChatPanel from "./ChatPanel";
import {
  NURSE_LOAD,
  formatEta,
  turnoverPlan,
  earlyWarning,
  stayLabel,
} from "./insights";
import {
  BUILDING,
  FRAME,
  SPACE_FILTERS,
  STATUS,
  applyCensus,
  buildHospital,
  findRooms,
  spaceBucket,
  summarize,
} from "./floors";
import { api } from "../lib/api";
import {
  getEmsRuns,
  createEmsRun,
  acceptEmsRun,
  divertEmsRun,
  handoffEmsRun,
  getEmsSummary,
  getEmsStatus,
  getRegionalAvailability,
  getStaffRoster,
  getTransfersList,
  getOpsData,
  getInsightsData,
  getAiBriefing,
  recordPatientAdmit,
  recordPatientDischarge,
} from "./emsService";
import { buildLiveOps, incidentsFromCensus } from "./liveOps";
import AmbulancesTab from "./AmbulancesTab";
import EmsCallIntakeModal from "./EmsCallIntakeModal";
import RegisterBedModal from "./RegisterBedModal";
import { AppNav } from "./AppBar";
import OpenDataTab from "./OpenDataTab";
import OverviewTab from "./OverviewTab";
import { roomPhoto } from "./roomPhotos";
import { loadSnapshot, saveSnapshot } from "./snapshot";
import NotificationsPanel, { desktopAlertsOn, lastSeenActivity, latestActivityId } from "./NotificationsPanel";
import AiMark from "./AiMark";
import { ESI, countdown } from "./network/ems";
import { EtaTrack, floorRows, localBriefing } from "./ui";
import "./dashboard.css";
import "./exec.css";
import "./ems.css";
import "./showcase.css";
import logo from "./logo.png";

const SFX_BY_DEPARTMENT = {
  icu: "Intesive Care.mp3",
  surgery: "Surgery.mp3",
  imaging: "Radiology.mp3",
  ed: "Emergency&Trauma.mp3",
  trauma: "Emergency&Trauma.mp3",
  med: "Clinic.mp3",
  surgward: "Surgery.mp3",
  pacu: "Support&Recovery.mp3",
  pharmacy: "Clinic.mp3",
  waiting: "Waiting(cut).mp3",
  outpatient: "Clinic.mp3",
  support: "Support&Recovery.mp3",
  nurse: "Staff(cut).mp3",
  spd: "Surgery.mp3",
  storage: "Storage.mp3",
  morgue: "Storage.mp3",
  mechanical: "Storage.mp3",
  dock: "Storage.mp3",
  clinic: "Clinic.mp3",
  admin: "Admin.mp3",
  conference: "Conference.mp3",
};

const SFX_BY_ROOM_ID = {
  REG: "Registration.mp3",
  ADMIN: "Trump.mp3",
};

const AMBIENT_BY_TYPE = {
  Restroom: null,
  Equipment: "Storage.mp3",
  "Clean utility": "Storage.mp3",
  "Soiled utility": "Storage.mp3",
  Linen: "Storage.mp3",
  "Sterile core": "Surgery.mp3",
  Decontamination: "Surgery.mp3",
  "Prep and pack": "Surgery.mp3",
  "Sterile storage": "Surgery.mp3",
  "Ambulance bay": "Emergency&Trauma.mp3",
  "Resuscitation support": "Emergency&Trauma.mp3",
  "Stat lab": "Clinic.mp3",
};

function sfxForRoom(room) {
  if (SFX_BY_ROOM_ID[room.id]) return SFX_BY_ROOM_ID[room.id];
  if (Object.prototype.hasOwnProperty.call(AMBIENT_BY_TYPE, room.type)) return AMBIENT_BY_TYPE[room.type];
  return SFX_BY_DEPARTMENT[room.dept] || null;
}

function Icon({ name }) {
  const common = {
    width: 20,
    height: 20,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
  };
  if (name === "search") {
    return (
      <svg {...common}>
        <circle cx="11" cy="11" r="7" />
        <path d="M20 20l-3-3" />
      </svg>
    );
  }
  if (name === "bell") {
    return (
      <svg {...common}>
        <path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4l2-2z" />
        <path d="M10 19a2 2 0 0 0 4 0" />
      </svg>
    );
  }
  return null;
}

function esiFor(status) {
  if (status === "critical") return "ESI 1 · Immediate";
  if (status === "warning") return "ESI 2 · Emergent";
  if (status === "normal") return "ESI 3 · Urgent";
  return "—";
}

function vitalsFor(room) {
  if (room?.heartRate == null) return null;
  const temp = room.temperature == null ? "—" : `${(room.temperature / 10).toFixed(1)}°C`;
  const pressure = room.systolic != null && room.diastolic != null
    ? `${room.systolic}/${room.diastolic}`
    : "—";
  return {
    hr: String(room.heartRate),
    bp: pressure,
    spo2: room.spo2 == null ? "—" : `${room.spo2}%`,
    rr: room.respiratoryRate == null ? "—" : String(room.respiratoryRate),
    temp,
  };
}

function historyFor(room, movements = []) {
  return (movements || [])
    .filter((item) => item.room_id === room.id || (room.patient && item.patient_name === room.patient))
    .slice(0, 12)
    .map((item) => {
      const stamp = item.created_at ? new Date(item.created_at) : null;
      const time = stamp && !Number.isNaN(stamp.getTime())
        ? stamp.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
        : "—";
      const tag = item.patient_name && item.patient_name !== room.patient
        ? item.patient_name
        : "Census";
      return { time, text: item.message, tag };
    });
}

function minutesLeft(ticks) {
  if (ticks == null) return "—";
  if (ticks <= 0) return "Finished";
  const seconds = ticks * 9;
  if (seconds < 60) return "Under a minute";
  const minutes = Math.max(1, Math.round(seconds / 60));
  return minutes === 1 ? "About 1 min" : `About ${minutes} min`;
}

function severityWord(status) {
  if (status === "critical") return "Critical";
  if (status === "warning") return "Watch";
  return "Stable";
}

// Theatre phases by share of the case done; the case ends when the census moves the patient out.
const SURGERY_PHASES = [
  { until: 0.12, label: "Induction" },
  { until: 0.8, label: "Operating" },
  { until: 0.95, label: "Closing" },
  { until: 1.01, label: "Recovery" },
];

// What is being done to the patient at this moment, from care_activities in the live database.
function NowDoing({ room, now }) {
  if (!room.patient || !room.activity) return null;
  const started = room.activityStartedAt ? new Date(room.activityStartedAt).getTime() : now;
  const share = Math.min(0.99, Math.max(0, (now - started) / Math.max(60000, (room.activityMinutes || 1) * 60000)));
  const since = new Date(started).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (room.activityKind === "surgery") {
    const current = SURGERY_PHASES.findIndex((phase) => share < phase.until);
    return (
      <section className="rc-now is-surgery" aria-label="Surgery in progress">
        <header>
          <span className="rc-now-live"><i />Surgery in progress</span>
          <small>since {since}</small>
        </header>
        <strong>{room.activity}</strong>
        <p>{[room.physician && `Surgeon ${room.physician}`, room.nurse && `Nurse ${room.nurse.replace(/^RN /, "")}`].filter(Boolean).join(" · ")}</p>
        <div className="rc-now-bar" role="progressbar" aria-valuenow={Math.round(share * 100)} aria-valuemin={0} aria-valuemax={100}>
          <i style={{ width: `${share * 100}%` }} />
        </div>
        <ol className="rc-now-phases">
          {SURGERY_PHASES.map((phase, index) => (
            <li key={phase.label} className={index < current ? "is-done" : index === current ? "is-now" : ""}>{phase.label}</li>
          ))}
        </ol>
      </section>
    );
  }
  return (
    <section className="rc-now" aria-label="Right now">
      <header>
        <span className="rc-now-live is-care"><i />Right now</span>
        <small>
          {room.activitySteps > 1 ? `Step ${room.activityStep + 1} of ${room.activitySteps} · ` : ""}since {since}
        </small>
      </header>
      <strong>{room.activity}</strong>
      <div className="rc-now-bar" role="progressbar" aria-valuenow={Math.round(share * 100)} aria-valuemin={0} aria-valuemax={100}>
        <i style={{ width: `${share * 100}%` }} />
      </div>
    </section>
  );
}

function dispositionFor(room, surgeOn) {
  if (room.kind === "or") return "Recovery after surgery";
  if (room.needsOr) return "Needs OR";
  if (room.status === "critical" || room.status === "warning") return "Must stay";
  const emergency = room.dept === "ed" || room.dept === "trauma";
  if (emergency && surgeOn) return "Divert candidate";
  if (room.status === "normal") return "Ready for discharge";
  return "Must stay";
}

function cleaningBrief(room) {
  const cleanOpen = (room.ticksLeft ?? 1) > 0;
  const linenOut = Boolean(room.linenStage) && room.linenStage !== "ready";
  if (cleanOpen && linenOut) {
    return {
      why: "Cleaning is not finished, and soiled linen is still out.",
      owner: room.housekeeper || "Unassigned",
      ready: minutesLeft(Math.max(room.ticksLeft || 0, room.linenTicks || 0)),
    };
  }
  if (cleanOpen) {
    return {
      why: "Cleaning has not finished.",
      owner: room.housekeeper || "Unassigned",
      ready: minutesLeft(room.ticksLeft),
    };
  }
  if (linenOut) {
    return {
      why: "The clean is finished, but the bed stays closed until clean linen arrives.",
      owner: room.linenAide || "Linen",
      ready: minutesLeft(room.linenTicks),
    };
  }
  return {
    why: "Cleaning is finished. The bed is waiting to be opened.",
    owner: room.housekeeper || "Housekeeping",
    ready: "Now",
  };
}

function situationFor(room, floor) {
  if (!room.census) {
    return {
      band: "Support",
      tone: "is-support",
      why: `${room.type || room.deptLabel} on ${floor.name}. This is not an inpatient bed.`,
    };
  }
  if (!room.status) {
    return {
      band: "Connecting",
      tone: "is-support is-loading",
      why: "Connecting to the live census. This bed fills in as soon as it reports.",
    };
  }
  if (room.patient) {
    const word = severityWord(room.status);
    return {
      band: "Occupied",
      detail: word,
      tone: room.status === "critical" ? "is-critical" : "is-occupied",
      why: `${room.patient} is ${word.toLowerCase()}. ${room.diagnosis || room.chiefComplaint || "Workup is in progress."}`,
    };
  }
  if (room.status === "cleaning") {
    const brief = cleaningBrief(room);
    const waiting = room.holdFor ? ` ${room.holdFor} is waiting for this bed.` : "";
    return {
      band: "Turnover",
      tone: "is-blocked",
      why: `${brief.why}${waiting}`,
      owner: brief.owner,
      ready: brief.ready,
    };
  }
  if (room.status === "reserved") {
    const ambulance = (room.holdFor || "").startsWith("EMS ");
    return {
      band: ambulance ? "Held for ambulance" : "Held",
      tone: "is-held",
      why: ambulance
        ? `Held for ${room.holdFor}. The crew is on the way; the bed is theirs when they arrive.`
        : `Held for ${room.holdFor || "a patient"}. Not usable until the hold is released.`,
    };
  }
  if (room.status === "blocked") {
    return {
      band: "Out of service",
      tone: "is-blocked",
      why: "This bed is out of service.",
    };
  }
  return {
    band: "Usable",
    tone: "is-usable",
    why: "Open for the next patient.",
  };
}

const CLEAN_LABEL = { standard: "Standard", terminal: "Terminal", stat: "STAT" };
const LINEN_LABEL = {
  pickup: "Soiled pickup",
  wash: "Wash",
  deliver: "Clean delivery",
  ready: "Sheets here",
};

function cleanLabel(type) {
  return CLEAN_LABEL[type] || "Standard";
}

function cleanQueue(hospital) {
  return hospital
    .flatMap((floor) => floor.rooms)
    .filter((room) => room.status === "cleaning" && !room.housekeeper && room.ticksLeft !== 0)
    .sort((a, b) => {
      const priority = (b.cleanPriority || 0) - (a.cleanPriority || 0);
      if (priority) return priority;
      const queued = (a.queuedTick || 0) - (b.queuedTick || 0);
      if (queued) return queued;
      return a.id.localeCompare(b.id);
    });
}

function keeperLabel(room, queuePlace) {
  if (room.housekeeper) return room.housekeeper;
  if (room.ticksLeft === 0) return "Clean done";
  return queuePlace ? `Queued #${queuePlace}` : "Queued";
}

function linenLabel(stage) {
  return LINEN_LABEL[stage] || "—";
}

function Meta({ label, children }) {
  return (
    <div className="meta-row">
      <span>{label}</span>
      <strong>{children}</strong>
    </div>
  );
}

function Stat({ tone, label, value }) {
  const displayVal = Number.isFinite(Number(value)) ? Number(value) : (value ?? 0);
  return (
    <div className="stat">
      <span className={`stat-dot ${tone}`} />
      <span>{label}</span>
      <strong>{displayVal}</strong>
    </div>
  );
}

// Polling beats: the census and ambulances every 2 s; slower lists every fifth beat (10 s).
const BEAT_MS = 2000;
const SLOW_EVERY = 5;

function snapshotAge(at, now) {
  const minutes = Math.max(0, Math.round((now - at) / 60000));
  return minutes < 1 ? "just now" : minutes < 60 ? `${minutes} min ago` : `${Math.round(minutes / 60)} h ago`;
}

function getInitialEmsRuns(bootRuns) {
  if (Array.isArray(bootRuns) && bootRuns.length > 0) return bootRuns;
  return getEmsRuns(true);
}

export default function CommandCenter({ user = null, onLogout = null }) {
  // Last known state from this browser: the first paint is instant while the API wakes up.
  const [boot] = useState(loadSnapshot);
  const [admitModalRoom, setAdmitModalRoom] = useState(null);
  const [admitPatientName, setAdmitPatientName] = useState("");
  const [admitDiagnosis, setAdmitDiagnosis] = useState("");
  const [admitEsi, setAdmitEsi] = useState("ESI 3");
  const [admitSubmitting, setAdmitSubmitting] = useState(false);
  const [emsCallModalOpen, setEmsCallModalOpen] = useState(false);
  const [registerBedModalOpen, setRegisterBedModalOpen] = useState(false);
  const [hospital, setHospital] = useState(() =>
    boot?.census?.rooms ? applyCensus(buildHospital(), boot.census.rooms) : buildHospital(),
  );
  const [incidents, setIncidents] = useState([]);
  const [ops, setOps] = useState(null);
  const [floorId, setFloorId] = useState("F1");
  const [selectedId, setSelectedId] = useState(null);
  const [hover, setHover] = useState(null);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [nav, setNav] = useState("overview");
  const [elevatorOpen, setElevatorOpen] = useState(false);
  const [surgeOn, setSurgeOn] = useState(false);
  const [roster, setRoster] = useState([]);
  const [movements, setMovements] = useState([]);
  const [flowLive, setFlowLive] = useState(false);
  const [flowSyncedAt, setFlowSyncedAt] = useState(null);
  const [bellOpen, setBellOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [spaceFilter, setSpaceFilter] = useState("all");
  const [summaryOpen, setSummaryOpen] = useState(true);
  const [syncTick, setSyncTick] = useState(() => Date.now());
  const [zoom, setZoom] = useState(1.25);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [fitToken, setFitToken] = useState(0);
  const mapRef = useRef(null);
  const stageRef = useRef(null);
  const sfxRef = useRef(null);
  const reloadRef = useRef(async () => { });
  const [tab, setTab] = useState("overview");
  const [insights, setInsights] = useState(null);
  const [briefing, setBriefing] = useState({ text: "", source: "rules", loading: false, at: 0 });
  const [toast, setToast] = useState("");
  const [now, setNow] = useState(() => new Date());

  const handleBroadcastAlert = useCallback((arg1, arg2 = "warning") => {
    let title = "";
    let message = "";
    if (typeof arg1 === "object" && arg1 !== null) {
      title = arg1.title || "Alert";
      message = arg1.message || "";
    } else {
      title = typeof arg2 === "string" ? arg2.toUpperCase() : "ALERT";
      message = String(arg1 || "");
    }
    setToast(`🚨 ${title ? `${title}: ` : ""}${message}`);
    setBellRinging(true);
    setTimeout(() => setBellRinging(false), 2500);

    try {
      const context = new (window.AudioContext || window.webkitAudioContext)();
      [784, 880, 988].forEach((pitch, index) => {
        const toneNode = context.createOscillator();
        const gain = context.createGain();
        toneNode.frequency.value = pitch;
        toneNode.type = "sine";
        gain.gain.setValueAtTime(0.0001, context.currentTime + index * 0.14);
        gain.gain.exponentialRampToValueAtTime(0.2, context.currentTime + index * 0.14 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + index * 0.14 + 0.28);
        toneNode.connect(gain).connect(context.destination);
        toneNode.start(context.currentTime + index * 0.14);
        toneNode.stop(context.currentTime + index * 0.14 + 0.3);
      });
      setTimeout(() => context.close(), 1200);
    } catch {
      // Audio optional
    }

    if (desktopAlertsOn()) {
      try {
        new window.Notification(title, {
          body: message,
          icon: "/logo.png",
          tag: "approaching-ambulance-alert",
        });
      } catch {
        // Notification optional
      }
    }
  }, []);

  const floor = hospital.find((level) => level.id === floorId) || hospital[2];
  const summary = useMemo(() => summarize(floor), [floor]);
  const spaceCounts = useMemo(() => {
    const counts = { all: 0, available: 0, occupied: 0, dirty: 0, cleaning: 0, reserved: 0, down: 0 };
    for (const room of floor.rooms) {
      if (!room.census) continue;
      counts.all += 1;
      const bucket = spaceBucket(room);
      if (bucket) {
        counts[bucket] = (counts[bucket] || 0) + 1;
      }
    }
    return counts;
  }, [floor]);
  const selected = floor.rooms.find((room) => room.id === selectedId) || null;
  const hits = useMemo(() => findRooms(hospital, query), [hospital, query]);
  const openIncidents = useMemo(() => incidents.filter((item) => item.status === "open"), [incidents]);
  const [actionBusy, setActionBusy] = useState("");
  const [emsRuns, setEmsRuns] = useState(() => getInitialEmsRuns(boot?.runs));
  const [emsSummary, setEmsSummary] = useState(() => boot?.summary || null);
  const [emsStatus, setEmsStatus] = useState(() => boot?.status || { ems_status: "accepting", reason: null });
  const [focusRunId, setFocusRunId] = useState(null);
  const [region, setRegion] = useState(() => boot?.region || []);
  const seenRuns = useRef(null);
  const roomIds = useMemo(
    () => new Set(hospital.flatMap((level) => level.rooms.map((room) => room.id))),
    [hospital],
  );
  const floors = useMemo(() => floorRows(hospital), [hospital]);
  const incoming = useMemo(
    () => emsRuns.filter((run) => (run.destination === "HIP Medical Center" || !run.destination) && ["pending", "accepted", "arrived"].includes(run.status)),
    [emsRuns],
  );
  const pendingRuns = useMemo(() => incoming.filter((run) => run.status === "pending"), [incoming]);
  const arrivedRuns = useMemo(() => incoming.filter((run) => run.status === "arrived"), [incoming]);
  // The badge counts what needs a person; the dot means there is activity nobody has looked at.
  const bellCount = openIncidents.length + pendingRuns.length + arrivedRuns.length;
  const [seenActivity, setSeenActivity] = useState(lastSeenActivity);
  const [bellRinging, setBellRinging] = useState(false);
  const unreadActivity = latestActivityId(movements) > seenActivity;
  const emsByRoom = useMemo(() => {
    const map = {};
    for (const run of incoming) {
      if (!run.bed_id || run.status === "pending") continue;
      const left = run.status === "arrived" ? "at bay" : countdown((new Date(run.eta_at).getTime() - syncTick) / 1000);
      map[run.bed_id] = { label: `🚑 ESI ${run.esi} · ${left}`, color: ESI[run.esi]?.color, run };
    }
    return map;
  }, [incoming, syncTick]);
  const emsBayActive = incoming.some((run) => run.status === "arrived");
  const [dbBeds, setDbBeds] = useState([]);

  const fetchDbBeds = useCallback(async () => {
    try {
      const beds = await api.getBeds();
      if (Array.isArray(beds) && beds.length > 0) {
        setDbBeds(beds);
        const roomSpecs = beds.map((b) => {
          let status = "available";
          if (b.status === "OCCUPIED") status = "occupied";
          else if (b.status === "RESERVED") status = "reserved";
          else if (b.status === "DIRTY") status = "dirty";
          else if (b.status === "CLEANING_IN_PROGRESS") status = "cleaning";
          else if (b.status === "MAINTENANCE") status = "blocked";

          return {
            id: b.bed_code,
            status,
            patient: b.patient_name || null,
            holdFor: b.patient_name || (b.status === "RESERVED" ? "EMS Inbound" : null),
            hold_for: b.patient_name || (b.status === "RESERVED" ? "EMS Inbound" : null),
            diagnosis: b.primary_diagnosis || b.notes || (b.status === "OCCUPIED" ? "Clinical Care" : null),
            acuity: b.status === "OCCUPIED" ? "normal" : (b.status === "RESERVED" ? (b.acuity_level ? b.acuity_level.replace("_", " ") : "ESI 3") : null),
          };
        });
        setHospital((current) => applyCensus(current, roomSpecs));
        saveSnapshot({ census: { rooms: roomSpecs } });
      }
    } catch {
      // Non-blocking fallback
    }
  }, []);

  useEffect(() => {
    fetchDbBeds();
    const timer = setInterval(fetchDbBeds, 4000);

    // Live WebSocket connection to bed events
    const token = sessionStorage.getItem("token") || localStorage.getItem("hip_access_token") || localStorage.getItem("token");
    let ws = null;
    let isMounted = true;
    if (token) {
      try {
        const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const wsHost = window.location.port === "5173" || window.location.port === "3000" ? "localhost:8080" : window.location.host;
        ws = new WebSocket(`${wsProtocol}//${wsHost}/ws/beds?token=${encodeURIComponent(token)}`);
        ws.onmessage = () => {
          if (isMounted) fetchDbBeds();
        };
        ws.onerror = () => {
          // Handled gracefully; interval polling ensures continuous sync
        };
      } catch { }
    }

    const handleSync = () => fetchDbBeds();
    window.addEventListener("hip:bed-updated", handleSync);
    window.addEventListener("hip:state-sync", handleSync);

    return () => {
      isMounted = false;
      clearInterval(timer);
      if (ws) {
        if (ws.readyState === WebSocket.OPEN) {
          try { ws.close(); } catch {}
        } else if (ws.readyState === WebSocket.CONNECTING) {
          ws.onopen = () => {
            try { ws.close(); } catch {}
          };
        }
      }
      window.removeEventListener("hip:bed-updated", handleSync);
      window.removeEventListener("hip:state-sync", handleSync);
    };
  }, [fetchDbBeds]);

  const homeCapacity = region.find((row) => row.name === "HIP Medical Center") || null;
  const effectiveCapacity = useMemo(() => {
    if (dbBeds && dbBeds.length > 0) {
      const edBeds = dbBeds.filter((b) => b.department === "EMERGENCY");
      const icuBeds = dbBeds.filter((b) => b.department === "ICU");
      const orBeds = dbBeds.filter((b) => b.department === "SURGERY");
      const inBeds = dbBeds.filter((b) => ["GENERAL", "MEDICINE", "GENERAL_WARD", "SURGICAL_WARD"].includes(b.department));

      const edOpen = edBeds.filter((b) => b.status === "AVAILABLE").length;
      const icuOpen = icuBeds.filter((b) => b.status === "AVAILABLE").length;
      const orOpen = orBeds.filter((b) => b.status === "AVAILABLE").length;
      const inOpen = inBeds.filter((b) => b.status === "AVAILABLE").length;

      return {
        name: "HIP Medical Center",
        units: {
          ed: {
            label: "Emergency / Trauma",
            total: edBeds.length,
            open: edOpen,
            occupancy_pct: Math.round(((edBeds.length - edOpen) / (edBeds.length || 1)) * 100),
            level: edOpen > 5 ? "open" : edOpen > 0 ? "limited" : "full",
          },
          icu: {
            label: "Intensive care",
            total: icuBeds.length,
            open: icuOpen,
            occupancy_pct: Math.round(((icuBeds.length - icuOpen) / (icuBeds.length || 1)) * 100),
            level: icuOpen > 2 ? "open" : icuOpen > 0 ? "limited" : "full",
          },
          inpatient: {
            label: "Inpatient beds",
            total: inBeds.length,
            open: inOpen,
            occupancy_pct: Math.round(((inBeds.length - inOpen) / (inBeds.length || 1)) * 100),
            level: inOpen > 5 ? "open" : inOpen > 0 ? "limited" : "full",
          },
          or: {
            label: "Operating rooms",
            total: orBeds.length,
            open: orOpen,
            occupancy_pct: Math.round(((orBeds.length - orOpen) / (orBeds.length || 1)) * 100),
            level: orOpen > 0 ? "open" : "full",
          },
        },
        ed_wait_min: 15,
      };
    }
    return homeCapacity;
  }, [dbBeds, homeCapacity]);

  let briefingText = "- Connecting to the live census.";
  if (briefing.source === "ai" && briefing.text) briefingText = briefing.text;
  else {
    briefingText = localBriefing({
      emsStatus,
      capacity: effectiveCapacity,
      incoming,
      totals: insights?.totals,
    });
  }
  const waitingClean = useMemo(() => cleanQueue(hospital), [hospital]);
  const queuePlace = useMemo(() => {
    const places = new Map();
    waitingClean.forEach((room, index) => places.set(room.id, index + 1));
    return places;
  }, [waitingClean]);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setSyncTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let stop = false;
    let beat = 0;
    let lastEventId = null;
    let inFlight = false;
    let simAvailable = true;

    // The census every beat; transfers, staff, ops and incidents change slowly and come every
    // fifth beat. Flow events are incremental: only what is newer than the last one we have.
    async function pull(force = false) {
      if ((document.hidden || inFlight) && !force) return;
      inFlight = true;
      try {
        let staffList = [];
        try {
          const dbStaff = await api.getStaff();
          if (Array.isArray(dbStaff) && dbStaff.length > 0) {
            staffList = dbStaff.map((s) => ({
              id: s.id,
              name: s.name,
              role: s.role,
              department: s.department || "GENERAL",
              status: s.status || "ON_DUTY",
            }));
          }
        } catch { }
        setRoster(staffList.length > 0 ? staffList : getStaffRoster());
        setOps(getOpsData());
        setIncidents([]);
        setMovements([
          { id: Date.now() - 3000, type: "admission", bed: "ED-102", detail: "Patient assigned from triage", timestamp: new Date(Date.now() - 3000).toISOString() },
          { id: Date.now() - 15000, type: "transfer", bed: "ICU-301", detail: "Transfer request from PACU", timestamp: new Date(Date.now() - 15000).toISOString() },
        ]);
        setFlowLive(true);
        setFlowSyncedAt(Date.now());
      } catch {
        if (!stop) setFlowLive(false);
      } finally {
        inFlight = false;
      }
    }

    function onVisible() {
      if (!document.hidden) pull(true);
    }

    pull(true);
    reloadRef.current = () => {
      pull(true);
      fetchDbBeds();
    };
    const timer = setInterval(pull, 6000);
    document.addEventListener("visibilitychange", onVisible);
    const onSync = () => pull(true);
    window.addEventListener("hip:bed-updated", onSync);
    window.addEventListener("hip:state-sync", onSync);
    return () => {
      stop = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("hip:bed-updated", onSync);
      window.removeEventListener("hip:state-sync", onSync);
    };
  }, []);

  useEffect(() => {
    function pullEms() {
      const activeRuns = getEmsRuns(true);
      setEmsRuns(activeRuns);
      setEmsStatus(getEmsStatus());
      setEmsSummary(getEmsSummary());
      setRegion(getRegionalAvailability().hospitals);
      saveSnapshot({
        runs: activeRuns,
        status: getEmsStatus(),
        summary: getEmsSummary(),
        region: getRegionalAvailability().hospitals,
      });
    }
    pullEms();
    const timer = setInterval(pullEms, 3000);
    window.addEventListener("hip:ems-updated", pullEms);
    return () => {
      clearInterval(timer);
      window.removeEventListener("hip:ems-updated", pullEms);
    };
  }, []);

  // Two-tone chime when a new pre-alert arrives (existing room sounds are untouched).
  useEffect(() => {
    const ids = new Set(pendingRuns.map((run) => run.id));
    if (seenRuns.current === null) {
      seenRuns.current = ids;
      return;
    }
    const freshRuns = pendingRuns.filter((run) => !seenRuns.current.has(run.id));
    const fresh = freshRuns.length > 0;
    seenRuns.current = ids;
    if (!fresh) return;
    setBellRinging(true);
    setTimeout(() => setBellRinging(false), 1400);
    if (document.hidden && desktopAlertsOn()) {
      for (const run of freshRuns.slice(0, 3)) {
        try {
          const alert = new window.Notification(`New pre-alert · ESI ${run.esi} ${run.complaint_label}`, {
            body: `${run.unit} · ${run.agency} · ETA ${countdown(run.eta_seconds)}. Waiting for our answer.`,
            icon: "/logo.png",
            tag: `run-${run.id}`,
          });
          alert.onclick = () => {
            window.focus();
            setFocusRunId(run.id);
            setNav("ambulances");
            alert.close();
          };
        } catch {
          // Desktop alerts are optional.
        }
      }
    }
    try {
      const context = new (window.AudioContext || window.webkitAudioContext)();
      [880, 660].forEach((pitch, index) => {
        const tone = context.createOscillator();
        const gain = context.createGain();
        tone.frequency.value = pitch;
        tone.type = "sine";
        gain.gain.setValueAtTime(0.0001, context.currentTime + index * 0.18);
        gain.gain.exponentialRampToValueAtTime(0.18, context.currentTime + index * 0.18 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + index * 0.18 + 0.3);
        tone.connect(gain).connect(context.destination);
        tone.start(context.currentTime + index * 0.18);
        tone.stop(context.currentTime + index * 0.18 + 0.32);
      });
      setTimeout(() => context.close(), 900);
    } catch {
      // Audio is optional.
    }
  }, [pendingRuns]);

  useEffect(() => {
    const syncInsights = () => setInsights(getInsightsData());
    syncInsights();
    window.addEventListener("hip:flow-updated", syncInsights);
    window.addEventListener("hip:bed-updated", syncInsights);
    return () => {
      window.removeEventListener("hip:flow-updated", syncInsights);
      window.removeEventListener("hip:bed-updated", syncInsights);
    };
  }, []);

  // Each tab opens at the top instead of inheriting the last tab's scroll.
  useEffect(() => {
    stageRef.current?.scrollTo({ top: 0 });
  }, [nav]);

  async function refreshBriefing() {
    setBriefing((current) => ({ ...current, loading: true }));
    try {
      const text = getAiBriefing();
      if (text) {
        setBriefing({ text, source: "ai", loading: false, at: Date.now() });
        return;
      }
    } catch {
      // Fall through to the computed briefing.
    }
    setBriefing({ text: "", source: "rules", loading: false, at: Date.now() });
  }

  useEffect(() => {
    if (nav === "overview" && Date.now() - briefing.at > 120000 && !briefing.loading) refreshBriefing();
    // Only re-check when the executive lands on the overview.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav]);

  useEffect(() => {
    function onKey(event) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
      if (event.key === "Escape") {
        setElevatorOpen(false);
        setSearchOpen(false);
        setBellOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function frameRoom(room, nextZoom = zoom) {
    const viewW = FRAME.w / nextZoom;
    const viewH = FRAME.h / nextZoom;
    setPan({
      x: room.x + room.w / 2 - viewW / 2 - FRAME.x,
      y: room.y + room.h / 2 - viewH / 2 - FRAME.y,
    });
  }

  function goToFloor(id) {
    setFloorId(id);
    setSelectedId(null);
    setElevatorOpen(false);
    setHover(null);
    setSummaryOpen(true);
    setFitToken((token) => token + 1);
    setNav("live");
  }

  function playRoomSfx(id) {
    const room = floor.rooms.find((item) => item.id === id);
    if (!room) return;

    const filename = sfxForRoom(room);
    if (!filename) return;

    sfxRef.current?.pause();
    const audio = new Audio(`/sfx/${filename}`);
    sfxRef.current = audio;
    if (filename.includes("(cut)")) {
      audio.addEventListener("timeupdate", () => {
        if (audio.currentTime >= 10) audio.pause();
      });
    }
    audio.play().catch(() => { });
  }

  function openHit(hit) {
    setFloorId(hit.floor.id);
    setSelectedId(hit.room.id);
    setNav("live");
    setElevatorOpen(false);
    setSearchOpen(false);
    setQuery(hit.room.id);
    setTab("overview");
    frameRoom(hit.room);
  }

  function chooseNav(id) {
    setElevatorOpen(false);
    setSearchOpen(false);
    setBellOpen(false);
    if (id === "live" && nav !== "live") {
      setSummaryOpen(true);
      setFitToken((token) => token + 1);
    }
    setNav(id);
  }

  // One request at a time; the result is shown on the map as a toast.
  async function runStep(key, work) {
    if (actionBusy) return false;
    setActionBusy(key);
    try {
      const message = await work();
      setToast(message);
      return true;
    } catch (error) {
      setToast(error.message);
      return false;
    } finally {
      setActionBusy("");
    }
  }

  async function emsAction(path, body) {
    let result = {};
    if (path.includes("/accept")) {
      const parts = path.split("/");
      const runId = parts[parts.indexOf("runs") + 1];
      result = acceptEmsRun(runId, body?.bed_id) || {};
    } else if (path.includes("/divert")) {
      const parts = path.split("/");
      const runId = parts[parts.indexOf("runs") + 1];
      result = divertEmsRun(runId, body?.to) || {};
    } else if (path.includes("/handoff")) {
      const parts = path.split("/");
      const runId = parts[parts.indexOf("runs") + 1];
      result = handoffEmsRun(runId) || {};
    } else {
      result = createEmsRun(body || {}) || {};
    }

    setEmsRuns(getEmsRuns(true));
    setEmsSummary(getEmsSummary());
    if (reloadRef.current) {
      await reloadRef.current().catch(() => {});
    }
    return result;
  }

  function acceptRun(run, bedId) {
    let targetBed = bedId || run.bed_id;
    if (!targetBed && Array.isArray(dbBeds)) {
      const free = dbBeds.find((b) => (b.status || "").toUpperCase() === "AVAILABLE");
      if (free) targetBed = free.bed_code;
    }
    return runStep(`accept:${run.id}`, async () => {
      // 1. Place hold via bed API only if targetBed exists in PostgreSQL
      if (targetBed) {
        const isDbBed = Array.isArray(dbBeds) && dbBeds.some((b) => b.bed_code === targetBed);
        if (isDbBed) {
          try {
            const patient = await api.registerPatient({
              name: run.patient_name?.trim() || `EMS Unknown (${run.unit || "Unit"})`,
              gender: "OTHER",
              age: run.age ? Number(run.age) : 35,
            });
            await api.updateBedStatus(targetBed, "RESERVED", {
              patient_id: patient.patient_id,
              acuity_level: `ESI_${run.esi || 3}`,
              primary_diagnosis: run.complaint || "EMS Inbound",
              notes: `EMS Run ${run.code}: ${run.unit} (${run.agency})`,
            });
          } catch (e) {
            console.warn("Could not sync bed hold to database in acceptRun:", e);
          }
        }
      }

      const data = await emsAction(`/api/ems/runs/${run.id}/accept`, { bed_id: targetBed }).catch(() => ({
        unit: run.unit,
        bed_id: targetBed,
      }));

      setEmsRuns((prev) =>
        prev.map((r) => (r.id === run.id ? { ...r, status: "accepted", bed_id: targetBed } : r))
      );

      if (targetBed) {
        setHospital((current) =>
          current.map((fl) => ({
            ...fl,
            rooms: fl.rooms.map((rm) =>
              rm.id === targetBed
                ? {
                  ...rm,
                  status: "reserved",
                  holdFor: run.patient_name || `EMS ${run.unit}`,
                  hold_for: run.patient_name || `EMS ${run.unit}`,
                  diagnosis: run.complaint || "EMS Inbound",
                  acuity: `ESI ${run.esi || 3}`,
                }
                : rm
            ),
          }))
        );
        await fetchDbBeds();
        window.dispatchEvent(new CustomEvent("hip:bed-updated"));
      }

      return `${data.unit || run.unit} accepted. Bed ${targetBed} is held on the live map.`;
    });
  }

  function divertRun(run, to) {
    const bedCode = run.bed_id;
    return runStep(`divert:${run.id}`, async () => {
      // If the diverted ambulance had a held bed in DB, release it directly to AVAILABLE
      if (bedCode) {
        const isDbBed = Array.isArray(dbBeds) && dbBeds.some((b) => b.bed_code === bedCode);
        if (isDbBed) {
          try {
            await api.cancelBedHold(bedCode);
          } catch (e) {
            try {
              await api.adminUpdateBedStatus(bedCode, "AVAILABLE");
            } catch { }
          }
        }
      }

      const data = await emsAction(`/api/ems/runs/${run.id}/divert`, { to }).catch(() => ({
        unit: run.unit,
        diverted_to: to || "Partner Hospital",
      }));

      setEmsRuns((prev) =>
        prev.map((r) =>
          r.id === run.id
            ? { ...r, status: "diverted", diverted_to: to || "Partner Hospital", bed_id: null }
            : r
        )
      );

      if (bedCode) {
        setHospital((current) =>
          current.map((fl) => ({
            ...fl,
            rooms: fl.rooms.map((rm) =>
              rm.id === bedCode
                ? { ...rm, status: "available", holdFor: null, hold_for: null, patient: null, diagnosis: null, acuity: null }
                : rm
            ),
          }))
        );
        await fetchDbBeds();
        window.dispatchEvent(new CustomEvent("hip:bed-updated"));
      }

      return `${data.unit || run.unit} diverted to ${data.diverted_to || to || "partner"}. Bed ${bedCode ? bedCode + " " : ""}is clean and AVAILABLE.`;
    });
  }

  async function cancelHoldRun(run) {
    const bedCode = run?.bed_id;
    return runStep(`cancel-hold:${run?.id || bedCode}`, async () => {
      if (bedCode) {
        const isDbBed = Array.isArray(dbBeds) && dbBeds.some((b) => b.bed_code === bedCode);
        if (isDbBed) {
          try {
            await api.cancelBedHold(bedCode);
          } catch (err) {
            await api.adminUpdateBedStatus(bedCode, "AVAILABLE").catch(() => { });
          }
        }
      }

      if (run?.id) {
        divertEmsRun(run.id, "Hold Cancelled");
      }

      setEmsRuns((prev) =>
        prev.map((r) =>
          r.id === run?.id
            ? { ...r, status: "diverted", diverted_to: "Hold Cancelled", bed_id: null }
            : r
        )
      );

      if (bedCode) {
        setHospital((current) =>
          current.map((fl) => ({
            ...fl,
            rooms: fl.rooms.map((rm) =>
              rm.id === bedCode
                ? {
                  ...rm,
                  status: "available",
                  holdFor: null,
                  hold_for: null,
                  patient: null,
                  diagnosis: null,
                  acuity: null,
                }
                : rm
            ),
          }))
        );
      }

      await fetchDbBeds();
      window.dispatchEvent(new CustomEvent("hip:bed-updated"));
      return `Hold on Bed ${bedCode || "room"} cancelled. Bed is clean and AVAILABLE.`;
    });
  }

  async function cancelHoldByRoomId(roomId) {
    return runStep(`cancel-hold:${roomId}`, async () => {
      const isDbBed = Array.isArray(dbBeds) && dbBeds.some((b) => b.bed_code === roomId);
      if (isDbBed) {
        try {
          await api.cancelBedHold(roomId);
        } catch (err) {
          await api.adminUpdateBedStatus(roomId, "AVAILABLE").catch(() => { });
        }
      }

      const allActive = getEmsRuns(true);
      const matching = allActive.find((r) => r.bed_id === roomId);
      if (matching) {
        divertEmsRun(matching.id, "Hold Cancelled");
      }

      setEmsRuns((prev) =>
        prev.map((r) =>
          r.bed_id === roomId
            ? { ...r, status: "diverted", diverted_to: "Hold Cancelled", bed_id: null }
            : r
        )
      );

      setHospital((current) =>
        current.map((fl) => ({
          ...fl,
          rooms: fl.rooms.map((rm) =>
            rm.id === roomId
              ? {
                ...rm,
                status: "available",
                holdFor: null,
                hold_for: null,
                patient: null,
                diagnosis: null,
                acuity: null,
              }
              : rm
          ),
        }))
      );

      await fetchDbBeds();
      window.dispatchEvent(new CustomEvent("hip:bed-updated"));
      return `Hold on Room ${roomId} cancelled. Bed is clean and AVAILABLE.`;
    });
  }

  function handoffRun(run) {
    return runStep(`handoff:${run.id}`, async () => {
      const data = await emsAction(`/api/ems/runs/${run.id}/handoff`);
      return `${data.patient_name} is in ${data.bed_id}. Offload took ${data.offload_seconds ?? 0}s.`;
    });
  }

  function openRoomById(roomId) {
    for (const level of hospital) {
      const room = level.rooms.find((entry) => entry.id === roomId);
      if (room) {
        openHit({ floor: level, room });
        return;
      }
    }
  }

  async function dischargeRoom(roomId) {
    return runStep(`discharge:${roomId}`, async () => {
      await api.updateBedStatus(roomId, "DIRTY");
      recordPatientDischarge();
      await fetchDbBeds();
      window.dispatchEvent(new CustomEvent("hip:bed-updated"));
      return `Room ${roomId} discharged. Bed queued for sanitization.`;
    });
  }

  async function completeCleanRoom(roomId) {
    return runStep(`clean:${roomId}`, async () => {
      await api.adminUpdateBedStatus(roomId, "AVAILABLE");
      await fetchDbBeds();
      window.dispatchEvent(new CustomEvent("hip:bed-updated"));
      return `Room ${roomId} sanitization complete. Marked AVAILABLE.`;
    });
  }

  async function handleHoldBedFromEms(data) {
    const hasBed = Boolean(data.bedCode);
    const actionKey = hasBed ? `hold:${data.bedCode}` : `prealert:${Date.now()}`;

    const ok = await runStep(actionKey, async () => {
      let patientId = null;
      if (hasBed) {
        // 1. Establish registered patient identity to get valid patient_id
        const patient = await api.registerPatient({
          name: data.patientName?.trim() || `Unknown EMS (${data.unit || 'Unit'})`,
          gender: data.gender || "OTHER",
          age: data.age ? Number(data.age) : 35,
        });

        if (!patient || !patient.patient_id) {
          throw new Error("Unable to establish patient record for bed reservation.");
        }
        patientId = patient.patient_id;

        // 2. Place hold on the bed via Bed Service (transitions to RESERVED)
        await api.updateBedStatus(data.bedCode, "RESERVED", {
          patient_id: patientId,
          acuity_level: `ESI_${data.esi || 3}`,
          primary_diagnosis: data.complaint || "EMS Inbound Call",
          notes: `EMS Call: ${data.unit} (${data.agency}) · ${data.complaint}`,
        });

        // 3. Immediately transition the local hospital room to RESERVED / "Held"
        setHospital((current) =>
          current.map((fl) => ({
            ...fl,
            rooms: fl.rooms.map((rm) =>
              rm.id === data.bedCode
                ? {
                  ...rm,
                  status: "reserved",
                  holdFor: data.patientName || `EMS ${data.unit}`,
                  hold_for: data.patientName || `EMS ${data.unit}`,
                  diagnosis: data.complaint || "EMS Inbound Call",
                  acuity: `ESI ${data.esi || 3}`,
                }
                : rm
            ),
          }))
        );
      }

      // 4. Synthesize new incoming run for active queue with countdown and persist in emsService
      const newRun = createEmsRun({
        id: `ems-${Date.now()}`,
        code: `RUN-${Math.floor(1000 + Math.random() * 9000)}`,
        unit: data.unit,
        agency: data.agency,
        destination: "HIP Medical Center",
        status: hasBed ? "accepted" : "pending",
        etaMinutes: Number(data.etaMinutes) || 8,
        patientName: data.patientName,
        age: data.age,
        gender: data.gender,
        complaint: data.complaint,
        complaint_label: data.complaint,
        summary: `${data.complaint} · ESI ${data.esi} · ${data.agency}`,
        esi: data.esi,
        zone: data.zone,
        bedCode: hasBed ? data.bedCode : null,
        vitals: {
          heart_rate: data.vitals?.heart_rate,
          systolic: data.vitals?.systolic,
          diastolic: data.vitals?.diastolic,
          spo2: data.vitals?.spo2,
          respiratory_rate: data.vitals?.respiratory_rate,
          gcs: data.vitals?.gcs,
        },
        needs: data.needs || [],
      });

      setEmsRuns(getEmsRuns(true));
      if (hasBed) {
        await fetchDbBeds();
        window.dispatchEvent(new CustomEvent("hip:bed-updated"));
        setToast(`Bed ${data.bedCode} held for ${data.unit} (${data.patientName}). ETA ~${data.etaMinutes}m.`);
      } else {
        setToast(`Pre-alert logged for ${data.unit} (${data.patientName}). Awaiting bed assignment. ETA ~${data.etaMinutes}m.`);
      }
      return hasBed ? `Bed ${data.bedCode} held for ${data.unit}.` : `Pre-alert logged for ${data.unit}.`;
    });

    if (!ok) {
      throw new Error("Failed to process EMS request. Please try again.");
    }
    return true;
  }

  async function handleCreateBed(bedPayload) {
    try {
      const created = await api.createBed(bedPayload);
      await fetchDbBeds();
      window.dispatchEvent(new CustomEvent("hip:bed-updated"));
      setToast(`Bed ${created.bed_code} (${created.department}) registered into inventory!`);
      return created;
    } catch (err) {
      setToast(`Failed to register bed: ${err.message}`);
      throw err;
    }
  }

  function openAdmitModal(room) {
    setAdmitModalRoom(room);
    setAdmitPatientName(room.holdFor || room.patient || "");
    setAdmitDiagnosis(room.diagnosis || (room.status === "reserved" ? "EMS Inbound Admission" : ""));
    if (room.acuity) {
      setAdmitEsi(room.acuity.startsWith("ESI") ? room.acuity : `ESI ${room.acuity}`);
    } else {
      setAdmitEsi("ESI 3");
    }
  }

  async function handleAdmitSubmit(e) {
    e.preventDefault();
    if (!admitModalRoom || !admitPatientName.trim()) return;
    setAdmitSubmitting(true);
    try {
      // 1. Register or get patient identity
      const patient = await api.registerPatient({
        name: admitPatientName.trim(),
        gender: "OTHER",
      });

      // 2. Admit patient to bed in PostgreSQL
      await api.updateBedStatus(admitModalRoom.id, "OCCUPIED", {
        patient_id: patient.patient_id,
        notes: admitDiagnosis || "Clinical Observation",
        acuity_level: admitEsi.replace(" ", "_"),
      });

      // 3. Mark any matching EMS run as handed off in emsService and UI
      const activeRuns = getEmsRuns(true);
      const matchingRun = activeRuns.find((r) => r.bed_id === admitModalRoom.id);
      if (matchingRun) {
        handoffEmsRun(matchingRun.id);
      }
      setEmsRuns(getEmsRuns(true));

      // 4. Immediately refresh beds in UI
      recordPatientAdmit();
      await fetchDbBeds();
      window.dispatchEvent(new CustomEvent("hip:bed-updated"));

      setToast(`Patient ${admitPatientName.trim()} admitted to Room ${admitModalRoom.id}!`);
      setAdmitModalRoom(null);
      setAdmitPatientName("");
      setAdmitDiagnosis("");
    } catch (err) {
      console.error("Admit patient error:", err);
      setToast(err.message || "Failed to admit patient.");
    } finally {
      setAdmitSubmitting(false);
    }
  }


  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(""), 7000);
    return () => clearTimeout(timer);
  }, [toast]);

  useLayoutEffect(() => {
    const stage = mapRef.current;
    if (!stage) return undefined;
    const frame = stage.querySelector(".map-canvas") || stage.querySelector(".map-body") || stage;
    let raf = 0;

    function fit() {
      const stageRect = frame.getBoundingClientRect();
      const width = stageRect.width;
      const height = stageRect.height;
      if (width < 48 || height < 48) return;
      const left = 18;
      const right = 18;
      const top = 14;
      const bottom = 36;
      const freeW = Math.max(160, width - left - right);
      const freeH = Math.max(160, height - top - bottom);
      const bw = BUILDING.w + 2.4;
      const bh = BUILDING.h + 2.4;
      const scaleW = (FRAME.w * freeW) / (bw * width);
      const scaleH = (FRAME.h * freeH) / (bh * height);
      const z = Math.max(0.22, Math.min(scaleW, scaleH));
      setZoom(z);
      const fx = (left + freeW / 2) / width;
      const fy = (top + freeH / 2) / height;
      setPan({
        x: BUILDING.x + BUILDING.w / 2 - fx * (FRAME.w / z) - FRAME.x,
        y: BUILDING.y + BUILDING.h / 2 - fy * (FRAME.h / z) - FRAME.y,
      });
    }

    fit();
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(fit);
    });
    observer.observe(frame);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [fitToken, selectedId]);

  function fitMap() {
    setFitToken((token) => token + 1);
  }

  function changeZoom(direction) {
    const next = Math.min(3.6, Math.max(0.22, zoom * (direction > 0 ? 1.15 : 0.87)));
    const cx = FRAME.x + pan.x + FRAME.w / zoom / 2;
    const cy = FRAME.y + pan.y + FRAME.h / zoom / 2;
    const viewW = FRAME.w / next;
    const viewH = FRAME.h / next;
    setZoom(next);
    setPan({ x: cx - viewW / 2, y: cy - viewH / 2 });
  }

  const deptBeds = selected
    ? floor.rooms.filter((room) => room.census && room.dept === selected.dept)
    : [];
  const clock = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const rightOpen = Boolean(selected);

  return (
    <div className={`shell view-${nav}`}>
      <header className="appbar sticky top-0 z-50 flex-none">
        <div className="ab-glow" aria-hidden="true" />
        <div className="ab-brand">
          <span className="ab-mark" aria-hidden="true">
            <img src="/logo_tight.png" alt="" />
          </span>
          <div>
            <strong>HIP</strong>
            <small>Hospital Intelligence Platform</small>
          </div>
        </div>

        <AppNav
          active={nav}
          onChange={chooseNav}
          live={flowLive}
          badges={{ ambulances: incoming.filter((run) => run.status !== "arrived").length }}
        />

        <div className="ab-tools">
          <button type="button" className="ab-search" onClick={() => setSearchOpen(true)} aria-label="Search the hospital">
            <Icon name="search" />
            <span>Search</span>
            <kbd>⌘K</kbd>
          </button>
          <div className="bell-wrap">
            <button
              type="button"
              className={chatOpen ? "ab-ask is-on" : "ab-ask"}
              aria-label="Ask HIP Clinical AI"
              onClick={() => {
                setChatOpen((open) => !open);
                setBellOpen(false);
              }}
            >
              <AiMark size={22} />
              <span>Ask AI</span>
            </button>
            <ChatPanel
              open={chatOpen}
              onClose={() => setChatOpen(false)}
              roomIds={roomIds}
              onOpenRoom={(roomId) => {
                openRoomById(roomId);
                setChatOpen(false);
              }}
            />
          </div>
          <div className="bell-wrap">
            <button
              type="button"
              className={`ab-icon${bellOpen ? " is-on" : ""}${bellRinging ? " is-ringing" : ""}`}
              aria-label={bellCount ? `Notifications, ${bellCount} need you` : "Notifications"}
              onClick={() => {
                setBellOpen((open) => !open);
                setChatOpen(false);
              }}
            >
              <Icon name="bell" />
              {bellCount > 0 && <em>{bellCount}</em>}
              {!bellCount && unreadActivity && <i className="ab-dot" aria-hidden="true" />}
            </button>
            <NotificationsPanel
              open={bellOpen}
              now={syncTick}
              pending={pendingRuns}
              arrived={arrivedRuns}
              incidents={openIncidents}
              capacity={effectiveCapacity}
              movements={movements}
              busy={actionBusy}
              onClose={() => setBellOpen(false)}
              onSeen={setSeenActivity}
              onOpenRun={(run) => {
                setFocusRunId(run.id);
                chooseNav("ambulances");
              }}
              onAcceptRun={(run) => acceptRun(run)}
              onHandoffRun={(run) => handoffRun(run)}
              onOpenRoom={(roomId) => {
                setBellOpen(false);
                openRoomById(roomId);
              }}
              onOpenOverview={() => chooseNav("overview")}
            />
          </div>
          <div className="ab-clock">
            <strong>{clock}</strong>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginLeft: "8px" }}>
            <a
              href="/dashboard/housekeeping"
              title="Go to EVS Housekeeping Dashboard"
              style={{ fontSize: "11px", fontWeight: "600", fontFamily: "JetBrains Mono, monospace", background: "rgba(245, 158, 11, 0.15)", color: "#fcd34d", border: "1px solid rgba(245, 158, 11, 0.35)", padding: "3px 8px", borderRadius: "6px", textDecoration: "none", transition: "all 0.2s" }}
            >
              🧹 EVS
            </a>
            {user?.role === "ADMIN" && (
              <a
                href="/dashboard/admin"
                title="Go to Administrator Dashboard"
                style={{ fontSize: "11px", fontWeight: "600", fontFamily: "JetBrains Mono, monospace", background: "rgba(168, 85, 247, 0.15)", color: "#d8b4fe", border: "1px solid rgba(168, 85, 247, 0.35)", padding: "3px 8px", borderRadius: "6px", textDecoration: "none", transition: "all 0.2s" }}
              >
                ⚙️ Admin
              </a>
            )}
          </div>
          {user && (
            <div className="ab-user-pill" style={{ display: "flex", alignItems: "center", gap: "8px", marginLeft: "10px", paddingLeft: "10px", borderLeft: "1px solid rgba(255,255,255,0.14)" }}>
              <span style={{ fontSize: "11px", fontWeight: "600", fontFamily: "JetBrains Mono, monospace", background: "rgba(59, 130, 246, 0.2)", color: "#93c5fd", border: "1px solid rgba(59, 130, 246, 0.4)", padding: "2px 7px", borderRadius: "4px" }}>
                {user.role}
              </span>
              <span style={{ fontSize: "12px", color: "#f1f5f9", fontWeight: "500", maxWidth: "130px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {user.full_name || user.username || user.email}
              </span>
              {onLogout && (
                <button
                  type="button"
                  onClick={onLogout}
                  title="Sign out of station"
                  style={{ background: "rgba(239, 68, 68, 0.2)", border: "1px solid rgba(239, 68, 68, 0.4)", color: "#fca5a5", padding: "4px 9px", borderRadius: "4px", fontSize: "11px", cursor: "pointer", fontWeight: "600", fontFamily: "JetBrains Mono, monospace", transition: "all 0.2s" }}
                >
                  Log Out
                </button>
              )}
            </div>
          )}
        </div>
      </header>

      {searchOpen && (
        <div className="palette-veil" onClick={() => setSearchOpen(false)}>
          <div className="palette" role="dialog" aria-label="Search the hospital" onClick={(event) => event.stopPropagation()}>
            <div className="palette-input">
              <Icon name="search" />
              <input
                id="map-search"
                autoFocus
                value={query}
                placeholder="Search a room, unit, or patient"
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && hits[0]) openHit(hits[0]);
                }}
                aria-label="Search the hospital"
              />
              <kbd>esc</kbd>
            </div>
            <div className="palette-list">
              {!query.trim() && (
                <>
                  <p className="palette-kicker">Jump to</p>
                  {floors.map((row) => (
                    <button key={row.id} type="button" onClick={() => { setSearchOpen(false); goToFloor(row.id); }}>
                      <strong>{row.code}</strong>
                      <span>{row.name} · {row.pct}% occupied · {row.open} open</span>
                    </button>
                  ))}
                </>
              )}
              {query.trim() && hits.length === 0 && <p className="palette-empty">No match on any floor.</p>}
              {hits.map((hit) => (
                <button key={`${hit.floor.id}-${hit.room.id}`} type="button" onClick={() => openHit(hit)}>
                  <strong>{hit.room.id}</strong>
                  <span>
                    {hit.floor.code} · {hit.room.deptLabel}
                    {hit.room.patient ? ` · ${hit.room.patient}` : ""}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="workspace">
        <main ref={stageRef} className={nav === "live" ? "stage" : "stage is-page"}>
          {nav === "overview" && (
            <OverviewTab
              now={now}
              insights={insights}
              briefing={{ ...briefing, text: briefingText }}
              onRefreshBriefing={refreshBriefing}
              capacity={effectiveCapacity}
              incoming={incoming}
              onOpenAmbulances={() => chooseNav("ambulances")}
              onOpenRun={(run) => {
                setFocusRunId(run.id);
                chooseNav("ambulances");
              }}
            />
          )}
          {nav === "ambulances" && (
            <AmbulancesTab
              runs={emsRuns}
              summary={emsSummary}
              hospitals={region}
              busy={actionBusy}
              focusId={focusRunId}
              onAccept={acceptRun}
              onDivert={divertRun}
              onCancelHold={cancelHoldRun}
              onHandoff={handoffRun}
              onOpenRoom={openRoomById}
              onLogEmsCall={() => setEmsCallModalOpen(true)}
              onRegisterBed={() => setRegisterBedModalOpen(true)}
              onBroadcastAlert={handleBroadcastAlert}
            />
          )}
          {nav === "data" && <OpenDataTab hospital={effectiveCapacity} incoming={incoming} />}
          {nav !== "live" && (
            <footer className="page-foot">
              <span>
                <i className={flowLive ? "" : "is-wait"} />
                {flowLive && flowSyncedAt
                  ? `Live census · synced ${Math.max(0, Math.round((syncTick - flowSyncedAt) / 1000))}s ago`
                  : boot
                    ? `Showing the last snapshot (${snapshotAge(boot.at, syncTick)}) · reconnecting…`
                    : "Connecting to the live census…"}
              </span>
              <span>HIP · Hospital Intelligence Platform</span>
            </footer>
          )}
          {nav === "live" && (
            <div
              ref={mapRef}
              className={`map-stage${rightOpen ? " has-detail" : ""} is-live`}
              onClick={() => {
                setSearchOpen(false);
                setBellOpen(false);
              }}
            >
              <header className="live-bar">
                <div className="live-bar-top">
                  <div>
                    <p className="live-kicker">Live map · {floor.code}</p>
                    <h2 className="live-title">{floor.subtitle || floor.name}</h2>
                  </div>
                  <div className="live-actions">
                    <span className={flowLive ? "live-sync" : "live-sync is-wait"}>
                      <i />
                      {flowLive && flowSyncedAt
                        ? `Live · synced ${Math.max(0, Math.round((syncTick - flowSyncedAt) / 1000))}s ago`
                        : boot
                          ? "Last snapshot · reconnecting"
                          : "Connecting to hospital"}
                    </span>
                    <div className="floor-seg" role="group" aria-label="Floor">
                      {hospital.map((level) => (
                        <button
                          key={level.id}
                          type="button"
                          className={level.id === floor.id ? "is-on" : ""}
                          aria-pressed={level.id === floor.id}
                          title={level.subtitle || level.name}
                          onClick={() => goToFloor(level.id)}
                        >
                          {level.code}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      className={elevatorOpen ? "live-btn is-on" : "live-btn"}
                      aria-expanded={elevatorOpen}
                      onClick={() => setElevatorOpen((open) => !open)}
                    >
                      Elevator
                    </button>
                    <button
                      type="button"
                      className={summaryOpen ? "live-btn is-on" : "live-btn"}
                      aria-pressed={summaryOpen}
                      onClick={() => {
                        setSummaryOpen((open) => !open);
                        fitMap();
                      }}
                    >
                      Summary
                    </button>
                  </div>
                </div>
                <div className="space-filters" role="toolbar" aria-label="Filter spaces">
                  {SPACE_FILTERS.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={spaceFilter === item.id ? "space-chip is-on" : "space-chip"}
                      onClick={() => setSpaceFilter(item.id)}
                    >
                      {item.dot && <i style={{ background: item.dot }} />}
                      {item.label}
                      <b>{Number.isFinite(spaceCounts[item.id]) ? spaceCounts[item.id] : 0}</b>
                    </button>
                  ))}
                </div>
                {spaceFilter !== "all" && spaceCounts[spaceFilter] === 0 && (
                  <p className="space-empty">
                    No {SPACE_FILTERS.find((item) => item.id === spaceFilter)?.empty} on {floor.code}.{" "}
                    <button type="button" onClick={() => setSpaceFilter("all")}>Clear filter</button>
                  </p>
                )}
              </header>
              <div className="map-body">
                {summaryOpen && (
                  <aside className="overview">
                    <h2>{floor.name} overview</h2>
                    <p className="overview-sub">{floor.subtitle}</p>
                    <Stat tone="slate" label="Total beds" value={summary.total} />
                    <Stat tone="teal" label="Available" value={summary.available} />
                    <Stat tone="amber" label="Occupied" value={summary.occupied} />
                    <Stat tone="red" label="Critical" value={summary.critical} />
                    <Stat tone="violet" label="Cleaning" value={summary.cleaning} />

                    <h3>Departments</h3>
                    <ul className="dept-list">
                      {summary.departments.map((dept) => (
                        <li key={dept.id}>
                          <i style={{ background: dept.color }} />
                          <span>{dept.label}</span>
                          <strong>{dept.beds || dept.rooms}</strong>
                        </li>
                      ))}
                    </ul>

                    <h3>Amenities</h3>
                    <ul className="dept-list amenity-list">
                      {summary.amenities.map((item) => (
                        <li key={item.id}>
                          <span>{item.label}</span>
                          <strong>{item.count}</strong>
                        </li>
                      ))}
                    </ul>
                  </aside>
                )}

                <div className="map-canvas">
                  <FloorPlan
                    floor={floor}
                    spaceFilter={spaceFilter}
                    emsByRoom={emsByRoom}
                    emsBayActive={emsBayActive}
                    selectedId={selectedId}
                    zoom={zoom}
                    pan={pan}
                    elevatorOpen={elevatorOpen}
                    onPanZoom={(nextPan, nextZoom) => {
                      setPan(nextPan);
                      setZoom(nextZoom);
                    }}
                    onSelect={(id) => {
                      playRoomSfx(id);
                      setSelectedId(id);
                      setTab("overview");
                    }}
                    onHover={setHover}
                    onElevator={() => setElevatorOpen((open) => !open)}
                    onStair={() => setToast("Stairs stay on this floor. Use the elevator to change maps.")}
                  />

                  <div className="zoom-tools" role="group" aria-label="Zoom">
                    <button type="button" onClick={fitMap} aria-label="Fit floor to screen" title="Fit floor">
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                        <path d="M1.5 5V1.5H5M9 1.5h3.5V5M12.5 9v3.5H9M5 12.5H1.5V9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                    <button type="button" onClick={() => changeZoom(1)} aria-label="Zoom in">
                      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                        <path d="M7 1.5v11M1.5 7h11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                      </svg>
                    </button>
                    <button type="button" onClick={() => changeZoom(-1)} aria-label="Zoom out">
                      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                        <path d="M1.5 7h11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                      </svg>
                    </button>
                  </div>
                  <div className="legend legend-status">
                    {SPACE_FILTERS.filter((item) => item.dot).map((item) => (
                      <span key={item.id}><i className="lg-dot" style={{ background: item.dot }} /> {item.label}</span>
                    ))}
                    <span><i className="lg lg-elev" /> Elevator</span>
                    <span><i className="lg lg-stair" /> Stairs</span>
                  </div>
                  {toast && (
                    <button type="button" className="toast" onClick={() => setToast("")}>
                      {toast}
                    </button>
                  )}
                  {elevatorOpen && (
                    <>
                      <button
                        type="button"
                        className="cab-backdrop"
                        aria-label="Close elevator"
                        onClick={() => setElevatorOpen(false)}
                      />
                      <ElevatorPanel
                        floors={hospital}
                        currentId={floor.id}
                        onSelect={goToFloor}
                        onClose={() => setElevatorOpen(false)}
                      />
                    </>
                  )}
                </div>

                {rightOpen && (
                  <aside className="detail">
                    {selected && (
                      <RoomCard
                        room={selected}
                        floor={floor}
                        tab={tab}
                        onTab={setTab}
                        deptBeds={deptBeds}
                        staff={(ops?.staff && ops.staff.length ? ops.staff : roster)}
                        surgeOn={surgeOn}
                        movements={movements}
                        incidents={openIncidents.filter((item) => item.room_id === selected.id)}
                        queuePlace={queuePlace.get(selected.id) || null}
                        emsRun={incoming.find((run) => run.bed_id === selected.id) || null}
                        busy={actionBusy}
                        onAcceptRun={acceptRun}
                        onHandoffRun={handoffRun}
                        onOpenRoom={openRoomById}
                        onClose={() => setSelectedId(null)}
                        onOpenAdmit={openAdmitModal}
                        onCancelHoldRoom={cancelHoldByRoomId}
                        onDischargeRoom={dischargeRoom}
                        onCompleteClean={completeCleanRoom}
                        now={syncTick}
                      />
                    )}

                  </aside>
                )}

                {hover && (
                  <div
                    className={`tip${hover.y > window.innerHeight - 330 ? " is-up" : ""}${hover.x > window.innerWidth - 320 ? " is-left" : ""}`}
                    style={{
                      left: hover.x + (hover.x > window.innerWidth - 320 ? -14 : 14),
                      top: hover.y + (hover.y > window.innerHeight - 330 ? -14 : 14),
                    }}
                  >
                    {roomPhoto(hover.room) && <img className="tip-photo" src={roomPhoto(hover.room)} alt="" />}
                    <div className="tip-head">
                      <strong>{hover.room.id}</strong>
                      {hover.room.status && STATUS[hover.room.status] && (
                        <span className="tip-status" style={{ color: STATUS[hover.room.status].color }}>
                          <i style={{ background: STATUS[hover.room.status].color }} />
                          {STATUS[hover.room.status].label}
                        </span>
                      )}
                    </div>
                    <small>
                      {hover.room.census ? hover.room.type : hover.room.type || hover.room.deptLabel} · {hover.room.deptLabel}
                    </small>
                    {hover.room.patient && (
                      <div className="tip-patient">
                        <b>{hover.room.patient}{hover.room.age != null ? `, ${hover.room.age}` : ""}</b>
                        <span>{hover.room.diagnosis || hover.room.chiefComplaint || "Workup in progress"}</span>
                        {hover.room.heartRate != null && (
                          <span className="tip-vitals">
                            HR {hover.room.heartRate}
                            {hover.room.spo2 != null ? ` · SpO₂ ${hover.room.spo2}%` : ""}
                            {hover.room.systolic != null ? ` · BP ${hover.room.systolic}/${hover.room.diastolic}` : ""}
                          </span>
                        )}
                        {hover.room.nurse && <span>Nurse · {hover.room.nurse}</span>}
                        {hover.room.activity && (
                          <span className={hover.room.activityKind === "surgery" ? "tip-now is-surgery" : "tip-now"}>
                            {hover.room.activityKind === "surgery" ? "In surgery · " : "Now · "}
                            {hover.room.activity}
                          </span>
                        )}
                      </div>
                    )}
                    {hover.room.status === "reserved" && hover.room.holdFor && (
                      <small>Held for {hover.room.holdFor}</small>
                    )}
                    {hover.room.status === "cleaning" && (
                      <small>
                        {cleanLabel(hover.room.cleanType)}
                        {" · "}
                        {keeperLabel(hover.room, queuePlace.get(hover.room.id))}
                        {hover.room.linenStage && hover.room.linenStage !== "ready" ? ` · Linen: ${linenLabel(hover.room.linenStage)}` : ""}
                      </small>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </main>
      </div>

      {admitModalRoom && (
        <div className="palette-veil" onClick={() => setAdmitModalRoom(null)} style={{ zIndex: 1200 }}>
          <div
            className="palette"
            style={{ maxWidth: "460px", background: "#0c1524", border: "1px solid rgba(255,255,255,0.18)", borderRadius: "10px", padding: "24px", color: "#f1f5f9", boxShadow: "0 20px 45px rgba(0,0,0,0.6)" }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Admit Patient Modal"
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", borderBottom: "1px solid rgba(255,255,255,0.1)", paddingBottom: "12px" }}>
              <div>
                <h3 style={{ margin: 0, fontSize: "18px", fontWeight: "600", color: "#ffffff" }}>Admit Patient to Room {admitModalRoom.id}</h3>
                <span style={{ fontSize: "11px", color: "#94a3b8", fontFamily: "JetBrains Mono, monospace" }}>Floor {floor.name} · {admitModalRoom.deptLabel}</span>
              </div>
              <button type="button" onClick={() => setAdmitModalRoom(null)} style={{ background: "none", border: "none", color: "#94a3b8", fontSize: "22px", cursor: "pointer", lineHeight: 1 }}>×</button>
            </div>
            <form onSubmit={handleAdmitSubmit}>
              <div style={{ marginBottom: "14px" }}>
                <label style={{ display: "block", fontSize: "12px", fontWeight: "500", color: "#94a3b8", marginBottom: "6px" }}>Patient Full Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. John Doe, Sarah Connor"
                  value={admitPatientName}
                  onChange={(e) => setAdmitPatientName(e.target.value)}
                  style={{ width: "100%", padding: "9px 12px", background: "rgba(15, 23, 42, 0.8)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "6px", color: "#ffffff", fontSize: "13px" }}
                />
              </div>
              <div style={{ marginBottom: "14px" }}>
                <label style={{ display: "block", fontSize: "12px", fontWeight: "500", color: "#94a3b8", marginBottom: "6px" }}>Triage Acuity (ESI)</label>
                <select
                  value={admitEsi}
                  onChange={(e) => setAdmitEsi(e.target.value)}
                  style={{ width: "100%", padding: "9px 12px", background: "#0f172a", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "6px", color: "#ffffff", fontSize: "13px" }}
                >
                  <option value="ESI 1">ESI 1 · Resuscitation / Immediate</option>
                  <option value="ESI 2">ESI 2 · Emergent</option>
                  <option value="ESI 3">ESI 3 · Urgent</option>
                  <option value="ESI 4">ESI 4 · Less Urgent</option>
                  <option value="ESI 5">ESI 5 · Non-Urgent</option>
                </select>
              </div>
              <div style={{ marginBottom: "18px" }}>
                <label style={{ display: "block", fontSize: "12px", fontWeight: "500", color: "#94a3b8", marginBottom: "6px" }}>Chief Complaint / Diagnosis</label>
                <input
                  type="text"
                  placeholder="e.g. Acute chest pain, shortness of breath"
                  value={admitDiagnosis}
                  onChange={(e) => setAdmitDiagnosis(e.target.value)}
                  style={{ width: "100%", padding: "9px 12px", background: "rgba(15, 23, 42, 0.8)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "6px", color: "#ffffff", fontSize: "13px" }}
                />
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
                <button
                  type="button"
                  onClick={() => setAdmitModalRoom(null)}
                  style={{ padding: "8px 14px", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "#cbd5e1", borderRadius: "6px", fontSize: "12px", cursor: "pointer" }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={admitSubmitting}
                  style={{ padding: "8px 16px", background: "#059669", border: "none", color: "#ffffff", fontWeight: "600", borderRadius: "6px", fontSize: "12px", cursor: "pointer" }}
                >
                  {admitSubmitting ? "Admitting..." : "Confirm Admission"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EMS Call Intake & Bed Hold Modal */}
      <EmsCallIntakeModal
        isOpen={emsCallModalOpen}
        onClose={() => setEmsCallModalOpen(false)}
        availableBeds={dbBeds || []}
        onHoldBed={handleHoldBedFromEms}
      />

      {/* Register Bed into Inventory Modal */}
      <RegisterBedModal
        isOpen={registerBedModalOpen}
        onClose={() => setRegisterBedModalOpen(false)}
        onBedCreated={handleCreateBed}
      />
    </div>
  );
}

const ROOM_TABS = [
  { id: "overview", label: "Situation" },
  { id: "patients", label: "Patient" },
  { id: "history", label: "Timeline" },
];

const BED_CHIPS = 6;

function lookupStaff(staff, name, roomId) {
  if (!name) return null;
  const person = (staff || []).find((item) => item.name === name);
  if (!person) return { name, known: false, detail: "", beds: [], load: null };
  const duty = person.on_duty ? "On duty" : "Off duty";
  const patients = person.patients || [];
  return {
    name,
    known: true,
    detail: `${person.specialty || person.role} · ${person.shift} shift · ${duty}`,
    onDuty: person.on_duty,
    extension: person.extension,
    beds: patients.filter((id) => id !== roomId),
    load: person.patients ? patients.length : null,
  };
}

function initials(name) {
  const parts = String(name).replace(/^(Dr\.?|RN)\s+/i, "").trim().split(/\s+/);
  return parts.slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function unitMix(beds) {
  const mix = { critical: 0, occupied: 0, turnover: 0, open: 0 };
  for (const bed of beds) {
    if (!bed.status) continue;
    if (bed.status === "critical") mix.critical += 1;
    else if (bed.status === "warning" || bed.status === "normal") mix.occupied += 1;
    else if (bed.status === "available") mix.open += 1;
    else mix.turnover += 1;
  }
  return mix;
}

const MIX = [
  { id: "critical", label: "Critical" },
  { id: "occupied", label: "Occupied" },
  { id: "turnover", label: "Turnover" },
  { id: "open", label: "Open" },
];

function TeamMember({ role, person, limit, onOpenRoom }) {
  const [expanded, setExpanded] = useState(false);
  const over = limit != null && person.load != null && person.load > limit;
  const beds = expanded ? person.beds : person.beds.slice(0, BED_CHIPS);
  return (
    <div className="rc-member">
      <span className={person.onDuty === false ? "rc-avatar is-off" : "rc-avatar"} aria-hidden="true">
        {initials(person.name)}
      </span>
      <div className="rc-member-main">
        <div className="rc-member-top">
          <strong>{person.name}</strong>
          {person.extension && (
            <a className="rc-ext" href={`tel:${person.extension}`}>ext {person.extension}</a>
          )}
        </div>
        <span className="rc-role">{role}{person.detail ? ` · ${person.detail}` : ""}</span>
        {person.load != null && (
          <div className={over ? "rc-load is-over" : "rc-load"}>
            <span>
              {person.load} {person.load === 1 ? "patient" : "patients"}
              {limit != null ? ` · safe load ${limit}` : ""}
            </span>
            {limit != null && (
              <i style={{ "--fill": `${Math.min(100, (person.load / limit) * 100)}%` }} />
            )}
          </div>
        )}
        {person.beds.length > 0 && (
          <div className="rc-beds">
            {beds.map((id) => (
              <button key={id} type="button" onClick={() => onOpenRoom?.(id)} title={`Open ${id}`}>
                {id}
              </button>
            ))}
            {person.beds.length > BED_CHIPS && (
              <button type="button" className="rc-more" onClick={() => setExpanded((open) => !open)}>
                {expanded ? "Show less" : `+${person.beds.length - BED_CHIPS} more`}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function RoomCard({
  room,
  floor,
  tab,
  onTab,
  deptBeds,
  staff = [],
  surgeOn = false,
  movements = [],
  incidents = [],
  queuePlace = null,
  emsRun = null,
  busy = "",
  onAcceptRun,
  onHandoffRun,
  onOpenRoom,
  onClose,
  onOpenAdmit,
  onCancelHoldRoom,
  onDischargeRoom,
  onCompleteClean,
  now = Date.now(),
}) {
  const vitals = vitalsFor(room);
  const history = historyFor(room, movements);
  const occupied = Boolean(room.patient);
  const situation = situationFor(room, floor);
  const attending = lookupStaff(staff, room.physician, room.id);
  const nurse = lookupStaff(staff, room.nurse, room.id);
  const censusBeds = deptBeds.filter((item) => item.census);
  const openBeds = censusBeds.filter((item) => item.status === "available").length;
  const mix = unitMix(censusBeds);
  const warning = occupied ? earlyWarning(room) : null;
  const stay = occupied ? stayLabel(room.stayTicks) : null;
  const charge = lookupStaff(staff, room.charge, room.id);
  const turnover = room.status === "cleaning" ? turnoverPlan(room, queuePlace) : null;
  const photo = roomPhoto(room);

  return (
    <div>
      {photo ? (
        <div className="rc-photo" key={room.id}>
          <img src={photo} alt={`${room.type || room.deptLabel}, ${floor.name}`} />
          <div className="rc-photo-top">
            <span className="rc-where">
              <i aria-hidden="true" />
              {floor.name} · {room.deptLabel}
            </span>
            <button type="button" className="rc-photo-close" onClick={onClose} aria-label="Close room">
              ×
            </button>
          </div>
          <div className="rc-photo-foot">
            <div>
              <h2>{room.id}</h2>
              <p>{room.type || room.deptLabel}</p>
            </div>
            {room.status && (
              <span className={`rc-photo-pill is-${room.status}`} style={{ "--c": STATUS[room.status].color }}>
                <i />
                {STATUS[room.status].label}
              </span>
            )}
          </div>
        </div>
      ) : (
        <div className="detail-head">
          <div>
            <h2>{room.id}</h2>
            <p className="overview-sub">
              {room.deptLabel} · {floor.name}
            </p>
          </div>
          <div className="head-actions">
            {room.status && (
              <span className="pill" style={{ color: STATUS[room.status].color }}>
                <i style={{ background: STATUS[room.status].color }} />
                {STATUS[room.status].label}
              </span>
            )}
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close room">
              ×
            </button>
          </div>
        </div>
      )}

      {emsRun ? (
        <div className="rc-ems" style={{ "--esi": ESI[emsRun.esi]?.color, "--esi-soft": ESI[emsRun.esi]?.soft }}>
          <div className="rc-ems-top">
            <span className="esi-badge" style={{ "--esi": ESI[emsRun.esi]?.color, "--esi-soft": ESI[emsRun.esi]?.soft }}>ESI {emsRun.esi}</span>
            <strong>
              {emsRun.status === "arrived"
                ? "Ambulance at the EMS bay"
                : emsRun.status === "pending"
                  ? "Suggested for an ambulance"
                  : "Ambulance on the way"}
            </strong>
            <b>{emsRun.status === "arrived" ? "Here" : countdown(emsRun.eta_seconds)}</b>
          </div>
          <p>{emsRun.unit} · {emsRun.complaint_label} · {emsRun.summary}</p>
          <div className="rc-ems-needs">{emsRun.needs.map((need) => <span key={need}>{need}</span>)}</div>
          <EtaTrack run={emsRun} />
          {emsRun.status === "pending" && room.status === "available" && (
            <button type="button" className="amb-accept" disabled={Boolean(busy)} onClick={() => onAcceptRun?.(emsRun, room.id)}>
              Accept &amp; hold {room.id}
            </button>
          )}
          {emsRun.status === "accepted" && (
            <button
              type="button"
              className="amb-accept"
              style={{
                background: "rgba(239, 68, 68, 0.15)",
                border: "1px solid rgba(239, 68, 68, 0.4)",
                color: "#f87171",
                cursor: "pointer",
                marginTop: "6px",
              }}
              disabled={Boolean(busy)}
              onClick={() => onCancelHoldRoom?.(room.id)}
            >
              🚫 Cancel Bed Hold (Keep Available)
            </button>
          )}
          {emsRun.status === "arrived" && (
            <button type="button" className="amb-accept" disabled={Boolean(busy)} onClick={() => onHandoffRun?.(emsRun)}>
              Handoff complete → {room.id}
            </button>
          )}
        </div>
      ) : (
        <div className="bed-id">
          <span className="mono">Location/{room.id}</span>
          {photo ? <span>{room.census ? "Live census bed" : "Support space"}</span> : <span>{room.type}</span>}
          <span>{floor.code}</span>
        </div>
      )}

      {room.census && (
        <div className="rc-clinical-actions" style={{ display: "flex", gap: "8px", margin: "12px 0 16px", flexWrap: "wrap" }}>
          {room.status === "available" && (
            <button
              type="button"
              className="amb-accept"
              style={{ background: "#059669", color: "#ffffff", padding: "8px 14px", fontSize: "12px", fontWeight: "600", borderRadius: "6px", border: "none", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "6px" }}
              onClick={() => onOpenAdmit?.(room)}
            >
              <span>➕</span> Admit Patient
            </button>
          )}
          {room.status === "reserved" && (
            <>
              <button
                type="button"
                className="amb-accept"
                style={{
                  background: "rgba(239, 68, 68, 0.15)",
                  border: "1px solid rgba(239, 68, 68, 0.4)",
                  color: "#f87171",
                  padding: "8px 14px",
                  fontSize: "12px",
                  fontWeight: "600",
                  borderRadius: "6px",
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                }}
                disabled={Boolean(busy)}
                onClick={() => onCancelHoldRoom?.(room.id)}
              >
                <span>🚫</span> Cancel Bed Hold (Keep Available)
              </button>
              <button
                type="button"
                className="amb-accept"
                style={{
                  background: "#059669",
                  color: "#ffffff",
                  padding: "8px 14px",
                  fontSize: "12px",
                  fontWeight: "600",
                  borderRadius: "6px",
                  border: "none",
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                }}
                onClick={() => onOpenAdmit?.(room)}
              >
                <span>➕</span> Confirm Admit ({room.holdFor || "Patient"})
              </button>
            </>
          )}
          {occupied && (
            <button
              type="button"
              className="amb-accept"
              style={{ background: "#dc2626", color: "#ffffff", padding: "8px 14px", fontSize: "12px", fontWeight: "600", borderRadius: "6px", border: "none", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "6px" }}
              disabled={Boolean(busy)}
              onClick={() => onDischargeRoom?.(room.id)}
            >
              <span>🚪</span> Discharge Patient
            </button>
          )}
          {(room.status === "cleaning" || room.status === "dirty") && (
            <button
              type="button"
              className="amb-accept"
              style={{ background: "#2563eb", color: "#ffffff", padding: "8px 14px", fontSize: "12px", fontWeight: "600", borderRadius: "6px", border: "none", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "6px" }}
              disabled={Boolean(busy)}
              onClick={() => onCompleteClean?.(room.id)}
            >
              <span>✨</span> Complete Clean (EVS)
            </button>
          )}
        </div>
      )}

      <div className="tabs">
        {ROOM_TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={tab === item.id ? "is-on" : ""}
            onClick={() => onTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="sheet rc">
          <div className={`rc-hero ${situation.tone}`}>
            <div className="rc-hero-top">
              <span className="rc-band">{situation.band}</span>
              {situation.detail && <span className="rc-sev">{situation.detail}</span>}
              {stay && <span className="rc-stay">{stay}</span>}
            </div>
            {occupied ? (
              <>
                <strong className="rc-name">
                  {room.patient}
                  {room.age != null && <small>{room.age} yrs</small>}
                </strong>
                <span className="rc-dx">{room.diagnosis || "Working diagnosis pending"}</span>
                {room.chiefComplaint && <span className="rc-cc">Came in with {room.chiefComplaint}</span>}
              </>
            ) : (
              <span className="rc-dx">{situation.why}</span>
            )}
            {occupied && (
              <div className="rc-tags">
                {occupied && <span className="rc-tag">{esiFor(room.status)}</span>}
                {occupied && (
                  <span className={room.needsOr ? "rc-tag is-alert" : dispositionFor(room, surgeOn) === "Must stay" ? "rc-tag" : "rc-tag is-next"}>
                    Next · {dispositionFor(room, surgeOn)}
                  </span>
                )}
              </div>
            )}
          </div>

          <NowDoing room={room} now={now} />

          {incidents.map((item) => (
            <div key={item.id} className="rc-incident">
              <strong>{item.title}</strong>
              <span>{item.severity ? `${item.severity} severity` : "Open incident"} · bed blocked until resolved</span>
            </div>
          ))}

          {warning && (
            <section className="rc-section">
              <header className="rc-sec-head">
                <p className="kicker">Early warning</p>
                <span className={`rc-news is-${warning.level}`}>NEWS {warning.total}</span>
              </header>
              <div className="rc-vitals">
                {warning.rows.map((row) => (
                  <div key={row.label} className={`rc-vital s${row.score}`}>
                    <span>{row.label}</span>
                    <strong>{row.value}</strong>
                  </div>
                ))}
              </div>
              <p className="rc-hint">{warning.advice}</p>
            </section>
          )}

          {turnover && (
            <section className="rc-section turn">
              <header className="rc-sec-head">
                <p className="kicker">Turnover</p>
                <span className={turnover.ready ? "rc-unit-flag" : "rc-unit-flag is-wait"}>
                  {turnover.ready ? "Ready to open" : `Opens in ~${formatEta(turnover.eta)}`}
                </span>
              </header>
              <div className="turn-progress" role="progressbar" aria-valuenow={turnover.pct} aria-valuemin={0} aria-valuemax={100}>
                <i style={{ width: `${turnover.pct}%` }} />
                <b>{turnover.pct}%</b>
              </div>
              {turnover.blocker && (
                <p className="turn-blocker"><span>Holding it up</span>{turnover.blocker}</p>
              )}
              <div className="turn-tracks">
                <div className={`turn-track is-${turnover.clean.state}`}>
                  <span className="turn-dot" aria-hidden="true" />
                  <div>
                    <strong>Clean · {cleanLabel(turnover.clean.type)}</strong>
                    <small>
                      {turnover.clean.state === "done"
                        ? "Finished"
                        : turnover.clean.who
                          ? `${turnover.clean.who} · ~${formatEta(turnover.clean.eta)} left`
                          : "Waiting for a housekeeper"}
                    </small>
                  </div>
                </div>
                <div className={`turn-track is-${turnover.linen.state}`}>
                  <span className="turn-dot" aria-hidden="true" />
                  <div>
                    <strong>Fresh linen</strong>
                    <small>
                      {turnover.linen.state === "done"
                        ? "Clean sheets are in the room"
                        : turnover.linen.who
                          ? `${turnover.linen.who} · ~${formatEta(turnover.linen.eta)} left`
                          : "Waiting for a linen aide"}
                    </small>
                    <ol className="turn-stages">
                      {turnover.linen.stages.map((stage) => (
                        <li key={stage.id} className={`is-${stage.state}`}>{stage.label}</li>
                      ))}
                    </ol>
                  </div>
                </div>
              </div>
              <p className="turn-next">
                {turnover.ready
                  ? "Both crews are done. "
                  : "Both crews work at the same time; the bed opens when the slower one finishes. "}
                {turnover.nextFor ? <b>{turnover.nextFor} gets this bed next.</b> : "It goes to the next admission."}
              </p>
            </section>
          )}

          {room.census && censusBeds.length > 0 && (
            <section className="rc-section">
              <header className="rc-sec-head">
                <p className="kicker">{room.deptLabel}</p>
                <span className={openBeds === 0 ? "rc-unit-flag is-full" : "rc-unit-flag"}>
                  {openBeds === 0 ? "No open beds" : `${openBeds} of ${censusBeds.length} open`}
                </span>
              </header>
              <div className="rc-bar" role="img" aria-label={MIX.map((item) => `${mix[item.id]} ${item.label}`).join(", ")}>
                {MIX.filter((item) => mix[item.id] > 0).map((item) => (
                  <i key={item.id} className={`is-${item.id}`} style={{ flexGrow: mix[item.id] }} />
                ))}
              </div>
              <ul className="rc-bar-key">
                {MIX.map((item) => (
                  <li key={item.id}>
                    <i className={`is-${item.id}`} />
                    {item.label}
                    <b>{mix[item.id]}</b>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {(attending || nurse || charge) && (
            <section className="rc-section">
              <p className="kicker">Care team</p>
              {attending && <TeamMember role="Attending" person={attending} onOpenRoom={onOpenRoom} />}
              {nurse && <TeamMember role="Primary nurse" person={nurse} limit={NURSE_LOAD} onOpenRoom={onOpenRoom} />}
              {charge && <TeamMember role="Charge nurse" person={charge} onOpenRoom={onOpenRoom} />}
            </section>
          )}
        </div>
      )}

      {tab === "patients" && (
        <div className="sheet">
          {occupied ? (
            <>
              <div className="detail-callout">
                <p className="kicker">{room.patient}{room.age != null ? ` · ${room.age} yrs` : ""}</p>
                <strong>{room.chiefComplaint || "Complaint not documented"}</strong>
                <span>{room.diagnosis || "Working diagnosis pending"}</span>
              </div>
              <Meta label="Right now">
                {room.activity ? `${room.activityKind === "surgery" ? "In surgery: " : ""}${room.activity}` : "—"}
              </Meta>
              <Meta label="Acuity">{esiFor(room.status)}</Meta>
              <Meta label="Disposition">{dispositionFor(room, surgeOn)}</Meta>
              <Meta label="Attending">{attending ? `${attending.name} · ${attending.detail}` : "—"}</Meta>
              <Meta label="Primary nurse">{nurse ? `${nurse.name} · ${nurse.detail}` : "—"}</Meta>
              {vitals ? (
                <div className="detail-block">
                  <p className="kicker">Last recorded</p>
                  <div className="vital-grid">
                    <div><span>HR</span><strong>{vitals.hr}</strong></div>
                    <div><span>BP</span><strong>{vitals.bp}</strong></div>
                    <div><span>SpO₂</span><strong>{vitals.spo2}</strong></div>
                    <div><span>RR</span><strong>{vitals.rr}</strong></div>
                    <div><span>Temp</span><strong>{vitals.temp}</strong></div>
                  </div>
                </div>
              ) : (
                <p className="detail-copy">Vitals are not recorded.</p>
              )}
            </>
          ) : (
            <div className="detail-empty">
              <p className="kicker">{room.census ? "No patient assigned" : "Not a bed"}</p>
              <p className="detail-copy">{situation.why}</p>
            </div>
          )}
        </div>
      )}

      {tab === "history" && (
        <div className="sheet">
          <p className="kicker">Timeline</p>
          {history.length === 0 ? (
            <p className="detail-copy">No events recorded yet.</p>
          ) : (
            <ul className="activity">
              {history.map((item) => (
                <li key={`${item.time}-${item.text}`}>
                  <strong>{item.time}</strong>
                  <span>{item.text}</span>
                  <em>{item.tag}</em>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
