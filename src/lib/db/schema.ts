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
  | "deploying"
  | "success"
  | "failed";

export type DeploymentTrigger = "auto" | "manual";

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

export type User = typeof users.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Deployment = typeof deployments.$inferSelect;
