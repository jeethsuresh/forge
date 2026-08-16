import { describe, expect, it } from "vitest";
import {
  GIT_HTTPS_BASIC_USERNAME,
  gitHttpsPasswordHelp,
} from "@/lib/git-https-auth";

describe("git HTTPS basic credentials", () => {
  it("documents username git and Ops/session token as password", () => {
    expect(GIT_HTTPS_BASIC_USERNAME).toBe("git");
    expect(gitHttpsPasswordHelp()).toContain("FORGE_OPS_API_TOKEN");
    expect(gitHttpsPasswordHelp()).toContain("fos.");
  });
});
