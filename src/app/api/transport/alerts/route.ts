import { authorizeTransport, checkMutationOrigin, privateJson, readJsonBody } from "@/lib/auth/http";
import { complaintErrorResponse } from "@/lib/complaints/service";
import { ComplaintError } from "@/lib/complaints/validation";
import { reportBreakdown } from "@/lib/transport/breakdowns";

// Raised by the fleet view when a simulated bus breaks down. Opens a repair work order
// for operations and alerts transport admins.
export async function POST(request: Request) {
  try {
    const { user, response } = await authorizeTransport();
    if (response) return response;
    const rejected = checkMutationOrigin(request);
    if (rejected) return rejected;
    const body = await readJsonBody(request, 4 * 1024);
    const text = (value: unknown, max: number) => typeof value === "string" && value.trim() && value.length <= max ? value.trim() : null;
    const busId = text(body.busId, 40), busName = text(body.busName, 40), routeName = text(body.routeName, 120), driver = text(body.driver, 80);
    const students = typeof body.students === "number" && Number.isInteger(body.students) && body.students >= 0 && body.students <= 200 ? body.students : null;
    const lat = typeof body.lat === "number" && Math.abs(body.lat) <= 90 ? body.lat : null;
    const lng = typeof body.lng === "number" && Math.abs(body.lng) <= 180 ? body.lng : null;
    if (!busId || !busName || !routeName || !driver || students === null || lat === null || lng === null || (body.source !== "AUTO" && body.source !== "MANUAL")) {
      throw new ComplaintError(400, "Send the broken bus details.");
    }
    return privateJson(await reportBreakdown(user, { busId, busName, routeName, driver, students, lat, lng, source: body.source }));
  } catch (error) { return complaintErrorResponse(error); }
}
