import { describe, expect, it } from "vitest";
import { parseDockerImageRef } from "./docker-image-ref";

describe("parseDockerImageRef", () => {
  it("accepts a short Hub name and infers latest", () => {
    const parsed = parseDockerImageRef("nginx");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.image).toBe("nginx");
    expect(parsed.nameHint).toBe("nginx");
    expect(parsed.registryHost).toBeNull();
  });

  it("accepts ghcr with tag", () => {
    const parsed = parseDockerImageRef("ghcr.io/org/app:1.2");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.image).toBe("ghcr.io/org/app:1.2");
    expect(parsed.nameHint).toBe("app");
    expect(parsed.registryHost).toBe("ghcr.io");
  });

  it("accepts digest references", () => {
    const parsed = parseDockerImageRef(
      "registry.example.com:5000/ns/app@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.nameHint).toBe("app");
    expect(parsed.registryHost).toBe("registry.example.com:5000");
  });

  it("rejects whitespace and shell metacharacters", () => {
    for (const input of ["nginx latest", "nginx;rm", "nginx$(id)", "nginx`id`", "nginx\nfoo"]) {
      const parsed = parseDockerImageRef(input);
      expect(parsed.ok).toBe(false);
    }
  });

  it("rejects empty input", () => {
    expect(parseDockerImageRef("  ").ok).toBe(false);
  });
});
