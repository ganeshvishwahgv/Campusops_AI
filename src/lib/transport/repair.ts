import { COLLEGE } from "./fleet";
import { haversineKm } from "./rescue";

// Demo timing: travel is compressed so a ride takes 30–90 seconds on screen.
export function travelMs(lat: number, lng: number): number {
  return Math.min(90_000, Math.max(30_000, haversineKm(COLLEGE.lat, COLLEGE.lng, lat, lng) * 20_000));
}

export type RepairPhase = "AWAITING_TECHNICIAN" | "ASSIGNED" | "TECHNICIAN_EN_ROUTE" | "REPAIRING" | "RETURNING" | "BACK_AT_COLLEGE";

export type Repair = {
  id: string; incidentId: string; busId: string; busName: string; routeName: string;
  lat: number; lng: number; students: number; status: string; technician: string | null;
  startedAt: string | null; resolvedAt: string | null; returnedAt: string | null; travelMs: number;
};

export function repairPhase(repair: Repair, now: number): RepairPhase {
  if (repair.returnedAt) return "BACK_AT_COLLEGE";
  if (repair.resolvedAt && ["RESOLVED", "CLOSED"].includes(repair.status)) {
    return now >= Date.parse(repair.resolvedAt) + repair.travelMs ? "BACK_AT_COLLEGE" : "RETURNING";
  }
  if (repair.startedAt && ["IN_PROGRESS", "BLOCKED"].includes(repair.status)) {
    return now >= Date.parse(repair.startedAt) + repair.travelMs ? "REPAIRING" : "TECHNICIAN_EN_ROUTE";
  }
  return repair.technician ? "ASSIGNED" : "AWAITING_TECHNICIAN";
}

/** 0 → 1 progress of a ride that started at `from`. */
export function rideProgress(from: string | null, duration: number, now: number) {
  return from ? Math.min(1, Math.max(0, (now - Date.parse(from)) / duration)) : 0;
}
