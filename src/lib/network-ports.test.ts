import { describe, expect, it } from "vitest";
import net from "net";
import { isPortAvailable, pickFreePort } from "@/lib/network-ports";

describe("network-ports", () => {
  it("isPortAvailable returns false for a bound port", async () => {
    const server = net.createServer();
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    const port =
      typeof address === "object" && address ? address.port : 0;
    expect(port).toBeGreaterThan(0);

    await expect(isPortAvailable(port, "127.0.0.1")).resolves.toBe(false);

    await new Promise<void>((resolve) => server.close(() => resolve()));
    await expect(isPortAvailable(port, "127.0.0.1")).resolves.toBe(true);
  });

  it("pickFreePort skips occupied ports", async () => {
    const server = net.createServer();
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    const occupied =
      typeof address === "object" && address ? address.port : 0;

    const picked = await pickFreePort(occupied, occupied + 5, "127.0.0.1");
    expect(picked).toBeGreaterThan(occupied);

    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});
