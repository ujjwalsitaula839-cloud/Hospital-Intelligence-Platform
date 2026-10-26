const OCCUPIED = new Set(["critical", "warning", "normal"]);
const NURSE_LOAD = 4;

export function buildLiveOps(census, transfers = [], staff = []) {
  const rooms = (census?.rooms || []).filter((room) => room.kind === "bed" || room.kind === "or");
  const keepers = census?.housekeepers || [];
  const keeperIds = new Set(keepers.map((keeper) => keeper.room_id).filter(Boolean));
  const usable = rooms.filter((room) => room.status === "available");
  const items = [
    ...cleans(rooms, keeperIds),
    ...blocked(rooms),
    ...transferItems(transfers),
    ...closedUnits(rooms),
    ...coverage(rooms, staff),
  ].sort((a, b) => b.impact - a.impact || a.id.localeCompare(b.id));

  return {
    surge: Boolean(census?.surge),
    counts: {
      usable: usable.length,
      transfers: items.filter((item) => item.kind === "transfer").length,
      cleans: items.filter((item) => item.kind === "clean").length,
      incidents: rooms.filter((room) => room.status === "blocked").length,
    },
    items,
    usable: usable.map(ref),
    holds: rooms.filter((room) => room.status === "reserved").map((room) => ({
      ...ref(room),
      hold_for: room.hold_for || "Hold",
    })),
    housekeepers: keepers.map((keeper) => ({
      id: keeper.id,
      name: keeper.name,
      room_id: keeper.room_id,
    })),
    staff: staff.map((person) => ({
      ...person,
      patients: rooms
        .filter((room) => room.nurse === person.name || room.physician === person.name)
        .map((room) => room.id),
    })),
    units: unitSummary(rooms, staff),
    pending: pending(rooms, transfers),
  };
}

export function incidentsFromCensus(census) {
  return (census?.rooms || [])
    .filter((room) => room.status === "blocked")
    .map((room) => ({
      id: `census:${room.id}`,
      room_id: room.id,
      title: "Bed out of service",
      severity: "high",
      status: "open",
      created_at: null,
      source: "census",
    }));
}

function ref(room) {
  return {
    room_id: room.id,
    floor_id: room.floor_id,
    dept: room.dept,
    kind: room.kind,
    status: room.status,
  };
}

function cleans(rooms, keeperIds) {
  return rooms
    .filter((room) => room.status === "cleaning" && !keeperIds.has(room.id) && !room.housekeeper)
    .map((room) => {
      const linenReady = room.linen_stage === "ready";
      let reason = "No housekeeper assigned.";
      if (linenReady) reason = "Clean finished. Waiting to open the bed.";
      else if ((room.ticks_left || 0) <= 0) reason = "Linen is still out. The bed stays closed.";
      return {
        id: `clean:${room.id}`,
        kind: "clean",
        floor_id: room.floor_id,
        room_id: room.id,
        title: `${room.id} needs a clean`,
        reason,
        age_seconds: null,
        impact: 70,
        nav: "live",
        linen_ready: linenReady,
      };
    });
}

function blocked(rooms) {
  return rooms
    .filter((room) => room.status === "blocked")
    .map((room) => ({
      id: `incident:${room.id}`,
      kind: "incident",
      floor_id: room.floor_id,
      room_id: room.id,
      title: `${room.id} is out of service`,
      reason: "Blocked on the live census",
      age_seconds: null,
      impact: 84,
      nav: "incidents",
    }));
}

function transferItems(transfers) {
  return transfers.map((transfer) => ({
    id: `transfer:${transfer.id}`,
    kind: "transfer",
    floor_id: null,
    room_id: null,
    title: `${transfer.patient_name} sent to ${transfer.destination}`,
    reason: transfer.reason === "icu_full" ? "ICU full" : "ORs full",
    age_seconds: ageOf(transfer.created_at),
    impact: 75,
    nav: "flow",
  }));
}

function closedUnits(rooms) {
  const groups = [
    ["icu", "Intensive Care", 95, (room) => room.dept === "icu" && room.kind === "bed"],
    ["ed", "Emergency", 90, (room) => room.dept === "ed" && room.kind === "bed"],
    ["or", "Operating rooms", 88, (room) => room.kind === "or"],
  ];
  return groups.flatMap(([id, label, impact, match]) => {
    const members = rooms.filter(match);
    if (!members.length || members.some((room) => room.status === "available")) return [];
    return [{
      id: `unit:${id}`,
      kind: "unit",
      floor_id: members[0].floor_id,
      room_id: null,
      title: `${label} has no open bed`,
      reason: `${members.length} beds, none usable`,
      age_seconds: null,
      impact,
      nav: "capacity",
    }];
  });
}

function coverage(rooms, staff) {
  const groups = {
    icu: (room) => room.dept === "icu",
    ed: (room) => room.dept === "ed",
    med: (room) => room.dept === "med",
    surg: (room) => room.dept === "surgward" || room.dept === "surgery" || room.kind === "or",
  };
  return Object.entries(groups).flatMap(([unit, match]) => {
    const occupied = rooms.filter((room) => match(room) && OCCUPIED.has(room.status));
    const nurses = staff.filter((person) => person.unit === unit && person.role === "nurse" && person.on_duty);
    if (!occupied.length) return [];
    const thin = !nurses.length || occupied.length > NURSE_LOAD * nurses.length;
    if (!thin) return [];
    const ratio = nurses.length ? (occupied.length / nurses.length).toFixed(1) : null;
    const reason = nurses.length
      ? `${occupied.length} patients for ${nurses.length} nurses (${ratio} each). Rule: no more than ${NURSE_LOAD}.`
      : `${occupied.length} patients and no nurse on duty. Rule: 1 nurse per ${NURSE_LOAD} patients.`;
    return [{
      id: `coverage:${unit}`,
      kind: "coverage",
      floor_id: occupied[0].floor_id,
      room_id: null,
      title: `${unit.toUpperCase()} coverage is thin`,
      reason,
      age_seconds: null,
      impact: 58,
      nav: "staff",
      unit,
    }];
  });
}

function unitSummary(rooms, staff) {
  const groups = [
    ["ed", "Emergency", (room) => room.dept === "ed"],
    ["icu", "Intensive Care", (room) => room.dept === "icu"],
    ["med", "Medical", (room) => room.dept === "med"],
    ["surg", "Surgery", (room) => room.dept === "surgward" || room.dept === "surgery" || room.kind === "or"],
  ];
  return groups.map(([id, label, match]) => {
    const patients = rooms.filter((room) => match(room) && OCCUPIED.has(room.status)).length;
    const nurses = staff.filter((person) => person.unit === id && person.role === "nurse" && person.on_duty).length;
    return {
      id,
      label,
      nurses,
      patients,
      ratio: nurses ? Math.round((patients / nurses) * 10) / 10 : null,
    };
  });
}

function pending(rooms, transfers) {
  const rows = rooms
    .filter((room) => room.status === "reserved")
    .map((room) => ({
      id: `hold:${room.id}`,
      kind: "reserve",
      room_id: room.id,
      floor_id: room.floor_id,
      title: `${room.id} held for ${room.hold_for || "a patient"}`,
      reason: "Reserved. Not usable until released.",
    }));
  const orOpen = rooms.some((room) => room.kind === "or" && room.status === "available");
  if (!orOpen) {
    rooms.forEach((room) => {
      if (!room.needs_or || room.kind === "or" || !room.patient) return;
      rows.push({
        id: `or:${room.id}`,
        kind: "or_wait",
        room_id: room.id,
        floor_id: room.floor_id,
        title: `${room.patient} needs an operating room`,
        reason: "Both operating rooms are in use.",
      });
    });
  }
  const icuOpen = rooms.some((room) => room.dept === "icu" && room.kind === "bed" && room.status === "available");
  if (!icuOpen) {
    rooms.forEach((room) => {
      if (room.dept === "icu" || room.status !== "critical" || !room.patient) return;
      rows.push({
        id: `icu:${room.id}`,
        kind: "icu_wait",
        room_id: room.id,
        floor_id: room.floor_id,
        title: `${room.patient} is critical outside the ICU`,
        reason: "Intensive Care has no open bed.",
      });
    });
  }
  transfers.forEach((transfer) => {
    rows.push({
      id: `transfer:${transfer.id}`,
      kind: "transfer",
      room_id: null,
      floor_id: null,
      title: `${transfer.patient_name} sent to ${transfer.destination}`,
      reason: transfer.reason === "icu_full" ? "ICU full" : "ORs full",
      age_seconds: ageOf(transfer.created_at),
    });
  });
  return rows;
}

function ageOf(iso) {
  if (!iso) return null;
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) return null;
  return Math.max(0, Math.round((Date.now() - time) / 1000));
}
