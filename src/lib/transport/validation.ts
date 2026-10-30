import { z } from "zod";
import { ComplaintError } from "@/lib/complaints/validation";
import type { Bus } from "./fleet";

const coordinate = z.number().finite();
const BusSchema = z.object({
  id: z.string().max(40), name: z.string().max(80), routeName: z.string().max(120),
  lat: coordinate.min(-90).max(90), lng: coordinate.min(-180).max(180),
  capacity: z.number().int().min(1).max(200), occupied: z.number().int().min(0).max(200),
  status: z.enum(["RUNNING", "BREAKDOWN", "RESCUING", "RETURNING"]),
  driver: z.string().max(80), phone: z.string().max(40),
  route: z.array(z.tuple([coordinate, coordinate])).max(50), wp: z.number().int().min(0),
  rescueTarget: z.object({ lat: coordinate, lng: coordinate, seats: z.number().int().min(0), busId: z.string().max(40), transferId: z.string().max(80) }).optional(),
}).refine((bus) => bus.occupied <= bus.capacity, "Occupancy cannot exceed capacity.");

/** The simulated fleet lives in the browser; validate its shape before planning on the server. */
export function parseFleet(value: unknown): Bus[] {
  const parsed = z.array(BusSchema).min(1).max(50).safeParse(value);
  if (!parsed.success) throw new ComplaintError(400, "Send a valid simulated fleet.");
  return parsed.data;
}
