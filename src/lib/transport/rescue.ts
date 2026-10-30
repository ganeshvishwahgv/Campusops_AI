import type { Bus } from "./fleet";

export interface Assignment {
  busId: string;
  busName: string;
  routeName: string;
  seatsAllocated: number;
  seatsFree: number;
  distanceKm: number;
  etaMin: number;
  driver: string;
  phone: string;
}

export interface RescuePlan {
  source: "RULES";
  reserved: number;
  brokenBusId: string;
  stranded: number;
  assignments: Assignment[];
  uncovered: number;
  summary: string;
}

const AVG_SPEED_KMH = 25; // Illustrative assumption, not measured traffic.
const MAX_RADIUS_KM = 10;

export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}

export function findRescuePlan(broken: Bus, fleet: Bus[]): RescuePlan {
  const stranded = broken.occupied;
  const reserved = fleet.filter((bus) => bus.status === "RESCUING" && bus.rescueTarget?.busId === broken.id).reduce((sum, bus) => sum + (bus.rescueTarget?.seats ?? 0), 0);

  // Rule 1: running buses with free seats, inside the search radius
  const candidates = fleet
    .filter((b) => b.id !== broken.id && b.status === "RUNNING" && b.capacity - b.occupied > 0)
    .map((b) => {
      const distanceKm = haversineKm(broken.lat, broken.lng, b.lat, b.lng);
      return { b, distanceKm, free: b.capacity - b.occupied };
    })
    .filter((c) => c.distanceKm <= MAX_RADIUS_KM)
    // Rule 2: nearest first, tie-break on more free seats
    .sort((x, y) => x.distanceKm - y.distanceKm || y.free - x.free);

  // Rule 3: allocate greedily until every student has a seat
  let remaining = Math.max(0, stranded - reserved);
  const assignments: Assignment[] = [];
  for (const c of candidates) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, c.free);
    remaining -= take;
    assignments.push({
      busId: c.b.id,
      busName: c.b.name,
      routeName: c.b.routeName,
      seatsAllocated: take,
      seatsFree: c.free,
      distanceKm: Number(c.distanceKm.toFixed(2)),
      etaMin: Math.max(1, Math.round((c.distanceKm / AVG_SPEED_KMH) * 60)),
      driver: c.b.driver,
      phone: c.b.phone,
    });
  }

  const summary =
    stranded === 0 ? "All passengers have been picked up in this simulation. The broken bus remains out of service."
      : remaining === 0 && assignments.length === 0 ? `${reserved} seats are reserved on buses already coming to help. Passengers are still waiting for pickup.`
      : assignments.length === 0
      ? `${broken.name} broke down with ${stranded} students. No running bus with free seats within ${MAX_RADIUS_KM} km. Escalate to the transport office for a replacement vehicle.`
      : `${broken.name} (${broken.routeName}) broke down with ${stranded} students. ` +
        `Recommended: ${assignments
          .map((a) => `${a.busName} takes ${a.seatsAllocated} (ETA ${a.etaMin} min)`)
          .join(", ")}.` +
        (remaining > 0
          ? ` ${remaining} students still need a seat; request an extra vehicle.`
          : " Enough seats can be reserved. Pickup is not yet complete.");

  return {
    source: "RULES", reserved,
    brokenBusId: broken.id,
    stranded,
    assignments,
    uncovered: Math.max(0, remaining),
    summary,
  };
}
