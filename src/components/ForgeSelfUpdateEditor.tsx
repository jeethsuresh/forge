"use client";

import { useCallback, useEffect, useState } from "react";
import {
  statusLabel,
  statusToneClass,
} from "@/lib/self-update-helpers";
import { APP_DISPLAY_NAME } from "@/lib/app-name";

interface ForgeUpdateView {
  id: string;
  status: string;
  trigger: string;
  targetCommitSha: string | null;
  previousCommitSha: string | null;
  logs: string;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
}

interface ForgeStatusResponse {
  configured: boolean;
  selfRepo: string | null;
  selfBranch: string;
  runningCommitSha: string | null;
  remoteCommitSha: string | null;
  remoteCommitLookupFailed?: boolean;
  updateAvailable: boolean;
  deployAllowed: boolean;
  hasRollbackImage: boolean;
  activeUpdate: ForgeUpdateView | null;
  recentUpdates: ForgeUpdateView[];
}

function shortSha(sha: string | null): string {
  if (!sha) return "—";
  return sha.slice(0, 7);
}

export function ForgeSelfUpdateEditor({
  className = "",
  hideHistory = false,
}: {
  className?: string;
  hideHistory?: boolean;
}) {
  const [status, setStatus] = useState<ForgeStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [expandedUpdateId, setExpandedUpdateId] = useState<string | null>(null);

  const fetchStatus = useCallback(() => {
    fetch("/api/forge/status")
      .then(async (r) => {
        if (!r.ok) {
          throw new Error(`Failed to load Forge status (${r.status})`);
        }
        return r.json() as Promise<ForgeStatusResponse>;
      })
      .then((data) => {
        setStatus(data);
        setStatusError(null);
        setLoading(false);
        if (data.activeUpdate) {
          setExpandedUpdateId(data.activeUpdate.id);
        }
      })
      .catch((err: unknown) => {
        setLoading(false);
        setStatusError(
          err instanceof Error ? err.message : "Failed to load Forge status",
        );
      });
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 3000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  async function runUpdate() {
    setActionLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/forge/update", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Update failed");
      }
      fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setActionLoading(false);
    }
  }

  async function runRollback() {
    if (
      !window.confirm(
        `Roll back ${APP_DISPLAY_NAME} to the previous working release? The current version will be replaced.`,
      )
    ) {
      return;
    }
    setActionLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/forge/rollback", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Rollback failed");
      }
      fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rollback failed");
    } finally {
      setActionLoading(false);
    }
  }

  const busy = actionLoading || !!status?.activeUpdate;
  const latestFailed = status?.recentUpdates.find((u) => u.status === "failed");

  return (
    <section
      className={`rounded-xl border border-zinc-800 bg-zinc-900/50 ${className}`}
    >
      <div className="border-b border-zinc-800 px-5 py-4">
        <h2 className="text-lg font-medium text-zinc-100">{APP_DISPLAY_NAME} self-update</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Update and redeploy {APP_DISPLAY_NAME} from its GitHub repository. Failed upgrades
          automatically roll back to the previous release.
        </p>
      </div>

      <div className="space-y-5 px-5 py-5">
        {loading ? (
          <div className="h-24 animate-pulse rounded-lg bg-zinc-800/60" />
        ) : statusError ? (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {statusError}
          </div>
        ) : !status?.configured ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            Set{" "}
            <code className="text-amber-100">FORGE_SELF_REPO</code> (e.g.{" "}
            <code className="text-amber-100">owner/forge</code>) in the
            environment and redeploy to enable self-updates.
          </div>
        ) : (
          <>
            <dl className="grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs uppercase tracking-wide text-zinc-500">
                  Repository
                </dt>
                <dd className="mt-1 font-mono text-sm text-zinc-200">
                  {status.selfRepo}@{status.selfBranch}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-zinc-500">
                  Running commit
                </dt>
                <dd className="mt-1 font-mono text-sm text-zinc-200">
                  {shortSha(status.runningCommitSha)}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-zinc-500">
                  Latest remote
                </dt>
                <dd className="mt-1 font-mono text-sm text-zinc-200">
                  {status.remoteCommitLookupFailed
                    ? "Unavailable"
                    : shortSha(status.remoteCommitSha)}
                  {status.updateAvailable && (
                    <span className="ml-2 text-xs text-orange-400">
                      Update available
                    </span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-zinc-500">
                  Rollback image
                </dt>
                <dd className="mt-1 text-sm text-zinc-200">
                  {status.hasRollbackImage ? "Available" : "Not available yet"}
                </dd>
              </div>
            </dl>

            {status.remoteCommitLookupFailed && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                Could not reach GitHub to compare commits. Updates are paused
                until the remote can be checked again.
              </div>
            )}

            {error && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {error}
              </div>
            )}

            {!status.activeUpdate && latestFailed?.errorMessage && (
              <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-200">
                Last update failed: {latestFailed.errorMessage}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
              {!status.updateAvailable && !status.activeUpdate && (
                <p className="text-sm text-zinc-400">
                  {status.remoteCommitLookupFailed
                    ? "Waiting for GitHub before checking for updates."
                    : (
                      <>
                        {APP_DISPLAY_NAME} is up to date with{" "}
                        <span className="font-mono text-zinc-300">
                          {status.selfRepo}@{status.selfBranch}
                        </span>
                        . You can still redeploy the same commit.
                      </>
                    )}
                </p>
              )}

              <button
                type="button"
                onClick={runUpdate}
                disabled={busy || !status.deployAllowed}
                className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {status.activeUpdate
                  ? "Update in progress…"
                  : status.updateAvailable
                    ? `Update ${APP_DISPLAY_NAME}`
                    : `Redeploy ${APP_DISPLAY_NAME}`}
              </button>
              <button
                type="button"
                onClick={runRollback}
                disabled={busy || !status.hasRollbackImage}
                className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Roll back
              </button>
            </div>

            {status.activeUpdate && (
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/80 p-4">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-zinc-200">
                    Active update
                  </span>
                  <span
                    className={`text-sm ${statusToneClass(status.activeUpdate.status)}`}
                  >
                    {statusLabel(status.activeUpdate.status)}
                  </span>
                </div>
                {status.activeUpdate.errorMessage && (
                  <p className="mb-2 text-sm text-red-300">
                    {status.activeUpdate.errorMessage}
                  </p>
                )}
                {status.activeUpdate.logs && (
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-zinc-900 p-3 font-mono text-xs text-zinc-400">
                    {status.activeUpdate.logs}
                  </pre>
                )}
              </div>
            )}
          </>
        )}

        {status && !hideHistory && status.recentUpdates.length > 0 && (
          <div>
            <h3 className="mb-3 text-sm font-medium text-zinc-300">
              Recent updates
            </h3>
            <ul className="space-y-2">
              {status.recentUpdates.map((update) => {
                const expanded = expandedUpdateId === update.id;
                return (
                  <li
                    key={update.id}
                    className="rounded-lg border border-zinc-800 bg-zinc-950/50"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedUpdateId(expanded ? null : update.id)
                      }
                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                    >
                      <div className="min-w-0">
                        <div className="text-sm text-zinc-200">
                          {update.trigger === "rollback"
                            ? "Rollback"
                            : "Update"}{" "}
                          · {shortSha(update.targetCommitSha)}
                        </div>
                        <div className="text-xs text-zinc-500">
                          {new Date(update.startedAt).toLocaleString()}
                        </div>
                        {update.errorMessage && (
                          <div className="mt-1 truncate text-xs text-red-300">
                            {update.errorMessage}
                          </div>
                        )}
                      </div>
                      <span
                        className={`shrink-0 text-sm ${statusToneClass(update.status)}`}
                      >
                        {statusLabel(update.status)}
                      </span>
                    </button>
                    {expanded && update.logs && (
                      <pre className="max-h-48 overflow-auto whitespace-pre-wrap border-t border-zinc-800 px-4 py-3 font-mono text-xs text-zinc-500">
                        {update.logs}
                      </pre>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
