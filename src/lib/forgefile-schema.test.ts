import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { projectForgefiles, projects } from "@/lib/db/schema";

describe("forgefile schema", () => {
  it("inserts projection rows", () => {
    const projectId = randomUUID();
    db.insert(projects)
      .values({
        id: projectId,
        name: "FF Schema",
        githubRepo: "owner/ff-schema",
        branch: "main",
        clonePath: "/tmp/ff-schema",
        enabled: true,
        deployEnvJson: "[]",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();

    db.insert(projectForgefiles)
      .values({
        projectId,
        status: "missing",
        parsedJson: "{}",
        updatedAt: new Date(),
      })
      .run();

    const row = db
      .select()
      .from(projectForgefiles)
      .where(eq(projectForgefiles.projectId, projectId))
      .get();
    expect(row?.status).toBe("missing");
  });
});
