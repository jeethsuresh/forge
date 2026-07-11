import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "fs";
import { dirname } from "path";
import * as schema from "./schema";

const dbPath = process.env.FORGE_DB_PATH ?? "./data/forge.db";

mkdirSync(dirname(dbPath), { recursive: true });

const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });

const INIT_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  github_repo TEXT NOT NULL,
  branch TEXT NOT NULL DEFAULT 'main',
  clone_path TEXT NOT NULL,
  last_seen_commit TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  deploy_env_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS deployments (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  commit_sha TEXT,
  branch TEXT NOT NULL,
  status TEXT NOT NULL,
  trigger TEXT NOT NULL,
  logs TEXT NOT NULL DEFAULT '',
  error_message TEXT,
  started_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_deployments_project_id ON deployments(project_id);
CREATE INDEX IF NOT EXISTS idx_deployments_started_at ON deployments(started_at);

CREATE TABLE IF NOT EXISTS agent_sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  branch TEXT NOT NULL,
  status TEXT NOT NULL,
  cursor_session_id TEXT,
  initial_prompt TEXT NOT NULL,
  logs TEXT NOT NULL DEFAULT '',
  error_message TEXT,
  deployment_id TEXT,
  commit_sha TEXT,
  started_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE TABLE IF NOT EXISTS agent_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS forge_updates (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  trigger TEXT NOT NULL,
  target_commit_sha TEXT,
  previous_commit_sha TEXT,
  logs TEXT NOT NULL DEFAULT '',
  error_message TEXT,
  started_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_forge_updates_started_at ON forge_updates(started_at);

CREATE INDEX IF NOT EXISTS idx_agent_sessions_project_id ON agent_sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_agent_events_session_id ON agent_events(session_id);
CREATE INDEX IF NOT EXISTS idx_agent_events_seq ON agent_events(session_id, seq);
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_sessions_project_branch ON agent_sessions(project_id, branch);

CREATE TABLE IF NOT EXISTS ops_api_actions (
  id TEXT PRIMARY KEY,
  action_description TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  request_body_json TEXT NOT NULL DEFAULT '{}',
  response_status INTEGER NOT NULL,
  actor TEXT NOT NULL DEFAULT 'agent',
  agent_session_id TEXT,
  project_id TEXT,
  resource_type TEXT,
  resource_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ops_api_actions_created_at ON ops_api_actions(created_at);
CREATE INDEX IF NOT EXISTS idx_ops_api_actions_project_id ON ops_api_actions(project_id);
`;

sqlite.exec(INIT_SQL);

function addColumnIfMissing(
  table: string,
  column: string,
  definition: string,
): void {
  const columns = sqlite
    .prepare(`PRAGMA table_info(${table})`)
    .all() as { name: string }[];
  if (columns.some((col) => col.name === column)) return;

  try {
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes("duplicate column name")) {
      throw err;
    }
  }
}

addColumnIfMissing("agent_sessions", "commit_sha", "TEXT");
addColumnIfMissing("agent_sessions", "resume_cursor_session_id", "TEXT");
addColumnIfMissing("agent_sessions", "failed_turn_start_seq", "INTEGER");
addColumnIfMissing("agent_sessions", "source", "TEXT NOT NULL DEFAULT 'manual'");
addColumnIfMissing("projects", "deploy_env_json", "TEXT NOT NULL DEFAULT '[]'");
addColumnIfMissing("projects", "host_port", "INTEGER");
addColumnIfMissing("projects", "caddy_route_json", "TEXT");
