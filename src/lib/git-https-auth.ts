/** Git Basic username for Forge smart HTTP. Any non-empty value works; git is canonical. */
export const GIT_HTTPS_BASIC_USERNAME = "git";

export function gitHttpsPasswordHelp(): string {
  return "FORGE_OPS_API_TOKEN (from .env) or a fos.* agent session token";
}
