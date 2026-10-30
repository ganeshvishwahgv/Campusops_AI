import { connection } from "next/server";
import { db } from "@/lib/db";
import { privateJson } from "@/lib/auth/http";
import { authorizeComplaints, complaintErrorResponse } from "@/lib/complaints/service";

export async function GET() {
  await connection();
  try {
    const { response } = await authorizeComplaints();
    if (response) return response;
    // Reference labels for reporting only: no incidents, capacities, stock,
    // operational availability, registrations, staff or other users.
    const [buildings, rooms, assets, buses] = await db.$transaction([
      db.building.findMany({ orderBy: { name: "asc" }, select: { id: true, code: true, name: true } }),
      db.room.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, buildingId: true } }),
      db.asset.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, assetTag: true, roomId: true } }),
      db.bus.findMany({ orderBy: { fleetCode: "asc" }, select: { id: true, fleetCode: true } }),
    ]);
    return privateJson({ buildings, rooms, assets, buses });
  } catch (error) { return complaintErrorResponse(error); }
}
