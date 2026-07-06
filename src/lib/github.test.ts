import { describe, expect, it } from "vitest";
import { parseGithubRepo } from "@/lib/github";

describe("parseGithubRepo", () => {
  it("accepts owner/repo shorthand", () => {
    expect(parseGithubRepo("acme/widget")).toBe("acme/widget");
  });

  it("parses HTTPS GitHub URLs", () => {
    expect(parseGithubRepo("https://github.com/acme/widget")).toBe(
      "acme/widget",
    );
    expect(parseGithubRepo("https://github.com/acme/widget.git")).toBe(
      "acme/widget",
    );
  });

  it("parses SSH GitHub URLs", () => {
    expect(parseGithubRepo("git@github.com:acme/widget.git")).toBe(
      "acme/widget",
    );
  });

  it("rejects invalid input", () => {
    expect(() => parseGithubRepo("not-a-repo")).toThrow(/Invalid GitHub/);
  });
});

describe("buildAgentCommitMessage", () => {
  it("prefixes the initial prompt", async () => {
    const { buildAgentCommitMessage } = await import("@/lib/github");
    expect(buildAgentCommitMessage("Add login page")).toBe("Agent: Add login page");
  });

  it("truncates long prompts", async () => {
    const { buildAgentCommitMessage } = await import("@/lib/github");
    const long = "x".repeat(100);
    const message = buildAgentCommitMessage(long);
    expect(message.startsWith("Agent: ")).toBe(true);
    expect(message.endsWith("…")).toBe(true);
    expect(message.length).toBeLessThan(100);
  });
});
