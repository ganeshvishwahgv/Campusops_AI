// RETURNING: repaired and driving back to college; its position comes from the shared repair record.
export type BusStatus = "RUNNING" | "BREAKDOWN" | "RESCUING" | "RETURNING";

export interface Bus {
  id: string;
  name: string;
  routeName: string;
  lat: number;
  lng: number;
  capacity: number;
  occupied: number;
  status: BusStatus;
  driver: string;
  phone: string;
  route: [number, number][];
  wp: number;
  rescueTarget?: { lat: number; lng: number; seats: number; busId: string; transferId: string };
}

// Fictional occupancy, drivers and contacts; approximate Chennai demo routes.
// Independent of the saved campus Bus records; this is not live GPS.
export const COLLEGE = { lat: 13.0335, lng: 80.179 };

export const INITIAL_FLEET: Bus[] = [
  {
    id: "BUS-01", name: "Bus 01", routeName: "Ramapuram - Porur",
    lat: 13.0338, lng: 80.1732, capacity: 50, occupied: 46,
    status: "RUNNING", driver: "Murugan", phone: "+91 90000 00001",
    route: [[13.0338, 80.1732], [13.0375, 80.1598], [13.0382, 80.1565], [13.0345, 80.17]], wp: 0,
  },
  {
    id: "BUS-02", name: "Bus 02", routeName: "Ramapuram - Guindy",
    lat: 13.029, lng: 80.185, capacity: 50, occupied: 22,
    status: "RUNNING", driver: "Selvam", phone: "+91 90000 00002",
    route: [[13.029, 80.185], [13.018, 80.193], [13.0105, 80.201], [13.022, 80.19]], wp: 0,
  },
  {
    id: "BUS-03", name: "Bus 03", routeName: "Ramapuram - Vadapalani",
    lat: 13.042, lng: 80.195, capacity: 45, occupied: 30,
    status: "RUNNING", driver: "Ravi", phone: "+91 90000 00003",
    route: [[13.042, 80.195], [13.05, 80.205], [13.052, 80.212], [13.045, 80.2]], wp: 0,
  },
  {
    id: "BUS-04", name: "Bus 04", routeName: "Ramapuram - Poonamallee",
    lat: 13.04, lng: 80.165, capacity: 50, occupied: 48,
    status: "RUNNING", driver: "Karthik", phone: "+91 90000 00004",
    route: [[13.04, 80.165], [13.047, 80.15], [13.048, 80.142], [13.042, 80.158]], wp: 0,
  },
  {
    id: "BUS-05", name: "Bus 05", routeName: "Ramapuram - Mount Road",
    lat: 13.025, lng: 80.17, capacity: 40, occupied: 12,
    status: "RUNNING", driver: "Prakash", phone: "+91 90000 00005",
    route: [[13.025, 80.17], [13.02, 80.18], [13.015, 80.188], [13.023, 80.176]], wp: 0,
  },
];

const STEP = 0.0003; // degrees per tick (~30 m)

/** Move one bus a small step. Called every second. */
export function stepBus(b: Bus): Bus {
  if (b.status === "BREAKDOWN" || b.status === "RETURNING") return b;

  // Rescue bus heads straight to the broken-down bus
  if (b.status === "RESCUING" && b.rescueTarget) {
    const dLat = b.rescueTarget.lat - b.lat;
    const dLng = b.rescueTarget.lng - b.lng;
    const dist = Math.hypot(dLat, dLng);
    if (dist < STEP * 2) {
      return {
        ...b,
        lat: b.rescueTarget.lat,
        lng: b.rescueTarget.lng,
        // The fleet engine transfers passengers on BOTH buses atomically.
      };
    }
    return {
      ...b,
      lat: b.lat + (dLat / dist) * STEP * 2,
      lng: b.lng + (dLng / dist) * STEP * 2,
    };
  }

  // Normal route loop
  const [tLat, tLng] = b.route[b.wp];
  const dLat = tLat - b.lat;
  const dLng = tLng - b.lng;
  const dist = Math.hypot(dLat, dLng);
  if (dist < STEP) {

    return { ...b, lat: tLat, lng: tLng, wp: (b.wp + 1) % b.route.length };
  }
  return { ...b, lat: b.lat + (dLat / dist) * STEP, lng: b.lng + (dLng / dist)* STEP};
}
