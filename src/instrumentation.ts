export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ensureForgeProject, ensureForgeSourceRepo } = await import(
      "@/lib/forge-project"
    );
    ensureForgeProject();
    void ensureForgeSourceRepo();

    const { reconcileStaleForgeUpdates } = await import("@/lib/self-update");
    void reconcileStaleForgeUpdates();

    const { reconcileForgeInterruptedDeploys } = await import(
      "@/lib/deploy-reconcile"
    );
    reconcileForgeInterruptedDeploys();

    try {
      const { refreshProjectRuntimeFromRunningContainers } = await import(
        "@/lib/container-discovery"
      );
      await refreshProjectRuntimeFromRunningContainers();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[forge] Container discovery on startup failed: ${message}`);
    }

    const { startWatcher } = await import("@/lib/watcher");
    await startWatcher();

    const { startCaddyLogTcpIngest } = await import("@/lib/caddy-log-tcp-ingest");
    startCaddyLogTcpIngest();
  }
}
