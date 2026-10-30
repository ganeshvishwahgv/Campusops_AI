import type { Complaint } from "@/lib/complaints/types";

export type WorkflowEvent = {
  id: string; action: string; note: string;
  fromStatus: string | null; toStatus: string;
  fromCategory: string | null; toCategory: string;
  fromPriority: string | null; toPriority: string;
  fromAssigneeName: string | null; toAssigneeName: string | null;
  actorName: string; actorRole: string; createdAt: string;
};

export type WorkOrder = Complaint & {
  version: number; priority: string; blockedReason: string | null; resolutionNote: string | null;
  respondedAt: string | null;
  reporter: { name: string };
  assignee: { id: string; name: string; department: string | null } | null;
};

export type Technician = {
  id: string; name: string; department: string | null; active: boolean;
  skills: string[]; onDuty: boolean; maxActiveJobs: number; activeJobs: number;
  availableFrom: string | null; availableUntil: string | null; version: number;
  eligible: boolean; reasons: string[];
};

export const workflowActions = ["TRIAGE", "ASSIGN", "START", "BLOCK", "RESUME", "RESOLVE", "CLOSE", "REOPEN"] as const;
export type WorkflowAction = typeof workflowActions[number];
