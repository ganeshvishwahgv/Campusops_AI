import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/session";
import { categoryOptions } from "@/lib/complaints/types";
import { getWorkOrder, technicians } from "@/lib/workflow/service";
import { haversineKm, type RescuePlan } from "@/lib/transport/rescue";
import type { Bus } from "@/lib/transport/fleet";
import type { Briefing, ComplaintDraft, LensAnswer, TransportBrief, TriageAdvice } from "./types";
import { structured, withFallback } from "./client";

const categories = categoryOptions.map((option) => option.value) as [string, ...string[]];
const priorities = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
const openStatuses = { notIn: ["RESOLVED" as const, "CLOSED" as const] };

const keywordCategories: [RegExp, string][] = [
  [/power|electric|light|fan|socket|spark|shock|ups|generator|breaker|tripp?ed/i, "ELECTRICAL"],
  [/wi-?fi|internet|network|lan|router|signal|connect/i, "NETWORK"],
  [/project|mic|microphone|speaker|computer|pc|printer|ac\b|air ?con|equipment|screen|smart ?board/i, "EQUIPMENT"],
  [/water|leak|pipe|tap|toilet|washroom|drain|flood/i, "PLUMBING"],
  [/dirty|garbage|clean|smell|trash|dust|pest/i, "CLEANLINESS"],
  [/fire|smoke|injur|unsafe|danger|broken glass|collapse|security/i, "SAFETY"],
  [/bus|driver|route|transport|pickup|vehicle/i, "TRANSPORT"],
  [/event|rehears|stage|auditorium|venue|function|inaugur/i, "EVENT"],
];

function ruleCategory(text: string) {
  return keywordCategories.find(([pattern]) => pattern.test(text))?.[1] ?? "OTHER";
}
function ruleUrgency(text: string): (typeof priorities)[number] {
  if (/fire|smoke|shock|injur|exam|emergency|danger|stranded|flood/i.test(text)) return "CRITICAL";
  if (/class|lecture|event|today|now|urgent|no power|outage|broke ?down/i.test(text)) return "HIGH";
  if (/minor|slow|sometimes|whenever/i.test(text)) return "LOW";
  return "MEDIUM";
}

// ---------- Natural-language complaint intake ----------

const DraftSchema = z.object({
  title: z.string(), category: z.enum(categories), reportedUrgency: z.enum(priorities),
  buildingId: z.string().nullable(), roomId: z.string().nullable(), assetId: z.string().nullable(), busId: z.string().nullable(),
  locationDetails: z.string(), followUpQuestions: z.array(z.string()), confidence: z.enum(["LOW", "MEDIUM", "HIGH"]),
});

export async function draftComplaint(text: string): Promise<ComplaintDraft> {
  const [buildings, rooms, assets, buses] = await db.$transaction([
    db.building.findMany({ select: { id: true, code: true, name: true } }),
    db.room.findMany({ select: { id: true, code: true, name: true, buildingId: true } }),
    db.asset.findMany({ select: { id: true, name: true, assetTag: true, roomId: true } }),
    db.bus.findMany({ select: { id: true, fleetCode: true, registrationNumber: true } }),
  ]);

  // Model output may only reference real records, in a consistent building → room → asset chain.
  function clean<T extends Omit<ComplaintDraft, keyof import("./types").Provenance>>(draft: T): T {
    const room = rooms.find((item) => item.id === draft.roomId);
    const buildingId = buildings.some((item) => item.id === draft.buildingId) ? draft.buildingId : room?.buildingId ?? null;
    const roomId = room && room.buildingId === buildingId ? room.id : null;
    const assetId = assets.find((item) => item.id === draft.assetId && item.roomId === roomId)?.id ?? null;
    const busId = draft.category === "TRANSPORT" ? buses.find((item) => item.id === draft.busId)?.id ?? null : null;
    const title = draft.title.trim().slice(0, 120).padEnd(5, ".");
    return { ...draft, title, buildingId, roomId, assetId, busId, locationDetails: draft.locationDetails.slice(0, 200), followUpQuestions: draft.followUpQuestions.slice(0, 3) };
  }

  function rules() {
    const lower = text.toLowerCase();
    const room = rooms.find((item) => lower.includes(item.code.toLowerCase()) || lower.includes(item.name.toLowerCase()));
    const building = buildings.find((item) => item.id === room?.buildingId)
      ?? buildings.find((item) => lower.includes(item.name.toLowerCase()) || new RegExp(`\\b${item.code}[- ]?block\\b|\\bblock[- ]?${item.code}\\b`, "i").test(text));
    const bus = buses.find((item) => lower.includes(item.fleetCode.toLowerCase()));
    const category = bus ? "TRANSPORT" : ruleCategory(text);
    const first = text.split(/[.!?\n]/)[0].trim();
    const questions = [
      ...(!building ? ["Which building or campus location is this in?"] : []),
      ...(!room && category !== "TRANSPORT" ? ["Which room or venue exactly?"] : []),
      "Is any class, exam or event affected right now?",
    ];
    return clean({
      title: first.length > 8 ? first.slice(0, 100) : `${categoryOptions.find((option) => option.value === category)?.label ?? "Campus"} issue reported`,
      category, reportedUrgency: ruleUrgency(text),
      buildingId: building?.id ?? null, roomId: room?.id ?? null, assetId: null, busId: bus?.id ?? null,
      locationDetails: "", followUpQuestions: questions.slice(0, 3), confidence: building ? "MEDIUM" as const : "LOW" as const,
    });
  }

  return withFallback(async () => clean(await structured(DraftSchema,
    `A student or staff member described a campus problem in their own words (below, in "report"). Fill in the structured complaint form.
- title: 5–90 characters, specific (what + where).
- category and reportedUrgency: pick the best fit. CRITICAL only for safety risk or an exam/major event disrupted right now.
- buildingId / roomId / assetId / busId: use IDs from the reference lists only when the report clearly points to them; otherwise null.
- locationDetails: extra location hints (floor, near which lab, etc.), else empty string.
- followUpQuestions: up to three short questions for details that are genuinely missing.`,
    { report: text, buildings, rooms, assets, buses: buses.map(({ id, fleetCode }) => ({ id, fleetCode })) }, { maxTokens: 2000 })), rules);
}

// ---------- Work-order triage ----------

const TriageSchema = z.object({
  summary: z.string(), suggestedCategory: z.enum(categories), suggestedPriority: z.enum(priorities), priorityReason: z.string(),
  technicianId: z.string().nullable(), technicianReason: z.string(), nextSteps: z.array(z.string()), impact: z.string(),
  related: z.array(z.object({ id: z.string(), reason: z.string() })),
});

export async function triageIncident(user: CurrentUser, id: string): Promise<TriageAdvice> {
  const order = await getWorkOrder(user, id);
  const [crew, related, bookings] = await Promise.all([
    technicians(db, order.category, order.id),
    db.incident.findMany({
      where: { id: { not: order.id }, status: openStatuses, OR: [
        ...(order.building ? [{ buildingId: order.building.id }] : []), { category: order.category },
      ] },
      select: { id: true, title: true, category: true, status: true, locationText: true, createdAt: true }, take: 15, orderBy: { createdAt: "desc" },
    }),
    order.room || order.building ? db.roomBooking.count({ where: { status: "CONFIRMED", endsAt: { gt: new Date() }, startsAt: { lt: new Date(Date.now() + 2 * 86_400_000) },
      ...(order.room ? { roomId: order.room.id } : { room: { buildingId: order.building!.id } }) } }) : Promise.resolve(0),
  ]);
  const eligible = crew.filter((person) => person.eligible);
  const facts = {
    incident: { id: order.id, title: order.title, description: order.description, category: order.category, priority: order.priority,
      reportedUrgency: order.reportedUrgency, status: order.status, location: order.locationText, room: order.room?.name ?? null,
      asset: order.asset?.name ?? null, bus: order.bus?.fleetCode ?? null, reportedAt: order.createdAt, assignee: order.assignee?.name ?? null, blockedReason: order.blockedReason },
    bookingsInNext48h: bookings,
    eligibleTechnicians: eligible.map(({ id, name, skills, activeJobs, maxActiveJobs }) => ({ id, name, skills, activeJobs, maxActiveJobs })),
    otherOpenIncidents: related,
  };
  const name = (techId: string | null) => crew.find((person) => person.id === techId)?.name ?? null;

  function rules() {
    const text = `${order.title} ${order.description}`;
    const suggestedPriority = order.reportedUrgency === "CRITICAL" || ruleUrgency(text) === "CRITICAL" ? "CRITICAL" : bookings > 0 || ruleUrgency(text) === "HIGH" ? "HIGH" : order.priority;
    const tech = [...eligible].sort((a, b) => a.activeJobs / a.maxActiveJobs - b.activeJobs / b.maxActiveJobs)[0];
    const words = new Set(order.title.toLowerCase().split(/\W+/).filter((word) => word.length > 3));
    return {
      summary: `${order.title}${order.locationText ? ` at ${order.locationText}` : ""}. Reported as ${(order.reportedUrgency ?? "MEDIUM").toLowerCase()} urgency; currently ${order.status.toLowerCase().replaceAll("_", " ")}.`,
      suggestedCategory: order.category === "UNCLASSIFIED" || order.category === "OTHER" ? ruleCategory(text) : order.category,
      suggestedPriority, priorityReason: bookings ? `${bookings} booking(s) in this location within 48 hours could be disrupted.` : "Based on the reported urgency and keywords in the description.",
      technicianId: tech?.id ?? null, technicianName: tech?.name ?? null,
      technicianReason: tech ? `Has the ${order.category.toLowerCase()} skill and the lightest workload (${tech.activeJobs}/${tech.maxActiveJobs} active jobs).` : "No on-duty technician with this skill has spare capacity. Update the workforce roster.",
      nextSteps: ["Confirm the issue on site and isolate any safety hazard.", ...(bookings ? ["Review affected room bookings and arrange a replacement room."] : []), "Assign the technician and set the resolution target."],
      impact: bookings ? `${bookings} upcoming booking(s) in the affected location.` : "No upcoming bookings found at this location.",
      related: related.filter((item) => item.title.toLowerCase().split(/\W+/).some((word) => words.has(word))).slice(0, 3)
        .map((item) => ({ id: item.id, title: item.title, reason: "Similar wording and same location or issue type." })),
    };
  }

  return withFallback(async () => {
    const advice = await structured(TriageSchema,
      `Triage this campus work order for the facilities administrator.
- summary: two sentences max.
- suggestedPriority with priorityReason grounded in the facts (safety, exams/events, number of people affected, bookings at risk).
- technicianId: choose only from eligibleTechnicians (or null if none); prefer matching skills and spare capacity.
- nextSteps: three to five concrete actions in order.
- impact: who/what is affected.
- related: possible duplicates or connected incidents from otherOpenIncidents (only if genuinely related), with a reason.`, facts, { maxTokens: 3000 });
    const technicianId = eligible.some((person) => person.id === advice.technicianId) ? advice.technicianId : null;
    return { ...advice, technicianId, technicianName: name(technicianId),
      related: advice.related.flatMap((item) => { const match = related.find((row) => row.id === item.id); return match ? [{ id: match.id, title: match.title, reason: item.reason }] : []; }) };
  }, rules);
}

// ---------- Daily operations briefing ----------

const BriefingSchema = z.object({
  headline: z.string(), situation: z.string(),
  risks: z.array(z.object({ title: z.string(), detail: z.string(), incidentIds: z.array(z.string()) })),
  actions: z.array(z.string()),
});

export async function operationsSnapshot() {
  const now = new Date();
  const [incidents, rooms, buses, bookings, crew] = await Promise.all([
    db.incident.findMany({ where: { status: openStatuses }, orderBy: { createdAt: "desc" }, take: 80, select: {
      id: true, title: true, category: true, priority: true, status: true, locationText: true, blockedReason: true,
      resolutionDueAt: true, createdAt: true, assignee: { select: { name: true } } } }),
    db.room.findMany({ select: { id: true, name: true, capacity: true, availability: true, accessible: true, hasProjector: true, building: { select: { name: true } } } }),
    db.bus.findMany({ select: { fleetCode: true, capacity: true, availability: true } }),
    db.roomBooking.findMany({ where: { status: "CONFIRMED", endsAt: { gt: now }, startsAt: { lt: new Date(now.getTime() + 7 * 86_400_000) } }, take: 60, orderBy: { startsAt: "asc" },
      select: { id: true, title: true, startsAt: true, endsAt: true, attendees: true, room: { select: { name: true } } } }),
    technicians(db),
  ]);
  return {
    now: now.toISOString(),
    openIncidents: incidents.map((item) => ({ ...item, assignee: item.assignee?.name ?? null, overdue: Boolean(item.resolutionDueAt && item.resolutionDueAt < now) })),
    rooms: rooms.map((room) => ({ ...room, building: room.building.name })), buses,
    upcomingBookings: bookings.map((booking) => ({ ...booking, room: booking.room.name })),
    technicians: crew.map(({ name, skills, onDuty, activeJobs, maxActiveJobs, eligible }) => ({ name, skills, onDuty, activeJobs, maxActiveJobs, available: eligible })),
  };
}

export async function operationsBriefing(): Promise<Briefing> {
  const snapshot = await operationsSnapshot();
  function rules() {
    const open = snapshot.openIncidents;
    const critical = open.filter((item) => item.priority === "CRITICAL");
    const blocked = open.filter((item) => item.status === "BLOCKED");
    const unassigned = open.filter((item) => !item.assignee);
    const overdue = open.filter((item) => item.overdue);
    const downRooms = snapshot.rooms.filter((room) => room.availability !== "AVAILABLE");
    return {
      headline: critical.length ? `${critical.length} critical incident${critical.length === 1 ? "" : "s"} need attention` : `${open.length} open incidents, none critical`,
      situation: `${open.length} open incidents: ${blocked.length} blocked, ${unassigned.length} unassigned, ${overdue.length} past their deadline. ${downRooms.length} room(s) out of service; ${snapshot.buses.filter((bus) => bus.availability !== "AVAILABLE").length} bus(es) unavailable.`,
      risks: [
        ...critical.slice(0, 3).map((item) => ({ title: item.title, detail: `${item.status.replaceAll("_", " ").toLowerCase()} · ${item.locationText ?? "location not set"}`, incidentIds: [item.id] })),
        ...(downRooms.length ? [{ title: "Rooms out of service", detail: downRooms.map((room) => room.name).join(", "), incidentIds: [] }] : []),
      ],
      actions: [
        ...(unassigned.length ? [`Assign technicians to ${unassigned.length} unassigned incident(s).`] : []),
        ...(blocked.length ? [`Unblock ${blocked.map((item) => item.id).join(", ")}.`] : []),
        ...(downRooms.length ? ["Use Room recovery to relocate classes from rooms that are out of service."] : []),
        "Review the incident queue by priority.",
      ],
    };
  }
  return withFallback(async () => {
    const briefing = await structured(BriefingSchema,
      `Write the operations briefing the facilities head reads at the start of a shift.
- headline: under 12 words.
- situation: two or three sentences with the key numbers.
- risks: up to four of the most important risks (critical/blocked/overdue incidents, rooms out of service with bookings, transport issues), each citing incident IDs where relevant.
- actions: three to five prioritised actions, imperative voice.`, snapshot, { maxTokens: 3000 });
    const ids = new Set(snapshot.openIncidents.map((item) => item.id));
    return { ...briefing, risks: briefing.risks.slice(0, 4).map((risk) => ({ ...risk, incidentIds: risk.incidentIds.filter((value) => ids.has(value)) })) };
  }, rules);
}

// ---------- Transport rescue brief ----------

const TransportSchema = z.object({ assessment: z.string(), passengerNotice: z.string(), driverInstructions: z.array(z.string()), risks: z.array(z.string()) });

export async function transportBrief(plan: RescuePlan, fleet: Bus[]): Promise<TransportBrief> {
  const found = fleet.find((bus) => bus.id === plan.brokenBusId);
  if (!found) throw new Error("Broken bus missing.");
  const broken: Bus = found;
  const facts = {
    brokenBus: { name: broken.name, route: broken.routeName, passengers: broken.occupied, driver: broken.driver },
    plan: { stranded: plan.stranded, uncovered: plan.uncovered, assignments: plan.assignments.map(({ busName, routeName, seatsAllocated, distanceKm, etaMin, driver }) => ({ busName, routeName, seatsAllocated, distanceKm, etaMin, driver })) },
    otherBuses: fleet.filter((bus) => bus.id !== broken.id).map((bus) => ({ name: bus.name, status: bus.status, freeSeats: bus.capacity - bus.occupied, distanceKm: Number(haversineKm(broken.lat, broken.lng, bus.lat, bus.lng).toFixed(1)) })),
    note: "Simulated fleet; distances are straight-line and ETAs assume 25 km/h.",
  };
  function rules() {
    const eta = Math.max(0, ...plan.assignments.map((item) => item.etaMin));
    return {
      assessment: plan.summary,
      passengerNotice: plan.assignments.length
        ? `${broken.name} (${broken.routeName}) has broken down. Please stay with the bus. ${plan.assignments.map((item) => `${item.busName} is coming for ${item.seatsAllocated} passengers`).join("; ")}. Expected pickup within about ${eta} minutes.`
        : `${broken.name} (${broken.routeName}) has broken down. Please stay with the bus; the transport office is arranging a replacement vehicle.`,
      driverInstructions: [
        `${broken.driver}: switch on hazard lights, keep students away from traffic, and count passengers.`,
        ...plan.assignments.map((item) => `${item.driver} (${item.busName}): after current drop-offs, proceed to ${broken.name} and board ${item.seatsAllocated} students.`),
      ],
      risks: plan.uncovered > 0 ? [`${plan.uncovered} students are still without a seat; request an extra vehicle.`] : ["Helper buses will reach their own stops later; inform their passengers about the delay."],
    };
  }
  return withFallback(() => structured(TransportSchema,
    `A college bus has broken down. Rule-based dispatch has already picked helper buses and seat counts (plan). Do not change the allocation.
- assessment: two sentences evaluating the plan (coverage, slowest ETA, any gaps).
- passengerNotice: an SMS-length message (under 320 characters) to stranded students and parents.
- driverInstructions: one line per driver involved, including the broken bus driver.
- risks: up to three operational risks to watch.`, facts, { maxTokens: 2000 }), rules);
}

// ---------- OpsLens: questions about live operations ----------

const LensSchema = z.object({ answer: z.string(), references: z.array(z.string()), followUps: z.array(z.string()) });
export type LensTurn = { role: "user" | "assistant"; text: string };

export async function askLens(question: string, history: LensTurn[]): Promise<LensAnswer> {
  const snapshot = await operationsSnapshot();
  function rules() {
    const open = snapshot.openIncidents;
    const q = question.toLowerCase();
    const matches = open.filter((item) => q.split(/\W+/).some((word) => word.length > 3 && `${item.title} ${item.locationText}`.toLowerCase().includes(word)));
    return {
      answer: matches.length
        ? `I found ${matches.length} open incident(s) matching your question:\n${matches.slice(0, 5).map((item) => `• ${item.id}: ${item.title} (${item.priority.toLowerCase()}, ${item.status.toLowerCase().replaceAll("_", " ")})`).join("\n")}`
        : `There are ${open.length} open incidents (${open.filter((item) => item.priority === "CRITICAL").length} critical), ${snapshot.rooms.filter((room) => room.availability !== "AVAILABLE").length} room(s) out of service and ${snapshot.upcomingBookings.length} bookings in the next 7 days. Connect Claude for full natural-language answers.`,
      references: matches.slice(0, 5).map((item) => item.id),
      followUps: ["Which incidents are blocked?", "Which rooms are out of service?", "Who has spare capacity today?"],
    };
  }
  return withFallback(() => structured(LensSchema,
    `Answer the facilities administrator's question using only the live campus snapshot. If the snapshot cannot answer it, say so and suggest where in CampusOps to look.
Use short paragraphs or "•" bullet lines (no markdown headings or tables). Put incident IDs, room names or booking IDs you relied on in references. Suggest two or three natural follow-up questions.

Conversation so far:
${history.slice(-6).map((turn) => `${turn.role === "user" ? "Admin" : "Assistant"}: ${turn.text.slice(0, 1500)}`).join("\n") || "(none)"}

Question: ${question}`, snapshot, { maxTokens: 4000, effort: "medium" }), rules);
}
