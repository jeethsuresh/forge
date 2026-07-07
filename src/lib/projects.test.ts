import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import {
  buildProjectScriptEnv,
  composeNameConflict,
  projectScriptArgs,
  validateProjectName,
} from "@/lib/projects";

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
