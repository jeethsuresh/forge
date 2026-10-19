export type TicketStatus = "todo" | "in_progress" | "done";

export type TicketClaimedByKind = "internal" | "ops";

export type TicketRef = {
  id: string;
  number: number;
  title: string;
  status: TicketStatus;
};

export type TicketView = {
  id: string;
  projectId: string;
  projectName: string;
  number: number;
  title: string;
  description: string;
  status: TicketStatus;
  queueRank: number;
  ready: boolean;
  blockedBy: TicketRef[];
  followups: TicketRef[];
  claimedByKind: TicketClaimedByKind | null;
  claimedBySessionId: string | null;
  claimedByActor: string | null;
  claimedAt: string | null;
  branch: string | null;
  agentSessionId: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};
