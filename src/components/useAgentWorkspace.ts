"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { mergeIncomingMessages, type AgentDisplayMessage } from "@/lib/agent-stream";
import type { ActiveDeployLogView } from "@/lib/active-deploy-logs";
import { resolveAgentSessionBanner } from "@/lib/agent-turn";
import { isInactiveAgentSessionStatus } from "@/lib/agent-session-source";
import {
  deriveAgentWorkspaceUi,
  sessionForBranch,
  toStatusBanner,
  type AgentSession,
  type AgentSessionsResponse,
  type BranchAgentInfo,
  type SessionDetailResponse,
  type StatusBanner,
} from "@/components/agent-workspace-types";

export { sessionForBranch } from "@/components/agent-workspace-types";

export function useAgentWorkspace({
  projectId,
  initialSessionId = null,
}: {
  projectId: string;
  watchBranch: string;
  className?: string;
  initialSessionId?: string | null;
}) {
  const [data, setData] = useState<AgentSessionsResponse | null>(null);
  const [selectedBranch, setSelectedBranch] = useState<string>("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AgentDisplayMessage[]>([]);
  const [sessionDetail, setSessionDetail] = useState<AgentSession | null>(null);
  const [deployLogView, setDeployLogView] = useState<ActiveDeployLogView | null>(
    null,
  );
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
  const archivedSessions = useMemo(
    () => data?.archivedSessions ?? [],
    [data?.archivedSessions],
  );
  const activeBranch = data?.activeSession?.branch ?? null;
  const archiveCollapseKey = `forge:agents-archive-collapse:${projectId}`;
  const [archiveExpanded, setArchiveExpanded] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(archiveCollapseKey) === "1";
    } catch {
      return false;
    }
  });
  const [showRecreateForm, setShowRecreateForm] = useState(false);
  const [recreatePrompt, setRecreatePrompt] = useState("");

  const fetchSessions = useCallback(async () => {
    const res = await fetch(`/api/projects/${projectId}/agent-sessions`);
    if (!res.ok) return;
    const json = (await res.json()) as AgentSessionsResponse;
    setData(json);

    if (!selectedId) return;
    const refreshed =
      json.sessions.find((s) => s.id === selectedId) ??
      (json.archivedSessions ?? []).find((s) => s.id === selectedId);
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
      setDeployLogView(json.deployLogView ?? null);
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
    if (!selectedId || sessionDetail?.status !== "deploying") return;

    queueMicrotask(() => {
      void fetchSessionDetail(selectedId, { refreshMessages: false });
    });
    const interval = setInterval(() => {
      void fetchSessionDetail(selectedId, { refreshMessages: false });
    }, 5000);
    return () => clearInterval(interval);
  }, [selectedId, sessionDetail?.status, fetchSessionDetail]);

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
      setLoadedSessionTerminal(
        Boolean(json.session.archivedAt) ||
          isInactiveAgentSessionStatus(json.session.status),
      );
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
          current.hasActiveRuntime === payload.session.hasActiveRuntime &&
          current.hasActiveProcess === payload.session.hasActiveProcess &&
          current.canRetry === payload.session.canRetry &&
          current.containerId === payload.session.containerId &&
          current.killReason === payload.session.killReason
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

  const hasActiveRuntime =
    sessionDetail?.hasActiveRuntime ?? sessionDetail?.hasActiveProcess ?? false;

  useEffect(() => {
    if (!shouldAutoScrollRef.current) return;
    const el = messagesScrollRef.current;
    if (!el) return;
    el.scrollTo({
      top: el.scrollHeight,
      behavior: hasActiveRuntime ? "auto" : "smooth",
    });
  }, [messages, hasActiveRuntime, sessionDetail?.status]);

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
    setDeployLogView(null);
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
      const json = (await res.json()) as { sessionId: string; queued?: boolean };
      const previousSessionId = selectedId;
      setPrompt("");
      setSelectedId(json.sessionId);
      await fetchSessions();
      if (json.queued) {
        await fetchSessionDetail(json.sessionId);
      } else if (json.sessionId === previousSessionId) {
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
      const json = (await res.json()) as {
        branch: string;
        sessionId: string;
        queued?: boolean;
      };
      setPrompt("");
      setNewBranchName("");
      setShowNewBranchForm(false);
      setSelectedBranch(json.branch);
      setSelectedId(json.sessionId);
      await fetchSessions();
      if (json.queued) {
        await fetchSessionDetail(json.sessionId);
      } else {
        setStreamEpoch((epoch) => epoch + 1);
      }
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

  async function saveLearnings(next: string) {
    if (!selectedId) return;
    const res = await fetch(
      `/api/projects/${projectId}/agent-sessions/${selectedId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contextCompact: next }),
      },
    );
    const json = (await res.json()) as {
      error?: string;
      session?: AgentSession;
    };
    if (!res.ok) {
      throw new Error(json.error ?? "Failed to save learnings");
    }
    if (json.session) {
      setSessionDetail(json.session);
    } else {
      setSessionDetail((prev) =>
        prev ? { ...prev, contextCompact: next.trim() || null } : prev,
      );
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

  async function revertSessionCommit() {
    if (!selectedId) return;
    if (
      !confirm(
        "Revert the agent commit on this branch and force-push the previous revision?",
      )
    ) {
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/agent-sessions/${selectedId}/revert`,
        { method: "POST" },
      );
      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        alert(json.error ?? "Failed to revert commit");
        return;
      }
      await fetchSessions();
      await fetchSessionDetail(selectedId);
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
    const rebaseRecovery = sessionDetail?.sessionSource === "rebase-recovery";
    if (
      !confirm(
        rebaseRecovery
          ? "Stop the rebase recovery agent? Branch operations for this project will be unblocked."
          : recovery
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

  async function archiveSession() {
    if (!selectedId || !selectedBranch) return;
    if (
      !confirm(
        `Archive the agent session on "${selectedBranch}"?\n\nIt will move to Archived sessions (read-only). You can recreate a fresh agent later.`,
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
        `/api/projects/${projectId}/agent-sessions/${selectedId}/archive`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ revertChanges }),
        },
      );
      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        alert(json.error ?? "Failed to archive session");
        return;
      }
      setShowRecreateForm(false);
      setLoadedSessionTerminal(true);
      await fetchSessions();
      // Stay on the archived session (now in archived list)
      if (selectedId) await fetchSessionDetail(selectedId);
    } finally {
      setLoading(false);
    }
  }

  async function restartStuckAgent(targetId: string | null = selectedId) {
    if (!targetId) return;
    if (
      !confirm(
        "Replace this agent with a fresh one on the same branch?\n\nThe current session is archived. Uncommitted files stay. The new agent gets the transcript including the latest turn.",
      )
    ) {
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/agent-sessions/${targetId}/restart`,
        { method: "POST" },
      );
      const json = (await res.json()) as {
        error?: string;
        sessionId?: string;
      };
      if (!res.ok) {
        alert(json.error ?? "Failed to restart agent");
        return;
      }
      setShowRecreateForm(false);
      setShowNewBranchForm(false);
      await fetchSessions();
      if (json.sessionId) {
        setSelectedId(json.sessionId);
        setLoadedSessionTerminal(false);
        setStreamEpoch((n) => n + 1);
        setMobileShowChat(true);
        setShowLogs(false);
      }
    } finally {
      setLoading(false);
    }
  }

  async function removeAgent(targetId: string | null = selectedId) {
    if (!targetId) return;
    const target =
      sessions.find((s) => s.id === targetId) ??
      (sessionDetail?.id === targetId ? sessionDetail : null);
    const branchName = target?.branch ?? selectedBranch;
    if (
      !confirm(
        `Remove the agent from "${branchName}"?\n\nThe session is archived. The branch and files stay. You can start a new agent later.`,
      )
    ) {
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/agent-sessions/${targetId}/archive`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ revertChanges: false }),
        },
      );
      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        alert(json.error ?? "Failed to remove agent");
        return;
      }
      setShowRecreateForm(false);
      if (selectedId === targetId) {
        setSelectedId(null);
        setSessionDetail(null);
        setMessages([]);
        setLoadedSessionTerminal(true);
      }
      await fetchSessions();
    } finally {
      setLoading(false);
    }
  }

  async function recreateAgent(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedBranch || !recreatePrompt.trim()) return;
    if (
      !confirm(
        `Recreate the agent on "${selectedBranch}"?\n\nThe current session will be archived and a fresh agent will start with your new prompt.`,
      )
    ) {
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/agent-sessions/recreate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            branch: selectedBranch,
            prompt: recreatePrompt.trim(),
          }),
        },
      );
      const json = (await res.json()) as {
        error?: string;
        sessionId?: string;
      };
      if (!res.ok) {
        alert(json.error ?? "Failed to recreate agent");
        return;
      }
      setShowRecreateForm(false);
      setRecreatePrompt("");
      setShowNewBranchForm(false);
      await fetchSessions();
      if (json.sessionId) {
        setSelectedId(json.sessionId);
        setLoadedSessionTerminal(false);
        setStreamEpoch((n) => n + 1);
        setMobileShowChat(true);
      }
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

  const {
    selectedBranchInfo,
    selectedSessionMeta,
    deployBranchName,
    isArchivedSession,
    isActiveSession,
    isQueuedSession,
    showEndSession,
    isDeploying,
    isRecoverySession,
    isRebaseRecoverySession,
    canStartOnBranch,
    isTerminalSession,
    showFollowUp,
    canCommitOrDeploy,
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
  } = deriveAgentWorkspaceUi({
    branches,
    sessions,
    selectedBranch,
    selectedId,
    sessionDetail,
    hasActiveRuntime,
    showRecreateForm,
  });

  const statusBanner = useMemo((): StatusBanner => {
    if (!sessionDetail) return null;
    return toStatusBanner(
      resolveAgentSessionBanner({
        status: sessionDetail.status,
        hasActiveRuntime,

        isDeploying,
        errorMessage: sessionDetail.errorMessage,
        canRetry: sessionDetail.canRetry ?? false,
        compactingLearnings: sessionDetail.compactingLearnings,
      }),
    );
  }, [sessionDetail, isDeploying, hasActiveRuntime]);

  return {
    data,
    setData,
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
    setLoading,
    showLogs,
    setShowLogs,
    mobileShowChat,
    setMobileShowChat,
    streamEpoch,
    setStreamEpoch,
    historyReady,
    setHistoryReady,
    loadedSessionTerminal,
    setLoadedSessionTerminal,
    showNewBranchForm,
    setShowNewBranchForm,
    newBranchName,
    setNewBranchName,
    messagesScrollRef,
    eventSourceRef,
    lastStreamSeqRef,
    streamGenerationRef,
    sseConnectedRef,
    shouldAutoScrollRef,
    selectedIdRef,
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
    fetchSessions,
    fetchSessionDetail,
    hasActiveRuntime,
    selectedBranchInfo,
    selectedSessionMeta,
    deployBranchName,
    isArchivedSession,
    isActiveSession,
    isQueuedSession,
    showEndSession,
    isDeploying,
    isRecoverySession,
    isRebaseRecoverySession,
    canStartOnBranch,
    isTerminalSession,
    showFollowUp,
    canCommitOrDeploy,
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
    openBranch,
    selectBranch,
    startOrContinueSession,
    createNewBranchAndAgent,
    sendMessage,
    saveLearnings,
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
  };
}
