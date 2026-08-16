import {
  sqliteTable,
  text,
  integer,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

/** Bare git repositories hosted by Forge (`/data/git/<slug>.git`). */
export const gitRepositories = sqliteTable("git_repositories", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  barePath: text("bare_path").notNull(),
  defaultBranch: text("default_branch").notNull().default("main"),
  /** One-shot GitHub source (`owner/repo`); null for Forge-native repos. */
  importedFrom: text("imported_from"),
  /**
   * Human clone/push password for smart HTTP (`fgc.…`).
   * Authorizes only `/api/git/<slug>.git` for this repo — never Ops.
   */
  cloneToken: text("clone_token"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export type GitSshKeyScope = "user" | "deploy";

/** Public SSH keys authorized for Forge git (sidecar sshd reads synced file). */
export const gitSshKeys = sqliteTable("git_ssh_keys", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  publicKey: text("public_key").notNull(),
  fingerprint: text("fingerprint").notNull().unique(),
  scope: text("scope").$type<GitSshKeyScope>().notNull().default("user"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /**
   * Legacy / import hint (`owner/repo`). Empty string for Forge-native projects
   * that use `gitRepositoryId` as origin.
   */
  githubRepo: text("github_repo").notNull().default(""),
  branch: text("branch").notNull().default("main"),
  clonePath: text("clone_path").notNull(),
  lastSeenCommit: text("last_seen_commit"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  deployEnvJson: text("deploy_env_json").notNull().default("[]"),
  hostPort: integer("host_port"),
  caddyRouteJson: text("caddy_route_json"),
  gitRepositoryId: text("git_repository_id").references(
    () => gitRepositories.id,
    { onDelete: "set null" },
  ),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export type DeploymentStatus =
  | "pending"
  | "pulling"
  | "building"
  | "testing"
  | "staging"
  | "deploying"
  | "health_check"
  | "success"
  | "failed"
  | "rolled_back"
  | "duplicate";

export type DeploymentTrigger =
  | "auto"
  | "manual"
  | "agent"
  | "recovery"
  | "rollback";

export type AgentSessionStatus =
  | "idle"
  | "queued"
  | "pending"
  | "running"
  | "deploying"
  | "completed"
  | "failed"
  | "cancelled";

export type AgentSessionSource = "manual" | "recovery" | "rebase-recovery";

export type ForgeUpdateStatus =
  | "pending"
  | "pulling"
  | "building"
  | "testing"
  | "staging"
  | "cutover"
  | "health_check"
  | "success"
  | "failed"
  | "rolled_back";

export type ForgeUpdateTrigger = "manual" | "rollback";

export type ProjectForgefileStatus = "missing" | "invalid" | "valid";

export const projectForgefiles = sqliteTable("project_forgefiles", {
  projectId: text("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  status: text("status").$type<ProjectForgefileStatus>().notNull(),
  contentHash: text("content_hash"),
  sourcePath: text("source_path"),
  commitSha: text("commit_sha"),
  errorMessage: text("error_message"),
  parsedJson: text("parsed_json").notNull().default("{}"),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const deployTargets = sqliteTable(
  "deploy_targets",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    autoDeploy: integer("auto_deploy", { mode: "boolean" }).notNull(),
    subdomain: text("subdomain"),
    composeSlug: text("compose_slug"),
    portsJson: text("ports_json").notNull(),
    scriptsJson: text("scripts_json").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("idx_deploy_targets_project_name").on(
      table.projectId,
      table.name,
    ),
  ],
);

export type ArtifactBuildStatus =
  | "pending"
  | "running"
  | "success"
  | "failed";

export const artifacts = sqliteTable(
  "artifacts",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    buildCommand: text("build_command").notNull(),
    outputPath: text("output_path").notNull(),
    contentType: text("content_type"),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("idx_artifacts_project_name").on(table.projectId, table.name),
  ],
);

export const artifactBuilds = sqliteTable("artifact_builds", {
  id: text("id").primaryKey(),
  artifactId: text("artifact_id")
    .notNull()
    .references(() => artifacts.id, { onDelete: "cascade" }),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  status: text("status").$type<ArtifactBuildStatus>().notNull(),
  commitSha: text("commit_sha"),
  branch: text("branch"),
  storageKey: text("storage_key"),
  sizeBytes: integer("size_bytes"),
  errorMessage: text("error_message"),
  startedAt: integer("started_at", { mode: "timestamp" }).notNull(),
  completedAt: integer("completed_at", { mode: "timestamp" }),
});

export type ServiceDirectoryStatus = "unknown" | "up" | "down";
export type ServiceDirectoryRouteStatus = "none" | "synced" | "error";

export const serviceDirectory = sqliteTable(
  "service_directory",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    deployTarget: text("deploy_target").notNull(),
    portName: text("port_name").notNull(),
    port: integer("port").notNull(),
    public: integer("public", { mode: "boolean" }).notNull(),
    subdomain: text("subdomain"),
    url: text("url"),
    status: text("status").$type<ServiceDirectoryStatus>().notNull(),
    routeStatus: text("route_status")
      .$type<ServiceDirectoryRouteStatus>()
      .notNull(),
    routeError: text("route_error"),
    boundPort: integer("bound_port"),
    lastCheckedAt: integer("last_checked_at", { mode: "timestamp" }),
    lastLatencyMs: integer("last_latency_ms"),
    lastError: text("last_error"),
    deploymentId: text("deployment_id"),
    commitSha: text("commit_sha"),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("idx_service_directory_project_target_port").on(
      table.projectId,
      table.deployTarget,
      table.portName,
    ),
  ],
);

export const deployments = sqliteTable("deployments", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  commitSha: text("commit_sha"),
  branch: text("branch").notNull(),
  status: text("status").$type<DeploymentStatus>().notNull(),
  trigger: text("trigger").$type<DeploymentTrigger>().notNull(),
  logs: text("logs").notNull().default(""),
  errorMessage: text("error_message"),
  deployTarget: text("deploy_target"),
  startedAt: integer("started_at", { mode: "timestamp" }).notNull(),
  completedAt: integer("completed_at", { mode: "timestamp" }),
});

export const agentSessions = sqliteTable("agent_sessions", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  branch: text("branch").notNull(),
  status: text("status").$type<AgentSessionStatus>().notNull(),
  cursorSessionId: text("cursor_session_id"),
  resumeCursorSessionId: text("resume_cursor_session_id"),
  failedTurnStartSeq: integer("failed_turn_start_seq"),
  initialPrompt: text("initial_prompt").notNull(),
  source: text("source").$type<AgentSessionSource>().notNull().default("manual"),
  logs: text("logs").notNull().default(""),
  errorMessage: text("error_message"),
  deploymentId: text("deployment_id"),
  commitSha: text("commit_sha"),
  startedAt: integer("started_at", { mode: "timestamp" }).notNull(),
  completedAt: integer("completed_at", { mode: "timestamp" }),
  /** Soft-archive timestamp; null means the session is the live session for its branch. */
  archivedAt: integer("archived_at", { mode: "timestamp" }),
});

export const forgeUpdates = sqliteTable("forge_updates", {
  id: text("id").primaryKey(),
  status: text("status").$type<ForgeUpdateStatus>().notNull(),
  trigger: text("trigger").$type<ForgeUpdateTrigger>().notNull(),
  targetCommitSha: text("target_commit_sha"),
  previousCommitSha: text("previous_commit_sha"),
  logs: text("logs").notNull().default(""),
  errorMessage: text("error_message"),
  startedAt: integer("started_at", { mode: "timestamp" }).notNull(),
  completedAt: integer("completed_at", { mode: "timestamp" }),
});

export const agentEvents = sqliteTable("agent_events", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => agentSessions.id, { onDelete: "cascade" }),
  seq: integer("seq").notNull(),
  eventType: text("event_type").notNull(),
  payload: text("payload").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export type AgentContainerStatus =
  | "starting"
  | "running"
  | "stopping"
  | "stopped"
  | "failed"
  | "removed";

export type AgentKillReason =
  | "heartbeat_miss"
  | "idle_timeout"
  | "wall_clock"
  | "user_stop"
  | "reconcile_missing"
  | "error";

export const agentContainers = sqliteTable("agent_containers", {
  sessionId: text("session_id")
    .primaryKey()
    .references(() => agentSessions.id, { onDelete: "cascade" }),
  containerId: text("container_id").notNull(),
  image: text("image").notNull(),
  status: text("status").$type<AgentContainerStatus>().notNull(),
  lastHeartbeatAt: integer("last_heartbeat_at", { mode: "timestamp" }),
  lastActivityAt: integer("last_activity_at", { mode: "timestamp" }),
  startedAt: integer("started_at", { mode: "timestamp" }).notNull(),
  deadlineAt: integer("deadline_at", { mode: "timestamp" }).notNull(),
  killReason: text("kill_reason").$type<AgentKillReason>(),
});

export type SecretScope = "global" | "project";

export const secrets = sqliteTable(
  "secrets",
  {
    id: text("id").primaryKey(),
    scope: text("scope").$type<SecretScope>().notNull(),
    projectId: text("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    ciphertext: text("ciphertext").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("idx_secrets_scope_project_name").on(
      table.scope,
      table.projectId,
      table.name,
    ),
  ],
);

export const secretRequests = sqliteTable("secret_requests", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => agentSessions.id, { onDelete: "cascade" }),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  allowed: integer("allowed", { mode: "boolean" }).notNull(),
  reason: text("reason"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const opsApiActions = sqliteTable("ops_api_actions", {
  id: text("id").primaryKey(),
  actionDescription: text("action_description").notNull(),
  method: text("method").notNull(),
  path: text("path").notNull(),
  requestBodyJson: text("request_body_json").notNull().default("{}"),
  responseStatus: integer("response_status").notNull(),
  actor: text("actor").notNull().default("agent"),
  agentSessionId: text("agent_session_id"),
  projectId: text("project_id"),
  resourceType: text("resource_type"),
  resourceId: text("resource_id"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export type User = typeof users.$inferSelect;
export type GitRepository = typeof gitRepositories.$inferSelect;
export type GitSshKey = typeof gitSshKeys.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type ProjectForgefile = typeof projectForgefiles.$inferSelect;
export type DeployTarget = typeof deployTargets.$inferSelect;
export type Artifact = typeof artifacts.$inferSelect;
export type ArtifactBuild = typeof artifactBuilds.$inferSelect;
export type ServiceDirectoryRow = typeof serviceDirectory.$inferSelect;
export type Deployment = typeof deployments.$inferSelect;
export type AgentSession = typeof agentSessions.$inferSelect;
export type AgentEvent = typeof agentEvents.$inferSelect;
export type AgentContainer = typeof agentContainers.$inferSelect;
export type Secret = typeof secrets.$inferSelect;
export type SecretRequest = typeof secretRequests.$inferSelect;
export type ForgeUpdate = typeof forgeUpdates.$inferSelect;
export type OpsApiAction = typeof opsApiActions.$inferSelect;
