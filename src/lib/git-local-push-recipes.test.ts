import { describe, expect, it } from "vitest";
import {
  forgeLocalAgentsNote,
  localPushRecipes,
} from "@/lib/git-local-push-recipes";

describe("localPushRecipes", () => {
  it("uses cat >> AGENTS.md and origin vs forge remotes", () => {
    const recipes = localPushRecipes({
      httpsUrl: "https://forge.example/api/git/demo.git",
      defaultBranch: "main",
      cloneToken: "fgc.demo.secret",
    });
    expect(recipes.noOrigin).toContain(
      "git remote add origin https://git:fgc.demo.secret@forge.example/api/git/demo.git",
    );
    expect(recipes.noOrigin).toContain("cat >> AGENTS.md");
    expect(recipes.noOrigin).not.toMatch(/cat > AGENTS\.md/);
    expect(recipes.noOrigin).toContain("git push -u origin main");
    expect(recipes.existingOrigin).toContain(
      "git remote add forge https://git:fgc.demo.secret@forge.example/api/git/demo.git",
    );
    expect(recipes.existingOrigin).toContain(
      "git config remote.pushDefault forge",
    );
    expect(recipes.existingOrigin).toContain("cat >> AGENTS.md");
    expect(recipes.existingOrigin).toContain("git push -u forge main");
    expect(forgeLocalAgentsNote()).toContain("Push to Forge");
  });
});
