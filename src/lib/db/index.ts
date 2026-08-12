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

CREATE TABLE IF NOT EXISTS git_repositories (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  bare_path TEXT NOT NULL,
  default_branch TEXT NOT NULL DEFAULT 'main',
  imported_from TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  github_repo TEXT NOT NULL DEFAULT '',
  branch TEXT NOT NULL DEFAULT 'main',
  clone_path TEXT NOT NULL,
  last_seen_commit TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  deploy_env_json TEXT NOT NULL DEFAULT '[]',
  git_repository_id TEXT REFERENCES git_repositories(id) ON DELETE SET NULL,
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
  completed_at INTEGER,
  archived_at INTEGER
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

CREATE TABLE IF NOT EXISTS project_forgefiles (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  content_hash TEXT,
  source_path TEXT,
  commit_sha TEXT,
  error_message TEXT,
  parsed_json TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS deploy_targets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  auto_deploy INTEGER NOT NULL,
  subdomain TEXT,
  compose_slug TEXT,
  ports_json TEXT NOT NULL,
  scripts_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_deploy_targets_project_name
  ON deploy_targets(project_id, name);
CREATE INDEX IF NOT EXISTS idx_deploy_targets_project_id ON deploy_targets(project_id);

CREATE TABLE IF NOT EXISTS service_directory (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  deploy_target TEXT NOT NULL,
  port_name TEXT NOT NULL,
  port INTEGER NOT NULL,
  public INTEGER NOT NULL,
  subdomain TEXT,
  url TEXT,
  status TEXT NOT NULL,
  route_status TEXT NOT NULL,
  route_error TEXT,
  bound_port INTEGER,
  last_checked_at INTEGER,
  last_latency_ms INTEGER,
  last_error TEXT,
  deployment_id TEXT,
  commit_sha TEXT,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_service_directory_project_target_port
  ON service_directory(project_id, deploy_target, port_name);
CREATE INDEX IF NOT EXISTS idx_service_directory_project_id
  ON service_directory(project_id);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  build_command TEXT NOT NULL,
  output_path TEXT NOT NULL,
  content_type TEXT,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_artifacts_project_name
  ON artifacts(project_id, name);
CREATE INDEX IF NOT EXISTS idx_artifacts_project_id ON artifacts(project_id);

CREATE TABLE IF NOT EXISTS artifact_builds (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  commit_sha TEXT,
  branch TEXT,
  storage_key TEXT,
  size_bytes INTEGER,
  error_message TEXT,
  started_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_artifact_builds_artifact_id
  ON artifact_builds(artifact_id);
CREATE INDEX IF NOT EXISTS idx_artifact_builds_project_id
  ON artifact_builds(project_id);

CREATE TABLE IF NOT EXISTS agent_containers (
  session_id TEXT PRIMARY KEY REFERENCES agent_sessions(id) ON DELETE CASCADE,
  container_id TEXT NOT NULL,
  image TEXT NOT NULL,
  status TEXT NOT NULL,
  last_heartbeat_at INTEGER,
  last_activity_at INTEGER,
  started_at INTEGER NOT NULL,
  deadline_at INTEGER NOT NULL,
  kill_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_agent_containers_status
  ON agent_containers(status);

CREATE TABLE IF NOT EXISTS secrets (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_secrets_scope_project_name
  ON secrets(scope, project_id, name);
CREATE INDEX IF NOT EXISTS idx_secrets_project_id ON secrets(project_id);

CREATE TABLE IF NOT EXISTS secret_requests (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  allowed INTEGER NOT NULL,
  reason TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_secret_requests_session_id
  ON secret_requests(session_id);
CREATE INDEX IF NOT EXISTS idx_secret_requests_project_id
  ON secret_requests(project_id);
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
addColumnIfMissing("agent_sessions", "archived_at", "INTEGER");
addColumnIfMissing("projects", "deploy_env_json", "TEXT NOT NULL DEFAULT '[]'");
addColumnIfMissing("projects", "host_port", "INTEGER");
addColumnIfMissing("projects", "caddy_route_json", "TEXT");
addColumnIfMissing("projects", "git_repository_id", "TEXT");
addColumnIfMissing("deployments", "deploy_target", "TEXT");

sqlite.exec(`
CREATE TABLE IF NOT EXISTS git_repositories (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  bare_path TEXT NOT NULL,
  default_branch TEXT NOT NULL DEFAULT 'main',
  imported_from TEXT,
  created_at INTEGER NOT NULL
);
`);

// Migrate the old unique (project_id, branch) index to a partial live-only unique index.
try {
  sqlite.exec("DROP INDEX IF EXISTS idx_agent_sessions_project_branch");
} catch {
  // ignore
}
try {
  sqlite.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_sessions_project_branch_live
      ON agent_sessions(project_id, branch)
      WHERE archived_at IS NULL
  `);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  if (!message.includes("already exists")) {
    throw err;
  }
}
