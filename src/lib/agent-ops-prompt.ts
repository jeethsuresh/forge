import { opsApiBaseUrl, isOpsApiConfigured } from "@/lib/ops-api-auth";

export function forgeOpsApiCatalog(baseUrl: string) {
  return {
    version: 1,
    baseUrl,
    auth: {
      header: "Authorization: Bearer $FORGE_OPS_API_TOKEN",
      alternateHeader: "X-Forge-Ops-Token: $FORGE_OPS_API_TOKEN",
      agentSessionHeader:
        "X-Forge-Agent-Session-Id: <session-id> (optional, links audit log to your session)",
    },
    rules: [
      "Every POST, PATCH, and DELETE request MUST include a non-empty actionDescription field (10–2000 chars) stating exactly what you are doing and why.",
      "Before mutating production state, read current status with the matching GET endpoint.",
      "Include opsActionId from responses when reporting results to the user.",
      "NEVER run Forge's own ./deploy.sh. Redeploy Forge only via POST /api/ops/projects/{projectId}/deploy (or the UI Redeploy/Update action). Running deploy.sh against Forge leaves the container in a state the self-updater cannot recreate properly.",
    ],
    endpoints: [
      { method: "GET", path: "/api/ops", description: "This catalog and usage rules" },
      { method: "GET", path: "/api/ops/actions", description: "Recent audited ops actions" },
      { method: "GET", path: "/api/ops/projects", description: "List all projects with runtime summary" },
      {
        method: "GET",
        path: "/api/ops/projects/{projectId}",
        description: "Project detail: deployments, containers, agents, deploy update",
      },
      {
        method: "PATCH",
        path: "/api/ops/projects/{projectId}",
        description: "Update project config (enabled, hostPort, deployEnvVars)",
        body: { actionDescription: "string (required)", enabled: "boolean?", hostPort: "number|null?" },
      },
      {
        method: "POST",
        path: "/api/ops/projects/{projectId}/deploy",
        description: "Start deploy or Forge self-update",
        body: { actionDescription: "string (required)", branch: "string?" },
      },
      {
        method: "POST",
        path: "/api/ops/projects/{projectId}/rollback",
        description: "Roll back to previous release",
        body: { actionDescription: "string (required)" },
      },
      {
        method: "POST",
        path: "/api/ops/projects/{projectId}/stop",
        description: "Stop running containers",
        body: { actionDescription: "string (required)" },
      },
      {
        method: "GET",
        path: "/api/ops/projects/{projectId}/deployments",
        description: "List recent deployments",
      },
      {
        method: "GET",
        path: "/api/ops/projects/{projectId}/deployments/{deploymentId}",
        description: "Deployment status and full logs",
      },
      {
        method: "GET",
        path: "/api/ops/projects/{projectId}/agent-sessions",
        description: "List agent sessions and branch overview",
      },
      {
        method: "POST",
        path: "/api/ops/projects/{projectId}/agent-sessions",
        description: "Start or resume an agent on a branch",
        body: {
          actionDescription: "string (required)",
          branch: "string (required)",
          prompt: "string (required)",
        },
      },
      {
        method: "GET",
        path: "/api/ops/projects/{projectId}/agent-sessions/{sessionId}",
        description: "Agent session detail, events, and logs",
      },
      {
        method: "POST",
        path: "/api/ops/projects/{projectId}/agent-sessions/{sessionId}/messages",
        description: "Send a follow-up prompt to a running agent",
        body: { actionDescription: "string (required)", prompt: "string (required)" },
      },
      {
        method: "POST",
        path: "/api/ops/projects/{projectId}/agent-sessions/{sessionId}/stop",
        description: "Stop the current agent turn (keeps the session; Retry or End afterward)",
        body: { actionDescription: "string (required)" },
      },
      {
        method: "POST",
        path: "/api/ops/projects/{projectId}/agent-sessions/{sessionId}/end",
        description:
          "End an agent session (manual or recovery) and unblock deploys; optional revertChanges",
        body: {
          actionDescription: "string (required)",
          revertChanges: "boolean?",
        },
      },
    ],
  };
}

export function buildForgeOpsAgentInstructions(
  projectId: string,
  sessionId: string,
): string {
  const baseUrl = opsApiBaseUrl();
  const configured = isOpsApiConfigured();

  return `# Forge Operations API

You orchestrate deployments and monitoring for this project through Forge's Ops API.
${configured ? "The token is available in your environment as FORGE_OPS_API_TOKEN." : "WARNING: FORGE_OPS_API_TOKEN is not configured; ops calls will fail until an operator sets it."}

## Required behavior

1. **State your intent before every mutating call.** Each POST/PATCH must include \`actionDescription\` (10–2000 characters) explaining exactly what you are doing, which project/branch/deployment it affects, and why.
2. **Check before you change.** Use GET endpoints to read deploy status, logs, and container state before deploy, rollback, or stop.
3. **Report opsActionId.** Mutating responses include \`opsActionId\`; mention it when summarizing actions.
4. **NEVER run Forge's own \`./deploy.sh\`.** If this is the Forge/Orchestrator project (or you need to redeploy Forge itself), use \`POST /api/ops/projects/{projectId}/deploy\` — never invoke \`deploy.sh\` in the Forge source tree. Running \`deploy.sh\` against Forge leaves the container in a state the self-updater cannot recreate properly.

## Authentication

\`\`\`bash
curl -sS -H "Authorization: Bearer $FORGE_OPS_API_TOKEN" \\
  -H "X-Forge-Agent-Session-Id: ${sessionId}" \\
  "${baseUrl}/api/ops/projects/${projectId}"
\`\`\`

## Common operations

**Check project status**
\`\`\`bash
curl -sS -H "Authorization: Bearer $FORGE_OPS_API_TOKEN" \\
  -H "X-Forge-Agent-Session-Id: ${sessionId}" \\
  "${baseUrl}/api/ops/projects/${projectId}"
\`\`\`

**Deploy**
\`\`\`bash
curl -sS -X POST -H "Authorization: Bearer $FORGE_OPS_API_TOKEN" \\
  -H "Content-Type: application/json" \\
  -H "X-Forge-Agent-Session-Id: ${sessionId}" \\
  -d '{"actionDescription":"Deploying main after merging the feature branch because tests passed locally.","branch":"main"}' \\
  "${baseUrl}/api/ops/projects/${projectId}/deploy"
\`\`\`

**Poll deployment logs**
\`\`\`bash
curl -sS -H "Authorization: Bearer $FORGE_OPS_API_TOKEN" \\
  "${baseUrl}/api/ops/projects/${projectId}/deployments/{deploymentId}"
\`\`\`

**Roll back**
\`\`\`bash
curl -sS -X POST -H "Authorization: Bearer $FORGE_OPS_API_TOKEN" \\
  -H "Content-Type: application/json" \\
  -H "X-Forge-Agent-Session-Id: ${sessionId}" \\
  -d '{"actionDescription":"Rolling back production because health checks failed after the last deploy."}' \\
  "${baseUrl}/api/ops/projects/${projectId}/rollback"
\`\`\`

Full endpoint catalog: \`GET ${baseUrl}/api/ops\`

## Rebase recovery

When rebasing, if the rebase command fails, create a special agent session in a new branch (off of the base branch) and attempt to rebase the divergent branch onto it. Once that's done, the agent should be able to remove the old branch, and rename the new branch to the old branch name for continuity.

**Finalize rebase recovery** (after conflicts are resolved and tests pass)
\`\`\`bash
curl -sS -X POST -H "Authorization: Bearer $FORGE_OPS_API_TOKEN" \\
  -H "Content-Type: application/json" \\
  -H "X-Forge-Agent-Session-Id: ${sessionId}" \\
  -d '{"recoveryBranch":"forge-rebase/feature-x","sourceBranch":"feature/x"}' \\
  "${baseUrl}/api/projects/${projectId}/git-tree/rebase/finalize"
\`\`\`

## Recovery agent sessions

Recovery agents should not block other agents from being started on the same branch. When a turn finishes successfully, Forge commits workspace changes and ends the session. When it fails, uncommitted changes stay in the workspace but the session still ends so another agent can run.

Review uncommitted changes after a failed recovery run. Commit them manually if you want to keep the work, or end the session with \`revertChanges: true\` to discard them before starting another agent.

\`\`\`bash
curl -sS -X POST -H "Authorization: Bearer $FORGE_OPS_API_TOKEN" \\
  -H "Content-Type: application/json" \\
  -H "X-Forge-Agent-Session-Id: ${sessionId}" \\
  -d '{"actionDescription":"Ending the failed recovery session and reverting uncommitted workspace changes so a new agent can run on this branch.","revertChanges":true}' \\
  "${baseUrl}/api/ops/projects/${projectId}/agent-sessions/{sessionId}/end"
\`\`\`
`;
}

export function prependForgeOpsInstructions(
  prompt: string,
  projectId: string,
  sessionId: string,
  includeInstructions: boolean,
): string {
  if (!includeInstructions) return prompt;
  return `${buildForgeOpsAgentInstructions(projectId, sessionId)}\n\n---\n\n${prompt}`;
}
