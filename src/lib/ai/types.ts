import type { RoomCandidate } from "@/lib/bookings/types";

export type Provenance = { source: "CLAUDE" | "RULES"; model: string | null; generatedAt: string; notice: string | null };

export type Recommendation = Provenance & {
  selectedId: string | null; reason: string;
  ranking: { id: string; note: string }[];
  tips: string[];
};
export type RecommendationInput = {
  kind: "ROOM" | "TRANSPORT";
  context: Record<string, unknown>;
  candidates: { id: string; label: string; facts: Record<string, unknown> }[];
  fallbackId: string | null; fallbackReason: string;
};

export type RoomAdvice = { rooms: RoomCandidate[]; recommendation: Recommendation };

export type RoomRecoveryResult = RoomAdvice & {
  source: { id: string; name: string; availability: string; capacity: number; building: { id: string; name: string } };
  incidents: { id: string; title: string; priority: string; status: string }[];
  affectedBookings: { id: string; title: string; startsAt: string; endsAt: string; attendees: number }[];
};

export type ComplaintDraft = Provenance & {
  title: string; category: string; reportedUrgency: string;
  buildingId: string | null; roomId: string | null; assetId: string | null; busId: string | null;
  locationDetails: string; followUpQuestions: string[]; confidence: "LOW" | "MEDIUM" | "HIGH";
};

export type TriageAdvice = Provenance & {
  summary: string; suggestedCategory: string; suggestedPriority: string; priorityReason: string;
  technicianId: string | null; technicianName: string | null; technicianReason: string;
  nextSteps: string[]; impact: string;
  related: { id: string; title: string; reason: string }[];
};

export type Briefing = Provenance & {
  headline: string; situation: string;
  risks: { title: string; detail: string; incidentIds: string[] }[];
  actions: string[];
};

export type TransportBrief = Provenance & {
  assessment: string; passengerNotice: string; driverInstructions: string[]; risks: string[];
};

export type LensAnswer = Provenance & { answer: string; references: string[]; followUps: string[] };
