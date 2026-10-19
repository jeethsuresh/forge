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

    try {
      const { reconcileRunningCommitShasFromContainers } = await import(
        "@/lib/project-running-sha"
      );
      await reconcileRunningCommitShasFromContainers();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[forge] Running commit SHA reconcile on startup failed: ${message}`,
      );
    }

    const { startWatcher } = await import("@/lib/watcher");
    await startWatcher();

    const { startCaddyLogTcpIngest } = await import("@/lib/caddy-log-tcp-ingest");
    startCaddyLogTcpIngest();

    const { startServiceHealthMonitor } = await import("@/lib/service-health");
    startServiceHealthMonitor();

    const { startAgentKillPolicyTicker } = await import("@/lib/agent-heartbeat");
    startAgentKillPolicyTicker();

    try {
      const { scheduleTicketDrain } = await import("@/lib/ticket-scheduler");
      scheduleTicketDrain();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[forge] Ticket scheduler on startup failed: ${message}`);
    }

    try {
      const { migrateGithubOriginProjects } = await import(
        "@/lib/git-migrate-origin"
      );
      await migrateGithubOriginProjects();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[forge-git] Origin migrate failed: ${message}`);
    }

    try {
      const { backfillForgeUpdatesIntoDeployments } = await import(
        "@/lib/self-update"
      );
      backfillForgeUpdatesIntoDeployments();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[forge] Forge update backfill failed: ${message}`);
    }
  }
}
