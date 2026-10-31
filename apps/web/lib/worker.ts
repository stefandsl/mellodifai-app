// A worker is online while its heartbeat is at most 45 s old.
export function workerIsOnline(lastSeen: string | null, now = Date.now()) {
  return Boolean(lastSeen && now - Date.parse(lastSeen) <= 45000);
}
