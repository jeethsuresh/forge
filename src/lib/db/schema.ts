import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  githubRepo: text("github_repo").notNull(),
  branch: text("branch").notNull().default("main"),
  clonePath: text("clone_path").notNull(),
  lastSeenCommit: text("last_seen_commit"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export type DeploymentStatus =
  | "pending"
  | "pulling"
  | "building"
  | "testing"
  | "deploying"
  | "success"
  | "failed";

export type DeploymentTrigger = "auto" | "manual" | "agent";

export type AgentSessionStatus =
  | "pending"
  | "running"
  | "deploying"
  | "completed"
  | "failed"
  | "cancelled";

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
  logs: text("logs").notNull().default(""),
  errorMessage: text("error_message"),
  deploymentId: text("deployment_id"),
  commitSha: text("commit_sha"),
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

export type User = typeof users.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Deployment = typeof deployments.$inferSelect;
export type AgentSession = typeof agentSessions.$inferSelect;
export type AgentEvent = typeof agentEvents.$inferSelect;
