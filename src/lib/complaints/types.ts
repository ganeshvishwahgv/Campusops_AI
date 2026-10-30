import type { WorkflowEvent } from "@/lib/workflow/types";

export const categoryOptions = [
  { value: "ELECTRICAL", label: "Electrical" },
  { value: "NETWORK", label: "Wi-Fi / network" },
  { value: "EQUIPMENT", label: "Equipment" },
  { value: "PLUMBING", label: "Plumbing / water" },
  { value: "CLEANLINESS", label: "Cleaning / sanitation" },
  { value: "SAFETY", label: "Safety concern" },
  { value: "TRANSPORT", label: "Transportation" },
  { value: "EVENT", label: "Event / venue" },
  { value: "OTHER", label: "Other" },
] as const;

export const urgencyOptions = [
  { value: "LOW", label: "Low — minor inconvenience" },
  { value: "MEDIUM", label: "Medium — routine attention needed" },
  { value: "HIGH", label: "High — an activity is disrupted" },
  { value: "CRITICAL", label: "Critical — immediate attention requested" },
] as const;

export const statusOptions = [
  { value: "ALL", label: "All statuses" },
  { value: "REPORTED", label: "Reported" },
  { value: "NEEDS_CLARIFICATION", label: "Needs clarification" },
  { value: "TRIAGED", label: "Triaged" },
  { value: "ASSIGNED", label: "Assigned" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "BLOCKED", label: "Blocked" },
  { value: "RESOLVED", label: "Resolved" },
  { value: "CLOSED", label: "Closed" },
] as const;

export type Complaint = {
  history: WorkflowEvent[];
  id: string;
  title: string;
  description: string;
  category: string;
  reportedUrgency: string | null;
  status: string;
  locationText: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  closedAt: string | null;
  building: { id: string; name: string } | null;
  room: { id: string; name: string } | null;
  asset: { id: string; name: string } | null;
  bus: { id: string; fleetCode: string } | null;
};

export type ComplaintOptions = {
  buildings: { id: string; code: string; name: string }[];
  rooms: { id: string; name: string; buildingId: string }[];
  assets: { id: string; name: string; assetTag: string; roomId: string }[];
  buses: { id: string; fleetCode: string }[];
};
