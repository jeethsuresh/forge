import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFile } from "child_process";
import { randomUUID } from "crypto";
import { promisify } from "util";
import { eq } from "drizzle-orm";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { db } from "@/lib/db";
import {
  artifactBuilds,
  artifacts,
  projectForgefiles,
  projects,
} from "@/lib/db/schema";
import {
  buildArtifact,
  deleteArtifactBuild,
  enforceArtifactRetention,
} from "@/lib/artifact-build";
import { createDiskArtifactStorage } from "@/lib/artifact-storage";
import { projectForgefile } from "@/lib/forgefile-project";

const execFileAsync = promisify(execFile);

vi.mock("@/lib/github", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/github")>();
  return {
    ...actual,
    cloneOrPull: vi.fn(
      async (_repo: string, _branch: string, clonePath: string) => {
        const sha = await actual.getLocalCommitSha(clonePath);
        return sha ?? "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
      },
    ),
  };
});

async function initGitRepo(dir: string): Promise<void> {
  await execFileAsync("git", ["init"], { cwd: dir });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], {
    cwd: dir,
  });
  await execFileAsync("git", ["config", "user.name", "Test"], { cwd: dir });
  await execFileAsync("git", ["add", "-A"], { cwd: dir });
  await execFileAsync("git", ["commit", "-m", "init", "--allow-empty"], {
    cwd: dir,
  });
}

describe("artifact-build", () => {
  let tempDir: string;
  let artifactsRoot: string;
  let projectId: string;
  let previousArtifactsDir: string | undefined;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "artifact-build-"));
    artifactsRoot = mkdtempSync(join(tmpdir(), "artifact-root-"));
    previousArtifactsDir = process.env.FORGE_ARTIFACTS_DIR;
    process.env.FORGE_ARTIFACTS_DIR = artifactsRoot;
    process.env.FORGE_ARTIFACT_DOWNLOAD_SECRET = "test-artifact-secret";

    projectId = randomUUID();
    const now = new Date();
    db.insert(projects)
      .values({
        id: projectId,
        name: "Build Artifacts",
        githubRepo: "owner/build-artifacts",
        branch: "main",
        clonePath: tempDir,
        enabled: true,
        deployEnvJson: "[]",
        createdAt: now,
        updatedAt: now,
      })
      .run();

    mkdirSync(join(tempDir, "scripts"), { recursive: true });
    writeFileSync(
      join(tempDir, "scripts", "build-ok.sh"),
      `#!/usr/bin/env bash
set -euo pipefail
mkdir -p dist
echo "payload" > dist/cli.bin
`,
    );
    chmodSync(join(tempDir, "scripts", "build-ok.sh"), 0o755);

    writeFileSync(
      join(tempDir, "scripts", "build-missing.sh"),
      `#!/usr/bin/env bash
set -euo pipefail
mkdir -p dist
# intentionally do not write the declared output
`,
    );
    chmodSync(join(tempDir, "scripts", "build-missing.sh"), 0o755);

    writeFileSync(
      join(tempDir, "Forgefile"),
      `version: 1
project:
  name: build-artifacts
scripts:
  build:
    run: ./scripts/build-ok.sh
deployments:
  web:
    scripts:
      deploy: ./deploy.sh
artifacts:
  cli:
    build: ./scripts/build-ok.sh
    path: dist/cli.bin
    content_type: application/octet-stream
  broken:
    build: ./scripts/build-missing.sh
    path: dist/missing.bin
`,
    );
    writeFileSync(join(tempDir, "deploy.sh"), "#!/bin/sh\nexit 0\n");
    chmodSync(join(tempDir, "deploy.sh"), 0o755);

    await initGitRepo(tempDir);

    expect(projectForgefile(projectId, tempDir).status).toBe("valid");
  });

  afterEach(() => {
    db.delete(artifactBuilds)
      .where(eq(artifactBuilds.projectId, projectId))
      .run();
    db.delete(artifacts).where(eq(artifacts.projectId, projectId)).run();
    db.delete(projectForgefiles)
      .where(eq(projectForgefiles.projectId, projectId))
      .run();
    db.delete(projects).where(eq(projects.id, projectId)).run();
    rmSync(tempDir, { recursive: true, force: true });
    rmSync(artifactsRoot, { recursive: true, force: true });
    if (previousArtifactsDir === undefined) {
      delete process.env.FORGE_ARTIFACTS_DIR;
    } else {
      process.env.FORGE_ARTIFACTS_DIR = previousArtifactsDir;
    }
    delete process.env.FORGE_ARTIFACT_DOWNLOAD_SECRET;
  });

  it("fails when declared output path is missing", async () => {
    const buildId = await buildArtifact(projectId, "broken");
    const row = db
      .select()
      .from(artifactBuilds)
      .where(eq(artifactBuilds.id, buildId))
      .get();
    expect(row?.status).toBe("failed");
    expect(row?.errorMessage).toMatch(/output/i);
    expect(row?.storageKey).toBeNull();
  });

  it("stores a successful build and enforces retention", async () => {
    const firstId = await buildArtifact(projectId, "cli");
    const first = db
      .select()
      .from(artifactBuilds)
      .where(eq(artifactBuilds.id, firstId))
      .get();
    expect(first?.status).toBe("success");
    expect(first?.storageKey).toBeTruthy();
    expect(first?.sizeBytes).toBeGreaterThan(0);

    const storage = createDiskArtifactStorage(artifactsRoot);
    const got = await storage.get(first!.storageKey!);
    expect(got).not.toBeNull();
    expect(readFileSync(got!.absolutePath, "utf8").trim()).toBe("payload");

    for (let i = 0; i < 11; i++) {
      await buildArtifact(projectId, "cli");
    }

    await enforceArtifactRetention(projectId, "cli", 10);

    const success = db
      .select()
      .from(artifactBuilds)
      .where(eq(artifactBuilds.artifactId, first!.artifactId))
      .all()
      .filter((b) => b.status === "success");
    expect(success.length).toBeLessThanOrEqual(10);

    await deleteArtifactBuild(success[0]!.id);
    expect(
      db
        .select()
        .from(artifactBuilds)
        .where(eq(artifactBuilds.id, success[0]!.id))
        .get(),
    ).toBeUndefined();
  });
});
