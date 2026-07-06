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

describe("gitAuthorIdentity", () => {
  it("uses defaults when env vars are unset", async () => {
    const { gitAuthorIdentity } = await import("@/lib/github");
    const prevName = process.env.FORGE_GIT_USER_NAME;
    const prevEmail = process.env.FORGE_GIT_USER_EMAIL;
    delete process.env.FORGE_GIT_USER_NAME;
    delete process.env.FORGE_GIT_USER_EMAIL;
    try {
      expect(gitAuthorIdentity()).toEqual({
        name: "Forge Agent",
        email: "forge-agent@localhost",
      });
    } finally {
      if (prevName === undefined) delete process.env.FORGE_GIT_USER_NAME;
      else process.env.FORGE_GIT_USER_NAME = prevName;
      if (prevEmail === undefined) delete process.env.FORGE_GIT_USER_EMAIL;
      else process.env.FORGE_GIT_USER_EMAIL = prevEmail;
    }
  });

  it("reads FORGE_GIT_USER_NAME and FORGE_GIT_USER_EMAIL", async () => {
    const { gitAuthorIdentity } = await import("@/lib/github");
    const prevName = process.env.FORGE_GIT_USER_NAME;
    const prevEmail = process.env.FORGE_GIT_USER_EMAIL;
    process.env.FORGE_GIT_USER_NAME = "Test User";
    process.env.FORGE_GIT_USER_EMAIL = "test@example.com";
    try {
      expect(gitAuthorIdentity()).toEqual({
        name: "Test User",
        email: "test@example.com",
      });
    } finally {
      if (prevName === undefined) delete process.env.FORGE_GIT_USER_NAME;
      else process.env.FORGE_GIT_USER_NAME = prevName;
      if (prevEmail === undefined) delete process.env.FORGE_GIT_USER_EMAIL;
      else process.env.FORGE_GIT_USER_EMAIL = prevEmail;
    }
  });
});

describe("gitHubCredentials", () => {
  const envKeys = [
    "FORGE_GITHUB_TOKEN",
    "GITHUB_TOKEN",
    "FORGE_GIT_PASSWORD",
    "FORGE_GIT_USERNAME",
    "FORGE_GIT_USER_NAME",
  ] as const;

  function saveEnv(): Record<string, string | undefined> {
    const saved: Record<string, string | undefined> = {};
    for (const key of envKeys) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    return saved;
  }

  function restoreEnv(saved: Record<string, string | undefined>): void {
    for (const key of envKeys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }

  it("returns null when no token or password is set", async () => {
    const { gitHubCredentials } = await import("@/lib/github");
    const saved = saveEnv();
    try {
      expect(gitHubCredentials()).toBeNull();
    } finally {
      restoreEnv(saved);
    }
  });

  it("prefers FORGE_GITHUB_TOKEN over other secrets", async () => {
    const { gitHubCredentials } = await import("@/lib/github");
    const saved = saveEnv();
    process.env.FORGE_GITHUB_TOKEN = "forge-token";
    process.env.GITHUB_TOKEN = "gh-token";
    process.env.FORGE_GIT_PASSWORD = "password";
    try {
      expect(gitHubCredentials()).toEqual({
        username: "git",
        password: "forge-token",
      });
    } finally {
      restoreEnv(saved);
    }
  });

  it("falls back to GITHUB_TOKEN then FORGE_GIT_PASSWORD", async () => {
    const { gitHubCredentials } = await import("@/lib/github");

    const savedGh = saveEnv();
    process.env.GITHUB_TOKEN = "gh-token";
    try {
      expect(gitHubCredentials()).toEqual({
        username: "git",
        password: "gh-token",
      });
    } finally {
      restoreEnv(savedGh);
    }

    const savedPw = saveEnv();
    process.env.FORGE_GIT_PASSWORD = "secret";
    try {
      expect(gitHubCredentials()).toEqual({
        username: "git",
        password: "secret",
      });
    } finally {
      restoreEnv(savedPw);
    }
  });

  it("uses FORGE_GIT_USERNAME then FORGE_GIT_USER_NAME for username", async () => {
    const { gitHubCredentials } = await import("@/lib/github");

    const savedUser = saveEnv();
    process.env.FORGE_GITHUB_TOKEN = "token";
    process.env.FORGE_GIT_USERNAME = "myuser";
    process.env.FORGE_GIT_USER_NAME = "Display Name";
    try {
      expect(gitHubCredentials()).toEqual({
        username: "myuser",
        password: "token",
      });
    } finally {
      restoreEnv(savedUser);
    }

    const savedName = saveEnv();
    process.env.FORGE_GITHUB_TOKEN = "token";
    process.env.FORGE_GIT_USER_NAME = "Display Name";
    try {
      expect(gitHubCredentials()).toEqual({
        username: "Display Name",
        password: "token",
      });
    } finally {
      restoreEnv(savedName);
    }
  });
});
