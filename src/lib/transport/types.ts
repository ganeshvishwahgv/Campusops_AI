import type { Bus } from "./fleet";
export type Transfer = {
  id: string; brokenBusId: string; helperBusId: string; seats: number;
  status: "EN_ROUTE" | "COMPLETED"; createdAt: string; completedAt: string | null;
};
export type FleetState = {
  schemaVersion: 1; fleet: Bus[]; transfers: Transfer[]; playing: boolean;
  lastTickAt: number; simulatedSeconds: number;
};
export type TransportSnapshot = {
  id: string; version: number; source: "SIMULATION"; playing: boolean; simulatedSeconds: number;
  updatedAt: string; fleet: Bus[]; transfers: Transfer[];
  history: { id: string; action: string; note: string; actorName: string; createdAt: string }[];
};
