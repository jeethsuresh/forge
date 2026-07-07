export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ensureForgeProject } = await import("@/lib/forge-project");
    ensureForgeProject();

    const { startWatcher } = await import("@/lib/watcher");
    await startWatcher();

    const { startCaddyLogTcpIngest } = await import("@/lib/caddy-log-tcp-ingest");
    startCaddyLogTcpIngest();
  }
}
