import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
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
  listArtifacts,
  projectForgefile,
  syncArtifactDeclarations,
} from "@/lib/forgefile-project";
import type { ForgefileArtifact } from "@/lib/forgefile-types";

const BASE_FORGEFILE = `version: 1
project:
  name: demo
scripts:
  build:
    run: ./build.sh
deployments:
  web:
    scripts:
      deploy: ./deploy.sh
`;

describe("syncArtifactDeclarations", () => {
  let tempDir: string;
  let projectId: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "ff-artifacts-"));
    projectId = randomUUID();
    const now = new Date();
    db.insert(projects)
      .values({
        id: projectId,
        name: "Artifact Project",
        githubRepo: "owner/artifact-project",
        branch: "main",
        clonePath: tempDir,
        enabled: true,
        deployEnvJson: "[]",
        createdAt: now,
        updatedAt: now,
      })
      .run();
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
  });

  it("upserts artifact declarations from Forgefile map", () => {
    const decls: Record<string, ForgefileArtifact> = {
      "linux-amd64": {
        description: "CLI binary",
        build: "./scripts/build-artifact.sh linux-amd64",
        path: "dist/my-app-linux-amd64",
        content_type: "application/octet-stream",
      },
      docs: {
        build: "./scripts/build-docs.sh",
        path: "dist/docs.tar.gz",
      },
    };

    syncArtifactDeclarations(projectId, decls);

    const rows = listArtifacts(projectId);
    expect(rows).toHaveLength(2);
    const linux = rows.find((r) => r.name === "linux-amd64");
    expect(linux).toMatchObject({
      projectId,
      description: "CLI binary",
      buildCommand: "./scripts/build-artifact.sh linux-amd64",
      outputPath: "dist/my-app-linux-amd64",
      contentType: "application/octet-stream",
    });
    const docs = rows.find((r) => r.name === "docs");
    expect(docs).toMatchObject({
      buildCommand: "./scripts/build-docs.sh",
      outputPath: "dist/docs.tar.gz",
      description: null,
      contentType: null,
    });
  });

  it("updates existing declarations and drops removed names", () => {
    syncArtifactDeclarations(projectId, {
      keep: {
        build: "./keep.sh",
        path: "out/keep",
        description: "old",
      },
      gone: {
        build: "./gone.sh",
        path: "out/gone",
      },
    });

    syncArtifactDeclarations(projectId, {
      keep: {
        build: "./keep-v2.sh",
        path: "out/keep-v2",
        description: "new",
        content_type: "text/plain",
      },
    });

    const rows = listArtifacts(projectId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "keep",
      buildCommand: "./keep-v2.sh",
      outputPath: "out/keep-v2",
      description: "new",
      contentType: "text/plain",
    });
  });

  it("projectForgefile projects artifacts when valid and clears when invalid", () => {
    const withArtifacts = `${BASE_FORGEFILE}
artifacts:
  cli:
    description: CLI
    build: ./scripts/build-cli.sh
    path: dist/cli
    content_type: application/octet-stream
`;
    writeFileSync(join(tempDir, "Forgefile"), withArtifacts);
    expect(projectForgefile(projectId, tempDir, "sha1").status).toBe("valid");

    let rows = listArtifacts(projectId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "cli",
      buildCommand: "./scripts/build-cli.sh",
      outputPath: "dist/cli",
      contentType: "application/octet-stream",
    });

    writeFileSync(
      join(tempDir, "Forgefile"),
      `version: 1
project:
  name: demo
scripts: {}
deployments: {}
`,
    );
    expect(projectForgefile(projectId, tempDir, "sha2").status).toBe("invalid");
    expect(listArtifacts(projectId)).toHaveLength(0);
  });
});
