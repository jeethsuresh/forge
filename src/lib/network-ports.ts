import net from "net";

/** Returns true when nothing is listening on host:port. */
export function isPortAvailable(
  port: number,
  host = "127.0.0.1",
): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

/** Scan upward from startPort until a free TCP port is found (inclusive). */
export async function pickFreePort(
  startPort: number,
  maxPort = 3999,
  host = "127.0.0.1",
): Promise<number> {
  if (!Number.isFinite(startPort) || startPort < 1 || startPort > 65535) {
    throw new Error(`Invalid start port: ${startPort}`);
  }
  if (maxPort < startPort) {
    throw new Error(`maxPort ${maxPort} is below startPort ${startPort}`);
  }

  for (let port = startPort; port <= maxPort; port++) {
    if (await isPortAvailable(port, host)) {
      return port;
    }
  }

  throw new Error(`No free port found between ${startPort} and ${maxPort}`);
}
