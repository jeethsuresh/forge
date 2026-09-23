import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  artifacts,
  deployTargets,
  gitRepositories,
  projectForgefiles,
  projects,
  secrets,
  type ProjectForgefileStatus,
} from "@/lib/db/schema";
import { decryptSecretValue } from "@/lib/agent-secrets";
import { bareRepoHasCommits } from "@/lib/git-repo";
import { listGitSshKeys } from "@/lib/git-ssh";

export const MIGRATION_SCHEMA_VERSION = 1;

export type MigrationGit = {
  slug: string;
  defaultBranch: string;
  importedFrom: string | null;
  hasCommits: boolean;
};

export type MigrationForgefile = {
  status: ProjectForgefileStatus;
  contentHash: string | null;
  sourcePath: string | null;
  commitSha: string | null;
  errorMessage: string | null;
  parsedJson: string;
};

export type MigrationDeployTarget = {
  name: string;
  description: string | null;
  autoDeploy: boolean;
  subdomain: string | null;
  composeSlug: string | null;
  portsJson: string;
  scriptsJson: string;
};

export type MigrationArtifact = {
  name: string;
  description: string | null;
  buildCommand: string;
  outputPath: string;
  contentType: string | null;
};

export type MigrationSecret = {
  name: string;
  value: string;
};

export type MigrationSshKey = {
  name: string;
  publicKey: string;
  scope: "user" | "deploy";
};

export type MigrationProject = {
  sourceId: string;
  name: string;
  githubRepo: string;
  branch: string;
  enabled: boolean;
  deployEnvJson: string;
  hostPort: number | null;
  git: MigrationGit | null;
  forgefile: MigrationForgefile | null;
  deployTargets: MigrationDeployTarget[];
  artifacts: MigrationArtifact[];
  secrets: MigrationSecret[];
};

export type MigrationManifest = {
  schemaVersion: typeof MIGRATION_SCHEMA_VERSION;
  exportedAt: string;
  projects: MigrationProject[];
  globalSecrets: MigrationSecret[];
  sshKeys: MigrationSshKey[];
};

export type MigrationSummary = {
  projectNames: string[];
  repositorySlugs: string[];
  secretCount: number;
  sshKeyCount: number;
  insecureHttp: boolean;
};

const FORGEFILE_STATUSES = new Set<ProjectForgefileStatus>([
  "missing",
  "invalid",
  "valid",
]);

export function buildMigrationManifest(): MigrationManifest {
  const projectRows = db.select().from(projects).all();
  return {
    schemaVersion: MIGRATION_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    projects: projectRows.map(exportProject),
    globalSecrets: db
      .select()
      .from(secrets)
      .where(and(eq(secrets.scope, "global"), isNull(secrets.projectId)))
      .all()
      .map((row) => ({
        name: row.name,
        value: decryptSecretValue(row.ciphertext),
      })),
    sshKeys: listGitSshKeys().map((key) => ({
      name: key.name,
      publicKey: key.publicKey,
      scope: key.scope,
    })),
  };
}

function exportProject(project: typeof projects.$inferSelect): MigrationProject {
  const repo = project.gitRepositoryId
    ? db
        .select()
        .from(gitRepositories)
        .where(eq(gitRepositories.id, project.gitRepositoryId))
        .get()
    : undefined;
  const forgefile = db
    .select()
    .from(projectForgefiles)
    .where(eq(projectForgefiles.projectId, project.id))
    .get();
  return {
    sourceId: project.id,
    name: project.name,
    githubRepo: project.githubRepo,
    branch: project.branch,
    enabled: project.enabled,
    deployEnvJson: project.deployEnvJson,
    hostPort: project.hostPort,
    git: repo
      ? {
          slug: repo.slug,
          defaultBranch: repo.defaultBranch,
          importedFrom: repo.importedFrom,
          hasCommits: bareRepoHasCommits(repo.barePath),
        }
      : null,
    forgefile: forgefile
      ? {
          status: forgefile.status,
          contentHash: forgefile.contentHash,
          sourcePath: forgefile.sourcePath,
          commitSha: forgefile.commitSha,
          errorMessage: forgefile.errorMessage,
          parsedJson: forgefile.parsedJson,
        }
      : null,
    deployTargets: db
      .select()
      .from(deployTargets)
      .where(eq(deployTargets.projectId, project.id))
      .all()
      .map((target) => ({
        name: target.name,
        description: target.description,
        autoDeploy: target.autoDeploy,
        subdomain: target.subdomain,
        composeSlug: target.composeSlug,
        portsJson: target.portsJson,
        scriptsJson: target.scriptsJson,
      })),
    artifacts: db
      .select()
      .from(artifacts)
      .where(eq(artifacts.projectId, project.id))
      .all()
      .map((artifact) => ({
        name: artifact.name,
        description: artifact.description,
        buildCommand: artifact.buildCommand,
        outputPath: artifact.outputPath,
        contentType: artifact.contentType,
      })),
    secrets: db
      .select()
      .from(secrets)
      .where(
        and(eq(secrets.scope, "project"), eq(secrets.projectId, project.id)),
      )
      .all()
      .map((row) => ({
        name: row.name,
        value: decryptSecretValue(row.ciphertext),
      })),
  };
}

export function migrationSummary(
  manifest: MigrationManifest,
  insecureHttp: boolean,
): MigrationSummary {
  const secretCount =
    manifest.globalSecrets.length +
    manifest.projects.reduce((count, project) => count + project.secrets.length, 0);
  return {
    projectNames: manifest.projects.map((project) => project.name),
    repositorySlugs: manifest.projects.flatMap((project) =>
      project.git ? [project.git.slug] : [],
    ),
    secretCount,
    sshKeyCount: manifest.sshKeys.length,
    insecureHttp,
  };
}

export function parseMigrationManifest(value: unknown): MigrationManifest {
  const record = asObject(value, "Manifest");
  if (record.schemaVersion !== MIGRATION_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported migration schema version ${String(record.schemaVersion)}`,
    );
  }
  return {
    schemaVersion: MIGRATION_SCHEMA_VERSION,
    exportedAt: asString(record.exportedAt, "exportedAt"),
    projects: asArray(record.projects, "projects").map((entry, index) =>
      parseProject(entry, index),
    ),
    globalSecrets: asArray(record.globalSecrets, "globalSecrets").map(
      (entry, index) => parseSecret(entry, `globalSecrets[${index}]`),
    ),
    sshKeys: asArray(record.sshKeys, "sshKeys").map((entry, index) =>
      parseSshKey(entry, index),
    ),
  };
}

function parseProject(value: unknown, index: number): MigrationProject {
  const record = asObject(value, `projects[${index}]`);
  const label = `projects[${index}]`;
  return {
    sourceId: asString(record.sourceId, `${label}.sourceId`),
    name: asString(record.name, `${label}.name`),
    githubRepo: asString(record.githubRepo, `${label}.githubRepo`),
    branch: asString(record.branch, `${label}.branch`),
    enabled: asBoolean(record.enabled, `${label}.enabled`),
    deployEnvJson: asString(record.deployEnvJson, `${label}.deployEnvJson`),
    hostPort: asNullableInt(record.hostPort, `${label}.hostPort`),
    git: record.git === null ? null : parseGit(record.git, label),
    forgefile:
      record.forgefile === null ? null : parseForgefile(record.forgefile, label),
    deployTargets: asArray(record.deployTargets, `${label}.deployTargets`).map(
      (entry, targetIndex) => parseDeployTarget(entry, label, targetIndex),
    ),
    artifacts: asArray(record.artifacts, `${label}.artifacts`).map(
      (entry, artifactIndex) => parseArtifact(entry, label, artifactIndex),
    ),
    secrets: asArray(record.secrets, `${label}.secrets`).map((entry, secretIndex) =>
      parseSecret(entry, `${label}.secrets[${secretIndex}]`),
    ),
  };
}

function parseGit(value: unknown, label: string): MigrationGit {
  const record = asObject(value, `${label}.git`);
  return {
    slug: asString(record.slug, `${label}.git.slug`),
    defaultBranch: asString(record.defaultBranch, `${label}.git.defaultBranch`),
    importedFrom: asNullableString(
      record.importedFrom,
      `${label}.git.importedFrom`,
    ),
    hasCommits: asBoolean(record.hasCommits, `${label}.git.hasCommits`),
  };
}

function parseForgefile(value: unknown, label: string): MigrationForgefile {
  const record = asObject(value, `${label}.forgefile`);
  const status = asString(record.status, `${label}.forgefile.status`);
  if (!FORGEFILE_STATUSES.has(status as ProjectForgefileStatus)) {
    throw new Error(`${label}.forgefile.status is invalid`);
  }
  return {
    status: status as ProjectForgefileStatus,
    contentHash: asNullableString(
      record.contentHash,
      `${label}.forgefile.contentHash`,
    ),
    sourcePath: asNullableString(
      record.sourcePath,
      `${label}.forgefile.sourcePath`,
    ),
    commitSha: asNullableString(record.commitSha, `${label}.forgefile.commitSha`),
    errorMessage: asNullableString(
      record.errorMessage,
      `${label}.forgefile.errorMessage`,
    ),
    parsedJson: asString(record.parsedJson, `${label}.forgefile.parsedJson`),
  };
}

function parseDeployTarget(
  value: unknown,
  label: string,
  index: number,
): MigrationDeployTarget {
  const record = asObject(value, `${label}.deployTargets[${index}]`);
  const prefix = `${label}.deployTargets[${index}]`;
  return {
    name: asString(record.name, `${prefix}.name`),
    description: asNullableString(record.description, `${prefix}.description`),
    autoDeploy: asBoolean(record.autoDeploy, `${prefix}.autoDeploy`),
    subdomain: asNullableString(record.subdomain, `${prefix}.subdomain`),
    composeSlug: asNullableString(record.composeSlug, `${prefix}.composeSlug`),
    portsJson: asString(record.portsJson, `${prefix}.portsJson`),
    scriptsJson: asString(record.scriptsJson, `${prefix}.scriptsJson`),
  };
}

function parseArtifact(
  value: unknown,
  label: string,
  index: number,
): MigrationArtifact {
  const record = asObject(value, `${label}.artifacts[${index}]`);
  const prefix = `${label}.artifacts[${index}]`;
  return {
    name: asString(record.name, `${prefix}.name`),
    description: asNullableString(record.description, `${prefix}.description`),
    buildCommand: asString(record.buildCommand, `${prefix}.buildCommand`),
    outputPath: asString(record.outputPath, `${prefix}.outputPath`),
    contentType: asNullableString(record.contentType, `${prefix}.contentType`),
  };
}

function parseSecret(value: unknown, label: string): MigrationSecret {
  const record = asObject(value, label);
  const name = asString(record.name, `${label}.name`).trim();
  if (!name) throw new Error(`${label}.name is required`);
  return {
    name,
    value: asString(record.value, `${label}.value`),
  };
}

function parseSshKey(value: unknown, index: number): MigrationSshKey {
  const record = asObject(value, `sshKeys[${index}]`);
  const scope = asString(record.scope, `sshKeys[${index}].scope`);
  if (scope !== "user" && scope !== "deploy") {
    throw new Error(`sshKeys[${index}].scope is invalid`);
  }
  return {
    name: asString(record.name, `sshKeys[${index}].name`),
    publicKey: asString(record.publicKey, `sshKeys[${index}].publicKey`),
    scope,
  };
}

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

function asString(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  return value;
}

function asBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean`);
  return value;
}

function asNullableString(value: unknown, label: string): string | null {
  if (value === null) return null;
  return asString(value, label);
}

function asNullableInt(value: unknown, label: string): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`${label} must be an integer or null`);
  }
  return value;
}
