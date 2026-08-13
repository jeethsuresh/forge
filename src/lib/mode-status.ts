import type { RuntimeStatus } from "@/lib/project-status";
import type { SemanticTone } from "@/lib/ui-status";
import { runtimeTone, statusTone } from "@/lib/ui-status";
import type { ProjectMode } from "@/lib/project-routes";

export type ModeStatusSignals = {
  runtimeStatus: RuntimeStatus;
  isDeploying: boolean;
  latestDeployStatus: string | null;
  hasAttention: boolean;
  agentLive: boolean;
  workingTreeDirty: boolean;
};

export type ModeStatusMap = Record<ProjectMode, SemanticTone>;

export function deployModeTone(signals: ModeStatusSignals): SemanticTone {
  if (signals.isDeploying) return "warning";
  if (signals.latestDeployStatus) {
    return statusTone(signals.latestDeployStatus);
  }
  return "neutral";
}

export function modeStatuses(signals: ModeStatusSignals): ModeStatusMap {
  return {
    overview: signals.hasAttention
      ? "warning"
      : runtimeTone(signals.runtimeStatus) === "success"
        ? "success"
        : runtimeTone(signals.runtimeStatus),
    deploy: deployModeTone(signals),
    agents: signals.agentLive ? "info" : "neutral",
    changes: signals.workingTreeDirty ? "warning" : "neutral",
    settings: "neutral",
  };
}

export function projectRowTone(signals: ModeStatusSignals): SemanticTone {
  if (signals.isDeploying) return "warning";
  if (signals.latestDeployStatus === "failed") return "danger";
  if (signals.agentLive) return "info";
  if (signals.hasAttention) return "warning";
  return runtimeTone(signals.runtimeStatus);
}
