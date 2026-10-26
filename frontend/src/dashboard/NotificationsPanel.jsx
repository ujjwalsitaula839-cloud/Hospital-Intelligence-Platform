import { useEffect, useState } from "react";
import { ESI, UNIT_ORDER, countdown } from "./network/ems";
import { NO_ANSWER_LEAD_SECONDS } from "./ui";

const SEEN_KEY = "hip:notifications:seen";
const DESKTOP_KEY = "hip:notifications:desktop";
// Flow event kinds worth a line in the activity feed.
const FEED_KINDS = new Set(["ems", "admit", "discharge", "transfer", "incident"]);

function readNumber(key) {
  try {
    return Number(window.localStorage.getItem(key)) || 0;
  } catch {
    return 0;
  }
}

function write(key, value) {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // Private windows can block storage; the panel still works for this visit.
  }
}

export function desktopAlertsOn() {
  try {
    return window.localStorage.getItem(DESKTOP_KEY) === "1" && window.Notification?.permission === "granted";
  } catch {
    return false;
  }
}

function ago(iso, now) {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h`;
}

// Latest activity id, so the bell can show a dot for anything newer than the last look.
export function latestActivityId(movements) {
  return movements.reduce((top, item) => (FEED_KINDS.has(item.kind) ? Math.max(top, item.id) : top), 0);
}

export function lastSeenActivity() {
  return readNumber(SEEN_KEY);
}

export default function NotificationsPanel({
  open,
  now,
  pending = [],
  arrived = [],
  incidents = [],
  capacity,
  movements = [],
  busy = "",
  onClose,
  onOpenRun,
  onAcceptRun,
  onHandoffRun,
  onOpenRoom,
  onOpenOverview,
  onSeen,
}) {
  const [seen, setSeen] = useState(readNumber(SEEN_KEY));
  const [desktop, setDesktop] = useState(desktopAlertsOn);
  const supported = typeof window !== "undefined" && "Notification" in window;
  const feed = movements.filter((item) => FEED_KINDS.has(item.kind)).slice(0, 8);
  const tight = UNIT_ORDER.map((key) => ({ key, ...(capacity?.units?.[key] || {}) })).filter(
    (unit) => unit.level === "full" || unit.level === "limited",
  );
  const newest = latestActivityId(movements);

  // Opening the panel counts as reading it.
  useEffect(() => {
    if (!open || !newest) return;
    write(SEEN_KEY, newest);
    onSeen?.(newest);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function toggleDesktop() {
    if (desktop) {
      write(DESKTOP_KEY, "0");
      setDesktop(false);
      return;
    }
    const permission = window.Notification.permission === "granted" ? "granted" : await window.Notification.requestPermission();
    const on = permission === "granted";
    write(DESKTOP_KEY, on ? "1" : "0");
    setDesktop(on);
    if (on) new window.Notification("Desktop alerts are on", { body: "New ambulance pre-alerts will pop up here.", icon: "/logo.png" });
  }

  if (!open) return null;
  const actionable = pending.length + arrived.length + incidents.length;

  return (
    <div className="notif-pop" role="dialog" aria-label="Notifications">
      <header className="notif-head">
        <div>
          <strong>Notifications</strong>
          <small>{actionable ? `${actionable} need${actionable === 1 ? "s" : ""} you` : "Nothing needs you right now"}</small>
        </div>
        <button type="button" className="notif-close" onClick={onClose} aria-label="Close notifications">×</button>
      </header>

      <div className="notif-body">
        {pending.length > 0 && (
          <section>
            <p className="notif-kicker is-alert">Needs your answer</p>
            {pending.map((run) => {
              const left = Math.max(0, Math.round((new Date(run.eta_at).getTime() - now) / 1000));
              const answerBy = Math.max(0, left - NO_ANSWER_LEAD_SECONDS);
              return (
                <article key={run.id} className="notif-item is-run" style={{ "--esi": ESI[run.esi]?.color, "--esi-soft": ESI[run.esi]?.soft }}>
                  <span className="notif-esi">ESI {run.esi}</span>
                  <div className="notif-text">
                    <b>{run.complaint_label}</b>
                    <span>{run.unit} · ETA {countdown(left)} · answer within {countdown(answerBy)}</span>
                    <div className="notif-actions">
                      {run.bed_id && (
                        <button type="button" className="is-primary" disabled={Boolean(busy)} onClick={() => onAcceptRun(run)}>
                          Accept · hold {run.bed_id}
                        </button>
                      )}
                      <button type="button" onClick={() => onOpenRun(run)}>Open</button>
                    </div>
                  </div>
                </article>
              );
            })}
          </section>
        )}

        {arrived.length > 0 && (
          <section>
            <p className="notif-kicker">At the EMS bay</p>
            {arrived.map((run) => (
              <article key={run.id} className="notif-item is-run" style={{ "--esi": ESI[run.esi]?.color, "--esi-soft": ESI[run.esi]?.soft }}>
                <span className="notif-esi">ESI {run.esi}</span>
                <div className="notif-text">
                  <b>{run.unit} is here</b>
                  <span>{run.complaint_label}{run.bed_id ? ` · bed ${run.bed_id}` : ""}</span>
                  <div className="notif-actions">
                    <button type="button" className="is-primary" disabled={Boolean(busy)} onClick={() => onHandoffRun(run)}>
                      Handoff complete
                    </button>
                    {run.bed_id && <button type="button" onClick={() => onOpenRoom(run.bed_id)}>Show bed</button>}
                  </div>
                </div>
              </article>
            ))}
          </section>
        )}

        {(tight.length > 0 || incidents.length > 0) && (
          <section>
            <p className="notif-kicker">Capacity and incidents</p>
            {tight.map((unit) => (
              <button key={unit.key} type="button" className="notif-item is-row" onClick={onOpenOverview}>
                <i className={`notif-dot is-${unit.level}`} />
                <div className="notif-text">
                  <b>{unit.label}: {unit.open} open</b>
                  <span>{unit.level === "full" ? "Full. Divert the next ambulance that needs it." : `${unit.occupancy_pct}% occupied, getting tight`}</span>
                </div>
              </button>
            ))}
            {incidents.map((item) => (
              <button key={item.id} type="button" className="notif-item is-row" onClick={() => onOpenRoom(item.room_id)}>
                <i className="notif-dot is-incident" />
                <div className="notif-text">
                  <b>{item.room_id} · out of service</b>
                  <span>{item.title}</span>
                </div>
              </button>
            ))}
          </section>
        )}

        <section>
          <p className="notif-kicker">Recent activity</p>
          {feed.length === 0 && <p className="notif-empty">Admissions, discharges and ambulance events show up here.</p>}
          {feed.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.id > seen ? "notif-item is-row is-new" : "notif-item is-row"}
              onClick={() => item.room_id && onOpenRoom(item.room_id)}
            >
              <i className={`notif-dot is-${item.kind}`} />
              <div className="notif-text">
                <b>{item.message}</b>
                <span>{item.room_id ? `${item.room_id} · ` : ""}{ago(item.created_at, now)} ago</span>
              </div>
            </button>
          ))}
        </section>
      </div>

      <footer className="notif-foot">
        {supported ? (
          <button type="button" className={desktop ? "notif-toggle is-on" : "notif-toggle"} onClick={toggleDesktop} role="switch" aria-checked={desktop}>
            <i />
            Desktop alerts for new pre-alerts
          </button>
        ) : (
          <span>Desktop alerts are not supported in this browser.</span>
        )}
        <button
          type="button"
          className="notif-read"
          onClick={() => {
            write(SEEN_KEY, newest);
            setSeen(newest);
            onSeen?.(newest);
          }}
        >
          Mark all read
        </button>
      </footer>
    </div>
  );
}
