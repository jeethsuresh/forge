import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import {
  buildProjectScriptEnv,
  composeNameConflict,
  projectComposeSlug,
  projectScriptArgs,
  validateProjectName,
} from "@/lib/projects";
import { ensureForgeProject } from "@/lib/forge-project";

describe("validateProjectName", () => {
  it("rejects empty names", () => {
    expect(validateProjectName("   ")).toBe("Project name is required");
  });

  it("accepts valid names", () => {
    expect(validateProjectName("My App")).toBeNull();
  });
});

describe("composeNameConflict", () => {
  const ids: string[] = [];

  beforeEach(() => {
    ids.length = 0;
  });

  afterEach(() => {
    for (const id of ids) {
      db.delete(projects).where(eq(projects.id, id)).run();
    }
  });

  function insertProject(name: string): string {
    const id = randomUUID();
    const now = new Date();
    db.insert(projects)
      .values({
        id,
        name,
        githubRepo: "acme/example",
        branch: "main",
        clonePath: `/tmp/${id}`,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    ids.push(id);
    return id;
  }

  it("detects compose slug collisions across display names", () => {
    const existingId = insertProject("My App");
    expect(composeNameConflict("MY-APP")).toMatch(/already uses compose name/);
    expect(composeNameConflict("MY-APP", existingId)).toBeNull();
    expect(composeNameConflict("Other App", existingId)).toBeNull();
  });
});

describe("buildProjectScriptEnv", () => {
  let previousComposeProject: string | undefined;
  let previousProjectName: string | undefined;
  let previousForgeContainer: string | undefined;
  let previousForgeSelfRepo: string | undefined;
  let previousDockerHost: string | undefined;

  beforeEach(() => {
    previousComposeProject = process.env.COMPOSE_PROJECT_NAME;
    previousProjectName = process.env.PROJECT_NAME;
    previousForgeContainer = process.env.FORGE_CONTAINER_NAME;
    previousForgeSelfRepo = process.env.FORGE_SELF_REPO;
    previousDockerHost = process.env.DOCKER_HOST;
    delete process.env.COMPOSE_PROJECT_NAME;
    delete process.env.PROJECT_NAME;
    delete process.env.FORGE_CONTAINER_NAME;
    delete process.env.FORGE_SELF_REPO;
    delete process.env.DOCKER_HOST;
  });

  afterEach(() => {
    if (previousComposeProject === undefined) delete process.env.COMPOSE_PROJECT_NAME;
    else process.env.COMPOSE_PROJECT_NAME = previousComposeProject;
    if (previousProjectName === undefined) delete process.env.PROJECT_NAME;
    else process.env.PROJECT_NAME = previousProjectName;
    if (previousForgeContainer === undefined) delete process.env.FORGE_CONTAINER_NAME;
    else process.env.FORGE_CONTAINER_NAME = previousForgeContainer;
    if (previousForgeSelfRepo === undefined) delete process.env.FORGE_SELF_REPO;
    else process.env.FORGE_SELF_REPO = previousForgeSelfRepo;
    if (previousDockerHost === undefined) delete process.env.DOCKER_HOST;
    else process.env.DOCKER_HOST = previousDockerHost;
  });

  it("injects compose project name env vars when unset", () => {
    const { env, composeProjectName: slug } = buildProjectScriptEnv(
      "My App",
      "[]",
    );
    expect(slug).toBe("my-app");
    expect(env.COMPOSE_PROJECT_NAME).toBe("my-app");
    expect(env.PROJECT_NAME).toBe("my-app");
  });

  it("does not override explicit deploy env values", () => {
    const { env } = buildProjectScriptEnv(
      "My App",
      JSON.stringify([
        { key: "COMPOSE_PROJECT_NAME", value: "custom", secret: false },
      ]),
    );
    expect(env.COMPOSE_PROJECT_NAME).toBe("custom");
  });

  it("inherits Forge instance runtime env for the Forge project", () => {
    process.env.FORGE_SELF_REPO = "acme/forge";
    process.env.FORGE_CONTAINER_NAME = "forge_app_1";
    process.env.DOCKER_HOST = "tcp://127.0.0.1:18765";

    const { env } = buildProjectScriptEnv("Forge", "[]");
    expect(env.COMPOSE_PROJECT_NAME).toBe("forge");
    expect(env.FORGE_CONTAINER_NAME).toBe("forge_app_1");
    expect(env.DOCKER_HOST).toBe("tcp://127.0.0.1:18765");
  });

  it("uses dedicated hostPort column when building script env", () => {
    const { env } = buildProjectScriptEnv("My App", "[]", 3912);
    expect(env.HOST_PORT).toBe("3912");
  });
});

describe("projectScriptArgs", () => {
  it("always passes --project-name", () => {
    expect(projectScriptArgs("my-app")).toEqual(["--project-name", "my-app"]);
  });

  it("includes --host-port when set in env", () => {
    expect(projectScriptArgs("my-app", { HOST_PORT: "3456" })).toEqual([
      "--project-name",
      "my-app",
      "--host-port",
      "3456",
    ]);
  });
});

describe("projectComposeSlug", () => {
  let previousRepo: string | undefined;
  let previousComposeProject: string | undefined;
  const ids: string[] = [];

  beforeEach(() => {
    previousRepo = process.env.FORGE_SELF_REPO;
    previousComposeProject = process.env.COMPOSE_PROJECT_NAME;
    process.env.FORGE_SELF_REPO = "acme/forge";
    process.env.COMPOSE_PROJECT_NAME = "forge";
  });

  afterEach(() => {
    for (const id of ids) {
      db.delete(projects).where(eq(projects.id, id)).run();
    }
    ids.length = 0;
    if (previousRepo === undefined) delete process.env.FORGE_SELF_REPO;
    else process.env.FORGE_SELF_REPO = previousRepo;
    if (previousComposeProject === undefined) delete process.env.COMPOSE_PROJECT_NAME;
    else process.env.COMPOSE_PROJECT_NAME = previousComposeProject;
  });

  it("uses the runtime compose project name for the Forge project", () => {
    const forge = ensureForgeProject();
    expect(forge).not.toBeNull();
    if (forge) ids.push(forge.id);
    expect(projectComposeSlug(forge!)).toBe("forge");
  });

  it("derives compose slug from display name for regular projects", () => {
    const id = randomUUID();
    const now = new Date();
    db.insert(projects)
      .values({
        id,
        name: "My App",
        githubRepo: "acme/example",
        branch: "main",
        clonePath: `/tmp/${id}`,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    ids.push(id);

    const project = db.select().from(projects).where(eq(projects.id, id)).get()!;
    expect(projectComposeSlug(project)).toBe("my-app");
  });
});
