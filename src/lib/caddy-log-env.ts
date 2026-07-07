export function getCaddyLogTcpPort(): number {
  const raw = process.env.FORGE_CADDY_LOG_TCP_PORT ?? "3999";
  const port = Number.parseInt(raw, 10);
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    return 3999;
  }
  return port;
}

export function getCaddyLogTcpAddress(): string {
  return `127.0.0.1:${getCaddyLogTcpPort()}`;
}

export function isCaddyLogIngestConfigured(): boolean {
  const token = process.env.FORGE_CADDY_LOG_INGEST_TOKEN?.trim();
  return Boolean(token);
}

export function verifyCaddyLogIngestToken(request: Request): boolean {
  const expected = process.env.FORGE_CADDY_LOG_INGEST_TOKEN?.trim();
  if (!expected) return false;

  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length) === expected;
  }

  return request.headers.get("x-forge-log-token") === expected;
}
