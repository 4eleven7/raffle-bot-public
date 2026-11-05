import { CONFIG } from "../config.js";
import { getDb } from "../storage/database.js";

interface MonitorState {
  started_at: string;
  heartbeat_at: string;
  last_scan_at: string | null;
  stopped_at: string | null;
  pid: number;
}

export function getMonitorStatus(now = Date.now()) {
  const state = getDb().prepare<[], MonitorState>("SELECT * FROM monitor_state WHERE id = 1").get();
  if (!state) return { status: "unknown" as const, heartbeatAgeMs: null, lastScanAt: null };
  const age = Math.max(0, now - Date.parse(state.heartbeat_at));
  return {
    status: state.stopped_at ? "stopped" as const : age > CONFIG.monitor.heartbeatStaleMs ? "stale" as const : "running" as const,
    heartbeatAgeMs: age,
    lastScanAt: state.last_scan_at,
    startedAt: state.started_at,
    pid: state.pid,
  };
}

export function recordMonitorHeartbeat(now = new Date(), starting = false): number | null {
  const db = getDb();
  const timestamp = now.toISOString();
  return db.transaction(() => {
    const previous = db.prepare<[], MonitorState>("SELECT * FROM monitor_state WHERE id = 1").get();
    const gap = previous ? now.getTime() - Date.parse(previous.heartbeat_at) : 0;
    if (previous && gap > CONFIG.monitor.heartbeatStaleMs) {
      db.prepare("INSERT INTO monitor_gaps (started_at, resumed_at) VALUES (?, ?)").run(previous.heartbeat_at, timestamp);
    }
    db.prepare(`INSERT INTO monitor_state (id, started_at, heartbeat_at, pid) VALUES (1, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET heartbeat_at=excluded.heartbeat_at, stopped_at=NULL,
      started_at=CASE WHEN ? THEN excluded.started_at ELSE monitor_state.started_at END, pid=excluded.pid`)
      .run(timestamp, timestamp, process.pid, starting ? 1 : 0);
    return gap > CONFIG.monitor.heartbeatStaleMs ? gap : null;
  })();
}

export function recordMonitorScan(now = new Date()): void {
  getDb().prepare("UPDATE monitor_state SET last_scan_at = ? WHERE id = 1").run(now.toISOString());
}

export function startMonitorHeartbeat() {
  const pulse = (starting = false) => {
    try {
      const gap = recordMonitorHeartbeat(new Date(), starting);
      if (gap !== null) console.warn(`Monitor coverage gap: ${Math.round(gap / 60_000)} minutes without a heartbeat. Host sleep or a stopped process can cause this.`);
    } catch (error) { console.warn(`Could not record monitor heartbeat: ${error}`); }
  };
  pulse(true);
  const timer = setInterval(pulse, Math.max(1000, CONFIG.monitor.heartbeatIntervalMs));
  timer.unref();
  return () => {
    clearInterval(timer);
    getDb().prepare("UPDATE monitor_state SET stopped_at = ? WHERE id = 1").run(new Date().toISOString());
  };
}
