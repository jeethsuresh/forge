import { describe, expect, it } from "vitest";
import {
  getCaddyLogBuffer,
} from "@/lib/caddy-log-buffer";
import {
  verifyCaddyLogIngestToken,
} from "@/lib/caddy-log-env";

describe("getCaddyLogBuffer", () => {
  it("ingests structured objects with sequential ids", () => {
    const buffer = getCaddyLogBuffer();
    const added = buffer.ingest([
      {
        level: "info",
        msg: "handled request",
        status: 200,
        request: { method: "GET", host: "example.com", uri: "/" },
      },
    ]);

    expect(added).toHaveLength(1);
    expect(added[0]?.seq).toBeGreaterThan(0);
    expect(added[0]?.parsed).toMatchObject({
      message: "handled request",
      method: "GET",
      status: 200,
    });

    const tailSeq = added[0]!.seq;
    expect(buffer.getAfter(tailSeq - 1).entries).toHaveLength(1);
  });

  it("trims old entries beyond the ring buffer size", () => {
    const buffer = getCaddyLogBuffer();
    const beforeCount = buffer.getTail(6000).length;
    const values = Array.from({ length: 5005 }, (_, index) => ({
      msg: `ring-buffer-${index}`,
    }));
    buffer.ingest(values);
    expect(buffer.getTail(6000).length).toBeLessThanOrEqual(5000);
    expect(buffer.getTail(6000).length).toBe(
      Math.min(beforeCount + 5005, 5000),
    );
  });
});

describe("verifyCaddyLogIngestToken", () => {
  it("accepts bearer and header tokens", () => {
    process.env.FORGE_CADDY_LOG_INGEST_TOKEN = "secret-token";

    expect(
      verifyCaddyLogIngestToken(
        new Request("http://localhost/api/caddy/logs/ingest", {
          headers: { Authorization: "Bearer secret-token" },
        }),
      ),
    ).toBe(true);

    expect(
      verifyCaddyLogIngestToken(
        new Request("http://localhost/api/caddy/logs/ingest", {
          headers: { "x-forge-log-token": "secret-token" },
        }),
      ),
    ).toBe(true);

    delete process.env.FORGE_CADDY_LOG_INGEST_TOKEN;
  });
});
