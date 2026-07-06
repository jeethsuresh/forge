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

interface AgentSession {
  id: string;
  branch: string;
  status: string;
  initialPrompt: string;
  logs: string;
  errorMessage: string | null;
  deploymentId: string | null;
  commitSha: string | null;
  startedAt: string;
  completedAt: string | null;
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
  messages: AgentDisplayMessage[];
}

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);

function mergeIncomingMessages(
  prev: AgentDisplayMessage[],
  incoming: AgentDisplayMessage[],
): AgentDisplayMessage[] {
  const merged = [...prev];
  for (const msg of incoming) {
    if (msg.role === "assistant") {
      const last = merged[merged.length - 1];
      if (last?.role === "assistant") {
        merged[merged.length - 1] = {
          ...last,
          content: last.content + msg.content,
        };
        continue;
      }
    }
    merged.push(msg);
  }
  return merged;
}

function sessionForBranch(
  sessions: AgentSession[],
  branch: string,
): AgentSession | undefined {
  return sessions.find((s) => s.branch === branch);
}

export function AgentWorkspace({ projectId }: { projectId: string }) {
  const [data, setData] = useState<AgentSessionsResponse | null>(null);
  const [selectedBranch, setSelectedBranch] = useState<string>("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AgentDisplayMessage[]>([]);
  const [sessionDetail, setSessionDetail] = useState<AgentSession | null>(null);
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [mobileShowChat, setMobileShowChat] = useState(false);
  const [agentBusy, setAgentBusy] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const sseConnectedRef = useRef(false);
  const shouldAutoScrollRef = useRef(true);

  const fetchSessions = useCallback(async () => {
    const res = await fetch(`/api/projects/${projectId}/agent-sessions`);
    if (!res.ok) return;
    const json = (await res.json()) as AgentSessionsResponse;
    setData(json);
  }, [projectId]);

  const fetchSessionDetail = useCallback(
    async (sessionId: string) => {
      const res = await fetch(
        `/api/projects/${projectId}/agent-sessions/${sessionId}`,
      );
      if (!res.ok) return;
      const json = (await res.json()) as SessionDetailResponse;
      setSessionDetail(json.session);
      setMessages(json.messages);
    },
    [projectId],
  );

  useEffect(() => {
    queueMicrotask(() => {
      void fetchSessions();
    });
    const interval = setInterval(() => {
      if (!sseConnectedRef.current) void fetchSessions();
    }, 8000);
    return () => clearInterval(interval);
  }, [fetchSessions]);

  useEffect(() => {
    if (!data || selectedBranch) return;
    const initial =
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
        if (session) setSessionDetail(session);
      }
    });
  }, [data, selectedBranch]);

  useEffect(() => {
    if (!selectedId) return;
    queueMicrotask(() => {
      void fetchSessionDetail(selectedId);
    });
  }, [selectedId, fetchSessionDetail]);

  useEffect(() => {
    if (!selectedId) return;

    eventSourceRef.current?.close();
    sseConnectedRef.current = false;

    const es = new EventSource(
      `/api/projects/${projectId}/agent-sessions/${selectedId}/stream`,
    );
    eventSourceRef.current = es;

    es.onopen = () => {
      sseConnectedRef.current = true;
    };

    es.addEventListener("events", (e) => {
      const payload = JSON.parse(e.data) as {
        messages: AgentDisplayMessage[];
        session: AgentSession;
      };
      setMessages((prev) => mergeIncomingMessages(prev, payload.messages));
      setSessionDetail(payload.session);
      setAgentBusy(false);
    });

    es.addEventListener("heartbeat", (e) => {
      const payload = JSON.parse(e.data) as { session: AgentSession };
      setSessionDetail(payload.session);
    });

    es.addEventListener("done", (e) => {
      const payload = JSON.parse(e.data) as { session: AgentSession };
      setSessionDetail(payload.session);
      setAgentBusy(false);
      sseConnectedRef.current = false;
      void fetchSessions();
      es.close();
    });

    es.onerror = () => {
      sseConnectedRef.current = false;
    };

    return () => {
      sseConnectedRef.current = false;
      es.close();
    };
  }, [selectedId, projectId, fetchSessions]);

  useEffect(() => {
    if (!shouldAutoScrollRef.current) return;
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, agentBusy, sessionDetail?.status]);

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
      if (session) setSessionDetail(session);
      return;
    }

    setSelectedId(null);
    setSessionDetail(null);
    setMessages([]);
  }

  function selectBranch(branch: BranchAgentInfo) {
    openBranch(branch, data?.sessions ?? [], true);
  }

  async function startOrContinueSession(e: React.FormEvent) {
    e.preventDefault();
    if (!prompt.trim() || !selectedBranch) return;
    setLoading(true);
    setAgentBusy(true);
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
        setAgentBusy(false);
        return;
      }
      const json = (await res.json()) as { sessionId: string };
      const userPrompt = prompt.trim();
      setPrompt("");
      setSelectedId(json.sessionId);
      setMessages((prev) => [
        ...prev,
        {
          id: `user-${Date.now()}`,
          role: "user" as const,
          content: userPrompt,
          timestamp: Date.now(),
        },
      ]);
      await fetchSessions();
    } finally {
      setLoading(false);
    }
  }

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId || !prompt.trim()) return;
    setLoading(true);
    setAgentBusy(true);
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
        setAgentBusy(false);
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
      };
      if (!res.ok) {
        alert(json.error ?? "Failed to commit changes");
        return;
      }
      if (json.committed) {
        await fetchSessions();
        await fetchSessionDetail(selectedId);
      } else {
        alert("No uncommitted changes to commit.");
      }
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

  const branches = data?.branches ?? [];
  const sessions = data?.sessions ?? [];
  const activeBranch = data?.activeSession?.branch ?? null;
  const selectedBranchInfo = branches.find((b) => b.name === selectedBranch);
  const selectedSessionMeta = sessionForBranch(sessions, selectedBranch);

  const blockedByOtherBranch = Boolean(
    data?.hasActiveSession && activeBranch && activeBranch !== selectedBranch,
  );

  const isActiveSession =
    sessionDetail && !TERMINAL_STATUSES.has(sessionDetail.status);
  const isDeploying = sessionDetail?.status === "deploying";
  const canStartOnBranch = Boolean(
    selectedBranch &&
      !blockedByOtherBranch &&
      !isActiveSession &&
      (!selectedBranchInfo?.hasAgent ||
        (selectedBranchInfo.sessionStatus &&
          TERMINAL_STATUSES.has(selectedBranchInfo.sessionStatus))),
  );

  const isTerminalSession = Boolean(
    sessionDetail && TERMINAL_STATUSES.has(sessionDetail.status),
  );
  const showFollowUp = Boolean(isActiveSession && !isDeploying && selectedId);
  const showContinueForm = Boolean(canStartOnBranch && isTerminalSession);
  const showNewAgentForm = Boolean(canStartOnBranch && !selectedId);

  const statusHint = useMemo(() => {
    if (!sessionDetail) return null;
    if (isDeploying) return "Rebuilding and releasing containers…";
    if (agentBusy || (sessionDetail.status === "running" && loading)) {
      return "Agent is working…";
    }
    if (sessionDetail.status === "pending") return "Starting agent session…";
    return null;
  }, [sessionDetail, isDeploying, agentBusy, loading]);

  const branchSidebar = (
    <aside
      className={`flex w-full shrink-0 flex-col border-zinc-800 bg-zinc-950 md:w-64 md:border-r ${
        mobileShowChat ? "hidden md:flex" : "flex"
      }`}
    >
      <div className="border-b border-zinc-800 px-4 py-3">
        <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
          Agents
        </p>
        <p className="mt-0.5 text-xs text-zinc-600">One agent per branch</p>
      </div>

      <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {branches.map((b) => {
          const session = sessionForBranch(sessions, b.name);
          const isSelected = selectedBranch === b.name;
          const isRunning =
            b.sessionStatus && !TERMINAL_STATUSES.has(b.sessionStatus);

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
      className={`flex min-h-[min(70vh,32rem)] min-w-0 flex-1 flex-col bg-zinc-900 ${
        !mobileShowChat ? "hidden md:flex" : "flex"
      }`}
    >
      {!selectedBranch ? (
        <div className="flex flex-1 items-center justify-center p-8 text-sm text-zinc-600">
          Select a branch to start or open an agent
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
            <div className="flex shrink-0 gap-1">
              {showFollowUp && (
                <>
                  <button
                    type="button"
                    onClick={commitSession}
                    disabled={loading || agentBusy}
                    className="min-h-9 rounded-lg border border-zinc-600 px-2.5 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
                  >
                    Commit
                  </button>
                  <button
                    type="button"
                    onClick={finishSession}
                    disabled={loading || agentBusy}
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
              {selectedId && (
                <button
                  type="button"
                  onClick={() => setShowLogs((v) => !v)}
                  className="min-h-9 rounded-lg px-2 py-1.5 text-xs text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
                >
                  {showLogs ? "Chat" : "Logs"}
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
                className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-4"
                onScroll={(e) => {
                  const el = e.currentTarget;
                  const nearBottom =
                    el.scrollHeight - el.scrollTop - el.clientHeight < 80;
                  shouldAutoScrollRef.current = nearBottom;
                }}
              >
                {messages.length === 0 && !statusHint && (
                  <p className="py-8 text-center text-sm text-zinc-600">
                    Waiting for agent output…
                  </p>
                )}
                {messages.map((msg) => (
                  <MessageBubble key={msg.id} message={msg} />
                ))}
                {statusHint && (
                  <div className="flex items-center gap-2 text-xs text-amber-400">
                    <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-amber-400" />
                    {statusHint}
                  </div>
                )}
                <div ref={messagesEndRef} />
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
                      disabled={loading || agentBusy || !prompt.trim()}
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
                      disabled={loading || agentBusy || !prompt.trim()}
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
    <div className="overflow-hidden rounded-xl border border-zinc-800">
      <div className="flex min-h-[min(70vh,32rem)]">{branchSidebar}{chatArea}</div>
    </div>
  );
}

function MessageBubble({ message }: { message: AgentDisplayMessage }) {
  if (message.role === "tool") {
    const icon = message.toolStatus === "completed" ? "✓" : "…";
    const busy = message.toolStatus === "started";
    return (
      <div
        className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${
          busy
            ? "border-amber-400/20 bg-amber-400/5 text-amber-200/80"
            : "border-zinc-800 bg-zinc-950/50 text-zinc-500"
        }`}
      >
        <span className="mt-0.5 shrink-0 font-mono">{icon}</span>
        <span className="break-all font-mono">{message.content}</span>
      </div>
    );
  }

  if (message.role === "system") {
    return (
      <p className="text-center text-xs text-zinc-600">{message.content}</p>
    );
  }

  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[92%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed sm:max-w-[85%] ${
          isUser
            ? "bg-orange-500/20 text-orange-100"
            : "bg-zinc-800 text-zinc-200"
        }`}
      >
        <p className="whitespace-pre-wrap break-words">{message.content}</p>
      </div>
    </div>
  );
}
