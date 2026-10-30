import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import type { IncidentStatus } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { canAccessComplaints, complaintRoles } from "@/lib/auth/permissions";
import { getCurrentUser, clearSessionCookie } from "@/lib/auth/session";
import { privateJson, RequestBodyError } from "@/lib/auth/http";
import { ComplaintError, validateComplaint } from "./validation";
import { statusOptions } from "./types";
import { historyQuery } from "@/lib/workflow/history";
import { notifyRoles, operationsRoles } from "@/lib/notifications/service";

// Reporter details include public workflow notes and actor/priority snapshots.
// Internal IDs, request fingerprints and other reporters' records stay private.
export const complaintSelect = {
  history: historyQuery,
  id: true, title: true, description: true, category: true, reportedUrgency: true,
  status: true, locationText: true, createdAt: true, updatedAt: true, resolvedAt: true, closedAt: true,
  building: { select: { id: true, name: true } },
  room: { select: { id: true, name: true } },
  asset: { select: { id: true, name: true } },
  bus: { select: { id: true, fleetCode: true } },
} as const satisfies Prisma.IncidentSelect;

export async function authorizeComplaints() {
  const user = await getCurrentUser();
  if (!user) {
    const response = privateJson({ error: "Please sign in to continue." }, 401);
    clearSessionCookie(response);
    return { user: null, response };
  }
  if (!canAccessComplaints(user.role)) {
    return { user: null, response: privateJson({ error: "Complaint reporting is not available for your role yet." }, 403) };
  }
  return { user, response: null };
}

export function complaintErrorResponse(error: unknown) {
  if (error instanceof ComplaintError || error instanceof RequestBodyError) {
    const response = privateJson({ error: error.message, ...(error instanceof ComplaintError && error.fields ? { fields: error.fields } : {}) }, error.status);
    if (error.status === 429) response.headers.set("Retry-After", "3600");
    return response;
  }
  // Never log submitted descriptions, passwords, session or query parameters.
  console.error("Complaint request could not be completed.");
  return privateJson({ error: "Complaint service is temporarily unavailable. Please retry." }, 503);
}

export async function listComplaints(reporterId: string, params: URLSearchParams) {
  const rawPage = params.get("page") ?? "1";
  const page = Number(rawPage);
  const status = params.get("status") ?? "ALL";
  const q = (params.get("q") ?? "").trim();
  if (!/^\d+$/.test(rawPage) || !Number.isSafeInteger(page) || page < 1 || page > 10000 ||
    !statusOptions.some((option) => option.value === status) || q.length > 100) {
    throw new ComplaintError(400, "Choose a valid page, status, and search of up to 100 characters.");
  }
  const where: Prisma.IncidentWhereInput = {
    reporterId,
    ...(status === "ALL" ? {} : { status: status as IncidentStatus }),
    ...(q ? { OR: [
      { id: { contains: q } }, { title: { contains: q } },
      { description: { contains: q } }, { locationText: { contains: q } },
    ] } : {}),
  };
  const pageSize = 20;
  const [total, items] = await db.$transaction([
    db.incident.count({ where }),
    db.incident.findMany({ where, select: { ...complaintSelect, history: false }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: pageSize, skip: (page - 1) * pageSize }),
  ]);
  return { items: items.map((item) => ({ ...item, history: [] })), total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function submitComplaint(reporterId: string, submissionKey: string, body: Record<string, unknown>) {
  const input = validateComplaint(body);
  const submissionHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  // SQLite transactions serialize the replay check, quota check, and creation.
  // The compound unique index is also an independent guard against duplicates.
  return db.$transaction(async (tx) => {
    const activeUser = await tx.user.findFirst({ where: { id: reporterId, active: true, role: { in: complaintRoles } }, select: { id: true, name: true, role: true } });
    if (!activeUser) throw new ComplaintError(403, "Your account can no longer submit complaints.");
    const prior = await tx.incident.findUnique({
      where: { reporterId_submissionKey: { reporterId, submissionKey } },
      select: { ...complaintSelect, submissionHash: true },
    });
    if (prior) {
      if (prior.submissionHash !== submissionHash) throw new ComplaintError(409, "This submission reference was already used for different details. Start a new submission.");
      const { submissionHash: ignoredHash, ...complaint } = prior;
      void ignoredHash;
      return { complaint, replayed: true };
    }
    const recent = await tx.incident.count({ where: { reporterId, submissionKey: { not: null }, createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } } });
    if (recent >= 20) throw new ComplaintError(429, "You have submitted 20 complaints in the last hour. Please wait before creating another.");

    const building = await tx.building.findUnique({ where: { id: input.buildingId }, select: { name: true } });
    if (!building) throw new ComplaintError(400, "Choose a current campus location.", { buildingId: "This campus location is unavailable. Refresh the form." });
    const room = input.roomId ? await tx.room.findFirst({ where: { id: input.roomId, buildingId: input.buildingId }, select: { name: true } }) : null;
    if (input.roomId && !room) throw new ComplaintError(400, "Check the selected room.", { roomId: "Choose a room within this campus location." });
    const asset = input.assetId ? await tx.asset.findFirst({ where: { id: input.assetId, roomId: input.roomId! }, select: { id: true } }) : null;
    if (input.assetId && !asset) throw new ComplaintError(400, "Check the selected equipment.", { assetId: "Choose equipment within the selected room." });
    const bus = input.busId ? await tx.bus.findUnique({ where: { id: input.busId }, select: { fleetCode: true } }) : null;
    if (input.busId && !bus) throw new ComplaintError(400, "Check the selected bus.", { busId: "Choose a current fleet vehicle." });

    const complaint = await tx.incident.create({
      data: {
        id: `REQ-${randomBytes(8).toString("hex").toUpperCase()}`,
        title: input.title, description: input.description, category: input.category,
        reportedUrgency: input.reportedUrgency,
        priority: "MEDIUM", status: "REPORTED", reporterId,
        buildingId: input.buildingId, roomId: input.roomId, assetId: input.assetId, busId: input.busId,
        locationText: [building.name, room?.name, bus?.fleetCode, input.locationDetails].filter(Boolean).join(" · "),
        submissionKey, submissionHash,
        history: { create: {
          actorId: activeUser.id, actorName: activeUser.name, actorRole: activeUser.role,
          action: "SUBMITTED", note: "Complaint submitted for operations review.",
          toStatus: "REPORTED", toCategory: input.category, toPriority: "MEDIUM", resultVersion: 0,
        } },
      },
      select: complaintSelect,
    });
    const notice = { kind: "NEW_COMPLAINT", link: `/work-orders?incident=${encodeURIComponent(complaint.id)}`,
      title: `New ${input.reportedUrgency.toLowerCase()}-urgency report from ${activeUser.name}`,
      body: `${input.title} · ${complaint.locationText}. Assign a technician in work orders.` };
    await notifyRoles(tx, operationsRoles, notice, activeUser.id);
    if (input.category === "TRANSPORT") await notifyRoles(tx, ["TRANSPORT_ADMIN"], { ...notice, kind: "TRANSPORT_REPORT", link: "/transport" }, activeUser.id);
    return { complaint, replayed: false };
  });
}
