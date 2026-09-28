import { forgeOpsApiCatalog } from "@/lib/agent-ops-prompt";
import type {
  ForgeAgentAuth,
  ForgeAgentKind,
  ForgeAgentPrompt,
  ForgeAgentResource,
  ForgeAgentTool,
  JsonSchema,
  SearchableItem,
} from "@/lib/forge-agent/types";

const ACTION_DESCRIPTION: Record<string, unknown> = {
  type: "string",
  minLength: 10,
  maxLength: 2000,
  description: "Exactly what you are doing and why (10–2000 chars)",
};

function objectSchema(
  properties: JsonSchema["properties"],
  required: string[] = [],
): JsonSchema {
  return { type: "object", properties, required, additionalProperties: false };
}

function opsTool(
  name: string,
  description: string,
  method: string,
  path: string,
  tags: string[],
  properties: JsonSchema["properties"],
  required: string[] = [],
): ForgeAgentTool {
  return {
    name,
    description,
    tags,
    method,
    path,
    callable: true,
    auth: "ops",
    kind: "ops",
    inputSchema: objectSchema(properties, required),
  };
}

function dashboardTool(
  name: string,
  description: string,
  method: string,
  path: string,
  tags: string[],
  properties: JsonSchema["properties"] = {},
  required: string[] = [],
): ForgeAgentTool {
  return {
    name,
    description: `${description} Requires a dashboard cookie session; not callable with an Ops bearer.`,
    tags: [...tags, "dashboard"],
    method,
    path,
    callable: false,
    auth: "dashboard_cookie",
    kind: "dashboard",
    inputSchema: objectSchema(properties, required),
  };
}

const PROJECT_ID = { type: "string", description: "Forge project id" };
const SESSION_ID = { type: "string", description: "Agent session id" };

function opsTools(): ForgeAgentTool[] {
  return [
    opsTool(
      "ops.catalog.get",
      "Existing Ops catalog and usage rules",
      "GET",
      "/api/ops",
      ["catalog", "ops"],
      {},
    ),
    opsTool(
      "ops.actions.list",
      "Recent audited ops actions",
      "GET",
      "/api/ops/actions",
      ["audit", "actions"],
      { limit: { type: "number", description: "Max rows (1–100)" } },
    ),
    opsTool(
      "ops.projects.list",
      "List projects with runtime summary (session tokens see only their project)",
      "GET",
      "/api/ops/projects",
      ["projects"],
      {},
    ),
    opsTool(
      "ops.projects.create",
      "Create a seeded Forge git repository and project, or one-shot import GitHub. Requires a global or fmu.* token (not fos.*). Clone with that same bearer; the response does not include fgc clone tokens.",
      "POST",
      "/api/ops/projects",
      ["projects", "git"],
      {
        actionDescription: ACTION_DESCRIPTION,
        mode: {
          type: "string",
          description: "create (default), import, or local (seeded alias of create)",
        },
        name: { type: "string", description: "Required for create/local" },
        slug: { type: "string", description: "Optional git slug" },
        branch: { type: "string", description: "Default branch (default main)" },
        githubRepo: {
          type: "string",
          description: "owner/repo required for mode=import",
        },
      },
      ["actionDescription"],
    ),
    opsTool(
      "ops.project.get",
      "Project detail: deployments, containers, agents, deploy update",
      "GET",
      "/api/ops/projects/{projectId}",
      ["projects", "status"],
      { projectId: PROJECT_ID },
      ["projectId"],
    ),
    opsTool(
      "ops.project.patch",
      "Update project config (enabled, hostPort, deployEnvVars)",
      "PATCH",
      "/api/ops/projects/{projectId}",
      ["projects", "config"],
      {
        projectId: PROJECT_ID,
        actionDescription: ACTION_DESCRIPTION,
        enabled: { type: "boolean" },
        hostPort: { type: ["number", "null"] },
      },
      ["projectId", "actionDescription"],
    ),
    opsTool(
      "ops.project.forgefile.get",
      "Forgefile projection status, parsed manifest, and deploy targets",
      "GET",
      "/api/ops/projects/{projectId}/forgefile",
      ["forgefile", "bootstrap"],
      { projectId: PROJECT_ID },
      ["projectId"],
    ),
    opsTool(
      "ops.services.list",
      "Fleet service directory. Optional projectId filter; session tokens are scoped.",
      "GET",
      "/api/ops/services",
      ["services", "ports"],
      { projectId: { type: "string" } },
    ),
    opsTool(
      "ops.project.container_logs.get",
      "Latest docker logs for a compose container, including failed-start inspect errors",
      "GET",
      "/api/ops/projects/{projectId}/containers/{containerName}/logs",
      ["containers", "logs"],
      {
        projectId: PROJECT_ID,
        containerName: { type: "string", description: "Docker compose container name" },
        tail: { type: "number", description: "Max lines to return (1–2000)" },
        refresh: { type: "boolean", description: "Pull live docker logs before returning" },
      },
      ["projectId", "containerName"],
    ),
    opsTool(
      "ops.project.artifacts.list",
      "List Forgefile artifact declarations and recent builds",
      "GET",
      "/api/ops/projects/{projectId}/artifacts",
      ["artifacts"],
      { projectId: PROJECT_ID },
      ["projectId"],
    ),
    opsTool(
      "ops.project.artifact.build",
      "Build a declared Forgefile artifact",
      "POST",
      "/api/ops/projects/{projectId}/artifacts/{name}/build",
      ["artifacts", "build"],
      {
        projectId: PROJECT_ID,
        name: { type: "string", description: "Artifact name" },
        actionDescription: ACTION_DESCRIPTION,
        branch: { type: "string" },
      },
      ["projectId", "name", "actionDescription"],
    ),
    opsTool(
      "ops.project.artifact.download",
      "Download a successful artifact build",
      "GET",
      "/api/ops/projects/{projectId}/artifacts/{name}/builds/{buildId}/download",
      ["artifacts"],
      {
        projectId: PROJECT_ID,
        name: { type: "string" },
        buildId: { type: "string" },
      },
      ["projectId", "name", "buildId"],
    ),
    opsTool(
      "ops.project.script.run",
      "Run a named Forgefile scripts.<name> command",
      "POST",
      "/api/ops/projects/{projectId}/scripts/{name}/run",
      ["scripts"],
      {
        projectId: PROJECT_ID,
        name: { type: "string" },
        actionDescription: ACTION_DESCRIPTION,
      },
      ["projectId", "name", "actionDescription"],
    ),
    opsTool(
      "ops.project.deploy",
      "Start deploy or Forge self-update. Never run ./deploy.sh against Forge.",
      "POST",
      "/api/ops/projects/{projectId}/deploy",
      ["deploy"],
      {
        projectId: PROJECT_ID,
        actionDescription: ACTION_DESCRIPTION,
        branch: { type: "string" },
        deployment: { type: "string", description: "Forgefile deploy target name" },
        authorizeActiveSessionDeploy: { type: "boolean" },
      },
      ["projectId", "actionDescription"],
    ),
    opsTool(
      "ops.project.rollback",
      "Roll back to previous release",
      "POST",
      "/api/ops/projects/{projectId}/rollback",
      ["rollback"],
      {
        projectId: PROJECT_ID,
        actionDescription: ACTION_DESCRIPTION,
      },
      ["projectId", "actionDescription"],
    ),
    opsTool(
      "ops.project.stop",
      "Stop running containers",
      "POST",
      "/api/ops/projects/{projectId}/stop",
      ["stop"],
      {
        projectId: PROJECT_ID,
        actionDescription: ACTION_DESCRIPTION,
      },
      ["projectId", "actionDescription"],
    ),
    opsTool(
      "ops.project.deployments.list",
      "List recent deployments",
      "GET",
      "/api/ops/projects/{projectId}/deployments",
      ["deployments"],
      { projectId: PROJECT_ID },
      ["projectId"],
    ),
    opsTool(
      "ops.project.deployment.get",
      "Deployment status and full logs",
      "GET",
      "/api/ops/projects/{projectId}/deployments/{deploymentId}",
      ["deployments", "logs"],
      {
        projectId: PROJECT_ID,
        deploymentId: { type: "string" },
      },
      ["projectId", "deploymentId"],
    ),
    opsTool(
      "ops.project.agent_sessions.list",
      "List agent sessions and branch overview",
      "GET",
      "/api/ops/projects/{projectId}/agent-sessions",
      ["agents"],
      { projectId: PROJECT_ID },
      ["projectId"],
    ),
    opsTool(
      "ops.project.agent_sessions.create",
      "Start or resume an agent on a branch",
      "POST",
      "/api/ops/projects/{projectId}/agent-sessions",
      ["agents"],
      {
        projectId: PROJECT_ID,
        actionDescription: ACTION_DESCRIPTION,
        branch: { type: "string" },
        prompt: { type: "string" },
        createBranch: { type: "boolean" },
      },
      ["projectId", "actionDescription", "branch", "prompt"],
    ),
    opsTool(
      "ops.project.agent_session.get",
      "Agent session detail, events, and logs",
      "GET",
      "/api/ops/projects/{projectId}/agent-sessions/{sessionId}",
      ["agents"],
      { projectId: PROJECT_ID, sessionId: SESSION_ID },
      ["projectId", "sessionId"],
    ),
    opsTool(
      "ops.project.agent_session.messages",
      "Send a follow-up prompt to a running agent",
      "POST",
      "/api/ops/projects/{projectId}/agent-sessions/{sessionId}/messages",
      ["agents"],
      {
        projectId: PROJECT_ID,
        sessionId: SESSION_ID,
        actionDescription: ACTION_DESCRIPTION,
        prompt: { type: "string" },
      },
      ["projectId", "sessionId", "actionDescription", "prompt"],
    ),
    opsTool(
      "ops.project.agent_session.stop",
      "Stop the current agent turn (keeps the session)",
      "POST",
      "/api/ops/projects/{projectId}/agent-sessions/{sessionId}/stop",
      ["agents"],
      {
        projectId: PROJECT_ID,
        sessionId: SESSION_ID,
        actionDescription: ACTION_DESCRIPTION,
      },
      ["projectId", "sessionId", "actionDescription"],
    ),
    opsTool(
      "ops.project.agent_session.end",
      "End an agent session and unblock deploys; optional revertChanges",
      "POST",
      "/api/ops/projects/{projectId}/agent-sessions/{sessionId}/end",
      ["agents", "recovery"],
      {
        projectId: PROJECT_ID,
        sessionId: SESSION_ID,
        actionDescription: ACTION_DESCRIPTION,
        revertChanges: { type: "boolean" },
      },
      ["projectId", "sessionId", "actionDescription"],
    ),
    opsTool(
      "ops.project.agent_session.restart",
      "Archive the current agent and start a fresh one on the same branch",
      "POST",
      "/api/ops/projects/{projectId}/agent-sessions/{sessionId}/restart",
      ["agents"],
      {
        projectId: PROJECT_ID,
        sessionId: SESSION_ID,
        actionDescription: ACTION_DESCRIPTION,
      },
      ["projectId", "sessionId", "actionDescription"],
    ),
    opsTool(
      "ops.project.agent_session.heartbeat",
      "Agent container heartbeat (miss threshold kills the session)",
      "POST",
      "/api/ops/projects/{projectId}/agent-sessions/{sessionId}/heartbeat",
      ["agents", "bootstrap"],
      {
        projectId: PROJECT_ID,
        sessionId: SESSION_ID,
        actionDescription: ACTION_DESCRIPTION,
      },
      ["projectId", "sessionId", "actionDescription"],
    ),
    opsTool(
      "ops.project.agent_session.events",
      "Ingest agent stream/events into agent_events",
      "POST",
      "/api/ops/projects/{projectId}/agent-sessions/{sessionId}/events",
      ["agents", "bootstrap"],
      {
        projectId: PROJECT_ID,
        sessionId: SESSION_ID,
        actionDescription: ACTION_DESCRIPTION,
        events: { type: "array" },
        event: { type: "object" },
        line: { type: "string" },
      },
      ["projectId", "sessionId", "actionDescription"],
    ),
    opsTool(
      "ops.project.secret.request",
      "Request a named project/global secret (hybrid; docker/host names denied)",
      "POST",
      "/api/ops/projects/{projectId}/secrets/{name}/request",
      ["secrets"],
      {
        projectId: PROJECT_ID,
        name: { type: "string" },
        actionDescription: ACTION_DESCRIPTION,
      },
      ["projectId", "name", "actionDescription"],
    ),
    opsTool(
      "ops.project.git.rebase_finalize",
      "Finalize rebase recovery: rename recovery branch to source and clean workspaces",
      "POST",
      "/api/ops/projects/{projectId}/git-tree/rebase/finalize",
      ["git", "rebase", "recovery"],
      {
        projectId: PROJECT_ID,
        actionDescription: ACTION_DESCRIPTION,
        recoveryBranch: { type: "string" },
        sourceBranch: { type: "string" },
      },
      ["projectId", "actionDescription", "recoveryBranch", "sourceBranch"],
    ),
  ];
}

function dashboardTools(): ForgeAgentTool[] {
  return [
    dashboardTool(
      "dashboard.projects.create",
      "Create a project from the dashboard. Prefer ops.projects.create with an Ops bearer.",
      "POST",
      "/api/projects",
      ["projects"],
    ),
    dashboardTool(
      "dashboard.project.get",
      "Dashboard project detail.",
      "GET",
      "/api/projects/{id}",
      ["projects"],
      { id: PROJECT_ID },
      ["id"],
    ),
    dashboardTool(
      "dashboard.project.container_logs",
      "Dashboard compose container logs.",
      "GET",
      "/api/projects/{id}/containers/{containerName}/logs",
      ["containers", "logs"],
      {
        id: PROJECT_ID,
        containerName: { type: "string" },
      },
      ["id", "containerName"],
    ),
    dashboardTool(
      "dashboard.project.deploy",
      "Dashboard deploy (use ops.project.deploy instead).",
      "POST",
      "/api/projects/{id}/deploy",
      ["deploy"],
      { id: PROJECT_ID },
      ["id"],
    ),
    dashboardTool(
      "dashboard.project.stop",
      "Dashboard stop.",
      "POST",
      "/api/projects/{id}/stop",
      ["stop"],
      { id: PROJECT_ID },
      ["id"],
    ),
    dashboardTool(
      "dashboard.project.rollback",
      "Dashboard rollback (use ops.project.rollback instead).",
      "POST",
      "/api/projects/{id}/rollback",
      ["rollback"],
      { id: PROJECT_ID },
      ["id"],
    ),
    dashboardTool(
      "dashboard.project.git_tree",
      "Git tree browser and branch graph.",
      "GET",
      "/api/projects/{id}/git-tree",
      ["git"],
      { id: PROJECT_ID },
      ["id"],
    ),
    dashboardTool(
      "dashboard.project.git_tree.rebase",
      "Start a rebase from the dashboard git tree.",
      "POST",
      "/api/projects/{id}/git-tree/rebase",
      ["git", "rebase"],
      { id: PROJECT_ID },
      ["id"],
    ),
    dashboardTool(
      "dashboard.project.git_tree.rebase.finalize",
      "Cookie-auth rebase finalize. Prefer ops.project.git.rebase_finalize.",
      "POST",
      "/api/projects/{id}/git-tree/rebase/finalize",
      ["git", "rebase"],
      { id: PROJECT_ID, recoveryBranch: { type: "string" }, sourceBranch: { type: "string" } },
      ["id", "recoveryBranch", "sourceBranch"],
    ),
    dashboardTool(
      "dashboard.project.git_tree.merge",
      "Merge from the dashboard git tree.",
      "POST",
      "/api/projects/{id}/git-tree/merge",
      ["git"],
      { id: PROJECT_ID },
      ["id"],
    ),
    dashboardTool(
      "dashboard.project.git_tree.push_all",
      "Push all branches from the dashboard.",
      "POST",
      "/api/projects/{id}/git-tree/push-all",
      ["git"],
      { id: PROJECT_ID },
      ["id"],
    ),
    dashboardTool(
      "dashboard.project.git_tree.resolve_conflicts",
      "Resolve git-tree conflicts in the dashboard.",
      "POST",
      "/api/projects/{id}/git-tree/resolve-conflicts",
      ["git"],
      { id: PROJECT_ID },
      ["id"],
    ),
    dashboardTool(
      "dashboard.project.compose",
      "Compose studio document.",
      "GET",
      "/api/projects/{id}/compose",
      ["compose"],
      { id: PROJECT_ID },
      ["id"],
    ),
    dashboardTool(
      "dashboard.project.compose.create",
      "Create compose from the studio.",
      "POST",
      "/api/projects/{id}/compose/create",
      ["compose"],
      { id: PROJECT_ID },
      ["id"],
    ),
    dashboardTool(
      "dashboard.project.compose.merge_deploy",
      "Merge-deploy from compose studio.",
      "POST",
      "/api/projects/{id}/compose/merge-deploy",
      ["compose", "deploy"],
      { id: PROJECT_ID },
      ["id"],
    ),
    dashboardTool(
      "dashboard.project.branch_editor",
      "Per-branch file editor.",
      "GET",
      "/api/projects/{id}/branch-editor",
      ["editor"],
      { id: PROJECT_ID },
      ["id"],
    ),
    dashboardTool(
      "dashboard.project.branch_editor.file",
      "Read/write a file in the branch editor.",
      "GET",
      "/api/projects/{id}/branch-editor/file",
      ["editor"],
      { id: PROJECT_ID },
      ["id"],
    ),
    dashboardTool(
      "dashboard.project.branch_editor.commit",
      "Commit from the branch editor.",
      "POST",
      "/api/projects/{id}/branch-editor/commit",
      ["editor", "git"],
      { id: PROJECT_ID },
      ["id"],
    ),
    dashboardTool(
      "dashboard.settings.routing",
      "Global project routing settings.",
      "GET",
      "/api/settings/project-routing",
      ["settings", "routing"],
    ),
    dashboardTool(
      "dashboard.settings.migration",
      "Install/migration preview.",
      "GET",
      "/api/settings/migration/preview",
      ["settings", "migration"],
    ),
    dashboardTool(
      "dashboard.settings.git_ssh_keys",
      "Git SSH keys in settings.",
      "GET",
      "/api/settings/git-ssh-keys",
      ["settings", "git"],
    ),
  ];
}

function uniqueTools(tools: ForgeAgentTool[]): ForgeAgentTool[] {
  const seen = new Set<string>();
  return tools.filter((tool) => {
    if (seen.has(tool.name)) return false;
    seen.add(tool.name);
    return true;
  });
}

export function listForgeAgentTools(): ForgeAgentTool[] {
  return uniqueTools([...opsTools(), ...dashboardTools()]);
}

export function getForgeAgentTool(name: string): ForgeAgentTool | undefined {
  return listForgeAgentTools().find((tool) => tool.name === name);
}

function resource(
  name: string,
  uriTemplate: string,
  description: string,
  tags: string[],
  auth: ForgeAgentAuth,
  kind: ForgeAgentKind,
  live: boolean,
  readTool?: string,
): ForgeAgentResource {
  return {
    name,
    uriTemplate,
    description,
    tags,
    mimeType: "application/json",
    auth,
    kind,
    live,
    readTool,
  };
}

export function listForgeAgentResources(): ForgeAgentResource[] {
  return [
    resource(
      "ops.catalog",
      "forge://ops/catalog",
      "Ops catalog and usage rules",
      ["catalog"],
      "ops",
      "ops",
      true,
      "ops.catalog.get",
    ),
    resource(
      "ops.projects",
      "forge://ops/projects",
      "Project list with runtime summary",
      ["projects"],
      "ops",
      "ops",
      true,
      "ops.projects.list",
    ),
    resource(
      "ops.project",
      "forge://ops/projects/{projectId}",
      "Live project detail",
      ["projects", "status"],
      "ops",
      "ops",
      true,
      "ops.project.get",
    ),
    resource(
      "ops.forgefile",
      "forge://ops/projects/{projectId}/forgefile",
      "Forgefile projection",
      ["forgefile"],
      "ops",
      "ops",
      true,
      "ops.project.forgefile.get",
    ),
    resource(
      "ops.services",
      "forge://ops/services",
      "Service directory",
      ["services"],
      "ops",
      "ops",
      true,
      "ops.services.list",
    ),
    resource(
      "ops.container_logs",
      "forge://ops/projects/{projectId}/containers/{containerName}/logs",
      "Compose container logs",
      ["containers", "logs"],
      "ops",
      "ops",
      true,
      "ops.project.container_logs.get",
    ),
    resource(
      "ops.actions",
      "forge://ops/actions",
      "Audited ops actions",
      ["audit"],
      "ops",
      "ops",
      true,
      "ops.actions.list",
    ),
    resource(
      "ops.deployments",
      "forge://ops/projects/{projectId}/deployments",
      "Deployment list",
      ["deployments"],
      "ops",
      "ops",
      true,
      "ops.project.deployments.list",
    ),
    resource(
      "ops.deployment",
      "forge://ops/projects/{projectId}/deployments/{deploymentId}",
      "Deployment logs",
      ["deployments"],
      "ops",
      "ops",
      true,
      "ops.project.deployment.get",
    ),
    resource(
      "ops.artifacts",
      "forge://ops/projects/{projectId}/artifacts",
      "Artifact declarations and builds",
      ["artifacts"],
      "ops",
      "ops",
      true,
      "ops.project.artifacts.list",
    ),
    resource(
      "git.smart_http",
      "forge://git/{slug}",
      "Forge git smart HTTP advertise/clone. Auth: Bearer Ops/session token or Basic password=token. See docs/git-server.md",
      ["git"],
      "ops",
      "git",
      false,
    ),
    resource(
      "dashboard.git_tree",
      "forge://dashboard/projects/{projectId}/git-tree",
      "Dashboard git tree (cookie session)",
      ["dashboard", "git"],
      "dashboard_cookie",
      "dashboard",
      false,
    ),
    resource(
      "dashboard.compose",
      "forge://dashboard/projects/{projectId}/compose",
      "Compose studio (cookie session)",
      ["dashboard", "compose"],
      "dashboard_cookie",
      "dashboard",
      false,
    ),
    resource(
      "dashboard.settings",
      "forge://dashboard/settings",
      "Global settings (cookie session)",
      ["dashboard", "settings"],
      "dashboard_cookie",
      "dashboard",
      false,
    ),
    resource(
      "dashboard.branch_editor",
      "forge://dashboard/projects/{projectId}/branch-editor",
      "Branch file editor (cookie session)",
      ["dashboard", "editor"],
      "dashboard_cookie",
      "dashboard",
      false,
    ),
  ];
}

export function getForgeAgentResource(name: string): ForgeAgentResource | undefined {
  return listForgeAgentResources().find((item) => item.name === name);
}

export function listForgeAgentPrompts(): ForgeAgentPrompt[] {
  return [
    {
      name: "forge.deploy",
      description: "Check project status, then deploy with actionDescription. Never run Forge ./deploy.sh.",
      tags: ["deploy"],
      arguments: [
        { name: "projectId", description: "Project id", required: true },
        { name: "branch", description: "Git branch", required: false },
        { name: "deployment", description: "Forgefile deploy target", required: false },
      ],
      template: `Check GET /api/ops/projects/{{projectId}} and GET /api/ops/projects/{{projectId}}/forgefile.
If healthy, call ops.project.deploy with actionDescription stating the branch and why.
Never run ./deploy.sh against Forge. Optional branch={{branch}} deployment={{deployment}}.`,
    },
    {
      name: "forge.rollback",
      description: "Inspect current deploy, then roll back if health failed.",
      tags: ["rollback"],
      arguments: [{ name: "projectId", description: "Project id", required: true }],
      template: `Read GET /api/ops/projects/{{projectId}} and recent deployments.
If the current release is unhealthy, call ops.project.rollback with actionDescription.`,
    },
    {
      name: "forge.check_status",
      description: "Read project, Forgefile, and service directory.",
      tags: ["status"],
      arguments: [{ name: "projectId", description: "Project id", required: true }],
      template: `GET /api/ops/projects/{{projectId}}
GET /api/ops/projects/{{projectId}}/forgefile
GET /api/ops/services?projectId={{projectId}}
Report runtime, containers, and deploy update.`,
    },
    {
      name: "forge.rebase_recovery",
      description: "Finish rebase recovery via Ops finalize after conflicts are resolved.",
      tags: ["rebase", "recovery"],
      arguments: [
        { name: "projectId", description: "Project id", required: true },
        { name: "recoveryBranch", description: "forge-rebase/… branch", required: true },
        { name: "sourceBranch", description: "Original branch name", required: true },
      ],
      template: `After conflicts are resolved and tests pass, POST /api/ops/projects/{{projectId}}/git-tree/rebase/finalize
with actionDescription, recoveryBranch={{recoveryBranch}}, sourceBranch={{sourceBranch}}.
Do not use the cookie dashboard finalize URL.`,
    },
    {
      name: "forge.forgefile_bootstrap",
      description: "Limited Ops while Forgefile is missing or invalid.",
      tags: ["bootstrap", "forgefile"],
      arguments: [{ name: "projectId", description: "Project id", required: true }],
      template: `Forgefile bootstrap mode: only forgefile, heartbeat, events, and limited session controls work.
GET /api/ops/projects/{{projectId}}/forgefile, author a valid Forgefile, then re-check.
Do not deploy until validation passes.`,
    },
  ];
}

export function getForgeAgentPrompt(name: string): ForgeAgentPrompt | undefined {
  return listForgeAgentPrompts().find((item) => item.name === name);
}

export function renderForgeAgentPrompt(
  prompt: ForgeAgentPrompt,
  args: Record<string, string>,
): string {
  return prompt.template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => args[key] ?? `{{${key}}}`);
}

export function searchableForgeAgentItems(): SearchableItem[] {
  return [
    ...listForgeAgentTools().map((tool) => ({
      kind: "tool" as const,
      name: tool.name,
      description: tool.description,
      tags: tool.tags,
      path: tool.path,
      callable: tool.callable,
      auth: tool.auth,
    })),
    ...listForgeAgentResources().map((item) => ({
      kind: "resource" as const,
      name: item.name,
      description: item.description,
      tags: item.tags,
      uriTemplate: item.uriTemplate,
      auth: item.auth,
    })),
    ...listForgeAgentPrompts().map((item) => ({
      kind: "prompt" as const,
      name: item.name,
      description: item.description,
      tags: item.tags,
    })),
  ];
}

/** Catalog Ops paths that must have a callable tool (git advertise is a resource). */
const EXPLORER_PATH_PREFIXES = [
  "/api/ops/discover",
  "/api/ops/search",
  "/api/ops/tools",
  "/api/ops/resources",
  "/api/ops/prompts",
  "/api/ops/mcp",
];

export function catalogOpsPathsRequiringTools(): string[] {
  return forgeOpsApiCatalog("http://example.test")
    .endpoints.filter((endpoint) => {
      if (!endpoint.path.startsWith("/api/ops")) return false;
      return !EXPLORER_PATH_PREFIXES.some(
        (prefix) => endpoint.path === prefix || endpoint.path.startsWith(`${prefix}/`),
      );
    })
    .map((endpoint) => `${endpoint.method} ${endpoint.path}`);
}

export function callableOpsPathSet(): Set<string> {
  return new Set(
    listForgeAgentTools()
      .filter((tool) => tool.callable && tool.kind === "ops")
      .map((tool) => `${tool.method} ${tool.path}`),
  );
}
