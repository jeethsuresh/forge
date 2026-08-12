import { describe, expect, it } from "vitest";
import {
  FORGE_SMOKE_MARKER_CONTAINER_PATH,
  FORGE_SMOKE_MARKER_RELATIVE_PATH,
  buildForgeSmokeAgentPrompt,
  buildForgeSmokeBranchName,
  buildForgeSmokeMarkerToken,
  forgeSmokeMarkerMatches,
} from "@/lib/forge-smoke-agent";

describe("forge-smoke-agent helpers", () => {
  it("builds a unique branch and marker token", () => {
    const branch = buildForgeSmokeBranchName(
      new Date("2026-07-20T15:30:00.000Z"),
    );
    expect(branch).toBe("forge-smoke/2026-07-20T15-30-00-000Z");
    expect(buildForgeSmokeMarkerToken("abc123")).toBe("SMOKE_MARKER_abc123");
  });

  it("prompts the agent to write only the public marker file", () => {
    const prompt = buildForgeSmokeAgentPrompt("SMOKE_MARKER_xyz");
    expect(prompt).toContain(FORGE_SMOKE_MARKER_RELATIVE_PATH);
    expect(prompt).toContain("SMOKE_MARKER_xyz");
    expect(prompt).toMatch(/Do not run \.\/deploy\.sh/);
  });

  it("matches marker file contents exactly after trim", () => {
    expect(
      forgeSmokeMarkerMatches("SMOKE_MARKER_xyz\n", "SMOKE_MARKER_xyz"),
    ).toBe(true);
    expect(forgeSmokeMarkerMatches("wrong", "SMOKE_MARKER_xyz")).toBe(false);
    expect(FORGE_SMOKE_MARKER_CONTAINER_PATH).toBe(
      "/app/public/forge-smoke-marker.txt",
    );
  });
});
