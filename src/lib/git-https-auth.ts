/** Git Basic username for Forge smart HTTP. Any non-empty value works; git is canonical. */
export const GIT_HTTPS_BASIC_USERNAME = "git";

/** @deprecated Prefer showing the per-repo fgc.* clone token from the API. */
export function gitHttpsPasswordHelp(): string {
  return "FORGE_OPS_API_TOKEN (from .env) or a fos.* agent session token";
}

/** Embed Basic credentials into an HTTPS clone URL for copy-paste recipes. */
export function forgeHttpsUrlWithToken(
  httpsUrl: string,
  token: string,
  username: string = GIT_HTTPS_BASIC_USERNAME,
): string {
  const url = httpsUrl.trim();
  const password = token.trim();
  if (!url || !password) return url;
  try {
    const parsed = new URL(url);
    parsed.username = username;
    parsed.password = password;
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return url;
  }
}
