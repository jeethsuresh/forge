import type { AgentKillReason } from "@/lib/db/schema";

export const MAX_AGENT_EXIT_RESTARTS = 3;

const UNRECOVERABLE_KILL_REASONS = new Set<AgentKillReason>([
  "user_stop",
  "heartbeat_miss",
  "idle_timeout",
  "wall_clock",
  "branch_merged",
  "branch_deleted",
]);

export function isUnrecoverableKillReason(
  reason: string | null | undefined,
): boolean {
  if (!reason) return false;
  return UNRECOVERABLE_KILL_REASONS.has(reason as AgentKillReason);
}

export function isRecoverableAgentExit(input: {
  exitCode: number;
  killReason?: string | null;
  restartCount: number;
}): boolean {
  if (input.restartCount >= MAX_AGENT_EXIT_RESTARTS) return false;
  if (isUnrecoverableKillReason(input.killReason)) return false;
  if (input.exitCode === 0) return false;
  if (input.exitCode === 137) return false;
  return true;
}

export type AgentTurnExitAction =
  | { type: "succeed" }
  | { type: "fail" }
  | { type: "restart" }
  | { type: "abort"; reason: "cancel" | "end" | "stop" };

export function nextAgentTurnExitAction(input: {
  cancelled: boolean;
  ended: boolean;
  stopping: boolean;
  exitCode: number;
  killReason?: string | null;
  restartCount: number;
}): AgentTurnExitAction {
  if (input.cancelled) return { type: "abort", reason: "cancel" };
  if (input.ended) return { type: "abort", reason: "end" };
  if (input.stopping) return { type: "abort", reason: "stop" };
  if (input.exitCode === 0) return { type: "succeed" };
  if (
    isRecoverableAgentExit({
      exitCode: input.exitCode,
      killReason: input.killReason,
      restartCount: input.restartCount,
    })
  ) {
    return { type: "restart" };
  }
  return { type: "fail" };
}

export async function runAgentContainerWithRestart(opts: {
  initialRestartCount: number;
  start: () => Promise<void>;
  waitForExit: () => Promise<number>;
  getKillReason: () => string | null;
  onExit: (info: {
    exitCode: number;
    attempt: number;
    recoverable: boolean;
  }) => void;
  persistRestart: (restartCount: number, lastExitCode: number | null) => void;
  remove: () => Promise<void>;
  isCancelled: () => boolean;
  isEnded: () => boolean;
  isStopping: () => boolean;
}): Promise<{
  outcome: "success" | "fail" | "cancel" | "end" | "stop";
  exitCode: number;
  restartCount: number;
}> {
  let restartCount = opts.initialRestartCount;
  let lastCode = 0;

  while (true) {
    await opts.start();
    lastCode = await opts.waitForExit();
    const action = nextAgentTurnExitAction({
      cancelled: opts.isCancelled(),
      ended: opts.isEnded(),
      stopping: opts.isStopping(),
      exitCode: lastCode,
      killReason: opts.getKillReason(),
      restartCount,
    });

    if (action.type === "abort") {
      return { outcome: action.reason, exitCode: lastCode, restartCount };
    }
    if (action.type === "succeed") {
      opts.persistRestart(0, null);
      return { outcome: "success", exitCode: 0, restartCount: 0 };
    }
    if (action.type === "fail") {
      opts.onExit({
        exitCode: lastCode,
        attempt: restartCount,
        recoverable: false,
      });
      opts.persistRestart(restartCount, lastCode);
      return { outcome: "fail", exitCode: lastCode, restartCount };
    }

    if (action.type !== "restart") {
      const _exhaustive: never = action;
      return _exhaustive;
    }

    opts.onExit({
      exitCode: lastCode,
      attempt: restartCount + 1,
      recoverable: true,
    });
    restartCount += 1;
    opts.persistRestart(restartCount, lastCode);
    await opts.remove();
  }
}

