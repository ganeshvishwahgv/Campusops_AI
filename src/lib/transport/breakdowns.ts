import "server-only";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/session";
import type { Prisma } from "@/generated/prisma/client";
import type { Role } from "@/generated/prisma/enums";
import { notifyRoles, operationsRoles } from "@/lib/notifications/service";
import { ComplaintError } from "@/lib/complaints/validation";
import { travelMs, type Repair } from "./repair";

type Writer = Prisma.TransactionClient;

const select = {
  id: true, incidentId: true, busId: true, busName: true, routeName: true, lat: true, lng: true, students: true, returnedAt: true,
  incident: { select: { status: true, resolvedAt: true, assignee: { select: { name: true } },
    history: { where: { action: { in: ["START", "RESUME"] } }, orderBy: { createdAt: "asc" }, take: 1, select: { createdAt: true } } } },
} satisfies Prisma.BusBreakdownSelect;

function loadActive() {
  // Active repairs, plus ones that came back in the last two minutes so viewers see the arrival.
  return db.busBreakdown.findMany({ where: { OR: [{ returnedAt: null }, { returnedAt: { gt: new Date(Date.now() - 120_000) } }] }, select, orderBy: { createdAt: "asc" } });
}
type Row = Awaited<ReturnType<typeof loadActive>>[number];

function toRepair(row: Row): Repair {
  return {
    id: row.id, incidentId: row.incidentId, busId: row.busId, busName: row.busName, routeName: row.routeName,
    lat: row.lat, lng: row.lng, students: row.students, status: row.incident.status,
    technician: row.incident.assignee?.name ?? null,
    startedAt: row.incident.history[0]?.createdAt.toISOString() ?? null,
    resolvedAt: row.incident.resolvedAt?.toISOString() ?? null,
    returnedAt: row.returnedAt?.toISOString() ?? null, travelMs: travelMs(row.lat, row.lng),
  };
}

/** Mark repaired buses whose drive back has finished, and tell transport admins once. */
export async function settleReturns() {
  const due = await db.busBreakdown.findMany({
    where: { returnedAt: null, incident: { status: { in: ["RESOLVED", "CLOSED"] }, resolvedAt: { not: null } } },
    select: { id: true, busName: true, lat: true, lng: true, incident: { select: { resolvedAt: true, assignee: { select: { name: true } } } } },
  });
  for (const row of due) {
    const arrival = row.incident.resolvedAt!.getTime() + travelMs(row.lat, row.lng);
    if (arrival > Date.now()) continue;
    await db.$transaction(async (tx) => {
      // The conditional update makes sure only one request sends the arrival alert.
      const claimed = await tx.busBreakdown.updateMany({ where: { id: row.id, returnedAt: null }, data: { returnedAt: new Date(arrival) } });
      if (claimed.count !== 1) return;
      await notifyRoles(tx, ["TRANSPORT_ADMIN"], { kind: "BUS_RETURNED", link: "/transport",
        title: `${row.busName} is back at college`,
        body: `Repaired by ${row.incident.assignee?.name ?? "the technician"} and driven back to campus. It is back in service.` });
    });
  }
}

export async function listRepairs() {
  await settleReturns();
  return { repairs: (await loadActive()).map(toRepair), serverNow: new Date().toISOString() };
}

export type BreakdownReport = {
  busId: string; busName: string; routeName: string; driver: string; students: number;
  lat: number; lng: number; source: "AUTO" | "MANUAL";
};

/** A breakdown opens a repair work order for operations and alerts transport admins. Repeat reports reuse the open one. */
export async function reportBreakdown(user: Pick<CurrentUser, "id" | "name" | "role">, report: BreakdownReport) {
  return db.$transaction(async (tx) => {
    const open = await tx.busBreakdown.findFirst({ where: { busId: report.busId, returnedAt: null }, select: { id: true, incidentId: true } });
    if (open) return { ...open, created: false };
    const where = `${report.lat.toFixed(4)}, ${report.lng.toFixed(4)}`;
    const existing = await findBusComplaint(tx, report.busId);
    const incidentId = existing ?? `REQ-${randomBytes(8).toString("hex").toUpperCase()}`;
    if (!existing) await tx.incident.create({ data: {
      id: incidentId, title: `${report.busName} broke down on ${report.routeName}`,
      description: `${report.busName} stopped ${report.source === "AUTO" ? "while running" : "and was reported by transport control"} with ${report.students} students on board (driver ${report.driver}). Location ${where}. Send a technician to repair the bus and bring it back to college.`,
      category: "TRANSPORT", priority: "HIGH", reportedUrgency: "HIGH", status: "REPORTED", reporterId: user.id, buildingId: "T",
      locationText: `${report.busName} · ${report.routeName} · ${where}`,
      history: { create: { actorId: user.id, actorName: user.name, actorRole: user.role as Role, action: "SUBMITTED",
        note: "Bus breakdown reported from transport control.", toStatus: "REPORTED", toCategory: "TRANSPORT", toPriority: "HIGH", resultVersion: 0 } },
    } });
    const row = await tx.busBreakdown.create({
      data: { incidentId, busId: report.busId, busName: report.busName, routeName: report.routeName, lat: report.lat, lng: report.lng, students: report.students },
      select: { id: true, incidentId: true },
    });
    // A system-detected breakdown alerts every transport admin; a manual report skips the reporter.
    await notifyRoles(tx, ["TRANSPORT_ADMIN"], { kind: "BUS_BREAKDOWN", link: "/transport",
      title: `${report.busName} broke down on ${report.routeName}`,
      body: `${report.students} student${report.students === 1 ? "" : "s"} on board · driver ${report.driver}. ${report.source === "AUTO" ? "Detected while the bus was running." : `Reported by ${user.name}.`} Dispatch nearby buses; operations will send a technician.` },
      report.source === "MANUAL" ? user.id : undefined);
    await notifyRoles(tx, operationsRoles, { kind: "BUS_REPAIR_NEEDED", link: `/work-orders?incident=${incidentId}`,
      title: `Repair needed: ${report.busName} broke down`,
      body: `${report.routeName}. Assign a technician to ride out, repair it and bring it back to college.` }, user.id);
    return { ...row, created: true };
  }, { timeout: 10000, maxWait: 10000 });
}

/** "Bus 02", "bus 2", "bus no. 2" → "BUS-02". */
export function busIdFromText(text: string): string | null {
  const match = /\bbus\s*(?:no\.?\s*|number\s*|#\s*)?0*(\d{1,2})\b/i.exec(text);
  return match ? `BUS-${match[1].padStart(2, "0")}` : null;
}

const openStatuses = { notIn: ["RESOLVED" as const, "CLOSED" as const] };

/** An open transport complaint about this bus that is not yet tied to a breakdown, preferring one already in hand. */
async function findBusComplaint(tx: Writer, busId: string) {
  const rows = await tx.incident.findMany({
    where: { category: "TRANSPORT", status: openStatuses, busBreakdown: null, createdAt: { gt: new Date(Date.now() - 2 * 86_400_000) } },
    select: { id: true, title: true, description: true, assigneeId: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 50,
  });
  const matches = rows.filter((row) => busIdFromText(`${row.title} ${row.description}`) === busId);
  return (matches.find((row) => row.assigneeId) ?? matches[0])?.id ?? null;
}

/**
 * When operations work on a transport complaint that names a bus, move that bus's open breakdown
 * onto it so the fleet map follows this job. The unstarted duplicate repair order is closed.
 */
export async function adoptBreakdown(tx: Writer, incidentId: string, actor: { id: string; name: string; role: Role }) {
  const incident = await tx.incident.findUnique({ where: { id: incidentId }, select: { category: true, title: true, description: true, busBreakdown: { select: { id: true } } } });
  if (!incident || incident.category !== "TRANSPORT" || incident.busBreakdown) return;
  const busId = busIdFromText(`${incident.title} ${incident.description}`);
  if (!busId) return;
  const breakdown = await tx.busBreakdown.findFirst({ where: { busId, returnedAt: null },
    select: { id: true, incident: { select: { id: true, status: true, assigneeId: true, version: true, category: true, priority: true } } } });
  // Never take over a repair that someone is already working on.
  if (!breakdown || breakdown.incident.assigneeId || !["REPORTED", "NEEDS_CLARIFICATION", "TRIAGED"].includes(breakdown.incident.status)) return;
  const old = breakdown.incident;
  await tx.busBreakdown.update({ where: { id: breakdown.id }, data: { incidentId } });
  const note = `Duplicate of ${incidentId}; the bus repair continues there.`;
  await tx.incident.update({ where: { id: old.id }, data: { status: "CLOSED", closedAt: new Date(), resolvedAt: new Date(), resolutionNote: note, version: { increment: 1 } } });
  await tx.incidentEvent.create({ data: { incidentId: old.id, actorId: actor.id, actorName: actor.name, actorRole: actor.role, action: "CLOSE", note,
    fromStatus: old.status, toStatus: "CLOSED", fromCategory: old.category, toCategory: old.category, fromPriority: old.priority, toPriority: old.priority, resultVersion: old.version + 1 } });
}

/** Students still waiting at a broken bus; only ever decreases, so every viewer converges on the same count. */
export async function recordPickup(id: string, waiting: number) {
  if (id.length > 100) throw new ComplaintError(404, "Breakdown not found.");
  await db.busBreakdown.updateMany({ where: { id, students: { gt: waiting } }, data: { students: waiting } });
}

/** The stop position can be corrected on the map until a technician sets off. */
export async function moveBreakdown(id: string, lat: number, lng: number) {
  const row = id.length <= 100 ? await db.busBreakdown.findUnique({ where: { id }, select: { busName: true, routeName: true, incidentId: true, incident: { select: { status: true } } } }) : null;
  if (!row) throw new ComplaintError(404, "Breakdown not found.");
  if (!["REPORTED", "NEEDS_CLARIFICATION", "TRIAGED", "ASSIGNED"].includes(row.incident.status)) {
    throw new ComplaintError(409, "The technician has already set off; the breakdown location is fixed.");
  }
  await db.$transaction([
    db.busBreakdown.update({ where: { id }, data: { lat, lng } }),
    db.incident.update({ where: { id: row.incidentId }, data: { locationText: `${row.busName} · ${row.routeName} · ${lat.toFixed(4)}, ${lng.toFixed(4)}` } }),
  ]);
}
