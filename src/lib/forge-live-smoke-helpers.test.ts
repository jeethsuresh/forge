import { describe, expect, it } from "vitest";
import {
  FORGE_LIVE_SMOKE_MARKER_CONTAINER_PATH,
  FORGE_LIVE_SMOKE_MARKER_PATH,
  opsBase,
} from "@/lib/forge-live-smoke-helpers";

describe("forge live smoke helpers (offline)", () => {
  it("keeps marker under public/ so the runner image includes it", () => {
    expect(FORGE_LIVE_SMOKE_MARKER_PATH).toBe(
      "public/forge-live-smoke-marker.txt",
    );
    expect(FORGE_LIVE_SMOKE_MARKER_CONTAINER_PATH).toBe(
      "/app/public/forge-live-smoke-marker.txt",
    );
  });

  it("defaults Ops base URL without trailing slash", () => {
    const previous = process.env.FORGE_OPS_API_BASE;
    delete process.env.FORGE_OPS_API_BASE;
    expect(opsBase()).toBe("http://127.0.0.1:3000");
    process.env.FORGE_OPS_API_BASE = "http://forge.example/";
    expect(opsBase()).toBe("http://forge.example");
    if (previous === undefined) delete process.env.FORGE_OPS_API_BASE;
    else process.env.FORGE_OPS_API_BASE = previous;
  });
});
