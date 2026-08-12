/** Spec defaults for agent container kill policy (design §3). */
export const AGENT_HEARTBEAT_INTERVAL_SEC = 10;
export const AGENT_HEARTBEAT_MISS_THRESHOLD = 3;
export const AGENT_IDLE_MS = 30 * 60 * 1000;
export const AGENT_WALL_CLOCK_MS = 2 * 60 * 60 * 1000;

/** Miss window: interval × threshold (e.g. 10s × 3 = 30s without heartbeat). */
export function agentHeartbeatMissWindowMs(
  intervalSec = AGENT_HEARTBEAT_INTERVAL_SEC,
  threshold = AGENT_HEARTBEAT_MISS_THRESHOLD,
): number {
  return intervalSec * threshold * 1000;
}
