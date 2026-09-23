import { randomUUID } from "crypto";
import { existsSync, rmSync } from "fs";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  artifacts,
  deployTargets,
  gitRepositories,
  gitSshKeys,
  projectForgefiles,
  projects,
  secrets,
} from "@/lib/db/schema";
import { storeSecret } from "@/lib/agent-secrets";
import { mintGitCloneToken } from "@/lib/git-clone-token";
import { barePathForSlug } from "@/lib/git-paths";
import { addGitSshKey, parseSshPublicKey, syncAuthorizedKeysFile } from "@/lib/git-ssh";
import { composeProjectName } from "@/lib/compose-project-name";
import { workingClonePathForSlug } from "@/lib/git-repo";
import { hostPortConflict, validateHostPort } from "@/lib/project-routing";
import { composeNameConflict, validateProjectName } from "@/lib/projects";
import {
  checkoutWatchBranch,
  materializeBareRepo,
} from "@/lib/migration/git-transfer";
import type { MigrationManifest, MigrationProject } from "@/lib/migration/manifest";

export { createRepositoryBundle } from "@/lib/migration/git-transfer";

export type MigrationApplyResult = {
  projects: { id: string; name: string; slug: string | null }[];
  sshKeysAdded: number;
  sshKeysSkipped: number;
};

type PreparedProject = {
  project: MigrationProject;
  barePath: string | null;
  clonePath: string;
  commitSha: string | null;
};

type WrittenRows = {
  projects: { id: string; name: string; slug: string | null }[];
  projectIds: string[];
  repoIds: string[];
  globalSecretIds: string[];
};

export function migrationConflicts(manifest: MigrationManifest): string[] {
  const errors: string[] = [];
  const names = new Set<string>();
  const composeSlugs = new Set<string>();
  const gitSlugs = new Set<string>();
  const ports = new Set<number>();
  const secretNames = new Set<string>();

  for (const project of manifest.projects) {
    const nameError = validateProjectName(project.name);
    if (nameError) errors.push(`${project.name || "Project"}: ${nameError}`);
    const nameKey = project.name.trim().toLowerCase();
    if (nameKey && names.has(nameKey)) {
      errors.push(`Manifest contains more than one project named “${project.name}”`);
    }
    if (nameKey) names.add(nameKey);

    const composeSlug = composeProjectName(project.name);
    if (composeSlugs.has(composeSlug)) {
      errors.push(
        `Manifest contains more than one project using compose name “${composeSlug}”`,
      );
    }
    composeSlugs.add(composeSlug);
    const composeError = composeNameConflict(project.name);
    if (composeError) errors.push(composeError);

    if (project.hostPort !== null) {
      const portError = validateHostPort(project.hostPort);
      if (portError) {
        errors.push(`${project.name}: ${portError}`);
      } else if (ports.has(project.hostPort)) {
        errors.push(`Manifest assigns port ${project.hostPort} more than once`);
      } else {
        ports.add(project.hostPort);
        const portConflict = hostPortConflict(project.hostPort);
        if (portConflict) errors.push(portConflict);
      }
    }

    if (!project.git) continue;
    if (gitSlugs.has(project.git.slug)) {
      errors.push(`Manifest contains more than one repo “${project.git.slug}”`);
    }
    gitSlugs.add(project.git.slug);
    try {
      const barePath = barePathForSlug(project.git.slug);
      const existing = db
        .select()
        .from(gitRepositories)
        .where(eq(gitRepositories.slug, project.git.slug))
        .get();
      if (existing) {
        errors.push(`Git repository slug “${project.git.slug}” already exists`);
      }
      if (existsSync(barePath)) {
        errors.push(`Bare path already exists: ${barePath}`);
      }
      const clonePath = workingClonePathForSlug(project.git.slug, project.branch);
      if (existsSync(clonePath)) {
        errors.push(`Working copy already exists for “${project.git.slug}”`);
      }
    } catch (err) {
      errors.push(err instanceof Error ? err.message : "Invalid git slug");
    }
  }

  for (const secret of manifest.globalSecrets) {
    if (secretNames.has(secret.name)) {
      errors.push(`Manifest contains more than one global secret “${secret.name}”`);
    }
    secretNames.add(secret.name);
    const existing = db
      .select()
      .from(secrets)
      .where(eq(secrets.name, secret.name))
      .all()
      .find((row) => row.scope === "global" && row.projectId === null);
    if (existing) {
      errors.push(`Global secret “${secret.name}” already exists`);
    }
  }

  for (const key of manifest.sshKeys) {
    try {
      parseSshPublicKey(key.publicKey);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : "Invalid SSH public key");
    }
  }

  return errors;
}

export async function applyMigrationManifest(
  manifest: MigrationManifest,
  bundles: ReadonlyMap<string, Buffer>,
): Promise<MigrationApplyResult> {
  const conflicts = migrationConflicts(manifest);
  if (conflicts.length > 0) {
    throw new Error(conflicts.join("\n"));
  }

  const createdBare: string[] = [];
  const createdClones: string[] = [];
  const addedKeyIds: string[] = [];
  let written: WrittenRows | null = null;
  try {
    const prepared = await prepareRepositories(manifest, bundles, createdBare, createdClones);
    written = writeRows(manifest, prepared);
    const ssh = importSshKeys(manifest, addedKeyIds);
    return {
      projects: written.projects,
      sshKeysAdded: ssh.added,
      sshKeysSkipped: ssh.skipped,
    };
  } catch (err) {
    for (const id of addedKeyIds) {
      db.delete(gitSshKeys).where(eq(gitSshKeys.id, id)).run();
    }
    if (addedKeyIds.length > 0) syncAuthorizedKeysFile();
    if (written) deleteWrittenRows(written);
    for (const path of [...createdClones, ...createdBare]) {
      rmSync(path, { recursive: true, force: true });
    }
    throw err;
  }
}

async function prepareRepositories(
  manifest: MigrationManifest,
  bundles: ReadonlyMap<string, Buffer>,
  createdBare: string[],
  createdClones: string[],
): Promise<PreparedProject[]> {
  const prepared: PreparedProject[] = [];
  for (const project of manifest.projects) {
    if (!project.git) {
      prepared.push({
        project,
        barePath: null,
        clonePath: workingClonePathForSlug(
          composeProjectName(project.name),
          project.branch || "main",
        ),
        commitSha: null,
      });
      continue;
    }
    const bundle = project.git.hasCommits
      ? bundles.get(project.git.slug) ?? null
      : null;
    if (project.git.hasCommits && (!bundle || bundle.length === 0)) {
      throw new Error(`Missing git bundle for ${project.git.slug}`);
    }
    const barePath = await materializeBareRepo({
      slug: project.git.slug,
      bundle,
      defaultBranch: project.git.defaultBranch || "main",
    });
    createdBare.push(barePath);
    const checkout = await checkoutWatchBranch({
      barePath,
      slug: project.git.slug,
      branch: project.branch || "main",
    });
    if (checkout.commitSha) createdClones.push(checkout.clonePath);
    prepared.push({
      project,
      barePath,
      clonePath: checkout.clonePath,
      commitSha: checkout.commitSha,
    });
  }
  return prepared;
}

function writeRows(
  manifest: MigrationManifest,
  prepared: PreparedProject[],
): WrittenRows {
  const written: WrittenRows = {
    projects: [],
    projectIds: [],
    repoIds: [],
    globalSecretIds: [],
  };
  db.transaction(() => {
    for (const item of prepared) {
      const projectId = randomUUID();
      const now = new Date();
      let repoId: string | null = null;
      if (item.project.git && item.barePath) {
        repoId = randomUUID();
        db.insert(gitRepositories)
          .values({
            id: repoId,
            slug: item.project.git.slug,
            barePath: item.barePath,
            defaultBranch: item.project.git.defaultBranch || "main",
            importedFrom: item.project.git.importedFrom,
            cloneToken: mintGitCloneToken(repoId),
            createdAt: now,
          })
          .run();
        written.repoIds.push(repoId);
      }
      db.insert(projects)
        .values({
          id: projectId,
          name: item.project.name.trim(),
          githubRepo: item.project.githubRepo,
          branch: item.project.branch || "main",
          clonePath: item.clonePath,
          lastSeenCommit: item.commitSha,
          enabled: item.project.enabled,
          deployEnvJson: item.project.deployEnvJson,
          hostPort: item.project.hostPort,
          caddyRouteJson: null,
          gitRepositoryId: repoId,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      written.projectIds.push(projectId);
      written.projects.push({
        id: projectId,
        name: item.project.name.trim(),
        slug: item.project.git?.slug ?? null,
      });
      if (item.project.forgefile) {
        const forgefile = item.project.forgefile;
        db.insert(projectForgefiles)
          .values({
            projectId,
            status: forgefile.status,
            contentHash: forgefile.contentHash,
            sourcePath: forgefile.sourcePath,
            commitSha: forgefile.commitSha,
            errorMessage: forgefile.errorMessage,
            parsedJson: forgefile.parsedJson,
            updatedAt: now,
          })
          .run();
      }
      for (const target of item.project.deployTargets) {
        db.insert(deployTargets)
          .values({
            id: randomUUID(),
            projectId,
            name: target.name,
            description: target.description,
            autoDeploy: target.autoDeploy,
            subdomain: target.subdomain,
            composeSlug: target.composeSlug,
            portsJson: target.portsJson,
            scriptsJson: target.scriptsJson,
            updatedAt: now,
          })
          .run();
      }
      for (const artifact of item.project.artifacts) {
        db.insert(artifacts)
          .values({
            id: randomUUID(),
            projectId,
            name: artifact.name,
            description: artifact.description,
            buildCommand: artifact.buildCommand,
            outputPath: artifact.outputPath,
            contentType: artifact.contentType,
            updatedAt: now,
          })
          .run();
      }
      for (const secret of item.project.secrets) {
        storeSecret({
          scope: "project",
          projectId,
          name: secret.name,
          value: secret.value,
        });
      }
    }
    for (const secret of manifest.globalSecrets) {
      const stored = storeSecret({
        scope: "global",
        name: secret.name,
        value: secret.value,
      });
      written.globalSecretIds.push(stored.id);
    }
  });
  return written;
}

function importSshKeys(
  manifest: MigrationManifest,
  addedKeyIds: string[],
): { added: number; skipped: number } {
  let added = 0;
  let skipped = 0;
  for (const key of manifest.sshKeys) {
    const parsed = parseSshPublicKey(key.publicKey);
    const existing = db
      .select()
      .from(gitSshKeys)
      .where(eq(gitSshKeys.fingerprint, parsed.fingerprint))
      .get();
    if (existing) {
      skipped += 1;
      continue;
    }
    const row = addGitSshKey({
      name: key.name,
      publicKey: key.publicKey,
      scope: key.scope,
    });
    addedKeyIds.push(row.id);
    added += 1;
  }
  return { added, skipped };
}

function deleteWrittenRows(written: WrittenRows): void {
  for (const id of written.projectIds) {
    db.delete(projects).where(eq(projects.id, id)).run();
  }
  for (const id of written.repoIds) {
    db.delete(gitRepositories).where(eq(gitRepositories.id, id)).run();
  }
  for (const id of written.globalSecretIds) {
    db.delete(secrets).where(eq(secrets.id, id)).run();
  }
}
