import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { db } from "@/lib/db";
import {
  deployTargets,
  projectForgefiles,
  projects,
  serviceDirectory,
} from "@/lib/db/schema";
import {
  getProjectForgefile,
  listDeployTargets,
  projectForgefile,
  requireValidForgefile,
} from "@/lib/forgefile-project";
import { listServiceDirectory } from "@/lib/service-directory";

const VALID_BODY = `version: 1
project:
  name: demo
scripts:
  build:
    run: ./build.sh
deployments:
  web:
    description: Web app
    auto_deploy: true
    subdomain: demo
    compose_slug: demo-web
    scripts:
      build: build
      deploy: ./deploy.sh --target web
    ports:
      - name: http
        port: 8080
        public: true
  api:
    scripts:
      deploy: ./deploy.sh --target api
`;

const INVALID_BODY = `version: 1
project:
  name: demo
scripts: {}
deployments: {}
`;

describe("forgefile-project", () => {
  let tempDir: string;
  let projectId: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "ff-project-"));
    projectId = randomUUID();
    const now = new Date();
    db.insert(projects)
      .values({
        id: projectId,
        name: "FF Project",
        githubRepo: "owner/ff-project",
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
    db.delete(serviceDirectory)
      .where(eq(serviceDirectory.projectId, projectId))
      .run();
    db.delete(deployTargets).where(eq(deployTargets.projectId, projectId)).run();
    db.delete(projectForgefiles)
      .where(eq(projectForgefiles.projectId, projectId))
      .run();
    db.delete(projects).where(eq(projects.id, projectId)).run();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("projects a valid Forgefile into rows and deploy targets", () => {
    writeFileSync(join(tempDir, "Forgefile"), VALID_BODY);

    const result = projectForgefile(projectId, tempDir, "abc123");

    expect(result.status).toBe("valid");
    expect(result.errors).toBeUndefined();

    const row = getProjectForgefile(projectId);
    expect(row).not.toBeNull();
    expect(row?.status).toBe("valid");
    expect(row?.commitSha).toBe("abc123");
    expect(row?.sourcePath?.endsWith("Forgefile")).toBe(true);
    expect(row?.contentHash).toBeTruthy();
    expect(row?.errorMessage).toBeNull();
    const parsed = JSON.parse(row!.parsedJson) as { project: { name: string } };
    expect(parsed.project.name).toBe("demo");

    const targets = listDeployTargets(projectId);
    expect(targets).toHaveLength(2);
    const web = targets.find((t) => t.name === "web");
    expect(web).toBeDefined();
    expect(web?.autoDeploy).toBe(true);
    expect(web?.subdomain).toBe("demo");
    expect(web?.composeSlug).toBe("demo-web");
    expect(web?.description).toBe("Web app");
    expect(JSON.parse(web!.portsJson)).toEqual([
      { name: "http", port: 8080, public: true },
    ]);
    expect(JSON.parse(web!.scriptsJson)).toMatchObject({
      build: "build",
      deploy: "./deploy.sh --target web",
    });
    expect(targets.find((t) => t.name === "api")?.autoDeploy).toBe(false);
  });

  it("marks missing Forgefile and clears deploy targets", () => {
    db.insert(projectForgefiles)
      .values({
        projectId,
        status: "valid",
        parsedJson: "{}",
        updatedAt: new Date(),
      })
      .run();
    db.insert(deployTargets)
      .values({
        id: randomUUID(),
        projectId,
        name: "stale",
        autoDeploy: false,
        portsJson: "[]",
        scriptsJson: "{}",
        updatedAt: new Date(),
      })
      .run();

    const result = projectForgefile(projectId, tempDir, null);

    expect(result.status).toBe("missing");
    expect(result.errors?.some((e) => /not found/i.test(e))).toBe(true);

    const row = getProjectForgefile(projectId);
    expect(row?.status).toBe("missing");
    expect(row?.errorMessage).toMatch(/not found/i);
    expect(listDeployTargets(projectId)).toHaveLength(0);
  });

  it("marks invalid Forgefile and clears deploy targets", () => {
    writeFileSync(join(tempDir, "Forgefile"), INVALID_BODY);

    const result = projectForgefile(projectId, tempDir, "deadbeef");

    expect(result.status).toBe("invalid");
    expect(result.errors?.length).toBeGreaterThan(0);

    const row = getProjectForgefile(projectId);
    expect(row?.status).toBe("invalid");
    expect(row?.commitSha).toBe("deadbeef");
    expect(row?.errorMessage).toBeTruthy();
    expect(row?.parsedJson).toBe("{}");
    expect(listDeployTargets(projectId)).toHaveLength(0);
  });

  it("replaces deploy targets on re-projection", () => {
    writeFileSync(join(tempDir, "Forgefile"), VALID_BODY);
    projectForgefile(projectId, tempDir, "sha1");
    expect(listDeployTargets(projectId)).toHaveLength(2);

    const slim = `version: 1
project:
  name: demo
scripts:
  build:
    run: ./build.sh
deployments:
  only:
    scripts:
      build: build
      deploy: ./deploy.sh
`;
    writeFileSync(join(tempDir, "Forgefile"), slim);
    const result = projectForgefile(projectId, tempDir, "sha2");

    expect(result.status).toBe("valid");
    const targets = listDeployTargets(projectId);
    expect(targets).toHaveLength(1);
    expect(targets[0]?.name).toBe("only");
    expect(getProjectForgefile(projectId)?.commitSha).toBe("sha2");
  });

  it("requireValidForgefile throws when not valid", () => {
    expect(() => requireValidForgefile(projectId)).toThrow(/Forgefile/i);

    writeFileSync(join(tempDir, "Forgefile"), INVALID_BODY);
    projectForgefile(projectId, tempDir);
    expect(() => requireValidForgefile(projectId)).toThrow(/Invalid Forgefile/i);

    writeFileSync(join(tempDir, "Forgefile"), VALID_BODY);
    projectForgefile(projectId, tempDir);
    expect(() => requireValidForgefile(projectId)).not.toThrow();
  });

  it("projects ports into the service directory and drops stale ports", () => {
    writeFileSync(join(tempDir, "Forgefile"), VALID_BODY);
    expect(projectForgefile(projectId, tempDir, "sha1").status).toBe("valid");

    let services = listServiceDirectory({ projectId });
    expect(services).toHaveLength(1);
    expect(services[0]).toMatchObject({
      deployTarget: "web",
      portName: "http",
      port: 8080,
      public: true,
      subdomain: "demo",
    });

    const twoPorts = `version: 1
project:
  name: demo
scripts:
  build:
    run: ./build.sh
deployments:
  web:
    auto_deploy: true
    subdomain: demo
    scripts:
      build: build
      deploy: ./deploy.sh --target web
    ports:
      - name: http
        port: 8080
        public: true
      - name: metrics
        port: 9091
        public: false
  api:
    scripts:
      deploy: ./deploy.sh --target api
    ports:
      - name: http
        port: 8082
        public: false
`;
    writeFileSync(join(tempDir, "Forgefile"), twoPorts);
    expect(projectForgefile(projectId, tempDir, "sha2").status).toBe("valid");
    services = listServiceDirectory({ projectId });
    expect(services).toHaveLength(3);

    const dropMetrics = `version: 1
project:
  name: demo
scripts:
  build:
    run: ./build.sh
deployments:
  web:
    auto_deploy: true
    subdomain: demo
    scripts:
      build: build
      deploy: ./deploy.sh --target web
    ports:
      - name: http
        port: 8080
        public: true
`;
    writeFileSync(join(tempDir, "Forgefile"), dropMetrics);
    expect(projectForgefile(projectId, tempDir, "sha3").status).toBe("valid");
    services = listServiceDirectory({ projectId });
    expect(services).toHaveLength(1);
    expect(services[0]).toMatchObject({
      deployTarget: "web",
      portName: "http",
      port: 8080,
    });
  });

  it("clears service directory when Forgefile is missing or invalid", () => {
    writeFileSync(join(tempDir, "Forgefile"), VALID_BODY);
    projectForgefile(projectId, tempDir);
    expect(listServiceDirectory({ projectId })).toHaveLength(1);

    writeFileSync(join(tempDir, "Forgefile"), INVALID_BODY);
    expect(projectForgefile(projectId, tempDir).status).toBe("invalid");
    expect(listServiceDirectory({ projectId })).toHaveLength(0);
  });

  it("rejects projection when host port conflicts with another project", () => {
    writeFileSync(join(tempDir, "Forgefile"), VALID_BODY);
    expect(projectForgefile(projectId, tempDir).status).toBe("valid");

    const otherId = randomUUID();
    const otherDir = mkdtempSync(join(tmpdir(), "ff-project-other-"));
    const now = new Date();
    db.insert(projects)
      .values({
        id: otherId,
        name: "Other FF",
        githubRepo: "owner/other-ff",
        branch: "main",
        clonePath: otherDir,
        enabled: true,
        deployEnvJson: "[]",
        createdAt: now,
        updatedAt: now,
      })
      .run();

    try {
      writeFileSync(join(otherDir, "Forgefile"), VALID_BODY);
      const result = projectForgefile(otherId, otherDir);
      expect(result.status).toBe("invalid");
      expect(result.errors?.some((e) => /port 8080/i.test(e))).toBe(true);
      expect(listServiceDirectory({ projectId: otherId })).toHaveLength(0);
      expect(listDeployTargets(otherId)).toHaveLength(0);
    } finally {
      db.delete(serviceDirectory)
        .where(eq(serviceDirectory.projectId, otherId))
        .run();
      db.delete(deployTargets)
        .where(eq(deployTargets.projectId, otherId))
        .run();
      db.delete(projectForgefiles)
        .where(eq(projectForgefiles.projectId, otherId))
        .run();
      db.delete(projects).where(eq(projects.id, otherId)).run();
      rmSync(otherDir, { recursive: true, force: true });
    }
  });
});
