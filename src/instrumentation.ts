export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ensureForgeProject, ensureForgeSourceRepo } = await import(
      "@/lib/forge-project"
    );
    ensureForgeProject();
    void ensureForgeSourceRepo();

    const { reconcileStaleForgeUpdates } = await import("@/lib/self-update");
    void reconcileStaleForgeUpdates();

    const { startWatcher } = await import("@/lib/watcher");
    await startWatcher();

    const { startCaddyLogTcpIngest } = await import("@/lib/caddy-log-tcp-ingest");
    startCaddyLogTcpIngest();
  }
}
