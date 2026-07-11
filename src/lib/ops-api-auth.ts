export function opsApiBaseUrl(): string {
  const configured = process.env.FORGE_OPS_API_BASE?.trim();
  if (configured) return configured.replace(/\/$/, "");
  const port = process.env.PORT ?? "3000";
  return `http://127.0.0.1:${port}`;
}

export function isOpsApiConfigured(): boolean {
  return Boolean(process.env.FORGE_OPS_API_TOKEN?.trim());
}

export function verifyOpsApiToken(request: Request): boolean {
  const expected = process.env.FORGE_OPS_API_TOKEN?.trim();
  if (!expected) return false;

  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length) === expected;
  }

  return request.headers.get("x-forge-ops-token") === expected;
}
