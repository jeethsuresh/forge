import { describe, expect, it } from "vitest";
import {
  legacyProjectSearchToPath,
  legacyTabToMode,
  projectModeHref,
  projectModePath,
  resolveProjectModeFromPath,
} from "./project-routes";

describe("legacyTabToMode", () => {
  it("maps legacy tabs including config and diff", () => {
    expect(legacyTabToMode("config")).toBe("settings");
    expect(legacyTabToMode("diff")).toBe("changes");
    expect(legacyTabToMode("deploy")).toBe("deploy");
    expect(legacyTabToMode(null)).toBe("overview");
  });
});

describe("projectModePath / href", () => {
  it("builds overview without suffix", () => {
    expect(projectModePath("p1", "overview")).toBe("/projects/p1");
    expect(projectModeHref("p1", "agents", { session: "s1" })).toBe(
      "/projects/p1/agents?session=s1",
    );
  });
});

describe("resolveProjectModeFromPath", () => {
  it("parses mode segments", () => {
    expect(resolveProjectModeFromPath("/projects/abc")).toEqual({
      projectId: "abc",
      mode: "overview",
    });
    expect(resolveProjectModeFromPath("/projects/abc/deploy")).toEqual({
      projectId: "abc",
      mode: "deploy",
    });
    expect(resolveProjectModeFromPath("/projects/abc/changes")).toEqual({
      projectId: "abc",
      mode: "changes",
    });
    expect(resolveProjectModeFromPath("/settings")).toBeNull();
  });
});

describe("legacyProjectSearchToPath", () => {
  it("rewrites tab and keeps other params", () => {
    const params = new URLSearchParams("tab=diff&mode=range&base=a&head=b");
    expect(legacyProjectSearchToPath("p1", params)).toBe(
      "/projects/p1/changes?mode=range&base=a&head=b",
    );
  });

  it("returns null when tab missing", () => {
    expect(legacyProjectSearchToPath("p1", new URLSearchParams("session=x"))).toBeNull();
  });
});
