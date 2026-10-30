import { authorizeTransport, checkMutationOrigin, privateJson, readJsonBody } from "@/lib/auth/http";
import { complaintErrorResponse } from "@/lib/complaints/service";
import { ComplaintError } from "@/lib/complaints/validation";
import { db } from "@/lib/db";
import { notifyRoles } from "@/lib/notifications/service";

// Raised by the fleet view when a simulated bus breaks down while running.
export async function POST(request: Request) {
  try {
    const { user, response } = await authorizeTransport();
    if (response) return response;
    const rejected = checkMutationOrigin(request);
    if (rejected) return rejected;
    const body = await readJsonBody(request, 4 * 1024);
    const text = (value: unknown, max: number) => typeof value === "string" && value.trim() && value.length <= max ? value.trim() : null;
    const busName = text(body.busName, 40), routeName = text(body.routeName, 120), driver = text(body.driver, 80);
    const students = typeof body.students === "number" && Number.isInteger(body.students) && body.students >= 0 && body.students <= 200 ? body.students : null;
    if (!busName || !routeName || !driver || students === null || (body.source !== "AUTO" && body.source !== "MANUAL")) throw new ComplaintError(400, "Send the broken bus details.");
    // A breakdown detected by the system alerts every transport admin; a manual report skips the reporter.
    await db.$transaction((tx) => notifyRoles(tx, ["TRANSPORT_ADMIN"], {
      kind: "BUS_BREAKDOWN", link: "/transport",
      title: `${busName} broke down on ${routeName}`,
      body: `${students} student${students === 1 ? "" : "s"} on board · driver ${driver}. ${body.source === "AUTO" ? "Detected while the bus was running." : `Reported by ${user.name}.`} Open transport to dispatch nearby buses.`,
    }, body.source === "MANUAL" ? user.id : undefined));
    return privateJson({ ok: true });
  } catch (error) { return complaintErrorResponse(error); }
}
