"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { shortSha, statusColor } from "@/lib/utils";
import type { AgentDisplayMessage } from "@/lib/agent-stream";
import { mergeIncomingMessages } from "@/lib/agent-stream";
import {
  resolveAgentSessionBanner,
} from "@/lib/agent-turn";
import {
  agentSessionSourceBadgeClass,
  isInactiveAgentSessionStatus,
} from "@/lib/agent-session-source";
import { AgentMessageList } from "@/components/AgentMessageList";

interface AgentSession {
  id: string;
  branch: string;
  status: string;
  initialPrompt: string;
  logs: string;
  errorMessage: string | null;
  failedTurnStartSeq: number | null;
  deploymentId: string | null;
  commitSha: string | null;
  startedAt: string;
  completedAt: string | null;
  hasActiveProcess?: boolean;
  canRetry?: boolean;
  hasFileEdits?: boolean;
  sessionSource?: "manual" | "recovery";
  sessionSourceLabel?: string;
}

type StatusBanner =
  | { kind: "working"; text: string }
  | { kind: "failed"; text: string; canRetry: boolean }
  | null;

function toStatusBanner(
  banner: ReturnType<typeof resolveAgentSessionBanner>,
): StatusBanner {
  if (!banner) return null;
  if (banner.kind === "failed") {
    return {
      kind: "failed",
      text: banner.text,
      canRetry: banner.canRetry ?? false,
    };
  }
  return { kind: "working", text: banner.text };
}

interface BranchAgentInfo {
  name: string;
  isDeployBranch: boolean;
  sessionId: string | null;
  sessionStatus: string | null;
  hasAgent: boolean;
}

interface AgentSessionsResponse {
  sessions: AgentSession[];
  branches: BranchAgentInfo[];
  activeSession: AgentSession | null;
  hasActiveSession: boolean;
}

interface SessionDetailResponse {
  session: AgentSession;
  events: Array<{ seq: number }>;
  messages: AgentDisplayMessage[];
}

const ACTIVE_AGENT_STATUSES = new Set<string>([
  "pending",
  "running",
  "deploying",
]);

function sessionForBranch(
  sessions: AgentSession[],
  branch: string,
): AgentSession | undefined {
  return sessions.find((s) => s.branch === branch);
}

export function AgentWorkspace({
  projectId,
  className = "",
  initialSessionId = null,
}: {
  projectId: string;
  className?: string;
  initialSessionId?: string | null;
}) {
  const [data, setData] = useState<AgentSessionsResponse | null>(null);
  const [selectedBranch, setSelectedBranch] = useState<string>("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AgentDisplayMessage[]>([]);
  const [sessionDetail, setSessionDetail] = useState<AgentSession | null>(null);
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [mobileShowChat, setMobileShowChat] = useState(false);
  const [streamEpoch, setStreamEpoch] = useState(0);
  const [historyReady, setHistoryReady] = useState(false);
  const [loadedSessionTerminal, setLoadedSessionTerminal] = useState(false);
  const [showNewBranchForm, setShowNewBranchForm] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");

  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const lastStreamSeqRef = useRef(0);
  const streamGenerationRef = useRef(0);
  const sseConnectedRef = useRef(false);
  const shouldAutoScrollRef = useRef(true);
  const selectedIdRef = useRef<string | null>(null);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  const branches = useMemo(() => data?.branches ?? [], [data?.branches]);
  const sessions = useMemo(() => data?.sessions ?? [], [data?.sessions]);
  const activeBranch = data?.activeSession?.branch ?? null;

  const fetchSessions = useCallback(async () => {
    const res = await fetch(`/api/projects/${projectId}/agent-sessions`);
    if (!res.ok) return;
    const json = (await res.json()) as AgentSessionsResponse;
    setData(json);

    if (!selectedId) return;
    const refreshed = json.sessions.find((s) => s.id === selectedId);
    if (!refreshed) return;

    setSessionDetail((prev) =>
      prev?.id === selectedId ? refreshed : prev,
    );
  }, [projectId, selectedId]);

  const fetchSessionDetail = useCallback(
    async (
      sessionId: string,
      options?: { refreshMessages?: boolean },
    ) => {
      const res = await fetch(
        `/api/projects/${projectId}/agent-sessions/${sessionId}`,
      );
      if (!res.ok) return null;
      const json = (await res.json()) as SessionDetailResponse;
      if (selectedIdRef.current !== sessionId) return json;

      const lastSeq = json.events.at(-1)?.seq ?? 0;
      lastStreamSeqRef.current = lastSeq;

      setSessionDetail(json.session);
      if (options?.refreshMessages !== false) {
        setMessages(json.messages);
      }
      return json;
    },
    [projectId],
  );

  useEffect(() => {
    queueMicrotask(() => {
      void fetchSessions();
    });
    const interval = setInterval(() => {
      void fetchSessions();
    }, 8000);
    return () => clearInterval(interval);
  }, [fetchSessions]);

  useEffect(() => {
    if (!data || selectedBranch) return;
    const initial =
      (initialSessionId
        ? data.sessions.find((s) => s.id === initialSessionId)?.branch
        : null) ??
      data.activeSession?.branch ??
      data.branches.find((b) => b.sessionId)?.name ??
      data.branches[0]?.name ??
      "";
    if (!initial) return;
    const branch = data.branches.find((b) => b.name === initial);
    if (!branch) return;

    queueMicrotask(() => {
      setSelectedBranch(branch.name);
      if (branch.sessionId) {
        setSelectedId(branch.sessionId);
        const session = sessionForBranch(data.sessions, branch.name);
        if (session) {
          setSessionDetail(session);
        }
      }
      if (initialSessionId) {
        setMobileShowChat(true);
      }
    });
  }, [data, selectedBranch, initialSessionId]);

  useEffect(() => {
    if (!data || !initialSessionId) return;
    const session = data.sessions.find((s) => s.id === initialSessionId);
    if (!session) return;
    if (selectedId === session.id) return;

    const branch = data.branches.find((b) => b.name === session.branch);
    if (!branch) return;

    queueMicrotask(() => {
      setSelectedBranch(session.branch);
      setSelectedId(session.id);
      setSessionDetail(session);
      setMobileShowChat(true);
    });
  }, [data, initialSessionId, selectedId]);

  useEffect(() => {
    if (!selectedId) {
      queueMicrotask(() => {
        setHistoryReady(false);
        setLoadedSessionTerminal(false);
        setMessages([]);
      });
      lastStreamSeqRef.current = 0;
      return;
    }

    let cancelled = false;
    queueMicrotask(() => {
      setHistoryReady(false);
      setLoadedSessionTerminal(false);
    });

    void (async () => {
      const json = await fetchSessionDetail(selectedId);
      if (cancelled || !json) return;
      setLoadedSessionTerminal(isInactiveAgentSessionStatus(json.session.status));
      setHistoryReady(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedId, streamEpoch, fetchSessionDetail]);

  useEffect(() => {
    if (!selectedId || !historyReady || loadedSessionTerminal) {
      if (loadedSessionTerminal) {
        eventSourceRef.current?.close();
        eventSourceRef.current = null;
        sseConnectedRef.current = false;
      }
      return;
    }

    const generation = ++streamGenerationRef.current;
    const afterSeq = lastStreamSeqRef.current;

    eventSourceRef.current?.close();
    sseConnectedRef.current = false;

    const es = new EventSource(
      `/api/projects/${projectId}/agent-sessions/${selectedId}/stream?afterSeq=${afterSeq}`,
    );
    eventSourceRef.current = es;

    es.onopen = () => {
      sseConnectedRef.current = true;
    };

    const applyEventBatch = (payload: {
      events: Array<{ seq: number }>;
      messages: AgentDisplayMessage[];
      session: AgentSession;
    }) => {
      if (payload.events.length === 0) return;

      const lastSeq = payload.events[payload.events.length - 1]!.seq;
      if (lastSeq > lastStreamSeqRef.current) {
        lastStreamSeqRef.current = lastSeq;
      }

      setMessages((prev) => mergeIncomingMessages(prev, payload.messages));

      setSessionDetail((current) =>
        current?.id === payload.session.id ? payload.session : current,
      );
    };

    es.addEventListener("events", (e) => {
      if (streamGenerationRef.current !== generation) return;
      const payload = JSON.parse(e.data) as {
        events: Array<{ seq: number }>;
        messages: AgentDisplayMessage[];
        session: AgentSession;
      };
      applyEventBatch(payload);
    });

    es.addEventListener("heartbeat", (e) => {
      if (streamGenerationRef.current !== generation) return;
      const payload = JSON.parse(e.data) as { session: AgentSession };
      setSessionDetail((current) => {
        if (current?.id !== payload.session.id) return current;
        if (
          current.status === payload.session.status &&
          current.errorMessage === payload.session.errorMessage &&
          current.deploymentId === payload.session.deploymentId &&
          current.commitSha === payload.session.commitSha &&
          current.hasActiveProcess === payload.session.hasActiveProcess &&
          current.canRetry === payload.session.canRetry
        ) {
          return current;
        }
        return payload.session;
      });
    });

    es.addEventListener("done", (e) => {
      if (streamGenerationRef.current !== generation) return;
      const payload = JSON.parse(e.data) as { session: AgentSession };
      setSessionDetail(payload.session);
      setLoadedSessionTerminal(isInactiveAgentSessionStatus(payload.session.status));
      sseConnectedRef.current = false;
      void fetchSessions();
      es.close();
    });

    es.onerror = () => {
      sseConnectedRef.current = false;
      if (streamGenerationRef.current === generation) {
        es.close();
        eventSourceRef.current = null;
      }
    };

    return () => {
      sseConnectedRef.current = false;
      es.close();
    };
  }, [
    selectedId,
    projectId,
    historyReady,
    loadedSessionTerminal,
    fetchSessions,
    streamEpoch,
  ]);

  const hasActiveProcess = sessionDetail?.hasActiveProcess ?? false;

  useEffect(() => {
    if (!shouldAutoScrollRef.current) return;
    const el = messagesScrollRef.current;
    if (!el) return;
    el.scrollTo({
      top: el.scrollHeight,
      behavior: hasActiveProcess ? "auto" : "smooth",
    });
  }, [messages, hasActiveProcess, sessionDetail?.status]);

  function openBranch(
    branch: BranchAgentInfo,
    sessions: AgentSession[],
    showChatOnMobile: boolean,
  ) {
    setSelectedBranch(branch.name);
    if (showChatOnMobile) setMobileShowChat(true);

    if (branch.sessionId) {
      setSelectedId(branch.sessionId);
      const session = sessionForBranch(sessions, branch.name);
      if (session) {
        setSessionDetail(session);
      }
      return;
    }

    setSelectedId(null);
    setSessionDetail(null);
    setMessages([]);
  }

  function selectBranch(branch: BranchAgentInfo) {
    setShowNewBranchForm(false);
    setNewBranchName("");
    openBranch(branch, data?.sessions ?? [], true);
  }

  async function startOrContinueSession(e: React.FormEvent) {
    e.preventDefault();
    if (!prompt.trim() || !selectedBranch) return;
    setLoading(true);
    setMobileShowChat(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/agent-sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branch: selectedBranch,
          prompt: prompt.trim(),
        }),
      });
      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        alert(json.error ?? "Failed to start agent");
        return;
      }
      const json = (await res.json()) as { sessionId: string };
      const previousSessionId = selectedId;
      setPrompt("");
      setSelectedId(json.sessionId);
      await fetchSessions();
      if (json.sessionId === previousSessionId) {
        setStreamEpoch((epoch) => epoch + 1);
      }
    } finally {
      setLoading(false);
    }
  }

  async function createNewBranchAndAgent(e: React.FormEvent) {
    e.preventDefault();
    const branchName = newBranchName.trim();
    if (!branchName || !prompt.trim()) return;
    setLoading(true);
    setMobileShowChat(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/branches`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: branchName,
          prompt: prompt.trim(),
        }),
      });
      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        alert(json.error ?? "Failed to create branch");
        return;
      }
      const json = (await res.json()) as { branch: string; sessionId: string };
      setPrompt("");
      setNewBranchName("");
      setShowNewBranchForm(false);
      setSelectedBranch(json.branch);
      setSelectedId(json.sessionId);
      await fetchSessions();
      setStreamEpoch((epoch) => epoch + 1);
    } finally {
      setLoading(false);
    }
  }

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId || !prompt.trim()) return;
    setLoading(true);
    shouldAutoScrollRef.current = true;
    const userPrompt = prompt.trim();
    try {
      const res = await fetch(
        `/api/projects/${projectId}/agent-sessions/${selectedId}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: userPrompt }),
        },
      );
      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        alert(json.error ?? "Failed to send message");
        return;
      }
      setMessages((prev) => [
        ...prev,
        {
          id: `user-${Date.now()}`,
          role: "user",
          content: userPrompt,
          timestamp: Date.now(),
        },
      ]);
      setPrompt("");
    } finally {
      setLoading(false);
    }
  }

  async function commitSession() {
    if (!selectedId) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/agent-sessions/${selectedId}/commit`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
      );
      const json = (await res.json()) as {
        error?: string;
        committed?: boolean;
        commitSha?: string | null;
        pushed?: boolean;
      };
      if (!res.ok) {
        alert(json.error ?? "Failed to commit and push changes");
        return;
      }
      if (json.committed || json.pushed) {
        await fetchSessions();
        await fetchSessionDetail(selectedId);
      } else {
        alert("No uncommitted changes to commit.");
      }
    } finally {
      setLoading(false);
    }
  }

  async function deploySession() {
    if (!selectedId) return;
    if (
      !confirm(
        "Rebuild and release containers from this branch? Uncommitted changes will be included if present.",
      )
    ) {
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/agent-sessions/${selectedId}/deploy`,
        { method: "POST" },
      );
      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        alert(json.error ?? "Failed to deploy session");
        return;
      }
      await fetchSessions();
      await fetchSessionDetail(selectedId);
    } finally {
      setLoading(false);
    }
  }

  async function finishSession() {
    if (!selectedId) return;
    if (
      !confirm(
        "Commit agent changes, then rebuild and release containers?",
      )
    ) {
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/agent-sessions/${selectedId}/finish`,
        { method: "POST" },
      );
      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        alert(json.error ?? "Failed to finish session");
      }
      await fetchSessions();
      await fetchSessionDetail(selectedId);
    } finally {
      setLoading(false);
    }
  }

  async function retryFailedTurn() {
    if (!selectedId) return;
    setLoading(true);
    shouldAutoScrollRef.current = true;
    try {
      const res = await fetch(
        `/api/projects/${projectId}/agent-sessions/${selectedId}/retry`,
        { method: "POST" },
      );
      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        alert(json.error ?? "Failed to retry agent turn");
        return;
      }
      const json = (await res.json()) as { prompt?: string };
      setLoadedSessionTerminal(false);
      if (json.prompt) {
        setMessages((prev) => {
          const lastUserIdx = prev.map((m) => m.role).lastIndexOf("user");
          if (lastUserIdx < 0) return prev;
          const lastUser = prev[lastUserIdx]!;
          if (lastUser.content !== json.prompt) return prev;
          return prev.slice(0, lastUserIdx);
        });
      }
      await fetchSessionDetail(selectedId, { refreshMessages: true });
      setStreamEpoch((n) => n + 1);
      await fetchSessions();
    } finally {
      setLoading(false);
    }
  }

  async function endSession() {
    if (!selectedId || !selectedBranch) return;
    const recovery = sessionDetail?.sessionSource === "recovery";
    if (
      !confirm(
        recovery
          ? "Stop the deploy recovery agent? Deploys for this project will be unblocked."
          : "End this agent session? Deploys for this project will be unblocked.",
      )
    ) {
      return;
    }
    const revertChanges = confirm(
      `Also revert uncommitted changes on branch ${selectedBranch}?\n\nThis runs git reset --hard and git clean -fd in the project workspace.`,
    );
    setLoading(true);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/agent-sessions/${selectedId}/end`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ revertChanges }),
        },
      );
      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        alert(json.error ?? "Failed to end session");
        return;
      }
      setLoadedSessionTerminal(true);
      await fetchSessions();
      if (selectedId) await fetchSessionDetail(selectedId);
    } finally {
      setLoading(false);
    }
  }

  async function stopAgent() {
    if (!selectedId) return;
    if (!confirm("Stop the agent? You can retry or send another message afterward.")) {
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/agent-sessions/${selectedId}/stop`,
        { method: "POST" },
      );
      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        alert(json.error ?? "Failed to stop agent");
        return;
      }
      await fetchSessions();
      if (selectedId) await fetchSessionDetail(selectedId);
    } finally {
      setLoading(false);
    }
  }

  async function clearLogs() {
    if (!selectedId) return;
    if (!confirm("Clear this agent's raw logs? Chat history is not affected.")) {
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/agent-sessions/${selectedId}/clear-logs`,
        { method: "POST" },
      );
      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        alert(json.error ?? "Failed to clear logs");
        return;
      }
      await fetchSessions();
      await fetchSessionDetail(selectedId);
    } finally {
      setLoading(false);
    }
  }

  async function cancelSession() {
    if (!selectedId) return;
    if (
      !confirm(
        "Cancel this agent session? Changes on the branch will remain but won't be deployed.",
      )
    ) {
      return;
    }
    setLoading(true);
    try {
      await fetch(
        `/api/projects/${projectId}/agent-sessions/${selectedId}/cancel`,
        { method: "POST" },
      );
      await fetchSessions();
      if (selectedId) await fetchSessionDetail(selectedId);
    } finally {
      setLoading(false);
    }
  }

  const selectedBranchInfo = branches.find((b) => b.name === selectedBranch);
  const selectedSessionMeta = sessionForBranch(sessions, selectedBranch);
  const deployBranchName =
    branches.find((b) => b.isDeployBranch)?.name ?? null;

  const blockedByOtherBranch = Boolean(
    data?.hasActiveSession && activeBranch && activeBranch !== selectedBranch,
  );

  const isActiveSession = Boolean(
    sessionDetail && ACTIVE_AGENT_STATUSES.has(sessionDetail.status),
  );
  const showEndSession = Boolean(isActiveSession && selectedId);
  const isDeploying = sessionDetail?.status === "deploying";
  const isRecoverySession = sessionDetail?.sessionSource === "recovery";
  const canStartOnBranch = Boolean(
    selectedBranch &&
      !blockedByOtherBranch &&
      !isActiveSession &&
      (!selectedBranchInfo?.hasAgent ||
        (selectedBranchInfo.sessionStatus &&
          isInactiveAgentSessionStatus(selectedBranchInfo.sessionStatus))),
  );

  const isTerminalSession = Boolean(
    sessionDetail && isInactiveAgentSessionStatus(sessionDetail.status),
  );
  const showFollowUp = Boolean(isActiveSession && !isDeploying && selectedId);
  const canCommitOrDeploy = Boolean(
    sessionDetail &&
      ["running", "completed", "failed"].includes(sessionDetail.status) &&
      !hasActiveProcess &&
      !isDeploying,
  );
  const showActiveAgentActions =
    canCommitOrDeploy && sessionDetail?.status === "running";
  const showFinishedAgentActions =
    canCommitOrDeploy && sessionDetail?.status === "completed";
  const showFailedAgentActions =
    canCommitOrDeploy && sessionDetail?.status === "failed";
  const showFinishAndDeploy = Boolean(
    canCommitOrDeploy &&
      sessionDetail &&
      sessionDetail.hasFileEdits !== false &&
      !sessionDetail.deploymentId,
  );
  const showContinueForm = Boolean(canStartOnBranch && isTerminalSession);
  const showNewAgentForm = Boolean(canStartOnBranch && !selectedId);

  const statusBanner = useMemo((): StatusBanner => {
    if (!sessionDetail) return null;
    return toStatusBanner(
      resolveAgentSessionBanner({
        status: sessionDetail.status,
        hasActiveProcess,
        isDeploying,
        errorMessage: sessionDetail.errorMessage,
        canRetry: sessionDetail.canRetry ?? false,
      }),
    );
  }, [sessionDetail, isDeploying, hasActiveProcess]);

  const branchSidebar = (
    <aside
      className={`flex h-full min-h-0 w-full shrink-0 flex-col overflow-hidden border-zinc-800 bg-zinc-950 md:w-64 md:border-r ${
        mobileShowChat ? "hidden md:flex" : "flex"
      }`}
    >
      <div className="border-b border-zinc-800 px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
              Agents
            </p>
            <p className="mt-0.5 text-xs text-zinc-600">One agent per branch</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setShowNewBranchForm(true);
              setMobileShowChat(true);
              setSelectedBranch("");
              setSelectedId(null);
              setSessionDetail(null);
              setMessages([]);
            }}
            disabled={loading || blockedByOtherBranch}
            className="min-h-8 shrink-0 rounded-lg border border-zinc-700 px-2.5 py-1 text-xs font-medium text-zinc-300 hover:bg-zinc-900 disabled:opacity-50"
            title={
              blockedByOtherBranch
                ? "Finish or cancel the active agent first"
                : "Create a new branch and agent"
            }
          >
            + New
          </button>
        </div>
      </div>

      <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {branches.map((b) => {
          const session = sessionForBranch(sessions, b.name);
          const isSelected = selectedBranch === b.name;
          const isRunning =
            session?.hasActiveProcess ?? b.sessionStatus === "deploying";

          return (
            <li key={b.name}>
              <button
                type="button"
                onClick={() => selectBranch(b)}
                className={`flex w-full flex-col gap-1 border-b border-zinc-800/60 px-4 py-3 text-left transition-colors hover:bg-zinc-900 ${
                  isSelected ? "bg-zinc-900" : ""
                }`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${
                      isRunning
                        ? "animate-pulse bg-amber-400"
                        : b.hasAgent
                          ? "bg-zinc-600"
                          : "bg-zinc-700"
                    }`}
                  />
                  <span className="min-w-0 flex-1 truncate font-mono text-sm text-zinc-200">
                    {b.name}
                  </span>
                </div>
                {session ? (
                  <p className="line-clamp-2 pl-4 text-xs text-zinc-500">
                    {session.initialPrompt}
                  </p>
                ) : (
                  <p className="pl-4 text-xs text-zinc-600">No agent yet</p>
                )}
                <div className="flex flex-wrap items-center gap-1.5 pl-4">
                  {b.isDeployBranch && (
                    <span className="text-[10px] uppercase text-zinc-600">
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
            </li>
          );
        })}
        {branches.length === 0 && (
          <li className="px-4 py-8 text-center text-sm text-zinc-600">
            No local branches. Clone the repo first.
          </li>
        )}
      </ul>
    </aside>
  );

  const chatArea = (
    <div
      className={`flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-zinc-900 ${
        !mobileShowChat ? "hidden md:flex" : "flex"
      }`}
    >
      {!selectedBranch && !showNewBranchForm ? (
        <div className="flex flex-1 items-center justify-center p-8 text-sm text-zinc-600">
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
              <h3 className="text-sm font-medium text-zinc-100">New branch &amp; agent</h3>
              <p className="mt-1 text-xs text-zinc-500">
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
              className="min-h-8 rounded-lg px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
            >
              Cancel
            </button>
          </div>
          {blockedByOtherBranch && (
            <p className="mb-4 rounded-lg border border-amber-400/20 bg-amber-400/5 px-3 py-2 text-xs text-amber-400">
              Agent is active on{" "}
              <span className="font-mono">{activeBranch}</span>. Finish or cancel
              it before creating a new branch.
            </p>
          )}
          <form onSubmit={createNewBranchAndAgent} className="flex flex-1 flex-col">
            <label className="mb-3 block">
              <span className="mb-1.5 block text-xs font-medium text-zinc-500">
                Branch name
              </span>
              <input
                type="text"
                value={newBranchName}
                onChange={(e) => setNewBranchName(e.target.value)}
                placeholder="agent/my-feature"
                autoFocus
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 font-mono text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-orange-500 focus:outline-none"
              />
            </label>
            <label className="mb-3 block flex-1">
              <span className="mb-1.5 block text-xs font-medium text-zinc-500">
                Initial instruction
              </span>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Describe what you want the agent to change…"
                rows={4}
                className="h-full min-h-32 w-full resize-none rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-base text-zinc-200 placeholder:text-zinc-600 focus:border-orange-500 focus:outline-none sm:text-sm"
              />
            </label>
            <button
              type="submit"
              disabled={
                loading ||
                blockedByOtherBranch ||
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
          <div className="flex shrink-0 items-start justify-between gap-2 border-b border-zinc-800 px-4 py-3">
            <div className="min-w-0">
              <button
                type="button"
                onClick={() => setMobileShowChat(false)}
                className="mb-1 inline-flex min-h-8 items-center gap-1 text-sm text-orange-400 hover:text-orange-300 md:hidden"
              >
                ← Agents
              </button>
              <h3 className="truncate font-mono text-sm font-medium text-zinc-100">
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
                <p className="text-xs text-zinc-500">
                  Commit {shortSha(sessionDetail.commitSha)}
                </p>
              )}
              {sessionDetail?.deploymentId && (
                <p className="text-xs text-zinc-500">
                  Deploy {shortSha(sessionDetail.deploymentId)}
                </p>
              )}
            </div>
            <div className="flex shrink-0 flex-wrap justify-end gap-1">
              {showEndSession && (
                <button
                  type="button"
                  onClick={endSession}
                  disabled={loading}
                  className="min-h-9 rounded-lg border border-amber-400/30 bg-amber-400/10 px-2.5 py-1.5 text-xs font-medium text-amber-200 hover:bg-amber-400/20 disabled:opacity-50"
                  title="Stop the agent and unblock deploys"
                >
                  {isRecoverySession ? "Stop recovery" : "End session"}
                </button>
              )}
              {sessionDetail?.status === "failed" && sessionDetail.canRetry && (
                <button
                  type="button"
                  onClick={retryFailedTurn}
                  disabled={loading || hasActiveProcess}
                  className="min-h-9 rounded-lg border border-orange-400/30 bg-orange-400/10 px-2.5 py-1.5 text-xs font-medium text-orange-300 hover:bg-orange-400/20 disabled:opacity-50"
                >
                  Retry
                </button>
              )}
              {hasActiveProcess && !isDeploying && selectedId && (
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
                <>
                  <button
                    type="button"
                    onClick={commitSession}
                    disabled={loading}
                    className="min-h-9 rounded-lg border border-zinc-600 px-2.5 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
                  >
                    Commit
                  </button>
                  <button
                    type="button"
                    onClick={deploySession}
                    disabled={loading}
                    className="min-h-9 rounded-lg border border-orange-400/30 bg-orange-400/10 px-2.5 py-1.5 text-xs font-medium text-orange-300 hover:bg-orange-400/20 disabled:opacity-50"
                  >
                    Deploy
                  </button>
                  <button
                    type="button"
                    onClick={finishSession}
                    disabled={loading}
                    className="min-h-9 rounded-lg bg-orange-500 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-orange-400 disabled:opacity-50"
                  >
                    Finish &amp; deploy
                  </button>
                  <button
                    type="button"
                    onClick={cancelSession}
                    disabled={loading}
                    className="min-h-9 rounded-lg border border-red-400/20 px-2.5 py-1.5 text-xs text-red-400 hover:bg-red-400/10 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </>
              )}
              {showFinishedAgentActions && (
                <>
                  {showFinishAndDeploy && (
                    <button
                      type="button"
                      onClick={finishSession}
                      disabled={loading}
                      className="min-h-9 rounded-lg bg-orange-500 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-orange-400 disabled:opacity-50"
                    >
                      Finish &amp; deploy
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={commitSession}
                    disabled={loading}
                    className="min-h-9 rounded-lg border border-zinc-600 px-2.5 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
                  >
                    Commit
                  </button>
                  <button
                    type="button"
                    onClick={deploySession}
                    disabled={loading}
                    className="min-h-9 rounded-lg border border-orange-400/30 bg-orange-400/10 px-2.5 py-1.5 text-xs font-medium text-orange-300 hover:bg-orange-400/20 disabled:opacity-50"
                  >
                    Deploy
                  </button>
                </>
              )}
              {showFailedAgentActions && (
                <>
                  {showFinishAndDeploy && (
                    <button
                      type="button"
                      onClick={finishSession}
                      disabled={loading}
                      className="min-h-9 rounded-lg bg-orange-500 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-orange-400 disabled:opacity-50"
                    >
                      Finish &amp; deploy
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={commitSession}
                    disabled={loading}
                    className="min-h-9 rounded-lg border border-zinc-600 px-2.5 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
                  >
                    Commit
                  </button>
                  <button
                    type="button"
                    onClick={deploySession}
                    disabled={loading}
                    className="min-h-9 rounded-lg border border-orange-400/30 bg-orange-400/10 px-2.5 py-1.5 text-xs font-medium text-orange-300 hover:bg-orange-400/20 disabled:opacity-50"
                  >
                    Deploy
                  </button>
                </>
              )}
              {selectedId && (
                <button
                  type="button"
                  onClick={() => setShowLogs((v) => !v)}
                  className="min-h-9 rounded-lg px-2 py-1.5 text-xs text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
                >
                  {showLogs ? "Chat" : "Logs"}
                </button>
              )}
              {selectedId && showLogs && (
                <button
                  type="button"
                  onClick={clearLogs}
                  disabled={loading || hasActiveProcess || !sessionDetail?.logs}
                  className="min-h-9 rounded-lg border border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-300 disabled:opacity-50"
                  title={
                    hasActiveProcess
                      ? "Stop the agent before clearing logs"
                      : !sessionDetail?.logs
                        ? "No logs to clear"
                        : "Clear raw agent logs"
                  }
                >
                  Clear logs
                </button>
              )}
            </div>
          </div>

          {blockedByOtherBranch && (
            <p className="border-b border-zinc-800 bg-amber-400/5 px-4 py-2 text-xs text-amber-400">
              Agent is active on{" "}
              <span className="font-mono">{activeBranch}</span>. Finish or
              cancel it before working here.
            </p>
          )}

          {sessionDetail &&
            isTerminalSession &&
            sessionDetail.status === "completed" &&
            showFinishAndDeploy && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 bg-orange-400/5 px-4 py-3">
                <p className="text-sm text-zinc-300">
                  Agent session is done. Commit and deploy changes in one step.
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
            isTerminalSession &&
            sessionDetail.hasFileEdits === false && (
              <p className="border-b border-zinc-800 bg-zinc-800/40 px-4 py-2 text-xs text-zinc-400">
                Session finished with no file changes.
              </p>
            )}

          {sessionDetail &&
            !isTerminalSession &&
            sessionDetail.hasFileEdits === true &&
            showFinishAndDeploy && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 bg-orange-400/5 px-4 py-3">
                <p className="text-sm text-zinc-300">
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
              <p className="border-b border-zinc-800 bg-zinc-800/40 px-4 py-2 text-xs text-zinc-400">
                Agent edited files on this branch.
              </p>
            )}

          {showNewAgentForm ? (
            <div className="flex flex-1 flex-col p-4">
              <p className="mb-4 text-sm text-zinc-400">
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
                  className="mb-3 w-full flex-1 resize-none rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-base text-zinc-200 placeholder:text-zinc-600 focus:border-orange-500 focus:outline-none sm:text-sm"
                />
                <button
                  type="submit"
                  disabled={loading || !prompt.trim() || blockedByOtherBranch}
                  className="min-h-11 rounded-lg bg-orange-500 py-2.5 text-sm font-semibold text-white hover:bg-orange-400 disabled:opacity-50"
                >
                  {selectedSessionMeta ? "Continue agent" : "Start agent"}
                </button>
              </form>
            </div>
          ) : showLogs && sessionDetail ? (
            <pre className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 font-mono text-xs leading-relaxed text-zinc-400">
              {sessionDetail.logs || "No logs yet."}
              {sessionDetail.errorMessage && (
                <span className="mt-2 block text-red-400">
                  {sessionDetail.errorMessage}
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
                {isRecoverySession && isActiveSession && (
                  <div className="rounded-lg border border-amber-400/20 bg-amber-400/5 px-3 py-2.5 text-xs text-amber-200">
                    This agent started automatically after a failed deploy. Stop it
                    anytime to unblock manual deploys.
                  </div>
                )}
                {messages.length === 0 && !statusBanner && (
                  <p className="py-8 text-center text-sm text-zinc-600">
                    Waiting for agent output…
                  </p>
                )}
                <AgentMessageList messages={messages} />
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
                            disabled={loading || hasActiveProcess}
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
                  className="shrink-0 border-t border-zinc-800 bg-zinc-900/95 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
                >
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      placeholder="Send a follow-up instruction…"
                      enterKeyHint="send"
                      className="min-h-11 flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-base text-zinc-200 placeholder:text-zinc-600 focus:border-orange-500 focus:outline-none sm:text-sm"
                    />
                    <button
                      type="submit"
                      disabled={loading || hasActiveProcess || !prompt.trim()}
                      className="min-h-11 shrink-0 rounded-lg bg-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-600 disabled:opacity-50"
                    >
                      Send
                    </button>
                  </div>
                </form>
              )}

              {showContinueForm && !showLogs && (
                <form
                  onSubmit={startOrContinueSession}
                  className="shrink-0 border-t border-zinc-800 bg-zinc-900/95 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
                >
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      placeholder="Continue with a new instruction…"
                      enterKeyHint="send"
                      className="min-h-11 flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-base text-zinc-200 placeholder:text-zinc-600 focus:border-orange-500 focus:outline-none sm:text-sm"
                    />
                    <button
                      type="submit"
                      disabled={loading || hasActiveProcess || !prompt.trim()}
                      className="min-h-11 shrink-0 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-400 disabled:opacity-50"
                    >
                      Continue
                    </button>
                  </div>
                </form>
              )}
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-8 text-sm text-zinc-600">
              {blockedByOtherBranch
                ? "Another branch has an active agent."
                : "Select a branch from the list."}
            </div>
          )}
        </>
      )}
    </div>
  );

  return (
    <div
      className={`flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-zinc-800 ${className}`}
    >
      <div className="flex h-full min-h-0 flex-1 overflow-hidden">
        {branchSidebar}
        {chatArea}
      </div>
    </div>
  );
}

