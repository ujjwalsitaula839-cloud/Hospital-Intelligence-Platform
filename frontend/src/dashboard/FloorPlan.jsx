import { useEffect, useRef } from "react";
import { CORE, FRAME, STATUS, spaceBucket } from "./floors";
import { cleanEtaSeconds, formatEta } from "./insights";

const SHELL = "M 5 3.2 H 75.6 V 40 L 60 56.6 H 5 Z";

function doorGeom(room) {
  const door = room.door;
  if (!door) return null;
  const { edge, offset, width } = door;
  if (edge === "s") {
    const x = room.x + offset;
    const y = room.y + room.h;
    return {
      gap: [x, y, x + width, y],
    };
  }
  if (edge === "n") {
    const x = room.x + offset;
    const y = room.y;
    return {
      gap: [x, y, x + width, y],
    };
  }
  if (edge === "w") {
    const x = room.x;
    const y = room.y + offset;
    return {
      gap: [x, y, x, y + width],
    };
  }
  const x = room.x + room.w;
  const y = room.y + offset;
  return {
    gap: [x, y, x, y + width],
  };
}

function Pictogram({ x, y, fill, children }) {
  const size = 1.55;
  return (
    <g transform={`translate(${x - size / 2} ${y - size / 2})`} style={{ pointerEvents: "none" }}>
      <rect width={size} height={size} rx="0.18" fill={fill} />
      <g transform="translate(0.22 0.22) scale(0.046)">
        {children}
      </g>
    </g>
  );
}

function Stairs({ item }) {
  const cx = item.x + item.w / 2;
  const cy = item.y + item.h / 2;
  return (
    <g data-kind="stair" className="map-hit">
      <rect x={item.x} y={item.y} width={item.w} height={item.h} fill="#e7edf3" stroke="#d0d7e2" strokeWidth="0.06" />
      <Pictogram x={cx} y={cy - 0.35} fill="#3b82f6">
        <path d="M8 20h4v-4h4v-4h4V8" fill="none" stroke="#fff" strokeWidth="2.4" />
        <circle cx="8" cy="8" r="2.2" fill="#fff" />
      </Pictogram>
      <text x={cx} y={item.y + item.h - 0.35} textAnchor="middle" fontSize="0.62" fontWeight="600" letterSpacing="0.04" fill="#3d5f8a" style={{ pointerEvents: "none" }}>
        Stairs
      </text>
    </g>
  );
}

function Elevator({ item, active }) {
  const cx = item.x + item.w / 2;
  const cy = item.y + item.h / 2;
  return (
    <g data-kind="elevator" className="map-hit">
      <rect
        x={item.x}
        y={item.y}
        width={item.w}
        height={item.h}
        fill={active ? "#dbeafe" : "#e7edf3"}
        stroke={active ? "#4a78b0" : "#d0d7e2"}
        strokeWidth="0.06"
      />
      <Pictogram x={cx} y={cy - 0.28} fill="#111827">
        <circle cx="8" cy="7" r="2" fill="#fff" />
        <circle cx="16" cy="7" r="2" fill="#fff" />
        <path d="M5 18c.4-3 2-4.5 3-4.5s2.6 1.5 3 4.5H5zM13 18c.4-3 2-4.5 3-4.5s2.6 1.5 3 4.5h-6z" fill="#fff" />
      </Pictogram>
      <text x={cx} y={item.y + item.h - 0.28} textAnchor="middle" fontSize="0.52" fontWeight="600" letterSpacing="0.03" fill="#1f2937" style={{ pointerEvents: "none" }}>
        Elev {item.label}
      </text>
    </g>
  );
}

function shortUse(room) {
  const type = room.type || "";
  if (type.includes("ICU")) return "Intensive care";
  if (type.includes("Trauma")) return "Trauma bay";
  if (type.includes("Exam")) return "Exam room";
  if (type.includes("Operating")) return "Operating room";
  if (type.includes("Med/Surg")) return "Patient room";
  if (type.includes("Observation")) return "Observation";
  if (type.includes("Fast track")) return "Fast track";
  if (room.kind === "restroom") return "Lavatory";
  return type;
}

function shortName(name) {
  const parts = String(name).trim().split(/\s+/);
  if (parts.length < 2) return parts[0] || "";
  return `${parts[0][0]}. ${parts[parts.length - 1]}`;
}

// What a charge nurse needs to read off the plate for one bed, in two words.
function bedLine(room) {
  if (room.status === "reserved") return { text: (room.holdFor || room.patient) ? `Held · ${shortName(room.holdFor || room.patient)}` : "Held", fill: "#c2410c" };
  if (room.patient) return { text: shortName(room.patient), fill: "#1f3f68" };
  if (room.status === "cleaning") {
    const eta = cleanEtaSeconds(room);
    return { text: eta ? `Ready in ${formatEta(eta)}` : "Ready now", fill: "#5b4a8f" };
  }
  if (room.status === "blocked") return { text: "Out of service", fill: "#374151" };
  if (room.status === "available") return { text: "Open", fill: "#1d7a4a" };
  return null;
}

function fitLabel(text, box, preferred) {
  const glyphs = Math.max(String(text).length, 1);
  const fitted = (box * 0.86) / (glyphs * 0.56);
  return Math.max(0.38, Math.min(preferred, fitted));
}

function RoomTag({ room, selected, override }) {
  const ink = "#1c2430";
  const muted = "#4b5568";
  if (room.kind === "restroom") {
    return (
      <text
        x={room.x + room.w / 2}
        y={room.y + room.h - 0.28}
        textAnchor="middle"
        fontSize="0.52"
        fontWeight="600"
        letterSpacing="0.06"
        fill="#9a6700"
        style={{ pointerEvents: "none" }}
      >
        WC
      </text>
    );
  }
  const wide = room.w >= 6.5 || room.h >= 6;
  const title = room.census ? room.id : (room.label || room.type || "");
  const info = override || (room.census && room.h >= 3.2 ? bedLine(room) : null);
  const sub = info ? info.text : (room.h >= 5.4 && room.w >= 4.2 && wide ? shortUse(room) : "");
  const titleSize = fitLabel(title, room.w, wide ? 1.15 : 0.98);
  const subSize = sub ? fitLabel(sub, room.w, Math.min(info ? 0.56 : 0.48, titleSize * 0.66)) : 0;
  const cx = room.x + room.w / 2;
  const cy = room.y + room.h / 2;
  return (
    <g style={{ pointerEvents: "none" }} clipPath={`url(#label-${room.id})`}>
      <text
        x={cx}
        y={sub ? cy - subSize * 0.15 : cy}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize={titleSize}
        fontWeight="650"
        letterSpacing="0.02"
        fill={selected ? "#0f172a" : ink}
      >
        {title}
      </text>
      {sub && (
        <text
          x={cx}
          y={cy + titleSize * 0.72}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={subSize}
          fontWeight={info ? 600 : 520}
          letterSpacing="0.01"
          fill={info ? info.fill : muted}
        >
          {sub}
        </text>
      )}
    </g>
  );
}

function Lavatory({ x, y }) {
  return (
    <Pictogram x={x} y={y} fill="#f59e0b">
      <circle cx="8" cy="6" r="2" fill="#fff" />
      <circle cx="16" cy="6" r="2" fill="#fff" />
      <path d="M5 16c.6-3 2.2-4 3-4s2.4 1 3 4H5zM13 16c.6-3 2.2-4 3-4s2.4 1 3 4h-6z" fill="#fff" />
    </Pictogram>
  );
}

const BUCKET_FILL = {
  available: "rgba(34, 197, 94, 0.22)",   // Green
  occupied: "rgba(239, 68, 68, 0.22)",    // Red
  dirty: "rgba(234, 179, 8, 0.25)",       // Yellow
  cleaning: "rgba(59, 130, 246, 0.22)",   // Blue
  reserved: "rgba(249, 115, 22, 0.22)",   // Orange
  down: "#eef1f4",
};

export default function FloorPlan({
  floor,
  spaceFilter = "all",
  selectedId,
  zoom,
  pan,
  elevatorOpen,
  onPanZoom,
  onSelect,
  onHover,
  onElevator,
  onStair,
  emsByRoom = {},
  emsBayActive = false,
}) {
  const svgRef = useRef(null);
  const drag = useRef(null);
  const live = useRef({ zoom, pan, onPanZoom });
  live.current = { zoom, pan, onPanZoom };

  // Wheel / trackpad pinch zooms toward the cursor so the point under it stays put.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return undefined;
    function onWheel(event) {
      event.preventDefault();
      const { zoom: z, pan: p, onPanZoom: move } = live.current;
      const next = Math.min(3.6, Math.max(0.22, z * Math.exp(-event.deltaY * 0.0015)));
      if (next === z) return;
      const rect = svg.getBoundingClientRect();
      const fx = (event.clientX - rect.left) / rect.width;
      const fy = (event.clientY - rect.top) / rect.height;
      move(
        {
          x: p.x + fx * (FRAME.w / z - FRAME.w / next),
          y: p.y + fy * (FRAME.h / z - FRAME.h / next),
        },
        next,
      );
    }
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  function unitsPerPixel() {
    const rect = svgRef.current.getBoundingClientRect();
    return {
      x: FRAME.w / zoom / rect.width,
      y: FRAME.h / zoom / rect.height,
    };
  }

  function pointerDown(event) {
    if (event.button !== 0) return;
    drag.current = {
      x: event.clientX,
      y: event.clientY,
      moved: false,
      pan: { ...pan },
      roomId: event.target.closest?.("[data-room]")?.getAttribute("data-room") || null,
      kind: event.target.closest?.("[data-kind]")?.getAttribute("data-kind") || null,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function pointerMove(event) {
    if (drag.current) {
      const dx = event.clientX - drag.current.x;
      const dy = event.clientY - drag.current.y;
      if (Math.hypot(dx, dy) > 4) drag.current.moved = true;
      const scale = unitsPerPixel();
      onPanZoom(
        {
          x: drag.current.pan.x - dx * scale.x,
          y: drag.current.pan.y - dy * scale.y,
        },
        zoom,
      );
      onHover(null);
      return;
    }
    const node = event.target.closest?.("[data-room]");
    if (!node) {
      onHover(null);
      return;
    }
    const room = floor.rooms.find((item) => item.id === node.getAttribute("data-room"));
    if (room) onHover({ room, x: event.clientX, y: event.clientY });
  }

  function pointerUp() {
    const info = drag.current;
    drag.current = null;
    if (!info || info.moved) return;
    if (info.kind === "elevator") onElevator();
    else if (info.kind === "stair") onStair();
    else if (info.roomId) onSelect(info.roomId);
  }

  const view = {
    x: FRAME.x + pan.x,
    y: FRAME.y + pan.y,
    w: FRAME.w / zoom,
    h: FRAME.h / zoom,
  };

  return (
    <svg
      ref={svgRef}
      className="floor-svg"
      fontFamily="Inter, Segoe UI, sans-serif"
      viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
      onPointerLeave={() => onHover(null)}
      role="img"
      aria-label={`${floor.name} floor plan`}
    >
      <defs>
        <clipPath id="plate">
          <path d={SHELL} />
        </clipPath>
        {floor.rooms.map((room) => (
          <clipPath key={room.id} id={`label-${room.id}`}>
            <rect x={room.x + 0.12} y={room.y + 0.08} width={Math.max(0.2, room.w - 0.24)} height={Math.max(0.2, room.h - 0.16)} />
          </clipPath>
        ))}
        <filter id="plate-shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="0.35" stdDeviation="0.45" floodColor="#94a3b8" floodOpacity="0.45" />
        </filter>
      </defs>

      <rect x={FRAME.x} y={FRAME.y} width={FRAME.w} height={FRAME.h} fill="#ffffff" />
      <path d={SHELL} fill="#ffffff" stroke="#e7ebf0" strokeWidth="0.45" filter="url(#plate-shadow)" />
      <g clipPath="url(#plate)">
        {floor.rooms.map((room) => {
          const selected = room.id === selectedId;
          const bucket = spaceBucket(room);
          const statusMiss = spaceFilter !== "all" && bucket !== spaceFilter;
          const door = doorGeom(room);
          let fill = BUCKET_FILL[bucket] || "#f4f7fb";
          if (room.kind === "restroom") fill = "#eef2f6";
          const marker = room.census ? STATUS[room.status] : null;
          const incoming = emsByRoom[room.id];
          const bay = room.id === "EMS" && emsBayActive;
          const override = incoming
            ? { text: incoming.label, fill: "#b42318" }
            : bay
              ? { text: "Ambulance at bay", fill: "#b42318" }
              : null;
          const critical = room.census && room.status === "critical";
          const dotR = Math.min(0.4, room.w * 0.08, room.h * 0.08);
          return (
            <g
              key={room.id}
              data-room={room.id}
              className={`map-hit${selected ? " is-selected" : ""}${incoming ? " is-ems" : ""}${bay ? " is-ems-bay" : ""}`}
              opacity={statusMiss ? 0.18 : 1}
            >
              <rect
                className="room-shape"
                x={room.x}
                y={room.y}
                width={room.w}
                height={room.h}
                fill={fill}
                stroke={selected ? "#2f5f9e" : "#9aabbd"}
                strokeWidth={selected ? 0.24 : 0.07}
              />
              {(incoming || bay) && (
                <rect
                  className="room-ems"
                  x={room.x + 0.1}
                  y={room.y + 0.1}
                  width={Math.max(0.1, room.w - 0.2)}
                  height={Math.max(0.1, room.h - 0.2)}
                  fill={bay ? "rgba(239, 68, 68, 0.12)" : "none"}
                  stroke={incoming?.color || "#ef4444"}
                  strokeWidth="0.26"
                  style={{ pointerEvents: "none" }}
                />
              )}
              {critical && (
                <rect
                  className="room-pulse"
                  x={room.x + 0.14}
                  y={room.y + 0.14}
                  width={Math.max(0.1, room.w - 0.28)}
                  height={Math.max(0.1, room.h - 0.28)}
                  fill="none"
                  stroke={STATUS.critical.color}
                  strokeWidth="0.2"
                  style={{ pointerEvents: "none" }}
                />
              )}
              {room.census && room.bed && (
                <rect
                  x={room.bed.x}
                  y={room.bed.y}
                  width={room.bed.w}
                  height={room.bed.h}
                  rx="0.12"
                  fill={selected ? "#0f172a" : "#64748b"}
                  opacity="0.55"
                  style={{ pointerEvents: "none" }}
                />
              )}
              {door && (
                <line
                  x1={door.gap[0]}
                  y1={door.gap[1]}
                  x2={door.gap[2]}
                  y2={door.gap[3]}
                  stroke="#ffffff"
                  strokeWidth="0.22"
                  style={{ pointerEvents: "none" }}
                />
              )}
              {room.kind === "restroom" && (
                <Lavatory x={room.x + room.w / 2} y={room.y + room.h / 2 - 0.15} />
              )}
              <RoomTag room={room} selected={selected} override={override} />
              {marker && (
                <circle
                  cx={room.x + room.w - dotR - 0.3}
                  cy={room.y + dotR + 0.3}
                  r={dotR}
                  fill={marker.color}
                  stroke="#fff"
                  strokeWidth="0.1"
                  style={{ pointerEvents: "none" }}
                />
              )}
            </g>
          );
        })}

        {CORE.map((item) =>
          item.kind === "stair" ? (
            <Stairs key={item.id} item={item} />
          ) : (
            <Elevator key={item.id} item={item} active={elevatorOpen} />
          ),
        )}
      </g>

      <text
        x="66"
        y="60.5"
        textAnchor="end"
        fontSize="3.4"
        fontWeight="600"
        letterSpacing="0.08"
        fill="#e8ecf1"
        style={{ pointerEvents: "none" }}
      >
        {floor.code === "B1" ? "B1" : `${floor.code.replace("F", "")}F`}
      </text>
    </svg>
  );
}
