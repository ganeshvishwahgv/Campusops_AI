import { connection } from "next/server";
import { db } from "@/lib/db";
import { authorizeDashboard, privateJson } from "@/lib/auth/http";

export async function GET() {
  // Read current database records at request time.
  // Keep this outside try/catch so Next.js can handle prerendering.
  await connection();

  try {
    const { response } = await authorizeDashboard();
    if (response) return response;
    const [buildings, incidents, buses] = await db.$transaction([
      db.building.findMany({
        orderBy: { code: "asc" },
        select: {
          id: true,
          code: true,
          name: true,
          mapX: true,
          mapY: true,
          rooms: {
            orderBy: { code: "asc" },
            select: {
              id: true,
              code: true,
              name: true,
              capacity: true,
              roomType: true,
              availability: true,
            },
          },
        },
      }),

      db.incident.findMany({
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          title: true,
          description: true,
          category: true,
          priority: true,
          reportedUrgency: true,
          status: true,
          locationText: true,
          summary: true,
          blockedReason: true,
          buildingId: true,
          roomId: true,
          busId: true,
          createdAt: true,
          updatedAt: true,
          responseDueAt: true,
          resolutionDueAt: true,
          assignee: {
            select: {
              name: true,
              department: true,
            },
          },
        },
      }),

      db.bus.findMany({
        orderBy: { fleetCode: "asc" },
        select: {
          id: true,
          fleetCode: true,
          capacity: true,
          availability: true,
        },
      }),
    ]);

    const openIncidents = incidents.filter(
      (incident) =>
        incident.status !== "RESOLVED" &&
        incident.status !== "CLOSED"
    );

    return privateJson(
      {
        source: "database",
        dataset: "fictional-campus",
        stats: {
          openIncidents: openIncidents.length,
          criticalIncidents: openIncidents.filter(
            (incident) => incident.priority === "CRITICAL"
          ).length,
          buildings: buildings.length,
          buses: buses.length,
        },
        buildings,
        incidents,
        buses,
      }
    );
  } catch {
    // A failed session lookup can include query parameters; keep them out of logs.
    console.error("Dashboard authentication or database read failed.");

    return privateJson(
      { error: "Unable to load campus data. Check the server terminal." },
      500
    );
  }
}
