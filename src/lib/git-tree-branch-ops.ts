import { NextResponse } from "next/server";
import {
  getBlockingAgentSession,
  isAgentSessionActive,
} from "@/lib/agent-state";
import { isDeploymentActive } from "@/lib/deployer";

export function branchOpsBlockedResponse(projectId: string) {
  if (isAgentSessionActive(projectId)) {
    const blocking = getBlockingAgentSession(projectId);
    return NextResponse.json(
      {
        error:
          "An agent session is active. End it on the Agents tab before changing branches.",
        blockingAgentSession: blocking
          ? {
              id: blocking.id,
              branch: blocking.branch,
              status: blocking.status,
            }
          : null,
      },
      { status: 409 },
    );
  }

  if (isDeploymentActive(projectId)) {
    return NextResponse.json(
      { error: "A deployment is in progress. Wait for it to finish." },
      { status: 409 },
    );
  }

  return null;
}
