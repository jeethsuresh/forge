export class CaddyApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: string,
  ) {
    super(message);
    this.name = "CaddyApiError";
  }
}

export function getCaddyAdminUrl(): string {
  const raw =
    process.env.FORGE_CADDY_ADMIN_URL ??
    process.env.CADDY_ADMIN ??
    "http://127.0.0.1:2019";
  return raw.replace(/\/$/, "");
}

export async function caddyFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const base = getCaddyAdminUrl();
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
  return fetch(url, init);
}

export async function getCaddyConfig(): Promise<unknown> {
  const res = await caddyFetch("/config/");
  if (!res.ok) {
    const body = await res.text();
    throw new CaddyApiError("Failed to fetch Caddy config", res.status, body);
  }
  return res.json();
}

export async function loadCaddyConfig(config: unknown): Promise<void> {
  const res = await caddyFetch("/load", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new CaddyApiError("Failed to load Caddy config", res.status, body);
  }
}
