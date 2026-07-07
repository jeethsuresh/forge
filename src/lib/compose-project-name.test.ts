import { describe, expect, it } from "vitest";
import { composeProjectName } from "@/lib/compose-project-name";

describe("composeProjectName", () => {
  it("lowercases and hyphenates display names", () => {
    expect(composeProjectName("My Playlists App")).toBe("my-playlists-app");
  });

  it("preserves valid compose characters", () => {
    expect(composeProjectName("playlists-dev_1")).toBe("playlists-dev_1");
  });

  it("prefixes names that do not start with a letter or digit", () => {
    expect(composeProjectName("_staging")).toBe("p-_staging");
  });

  it("falls back when the name has no usable characters", () => {
    expect(composeProjectName("!!!")).toBe("forge-project");
  });
});
