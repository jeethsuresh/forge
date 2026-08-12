import { describe, expect, it } from "vitest";
import {
  buildForgefileBootstrapPrompt,
  FORGEFILE_BOOTSTRAP_SOURCE,
} from "@/lib/forgefile-bootstrap";

describe("buildForgefileBootstrapPrompt", () => {
  it("instructs the agent to author a version-1 Forgefile from the template", () => {
    const prompt = buildForgefileBootstrapPrompt("Demo App");
    expect(prompt).toContain("Forgefile");
    expect(prompt).toContain("version: 1");
    expect(prompt).toContain("docs/forgefile.template.yml");
    expect(prompt).toContain("Demo App");
    expect(FORGEFILE_BOOTSTRAP_SOURCE).toBe("manual");
  });
});
