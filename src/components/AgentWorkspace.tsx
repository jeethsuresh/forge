"use client";

import { sessionForBranch, useAgentWorkspace } from "@/components/useAgentWorkspace";
import Link from "next/link";
import { formatRelativeTime, shortSha, statusColor } from "@/lib/utils";
import { AgentMessageList } from "@/components/AgentMessageList";
import { ActiveDeployLogsPanel } from "@/components/ActiveDeployLogsPanel";
import {
  agentSessionSourceBadgeClass,
} from "@/lib/agent-session-source";
import {
  agentSessionUncommittedDiffHref,
  branchVsMainDiffHref,
} from "@/lib/project-diff-url";

export function AgentWorkspace({
  projectId,
  watchBranch,
  className = "",
  initialSessionId = null,
}: {
  projectId: string;
  watchBranch: string;
  className?: string;
  initialSessionId?: string | null;
}) {
  const {
    selectedBranch,
    setSelectedBranch,
    selectedId,
    setSelectedId,
    messages,
    setMessages,
    sessionDetail,
    setSessionDetail,
    deployLogView,
    setDeployLogView,
    prompt,
    setPrompt,
    loading,
    showLogs,
    setShowLogs,
    mobileShowChat,
    setMobileShowChat,
    showNewBranchForm,
    setShowNewBranchForm,
    newBranchName,
    setNewBranchName,
    messagesScrollRef,
    shouldAutoScrollRef,
    branches,
    sessions,
    archivedSessions,
    activeBranch,
    archiveCollapseKey,
    archiveExpanded,
    setArchiveExpanded,
    showRecreateForm,
    setShowRecreateForm,
    recreatePrompt,
    setRecreatePrompt,
    hasActiveRuntime,
    selectBranch,
    selectedSessionMeta,
    deployBranchName,
    isArchivedSession,
    isActiveSession,
    isQueuedSession,
    showEndSession,
    isDeploying,
    isRecoverySession,
    isRebaseRecoverySession,
    isTerminalSession,
    showFollowUp,
    showActiveAgentActions,
    showFinishedAgentActions,
    showRevertCommit,
    showFailedAgentActions,
    showFinishAndDeploy,
    showContinueForm,
    showNewAgentForm,
    showRecreateButton,
    showArchiveButton,
    showRestartButton,
    agentBranches,
    idleBranches,
    statusBanner,
    startOrContinueSession,
    createNewBranchAndAgent,
    sendMessage,
    commitSession,
    revertSessionCommit,
    deploySession,
    finishSession,
    retryFailedTurn,
    endSession,
    stopAgent,
    archiveSession,
    removeAgent,
    restartStuckAgent,
    recreateAgent,
    clearLogs,
    cancelSession,
  } = useAgentWorkspace({
    projectId,
    watchBranch,
    className,
    initialSessionId,
  });

  const branchSidebar = (
    <aside
      className={`flex h-full min-h-0 w-full shrink-0 flex-col overflow-hidden border-[var(--forge-line)] bg-[var(--forge-app)] md:w-64 md:border-r ${
        mobileShowChat ? "hidden md:flex" : "flex"
      }`}
    >
      <div className="border-b border-[var(--forge-line)] px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-[var(--forge-faint)]">
              Agents
            </p>
            <p className="mt-0.5 text-xs text-[var(--forge-faint)]">
              Queue agents on different branches
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setShowNewBranchForm(true);
              setMobileShowChat(true);
              setSelectedBranch("");
              setSelectedId(null);
              setSessionDetail(null);
              setDeployLogView(null);
              setMessages([]);
            }}
            disabled={loading}
            className="min-h-8 shrink-0 rounded-lg border border-[var(--forge-line-strong)] px-2.5 py-1 text-xs font-medium text-[var(--forge-muted)] hover:bg-[rgba(255,255,255,0.04)] disabled:opacity-50"
            title="Create a new branch and agent"
          >
            + New
          </button>
        </div>
      </div>

      {idleBranches.length > 0 && (
        <label className="block border-b border-[var(--forge-line)] px-4 py-2">
          <span className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-[var(--forge-faint)]">
            Start on branch
          </span>
          <select
            value=""
            disabled={loading}
            onChange={(e) => {
              const name = e.target.value;
              e.currentTarget.selectedIndex = 0;
              if (!name) return;
              const next = branches.find((b) => b.name === name);
              if (!next) return;
              setShowNewBranchForm(false);
              setShowRecreateForm(false);
              selectBranch(next);
              setMobileShowChat(true);
            }}
            className="min-h-11 w-full rounded-lg border border-[var(--forge-line-strong)] bg-[rgba(0,0,0,0.35)] px-2.5 text-sm text-[var(--forge-bright)]"
          >
            <option value="">Branches without an agent…</option>
            {idleBranches.map((b) => (
              <option key={b.name} value={b.name}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {agentBranches.map((b) => {
          const session = sessionForBranch(sessions, b.name);
          const isSelected =
            selectedBranch === b.name && !sessionDetail?.archivedAt;
          const isRunning =
            session?.hasActiveRuntime ??
            session?.hasActiveProcess ??
            b.sessionStatus === "deploying";

          return (
            <li key={b.name}>
              <button
                type="button"
                onClick={() => {
                  setShowRecreateForm(false);
                  selectBranch(b);
                }}
                className={`flex w-full flex-col gap-1 border-b border-[var(--forge-line)] px-4 py-3 text-left transition-colors hover:bg-[rgba(255,255,255,0.04)] ${
                  isSelected ? "bg-[rgba(255,255,255,0.04)]" : ""
                }`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${
                      isRunning
                        ? "animate-pulse bg-amber-400"
                        : b.hasAgent
                          ? "bg-[var(--forge-muted)]"
                          : "bg-[var(--forge-elevated)]"
                    }`}
                  />
                  <span className="min-w-0 flex-1 truncate font-mono text-sm text-[var(--forge-bright)]">
                    {b.name}
                  </span>
                </div>
                {session ? (
                  <p className="line-clamp-2 pl-4 text-xs text-[var(--forge-faint)]">
                    {session.initialPrompt}
                  </p>
                ) : (
                  <p className="pl-4 text-xs text-[var(--forge-faint)]">No agent yet</p>
                )}
                <div className="flex flex-wrap items-center gap-1.5 pl-4">
                  {b.isDeployBranch && (
                    <span className="text-[10px] uppercase text-[var(--forge-faint)]">
                      deploy
                    </span>
                  )}
                  {session?.sessionSourceLabel && (
                    <span
                      className={`rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${agentSessionSourceBadgeClass(session.sessionSource ?? "manual")}`}
                    >
                      {session.sessionSourceLabel}
                    </span>
                  )}
                  {b.sessionStatus && (
                    <span
                      className={`rounded border px-1.5 py-0.5 text-[10px] capitalize ${statusColor(b.sessionStatus)}`}
                    >
                      {b.sessionStatus}
                    </span>
                  )}
                </div>
              </button>
              {session ? (
                <div className="flex flex-wrap gap-1 border-b border-[var(--forge-line)] px-4 pb-2 pl-8">
                  <button
                    type="button"
                    disabled={loading}
                    onClick={(e) => {
                      e.stopPropagation();
                      void restartStuckAgent(session.id);
                    }}
                    className="min-h-9 rounded-md border border-[var(--forge-line-strong)] px-2 text-[11px] text-[var(--forge-bright)] hover:bg-[var(--forge-elevated)] disabled:opacity-50"
                  >
                    Restart
                  </button>
                  <button
                    type="button"
                    disabled={loading}
                    onClick={(e) => {
                      e.stopPropagation();
                      void removeAgent(session.id);
                    }}
                    className="min-h-9 rounded-md border border-red-400/30 px-2 text-[11px] text-red-300 hover:bg-red-400/10 disabled:opacity-50"
                  >
                    Remove agent
                  </button>
                </div>
              ) : null}
            </li>
          );
        })}
        {branches.length === 0 ? (
          <li className="px-4 py-8 text-center text-sm text-[var(--forge-faint)]">
            No local branches. Clone the repo first.
          </li>
        ) : agentBranches.length === 0 ? (
          <li className="px-4 py-8 text-center text-sm text-[var(--forge-faint)]">
            No agents yet. Choose a branch without an agent above, or create a
            new one.
          </li>
        ) : null}
      </ul>

      <div className="shrink-0 border-t border-[var(--forge-line)]">
        <button
          type="button"
          onClick={() => {
            setArchiveExpanded((open) => {
              const next = !open;
              try {
                window.localStorage.setItem(
                  archiveCollapseKey,
                  next ? "1" : "0",
                );
              } catch {
                // ignore
              }
              return next;
            });
          }}
          aria-expanded={archiveExpanded}
          className="flex min-h-10 w-full items-center gap-2 px-4 py-2 text-left hover:bg-[rgba(255,255,255,0.04)]"
        >
          <span
            className={`text-[var(--forge-faint)] transition-transform ${archiveExpanded ? "rotate-90" : ""}`}
            aria-hidden
          >
            ›
          </span>
          <span className="text-xs font-medium uppercase tracking-wider text-[var(--forge-faint)]">
            Archived sessions
          </span>
          <span className="ml-auto text-[10px] text-[var(--forge-faint)]">
            {archivedSessions.length}
          </span>
        </button>
        {archiveExpanded && (
          <ul className="max-h-48 overflow-y-auto overscroll-contain border-t border-[var(--forge-line)]">
            {archivedSessions.length === 0 ? (
              <li className="px-4 py-3 text-xs text-[var(--forge-faint)]">
                No archived sessions yet.
              </li>
            ) : (
              archivedSessions.map((session) => {
                const isSelected = selectedId === session.id;
                return (
                  <li key={session.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setShowNewBranchForm(false);
                        setShowRecreateForm(false);
                        setSelectedBranch(session.branch);
                        setSelectedId(session.id);
                        setSessionDetail(session);
                        setDeployLogView(null);
                        setMessages([]);
                        setMobileShowChat(true);
                      }}
                      className={`flex w-full flex-col gap-1 border-b border-[var(--forge-line)] px-4 py-2.5 text-left hover:bg-[rgba(255,255,255,0.04)] ${
                        isSelected ? "bg-[rgba(255,255,255,0.04)]" : ""
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate font-mono text-xs text-[var(--forge-muted)]">
                          {session.branch}
                        </span>
                        <span
                          className={`rounded border px-1.5 py-0.5 text-[10px] capitalize ${statusColor(session.status)}`}
                        >
                          {session.status}
                        </span>
                      </div>
                      <p className="line-clamp-2 text-[11px] text-[var(--forge-faint)]">
                        {session.initialPrompt}
                      </p>
                      <p className="text-[10px] text-[var(--forge-faint)]">
                        {session.archivedAt
                          ? formatRelativeTime(session.archivedAt)
                          : formatRelativeTime(session.startedAt)}
                      </p>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        )}
      </div>
    </aside>
  );

  const chatArea = (
    <div
      className={`flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--forge-panel)] ${
        !mobileShowChat ? "hidden md:flex" : "flex"
      }`}
    >
      {!selectedBranch && !showNewBranchForm ? (
        <div className="flex flex-1 items-center justify-center p-8 text-sm text-[var(--forge-faint)]">
          Select a branch to start or open an agent
        </div>
      ) : showNewBranchForm ? (
        <div className="flex flex-1 flex-col p-4">
          <div className="mb-4 flex items-start justify-between gap-2">
            <div>
              <button
                type="button"
                onClick={() => setMobileShowChat(false)}
                className="mb-1 inline-flex min-h-8 items-center gap-1 text-sm text-orange-400 hover:text-orange-300 md:hidden"
              >
                ← Agents
              </button>
              <h3 className="text-sm font-medium text-[var(--forge-bright)]">New branch &amp; agent</h3>
              <p className="mt-1 text-xs text-[var(--forge-faint)]">
                Creates a branch from{" "}
                <span className="font-mono text-orange-400/90">
                  {deployBranchName ?? "deploy branch"}
                </span>{" "}
                and starts an agent on it.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setShowNewBranchForm(false);
                setNewBranchName("");
                setPrompt("");
              }}
              className="min-h-8 rounded-lg px-2 py-1 text-xs text-[var(--forge-faint)] hover:bg-[var(--forge-elevated)] hover:text-[var(--forge-muted)]"
            >
              Cancel
            </button>
          </div>

          <form onSubmit={createNewBranchAndAgent} className="flex flex-1 flex-col">
            <label className="mb-3 block">
              <span className="mb-1.5 block text-xs font-medium text-[var(--forge-faint)]">
                Branch name
              </span>
              <input
                type="text"
                value={newBranchName}
                onChange={(e) => setNewBranchName(e.target.value)}
                placeholder="agent/my-feature"
                autoFocus
                className="w-full rounded-lg border border-[var(--forge-line-strong)] bg-[rgba(0,0,0,0.35)] px-3 py-2.5 font-mono text-sm text-[var(--forge-bright)] placeholder:text-[var(--forge-faint)] focus:border-orange-500 focus:outline-none"
              />
            </label>
            <label className="mb-3 block flex-1">
              <span className="mb-1.5 block text-xs font-medium text-[var(--forge-faint)]">
                Initial instruction
              </span>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Describe what you want the agent to change…"
                rows={4}
                className="h-full min-h-32 w-full resize-none rounded-lg border border-[var(--forge-line-strong)] bg-[rgba(0,0,0,0.35)] px-3 py-2.5 text-base text-[var(--forge-bright)] placeholder:text-[var(--forge-faint)] focus:border-orange-500 focus:outline-none sm:text-sm"
              />
            </label>
            <button
              type="submit"
              disabled={
                loading ||
                !newBranchName.trim() ||
                !prompt.trim()
              }
              className="min-h-11 rounded-lg bg-orange-500 py-2.5 text-sm font-semibold text-white hover:bg-orange-400 disabled:opacity-50"
            >
              Create branch &amp; start agent
            </button>
          </form>
        </div>
      ) : (
        <>
          <div className="flex shrink-0 items-start justify-between gap-2 border-b border-[var(--forge-line)] px-4 py-3">
            <div className="min-w-0">
              <button
                type="button"
                onClick={() => setMobileShowChat(false)}
                className="mb-1 inline-flex min-h-8 items-center gap-1 text-sm text-orange-400 hover:text-orange-300 md:hidden"
              >
                ← Agents
              </button>
              <h3 className="truncate font-mono text-sm font-medium text-[var(--forge-bright)]">
                {selectedBranch}
              </h3>
              {sessionDetail?.sessionSourceLabel && (
                <span
                  className={`mt-1 inline-flex rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${agentSessionSourceBadgeClass(sessionDetail.sessionSource ?? "manual")}`}
                >
                  {sessionDetail.sessionSourceLabel}
                </span>
              )}
              {sessionDetail?.commitSha && (
                <p className="text-xs text-[var(--forge-faint)]">
                  Commit {shortSha(sessionDetail.commitSha)}
                </p>
              )}
              {sessionDetail?.deploymentId && (
                <p className="text-xs text-[var(--forge-faint)]">
                  Deploy {shortSha(sessionDetail.deploymentId)}
                </p>
              )}
              {sessionDetail?.containerId && (
                <p className="text-xs text-[var(--forge-faint)]">
                  Container{" "}
                  <span className="font-mono">
                    {sessionDetail.containerId.slice(0, 12)}
                  </span>
                </p>
              )}
              {sessionDetail?.killReason &&
                sessionDetail.killReason !== "reconcile_missing" && (
                <p className="text-xs text-red-400/90">
                  Kill reason: {sessionDetail.killReason.replace(/_/g, " ")}
                </p>
              )}
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
              {showRestartButton && selectedId && !isArchivedSession && (
                <button
                  type="button"
                  onClick={() => void restartStuckAgent(selectedId)}
                  disabled={loading}
                  className="min-h-9 rounded-lg border border-orange-400/40 bg-orange-400/10 px-2.5 py-1.5 text-xs font-medium text-orange-200 hover:bg-orange-400/20 disabled:opacity-50"
                >
                  Restart
                </button>
              )}
              {hasActiveRuntime && !isDeploying && selectedId && (
                <button
                  type="button"
                  onClick={stopAgent}
                  disabled={loading}
                  className="min-h-9 rounded-lg border border-red-400/30 bg-red-400/10 px-2.5 py-1.5 text-xs font-medium text-red-300 hover:bg-red-400/20 disabled:opacity-50"
                >
                  Stop
                </button>
              )}
              {showActiveAgentActions && (
                <button
                  type="button"
                  onClick={finishSession}
                  disabled={loading}
                  className="min-h-9 rounded-lg bg-orange-500 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-orange-400 disabled:opacity-50"
                >
                  Finish &amp; deploy
                </button>
              )}
              {showFailedAgentActions && showFinishAndDeploy && (
                <button
                  type="button"
                  onClick={finishSession}
                  disabled={loading}
                  className="min-h-9 rounded-lg bg-orange-500 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-orange-400 disabled:opacity-50"
                >
                  Finish &amp; deploy
                </button>
              )}
              {selectedId && (
                <div className="flex rounded-lg border border-[var(--forge-line-strong)] p-0.5">
                  <button
                    type="button"
                    onClick={() => setShowLogs(false)}
                    className={`min-h-8 rounded-md px-2.5 text-xs ${
                      !showLogs
                        ? "bg-[var(--forge-elevated)] text-[var(--forge-bright)]"
                        : "text-[var(--forge-faint)] hover:text-[var(--forge-muted)]"
                    }`}
                  >
                    Chat
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowLogs(true)}
                    className={`min-h-8 rounded-md px-2.5 text-xs ${
                      showLogs
                        ? "bg-[var(--forge-elevated)] text-[var(--forge-bright)]"
                        : "text-[var(--forge-faint)] hover:text-[var(--forge-muted)]"
                    }`}
                  >
                    Logs
                  </button>
                </div>
              )}
              <details className="relative">
                <summary className="flex min-h-9 cursor-pointer list-none items-center rounded-lg border border-[var(--forge-line-strong)] px-2.5 py-1.5 text-xs text-[var(--forge-bright)] hover:bg-[var(--forge-elevated)] [&::-webkit-details-marker]:hidden">
                  Session
                </summary>
                <div className="absolute right-0 z-30 mt-1 max-h-[70vh] w-52 overflow-y-auto rounded-lg border border-[var(--forge-line-strong)] bg-[rgba(0,0,0,0.35)] py-1 shadow-xl">
                  {showRecreateButton && (
                    <button
                      type="button"
                      onClick={() => {
                        setShowRecreateForm(true);
                        setRecreatePrompt("");
                      }}
                      disabled={loading}
                      className="flex w-full px-3 py-2 text-left text-xs text-[var(--forge-bright)] hover:bg-[var(--forge-elevated)] disabled:opacity-50"
                    >
                      Recreate
                    </button>
                  )}
                  {showArchiveButton && (
                    <button
                      type="button"
                      onClick={() => void archiveSession()}
                      disabled={loading}
                      className="flex w-full px-3 py-2 text-left text-xs text-[var(--forge-muted)] hover:bg-[var(--forge-elevated)] disabled:opacity-50"
                    >
                      Archive
                    </button>
                  )}
                  {showEndSession && (
                    <button
                      type="button"
                      onClick={endSession}
                      disabled={loading}
                      className="flex w-full px-3 py-2 text-left text-xs text-amber-200 hover:bg-amber-400/10 disabled:opacity-50"
                    >
                      End session
                    </button>
                  )}
                  {sessionDetail?.status === "failed" &&
                    sessionDetail.canRetry && (
                      <button
                        type="button"
                        onClick={retryFailedTurn}
                        disabled={loading || hasActiveRuntime}
                        className="flex w-full px-3 py-2 text-left text-xs text-orange-300 hover:bg-orange-400/10 disabled:opacity-50"
                      >
                        Retry
                      </button>
                    )}
                  {showActiveAgentActions && (
                    <>
                      <button
                        type="button"
                        onClick={commitSession}
                        disabled={loading}
                        className="flex w-full px-3 py-2 text-left text-xs text-[var(--forge-bright)] hover:bg-[var(--forge-elevated)] disabled:opacity-50"
                      >
                        Commit
                      </button>
                      <button
                        type="button"
                        onClick={deploySession}
                        disabled={loading}
                        className="flex w-full px-3 py-2 text-left text-xs text-orange-300 hover:bg-orange-400/10 disabled:opacity-50"
                      >
                        Deploy
                      </button>
                      <button
                        type="button"
                        onClick={cancelSession}
                        disabled={loading}
                        className="flex w-full px-3 py-2 text-left text-xs text-red-400 hover:bg-red-400/10 disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </>
                  )}
                  {showFinishedAgentActions && (
                    <>
                      <button
                        type="button"
                        onClick={deploySession}
                        disabled={loading}
                        className="flex w-full px-3 py-2 text-left text-xs text-orange-300 hover:bg-orange-400/10 disabled:opacity-50"
                      >
                        Deploy
                      </button>
                      {showRevertCommit && (
                        <button
                          type="button"
                          onClick={revertSessionCommit}
                          disabled={loading}
                          className="flex w-full px-3 py-2 text-left text-xs text-red-400 hover:bg-red-400/10 disabled:opacity-50"
                        >
                          Revert commit
                        </button>
                      )}
                    </>
                  )}
                  {showFailedAgentActions && (
                    <>
                      <button
                        type="button"
                        onClick={commitSession}
                        disabled={loading}
                        className="flex w-full px-3 py-2 text-left text-xs text-[var(--forge-bright)] hover:bg-[var(--forge-elevated)] disabled:opacity-50"
                      >
                        Commit
                      </button>
                      <button
                        type="button"
                        onClick={deploySession}
                        disabled={loading}
                        className="flex w-full px-3 py-2 text-left text-xs text-orange-300 hover:bg-orange-400/10 disabled:opacity-50"
                      >
                        Deploy
                      </button>
                    </>
                  )}
                  {selectedId && (
                    <>
                      <Link
                        href={agentSessionUncommittedDiffHref(
                          projectId,
                          selectedId,
                        )}
                        className="flex w-full px-3 py-2 text-left text-xs text-[var(--forge-muted)] hover:bg-[var(--forge-elevated)]"
                      >
                        View changes
                      </Link>
                      {selectedBranch && (
                        <Link
                          href={branchVsMainDiffHref(
                            projectId,
                            selectedBranch,
                          )}
                          className="flex w-full px-3 py-2 text-left text-xs text-[var(--forge-muted)] hover:bg-[var(--forge-elevated)]"
                        >
                          vs {watchBranch}
                        </Link>
                      )}
                    </>
                  )}
                  {selectedId && showLogs && (
                    <button
                      type="button"
                      onClick={clearLogs}
                      disabled={
                        loading || hasActiveRuntime || !sessionDetail?.logs
                      }
                      className="flex w-full px-3 py-2 text-left text-xs text-[var(--forge-muted)] hover:bg-[var(--forge-elevated)] disabled:opacity-50"
                    >
                      Clear logs
                    </button>
                  )}
                </div>
              </details>
            </div>
          </div>

          {isArchivedSession && (
            <div className="border-b border-[var(--forge-line)] bg-[rgba(0,0,0,0.35)] px-4 py-2 text-xs text-[var(--forge-muted)]">
              Archived session — read-only. Recreate a live agent from the branch
              list when you want a fresh run.
            </div>
          )}

          {showRecreateForm && selectedBranch && (
            <form
              onSubmit={recreateAgent}
              className="space-y-3 border-b border-[var(--forge-line)] bg-[rgba(0,0,0,0.28)] px-4 py-3"
            >
              <div>
                <p className="text-sm font-medium text-[var(--forge-bright)]">
                  Recreate agent on{" "}
                  <span className="font-mono text-orange-300">
                    {selectedBranch}
                  </span>
                </p>
                <p className="mt-1 text-xs text-[var(--forge-faint)]">
                  Archives the current session and starts a brand-new agent with
                  a new initial prompt.
                </p>
              </div>
              <textarea
                value={recreatePrompt}
                onChange={(e) => setRecreatePrompt(e.target.value)}
                rows={4}
                required
                placeholder="New initial prompt…"
                disabled={loading}
                className="w-full rounded-lg border border-[var(--forge-line-strong)] bg-[rgba(0,0,0,0.35)] px-3 py-2 text-sm text-[var(--forge-bright)] outline-none focus:border-orange-500/50 disabled:opacity-50"
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="submit"
                  disabled={loading || !recreatePrompt.trim()}
                  className="rounded-lg bg-orange-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-400 disabled:opacity-50"
                >
                  {loading ? "Starting…" : "Archive & start fresh"}
                </button>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => {
                    setShowRecreateForm(false);
                    setRecreatePrompt("");
                  }}
                  className="rounded-lg border border-[var(--forge-line-strong)] px-3 py-1.5 text-xs text-[var(--forge-muted)] hover:bg-[var(--forge-elevated)] disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          {deployLogView && (
            <ActiveDeployLogsPanel
              view={deployLogView}
              className="mx-4 mt-3 shrink-0"
            />
          )}

          {isQueuedSession && (
            <p className="border-b border-[var(--forge-line)] bg-amber-400/5 px-4 py-2 text-xs text-amber-400">
              Queued behind the active agent
              {activeBranch ? (
                <>
                  {" "}
                  on <span className="font-mono">{activeBranch}</span>
                </>
              ) : null}
              . This session will start automatically when its turn comes.
            </p>
          )}

          {sessionDetail &&
            isTerminalSession &&
            sessionDetail.status === "completed" &&
            !sessionDetail.deploymentId && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--forge-line)] bg-orange-400/5 px-4 py-3">
                <p className="text-sm text-[var(--forge-muted)]">
                  Session finished
                  {sessionDetail.commitSha
                    ? ` and changes were pushed (${shortSha(sessionDetail.commitSha)})`
                    : " with no file changes"}
                  . Deploy when ready, or revert the commit.
                </p>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={deploySession}
                    disabled={loading}
                    className="min-h-9 rounded-lg bg-orange-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-400 disabled:opacity-50"
                  >
                    Deploy
                  </button>
                  {showRevertCommit && (
                    <button
                      type="button"
                      onClick={revertSessionCommit}
                      disabled={loading}
                      className="min-h-9 rounded-lg border border-red-400/20 px-3 py-1.5 text-xs text-red-400 hover:bg-red-400/10 disabled:opacity-50"
                    >
                      Revert commit
                    </button>
                  )}
                </div>
              </div>
            )}

          {sessionDetail &&
            isTerminalSession &&
            sessionDetail.hasFileEdits === false &&
            sessionDetail.status === "completed" &&
            !sessionDetail.commitSha && (
              <p className="border-b border-[var(--forge-line)] bg-[rgba(255,255,255,0.04)] px-4 py-2 text-xs text-[var(--forge-muted)]">
                Session finished with no file changes.
              </p>
            )}

          {sessionDetail &&
            !isTerminalSession &&
            sessionDetail.hasFileEdits === true &&
            showFinishAndDeploy && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--forge-line)] bg-orange-400/5 px-4 py-3">
                <p className="text-sm text-[var(--forge-muted)]">
                  Agent finished with file changes ready to ship.
                </p>
                <button
                  type="button"
                  onClick={finishSession}
                  disabled={loading}
                  className="min-h-9 shrink-0 rounded-lg bg-orange-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-400 disabled:opacity-50"
                >
                  Finish &amp; deploy
                </button>
              </div>
            )}

          {sessionDetail &&
            !isTerminalSession &&
            sessionDetail.hasFileEdits === true &&
            !showFinishAndDeploy && (
              <p className="border-b border-[var(--forge-line)] bg-[rgba(255,255,255,0.04)] px-4 py-2 text-xs text-[var(--forge-muted)]">
                Agent edited files on this branch.
              </p>
            )}

          {showNewAgentForm ? (
            <div className="flex flex-1 flex-col p-4">
              <p className="mb-4 text-sm text-[var(--forge-muted)]">
                {selectedSessionMeta
                  ? "Continue the agent on this branch with a new instruction."
                  : "Start a new agent on this branch."}
              </p>
              <form onSubmit={startOrContinueSession} className="flex flex-1 flex-col">
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Describe what you want the agent to change…"
                  rows={4}
                  className="mb-3 w-full flex-1 resize-none rounded-lg border border-[var(--forge-line-strong)] bg-[rgba(0,0,0,0.35)] px-3 py-2.5 text-base text-[var(--forge-bright)] placeholder:text-[var(--forge-faint)] focus:border-orange-500 focus:outline-none sm:text-sm"
                />
                <button
                  type="submit"
                  disabled={loading || !prompt.trim()}
                  className="min-h-11 rounded-lg bg-orange-500 py-2.5 text-sm font-semibold text-white hover:bg-orange-400 disabled:opacity-50"
                >
                  {selectedSessionMeta ? "Continue agent" : "Start agent"}
                </button>
              </form>
            </div>
          ) : showLogs && sessionDetail ? (
            <pre className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 font-mono text-xs leading-relaxed text-[var(--forge-muted)]">
              {sessionDetail.logs || "No logs yet."}
              {sessionDetail.errorMessage && (
                <span className="mt-2 block text-red-400">
                  {sessionDetail.errorMessage}
                  {sessionDetail.killReason
                    ? ` (kill: ${sessionDetail.killReason})`
                    : ""}
                </span>
              )}
            </pre>
          ) : selectedId ? (
            <>
              <div
                ref={messagesScrollRef}
                className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-4"
                onScroll={(e) => {
                  const el = e.currentTarget;
                  const nearBottom =
                    el.scrollHeight - el.scrollTop - el.clientHeight < 80;
                  shouldAutoScrollRef.current = nearBottom;
                }}
              >
                {isRebaseRecoverySession && isActiveSession && (
                  <div className="rounded-lg border border-sky-400/20 bg-sky-400/5 px-3 py-2.5 text-xs text-sky-200">
                    This agent started automatically after a failed rebase. Stop it
                    anytime to unblock branch operations.
                  </div>
                )}
                {isRecoverySession && isActiveSession && (
                  <div className="rounded-lg border border-amber-400/20 bg-amber-400/5 px-3 py-2.5 text-xs text-amber-200">
                    This agent started automatically after a failed deploy. Use Stop
                    to halt the current turn, or End session to finish and unblock
                    deploys — same as a manual agent.
                  </div>
                )}
                {messages.length === 0 && !statusBanner && (
                  <p className="py-8 text-center text-sm text-[var(--forge-faint)]">
                    Waiting for agent output…
                  </p>
                )}
                <AgentMessageList
                  messages={messages}
                  learnings={sessionDetail?.contextCompact}
                />
                {statusBanner?.kind === "working" && (
                  <div className="flex items-center gap-2 text-xs text-amber-400">
                    <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-amber-400" />
                    {statusBanner.text}
                  </div>
                )}
                {statusBanner?.kind === "failed" && (
                  <div className="rounded-lg border border-red-400/20 bg-red-400/5 px-3 py-2.5 text-xs">
                    <div className="flex items-start gap-2">
                      <span className="mt-0.5 shrink-0 text-red-400">✕</span>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-red-400">Agent turn failed</p>
                        <p className="mt-1 break-words text-red-300/90">
                          {statusBanner.text}
                        </p>
                        {statusBanner.canRetry && (
                          <button
                            type="button"
                            onClick={retryFailedTurn}
                            disabled={loading || hasActiveRuntime}
                            className="mt-2 min-h-8 rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-red-400/15 disabled:opacity-50"
                          >
                            Retry
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {showFollowUp && !showLogs && (
                <form
                  onSubmit={sendMessage}
                  className="shrink-0 border-t border-[var(--forge-line)] bg-[color-mix(in_srgb,var(--forge-panel)_95%,transparent)] p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
                >
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      placeholder="Send a follow-up instruction…"
                      enterKeyHint="send"
                      className="min-h-11 flex-1 rounded-lg border border-[var(--forge-line-strong)] bg-[rgba(0,0,0,0.35)] px-3 py-2 text-base text-[var(--forge-bright)] placeholder:text-[var(--forge-faint)] focus:border-orange-500 focus:outline-none sm:text-sm"
                    />
                    <button
                      type="submit"
                      disabled={loading || hasActiveRuntime || !prompt.trim()}
                      className="min-h-11 shrink-0 rounded-lg bg-[var(--forge-elevated)] px-4 py-2 text-sm font-medium text-[var(--forge-bright)] hover:bg-[var(--forge-muted)] disabled:opacity-50"
                    >
                      Send
                    </button>
                  </div>
                </form>
              )}

              {showContinueForm && !showLogs && (
                <form
                  onSubmit={startOrContinueSession}
                  className="shrink-0 border-t border-[var(--forge-line)] bg-[color-mix(in_srgb,var(--forge-panel)_95%,transparent)] p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
                >
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      placeholder="Continue with a new instruction…"
                      enterKeyHint="send"
                      className="min-h-11 flex-1 rounded-lg border border-[var(--forge-line-strong)] bg-[rgba(0,0,0,0.35)] px-3 py-2 text-base text-[var(--forge-bright)] placeholder:text-[var(--forge-faint)] focus:border-orange-500 focus:outline-none sm:text-sm"
                    />
                    <button
                      type="submit"
                      disabled={loading || hasActiveRuntime || !prompt.trim()}
                      className="min-h-11 shrink-0 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-400 disabled:opacity-50"
                    >
                      Continue
                    </button>
                  </div>
                </form>
              )}
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-8 text-sm text-[var(--forge-faint)]">
              Select a branch from the list.
            </div>
          )}
        </>
      )}
    </div>
  );

  return (
    <div
      data-testid="agent-workspace"
      className={`flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-[var(--forge-line)] ${className}`}
    >
      <div className="flex h-full min-h-0 flex-1 overflow-hidden">
        {branchSidebar}
        {chatArea}
      </div>
    </div>
  );
}

