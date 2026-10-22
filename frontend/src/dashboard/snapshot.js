// Last known state, kept in this browser so the next visit paints instantly while the API wakes up.
// It is only a head start: every screen says "last snapshot" until the live census answers.
const KEY = "hip:snapshot:v1";
const MAX_AGE_MS = 12 * 60 * 60 * 1000;
// Ambulances move fast; older than this and the countdowns would be wrong, so they are dropped.
const RUNS_MAX_AGE_MS = 3 * 60 * 1000;
const WRITE_EVERY_MS = 10000;

let pending = {};
let lastWrite = 0;

export function loadSnapshot() {
  try {
    const data = JSON.parse(window.localStorage.getItem(KEY) || "null");
    if (!data?.at || Date.now() - data.at > MAX_AGE_MS) return null;
    const runsFresh = Date.now() - (data.runsAt || 0) < RUNS_MAX_AGE_MS;
    return { ...data, runs: runsFresh ? data.runs : null };
  } catch {
    return null;
  }
}

// Throttled: the census arrives every two seconds, the browser only writes every ten.
export function saveSnapshot(part) {
  pending = { ...pending, ...part };
  const now = Date.now();
  if (now - lastWrite < WRITE_EVERY_MS) return;
  lastWrite = now;
  try {
    const current = JSON.parse(window.localStorage.getItem(KEY) || "{}");
    window.localStorage.setItem(KEY, JSON.stringify({ ...current, ...pending, at: now }));
    pending = {};
  } catch {
    // Storage full or blocked (private window): the snapshot is optional.
  }
}
