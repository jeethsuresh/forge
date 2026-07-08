import { describe, expect, it } from "vitest";
import { composeAppContainerName, composeProjectName } from "@/lib/compose-project-name";

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

describe("composeAppContainerName", () => {
  it("maps compose slugs to underscore container names", () => {
    expect(composeAppContainerName("forge")).toBe("forge_app_1");
    expect(composeAppContainerName("forge-staging")).toBe("forge_staging_app_1");
  });
});
