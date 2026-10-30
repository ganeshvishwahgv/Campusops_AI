import "server-only";
import { createHash } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import type { IncidentStatus } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { canAccessWorkOrders, canViewDashboard } from "@/lib/auth/permissions";
import { clearSessionCookie, getCurrentUser, type CurrentUser } from "@/lib/auth/session";
import { privateJson } from "@/lib/auth/http";
import { complaintErrorResponse, complaintSelect } from "@/lib/complaints/service";
import { statusOptions } from "@/lib/complaints/types";
import { validateAction, validateProfile, WorkflowError } from "./validation";

type Reader = Prisma.TransactionClient;
export const activeStatuses: IncidentStatus[] = ["ASSIGNED", "IN_PROGRESS", "BLOCKED"];
const priorityOrder = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;
export const workOrderSelect = {
  ...complaintSelect, version: true, priority: true, blockedReason: true, resolutionNote: true, respondedAt: true,
  assignee: { select: { id: true, name: true, department: true } },
  reporter: { select: { name: true } },
} as const satisfies Prisma.IncidentSelect;

export async function authorizeWorkflow(adminOnly = false) {
  const user = await getCurrentUser();
  if (!user) {
    const response = privateJson({ error: "Please sign in to continue." }, 401);
    clearSessionCookie(response);
    return { user: null, response };
  }
  if (!canAccessWorkOrders(user.role) || (adminOnly && !canViewDashboard(user.role))) {
    return { user: null, response: privateJson({ error: "Your role cannot perform this work-order operation." }, 403) };
  }
  return { user, response: null };
}

export function workflowErrorResponse(error: unknown) {
  const response = complaintErrorResponse(error);
  if (response.status === 401) clearSessionCookie(response);
  return response;
}

function scope(user: Pick<CurrentUser, "id" | "role">): Prisma.IncidentWhereInput {
  return canViewDashboard(user.role) ? {} : { assigneeId: user.id };
}

export async function getWorkOrder(user: Pick<CurrentUser, "id" | "role">, id: string, tx: Reader = db) {
  const order = id.length <= 100 ? await tx.incident.findFirst({ where: { id, ...scope(user) }, select: workOrderSelect }) : null;
  if (!order) throw new WorkflowError(404, "Work order not found.");
  return order;
}

async function writeActor(tx: Reader, id: string, adminOnly = false) {
  // Acquire a SQLite write lock BEFORE checking shared eligibility/capacity.
  // This is constant SQL; request values are never interpolated into SQL text.
  const locked = await tx.$executeRaw`UPDATE "WorkflowLock" SET "id" = "id" WHERE "id" = 1`;
  if (locked !== 1) throw new WorkflowError(503, "Workflow storage is not ready. Apply the pending migration.");
  const actor = await tx.user.findFirst({ where: { id, active: true }, select: { id: true, name: true, role: true } });
  if (!actor) throw new WorkflowError(401, "Your account is no longer active.");
  if (!canAccessWorkOrders(actor.role) || (adminOnly && !canViewDashboard(actor.role))) throw new WorkflowError(403, "Your role can no longer perform this action.");
  return actor;
}

export async function listWorkOrders(user: CurrentUser, params: URLSearchParams) {
  const rawPage = params.get("page") ?? "1";
  const page = Number(rawPage);
  const status = params.get("status") ?? "ALL";
  const q = (params.get("q") ?? "").trim();
  if (!/^\d+$/.test(rawPage) || !Number.isSafeInteger(page) || page < 1 || page > 10000 || q.length > 100 || !statusOptions.some((item) => item.value === status)) throw new WorkflowError(400, "Choose a valid page, status and search of up to 100 characters.");
  const where: Prisma.IncidentWhereInput = {
    ...scope(user), ...(status === "ALL" ? {} : { status: status as IncidentStatus }),
    ...(q ? { OR: [{ id: { contains: q } }, { title: { contains: q } }, { locationText: { contains: q } }] } : {}),
  };
  // Enum names sort alphabetically in SQLite; use explicit priority buckets.
  return db.$transaction(async (tx) => {
    const counts = await tx.incident.groupBy({ by: ["priority"], where, _count: { _all: true } });
    const total = counts.reduce((sum, item) => sum + item._count._all, 0);
    let skip = (page - 1) * 20;
    let remaining = 20;
    const items = [];
    for (const priority of priorityOrder) {
      const count = counts.find((item) => item.priority === priority)?._count._all ?? 0;
      if (skip >= count) { skip -= count; continue; }
      const rows = await tx.incident.findMany({ where: { ...where, priority }, select: { ...workOrderSelect, history: false }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], skip, take: remaining });
      items.push(...rows.map((row) => ({ ...row, history: [] })));
      remaining -= rows.length;
      skip = 0;
      if (!remaining) break;
    }
    return { items, total, page, pageSize: 20, totalPages: Math.max(1, Math.ceil(total / 20)) };
  });
}

export async function technicians(tx: Reader = db, category?: string, excludeIncidentId?: string) {
  const people = await tx.user.findMany({
    where: { role: "TECHNICIAN" }, orderBy: { name: "asc" },
    select: { id: true, name: true, department: true, active: true, technicianProfile: {
      select: { onDuty: true, maxActiveJobs: true, availableFrom: true, availableUntil: true, version: true, skills: { select: { category: true }, orderBy: { category: "asc" } } },
    } },
  });
  const counts = await tx.incident.groupBy({
    by: ["assigneeId"], where: { assigneeId: { not: null }, status: { in: activeStatuses }, ...(excludeIncidentId ? { id: { not: excludeIncidentId } } : {}) }, _count: { _all: true },
  });
  const now = new Date();
  return people.map((person) => {
    const profile = person.technicianProfile;
    const skills = profile?.skills.map((item) => item.category) ?? [];
    const onDuty = profile?.onDuty ?? false;
    const maxActiveJobs = profile?.maxActiveJobs ?? 3;
    const activeJobs = counts.find((item) => item.assigneeId === person.id)?._count._all ?? 0;
    const reasons: string[] = [];
    if (!person.active) reasons.push("Account is inactive.");
    if (!onDuty) reasons.push("Off duty.");
    if (category ? !skills.includes(category) : !skills.length) reasons.push(category ? `Missing ${category.toLowerCase()} skill.` : "No skills configured.");
    if (profile?.availableFrom && profile.availableFrom > now) reasons.push("Availability window has not started.");
    if (profile?.availableUntil && profile.availableUntil <= now) reasons.push("Availability window has ended.");
    if (activeJobs >= maxActiveJobs) reasons.push("Workload limit reached.");
    return { id: person.id, name: person.name, department: person.department, active: person.active,
      skills, onDuty, maxActiveJobs, activeJobs, version: profile?.version ?? 0,
      availableFrom: profile?.availableFrom ?? null, availableUntil: profile?.availableUntil ?? null,
      eligible: reasons.length === 0, reasons,
    };
  });
}

export async function assignmentCandidates(user: CurrentUser, id: string) {
  return db.$transaction(async (tx) => {
    const order = await getWorkOrder(user, id, tx);
    const candidates = (await technicians(tx, order.category)).map((person) => person.id === order.assignee?.id
      ? { ...person, eligible: false, reasons: [...person.reasons, "Already assigned to this work order."] } : person);
    candidates.sort((a, b) => Number(b.eligible) - Number(a.eligible) || a.activeJobs / a.maxActiveJobs - b.activeJobs / b.maxActiveJobs || a.activeJobs - b.activeJobs || a.name.localeCompare(b.name));
    return { candidates };
  });
}

export async function updateTechnician(actorId: string, userId: string, body: Record<string, unknown>) {
  const input = validateProfile(body);
  return db.$transaction(async (tx) => {
    await writeActor(tx, actorId, true);
    const person = await tx.user.findFirst({ where: { id: userId, role: "TECHNICIAN" }, select: { id: true, technicianProfile: { select: { version: true } } } });
    if (!person) throw new WorkflowError(404, "Technician not found.");
    if ((person.technicianProfile?.version ?? 0) !== input.expectedVersion) throw new WorkflowError(409, "This technician profile changed. Refresh before saving again.");
    const openWork = await tx.incident.findMany({ where: { assigneeId: userId, status: { in: activeStatuses } }, select: { category: true } });
    if (openWork.length > input.maxActiveJobs) throw new WorkflowError(409, "The workload limit cannot be lower than the current active workload.");
    if (openWork.some((job) => !input.skills.includes(job.category))) throw new WorkflowError(409, "Keep the skills required by assigned active jobs, or reassign those jobs first.");
    const data = { onDuty: input.onDuty, maxActiveJobs: input.maxActiveJobs, availableFrom: input.availableFrom, availableUntil: input.availableUntil, version: input.expectedVersion + 1 };
    if (person.technicianProfile) {
      const updated = await tx.technicianProfile.updateMany({ where: { userId, version: input.expectedVersion }, data });
      if (updated.count !== 1) throw new WorkflowError(409, "The profile changed. Refresh and try again.");
      await tx.technicianSkill.deleteMany({ where: { userId } });
      await tx.technicianSkill.createMany({ data: input.skills.map((category) => ({ userId, category })) });
    } else {
      await tx.technicianProfile.create({ data: { ...data, userId, skills: { create: input.skills.map((category) => ({ category })) } } });
    }
    return { technician: (await technicians(tx)).find((person) => person.id === userId)! };
  }, { timeout: 10000, maxWait: 10000 });
}

export async function performAction(actorId: string, incidentId: string, requestKey: string, body: Record<string, unknown>) {
  const input = validateAction(body);
  const requestHash = createHash("sha256").update(JSON.stringify({ incidentId, ...input })).digest("hex");
  return db.$transaction(async (tx) => {
    const actor = await writeActor(tx, actorId);
    const current = await getWorkOrder(actor, incidentId, tx);
    const admin = canViewDashboard(actor.role);
    const adminAction = ["TRIAGE", "ASSIGN", "CLOSE", "REOPEN"].includes(input.action);
    if (admin !== adminAction) throw new WorkflowError(403, adminAction ? "Only operations administrators can perform this action." : "Only the assigned technician can perform this action.");
    const prior = await tx.incidentEvent.findUnique({ where: { actorId_requestKey: { actorId, requestKey } }, select: { requestHash: true } });
    if (prior) {
      if (prior.requestHash !== requestHash) throw new WorkflowError(409, "This request reference was already used for different details.");
      return { workOrder: current, replayed: true };
    }
    if (current.version !== input.expectedVersion) throw new WorkflowError(409, "This work order changed. Refresh and review the latest state before trying again.");
    const transitions: Record<typeof input.action, IncidentStatus[]> = {
      TRIAGE: ["REPORTED", "NEEDS_CLARIFICATION", "TRIAGED"], ASSIGN: ["TRIAGED", "ASSIGNED", "IN_PROGRESS", "BLOCKED"],
      START: ["ASSIGNED"], BLOCK: ["ASSIGNED", "IN_PROGRESS"], RESUME: ["BLOCKED"],
      RESOLVE: ["IN_PROGRESS"], CLOSE: ["RESOLVED"], REOPEN: ["RESOLVED"],
    };
    if (!transitions[input.action].includes(current.status)) throw new WorkflowError(409, `Cannot ${input.action.toLowerCase()} a work order in ${current.status.toLowerCase().replaceAll("_", " ")} status.`);
    const now = new Date();
    const data: Prisma.IncidentUncheckedUpdateManyInput = { version: { increment: 1 }, respondedAt: current.respondedAt ?? now };
    let nextAssigneeName = current.assignee?.name ?? null;
    if (input.action === "TRIAGE") {
      Object.assign(data, { category: input.category, priority: input.priority, status: "TRIAGED", assigneeId: null, blockedReason: null });
      nextAssigneeName = null;
    } else if (input.action === "ASSIGN") {
      if (input.assigneeId === current.assignee?.id) throw new WorkflowError(409, "This technician is already assigned.");
      const candidate = (await technicians(tx, current.category)).find((person) => person.id === input.assigneeId);
      if (!candidate || !candidate.eligible) throw new WorkflowError(409, candidate ? `Technician cannot be assigned: ${candidate.reasons.join(" ")}` : "Choose an active qualified technician.");
      Object.assign(data, { assigneeId: candidate.id, status: "ASSIGNED", blockedReason: null, resolutionNote: null, resolvedAt: null, closedAt: null });
      nextAssigneeName = candidate.name;
    } else if (input.action === "START" || input.action === "RESUME") {
      const candidate = (await technicians(tx, current.category, incidentId)).find((person) => person.id === actorId);
      if (!candidate?.eligible) throw new WorkflowError(409, `Work cannot start now. ${candidate?.reasons.join(" ") ?? "Technician profile is unavailable."}`);
      Object.assign(data, { status: "IN_PROGRESS", blockedReason: null });
    } else if (input.action === "BLOCK") {
      Object.assign(data, { status: "BLOCKED", blockedReason: input.note });
    } else if (input.action === "RESOLVE") {
      Object.assign(data, { status: "RESOLVED", resolutionNote: input.note, resolvedAt: now, blockedReason: null });
    } else if (input.action === "CLOSE") {
      if (!current.resolvedAt || !current.resolutionNote) throw new WorkflowError(409, "A recorded resolution is required before closure.");
      Object.assign(data, { status: "CLOSED", closedAt: now });
    } else if (input.action === "REOPEN") {
      Object.assign(data, { status: "TRIAGED", assigneeId: null, blockedReason: null, resolutionNote: null, resolvedAt: null, closedAt: null });
      nextAssigneeName = null;
    }
    const updated = await tx.incident.updateMany({ where: { id: incidentId, version: input.expectedVersion }, data });
    if (updated.count !== 1) throw new WorkflowError(409, "This work order changed. Refresh and review it.");
    await tx.incidentEvent.create({ data: {
      incidentId, actorId, actorName: actor.name, actorRole: actor.role, action: input.action, note: input.note,
      fromStatus: current.status, toStatus: data.status as IncidentStatus,
      fromCategory: current.category, toCategory: input.category ?? current.category,
      fromPriority: current.priority, toPriority: input.priority ?? current.priority,
      fromAssigneeName: current.assignee?.name ?? null, toAssigneeName: nextAssigneeName,
      requestKey, requestHash, resultVersion: input.expectedVersion + 1,
    } });
    return { workOrder: await getWorkOrder(actor, incidentId, tx), replayed: false };
  }, { timeout: 10000, maxWait: 10000 });
}
