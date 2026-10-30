import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma/client";
import type { IncidentStatus, Priority } from "../src/generated/prisma/enums";

// Presentation data: Harrish's job history and queue, Abirami as transport admin,
// and a few starter notifications. Safe to re-run: existing demo records are skipped.
// All incidents here are fictional demo scenarios.
const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? "file:./campusops.db" }) });
const ALL_JOB_TYPES = ["ELECTRICAL", "NETWORK", "EQUIPMENT", "PLUMBING", "CLEANLINESS", "SAFETY", "TRANSPORT", "EVENT", "OTHER"];
const hours = (n: number) => new Date(Date.now() - n * 3_600_000);

type Step = "ASSIGN" | "START" | "RESOLVE" | "CLOSE";
type Job = {
  id: string; title: string; description: string; category: string; priority: Priority; reporter: "jayavijaya" | "faculty";
  buildingId: string; roomId?: string; location: string; ageHours: number; steps: Step[]; resolution?: string;
};

const jobs: Job[] = [
  { id: "INC-H01", title: "Water leaking near Academic Block ground-floor washroom", description: "Water is pooling in the corridor outside the ground-floor washroom. Students are slipping near the stairs.", category: "PLUMBING", priority: "HIGH", reporter: "jayavijaya", buildingId: "B", location: "Academic Block · ground floor washroom", ageHours: 5, steps: ["ASSIGN", "START"] },
  { id: "INC-H02", title: "Tube lights flickering in Main Block Classroom 202", description: "Three tube lights flicker constantly during lectures and one has gone dark.", category: "ELECTRICAL", priority: "MEDIUM", reporter: "faculty", buildingId: "A", roomId: "A202", location: "Main Block · Demo Classroom 202", ageHours: 4, steps: ["ASSIGN"] },
  { id: "INC-H03", title: "Broken bench in Civil Block drawing hall", description: "A bench leg has cracked in the drawing hall; two students cannot sit.", category: "OTHER", priority: "LOW", reporter: "jayavijaya", buildingId: "C", roomId: "C102", location: "Civil Block · Demo Drawing Hall 102", ageHours: 3, steps: ["ASSIGN"] },
  { id: "INC-H04", title: "Ceiling fan not working in Mechanical Classroom 201", description: "The front ceiling fan does not start; the room is very hot in the afternoon.", category: "ELECTRICAL", priority: "MEDIUM", reporter: "faculty", buildingId: "L", roomId: "L201", location: "Mechanical Block · Demo Classroom 201", ageHours: 30, steps: ["ASSIGN", "START", "RESOLVE"], resolution: "Replaced the fan capacitor and tested at all speeds for 10 minutes." },
  { id: "INC-H05", title: "Blocked drain outside Main Block entrance", description: "Rainwater is not draining outside the main entrance and is collecting near the steps.", category: "PLUMBING", priority: "HIGH", reporter: "jayavijaya", buildingId: "A", location: "Main Block · front entrance", ageHours: 72, steps: ["ASSIGN", "START", "RESOLVE", "CLOSE"], resolution: "Cleared leaves and silt from the drain grate and flushed the line; water now drains freely." },
  { id: "INC-H06", title: "Overflowing dustbins near Admin Block", description: "Bins near the Admin Block lobby have not been emptied and are attracting flies.", category: "CLEANLINESS", priority: "LOW", reporter: "faculty", buildingId: "D", location: "Admin Block · lobby", ageHours: 96, steps: ["ASSIGN", "START", "RESOLVE", "CLOSE"], resolution: "Emptied and sanitised the bins and added this spot to the daily cleaning round." },
];

async function main() {
  const login = async (username: string) => (await prisma.credential.findUniqueOrThrow({ where: { username }, select: { user: { select: { id: true, name: true, role: true } } } })).user;
  const harrish = await login("harrish");
  const jaya = await login("jayavijaya");
  const admin = await login("kavya");
  const faculty = await prisma.user.findUniqueOrThrow({ where: { id: "demo-faculty" }, select: { id: true, name: true, role: true } });

  // Abirami becomes the transport admin.
  const abirami = await prisma.user.update({ where: { id: (await login("abirami")).id }, data: { role: "TRANSPORT_ADMIN", department: "Transport" }, select: { name: true, role: true } });
  console.log(`${abirami.name} is now ${abirami.role}.`);

  // Harrish is the general maintenance in-charge: every job type, room for a long queue.
  await prisma.technicianProfile.upsert({ where: { userId: harrish.id }, update: { onDuty: true, maxActiveJobs: 20, availableFrom: null, availableUntil: null, version: { increment: 1 } }, create: { userId: harrish.id, onDuty: true, maxActiveJobs: 20 } });
  for (const category of ALL_JOB_TYPES) await prisma.technicianSkill.upsert({ where: { userId_category: { userId: harrish.id, category } }, update: {}, create: { userId: harrish.id, category } });
  // Other technicians also take general jobs and a slightly larger queue.
  for (const userId of ["demo-electrician", "demo-network", "demo-av"]) {
    if (!(await prisma.technicianProfile.findUnique({ where: { userId } }))) continue;
    await prisma.technicianProfile.update({ where: { userId }, data: { onDuty: true, maxActiveJobs: 8, version: { increment: 1 } } });
    await prisma.technicianSkill.upsert({ where: { userId_category: { userId, category: "OTHER" } }, update: {}, create: { userId, category: "OTHER" } });
  }
  console.log("Harrish: on duty, all job types, up to 20 jobs in his queue.");

  let created = 0;
  for (const job of jobs) {
    if (await prisma.incident.findUnique({ where: { id: job.id } })) continue;
    const reporter = job.reporter === "jayavijaya" ? jaya : faculty;
    const reportedAt = hours(job.ageHours);
    let status: IncidentStatus = "REPORTED", version = 0, assigned = false;
    const at = (index: number) => new Date(reportedAt.getTime() + (index + 1) * 25 * 60_000);
    const events: Parameters<typeof prisma.incidentEvent.create>[0]["data"][] = [];
    const event = (index: number, actor: { id: string; name: string; role: typeof admin.role }, action: string, note: string, toStatus: IncidentStatus) => {
      events.push({ incidentId: job.id, actorId: actor.id, actorName: actor.name, actorRole: actor.role, action, note,
        fromStatus: status, toStatus, fromCategory: job.category, toCategory: job.category, fromPriority: job.priority, toPriority: job.priority,
        fromAssigneeName: assigned ? harrish.name : null, toAssigneeName: harrish.name, resultVersion: version + 1, createdAt: at(index) } as never);
      status = toStatus; version += 1; assigned = true;
    };
    job.steps.forEach((step, index) => {
      if (step === "ASSIGN") event(index, admin, "ASSIGN", "Assigned to Harrish, general maintenance in-charge.", "ASSIGNED");
      if (step === "START") event(index, harrish, "START", "On site and starting the repair.", "IN_PROGRESS");
      if (step === "RESOLVE") event(index, harrish, "RESOLVE", job.resolution!, "RESOLVED");
      if (step === "CLOSE") event(index, admin, "CLOSE", "Checked on site; the fix is working.", "CLOSED");
    });
    const resolvedAt = job.steps.includes("RESOLVE") ? at(job.steps.indexOf("RESOLVE")) : null;
    await prisma.$transaction(async (tx) => {
      await tx.incident.create({ data: {
        id: job.id, title: job.title, description: job.description, category: job.category, priority: job.priority, reportedUrgency: job.priority,
        status, version, reporterId: reporter.id, assigneeId: harrish.id, buildingId: job.buildingId, roomId: job.roomId ?? null, locationText: job.location,
        createdAt: reportedAt, respondedAt: at(0), resolvedAt, resolutionNote: job.resolution ?? null,
        closedAt: job.steps.includes("CLOSE") ? at(job.steps.indexOf("CLOSE")) : null,
        resolutionDueAt: new Date(reportedAt.getTime() + 24 * 3_600_000),
        history: { create: [{ actorId: reporter.id, actorName: reporter.name, actorRole: reporter.role, action: "SUBMITTED", note: "Complaint submitted for operations review.",
          toStatus: "REPORTED", toCategory: job.category, toPriority: job.priority, resultVersion: 0, createdAt: reportedAt }] },
      } });
      for (const data of events) await tx.incidentEvent.create({ data });
    });
    created += 1;
  }
  console.log(`Created ${created} of Harrish's demo jobs (${jobs.length - created} already present).`);

  // Starter notifications so each bell has something to show; added once.
  if (!(await prisma.notification.findFirst({ where: { userId: harrish.id, link: "/work-orders?incident=INC-H02" } }))) {
    const operations = await prisma.user.findMany({ where: { role: { in: ["FACILITIES_ADMIN", "SYSTEM_ADMIN"] }, active: true }, select: { id: true } });
    const transport = await prisma.user.findMany({ where: { role: "TRANSPORT_ADMIN" }, select: { id: true } });
    const rows = [
      { userId: harrish.id, kind: "TASK_ASSIGNED", title: "New job assigned: Tube lights flickering in Main Block Classroom 202", body: "Kavya Suresh assigned INC-H02 to you. It is queued after your current job.", link: "/work-orders?incident=INC-H02", createdAt: hours(4) },
      { userId: harrish.id, kind: "TASK_ASSIGNED", title: "New job assigned: Broken bench in Civil Block drawing hall", body: "Kavya Suresh assigned INC-H03 to you. It is queued after your 2 current jobs.", link: "/work-orders?incident=INC-H03", createdAt: hours(3) },
      { userId: jaya.id, kind: "COMPLAINT_RESOLVED", title: "Your reported issue is resolved", body: "\"Blocked drain outside Main Block entrance\" was fixed by Harrish.", link: "/complaints", createdAt: hours(70) },
      { userId: jaya.id, kind: "COMPLAINT_UPDATE", title: "Work has started on your report", body: "Harrish started work on \"Water leaking near Academic Block ground-floor washroom\".", link: "/complaints", createdAt: hours(4) },
      { userId: faculty.id, kind: "COMPLAINT_RESOLVED", title: "Your reported issue is resolved", body: "\"Ceiling fan not working in Mechanical Classroom 201\" was fixed by Harrish.", link: "/complaints", createdAt: hours(28) },
      ...operations.flatMap(({ id }) => [
        { userId: id, kind: "WORK_RESOLVED", title: "Harrish resolved INC-H04", body: "\"Ceiling fan not working in Mechanical Classroom 201\": capacitor replaced. Verify and close it in work orders.", link: "/work-orders?incident=INC-H04", createdAt: hours(28) },
        { userId: id, kind: "NEW_COMPLAINT", title: "New high-urgency report from Jayavijaya", body: "Water leaking near Academic Block ground-floor washroom. Assign a technician in work orders.", link: "/work-orders?incident=INC-H01", createdAt: hours(5) },
      ]),
      ...transport.map(({ id }) => ({ userId: id, kind: "TRANSPORT_REPORT", title: "Welcome to transport control", body: "You will be alerted here when a bus breaks down. Open transport to see the live fleet.", link: "/transport", createdAt: hours(1) })),
    ];
    await prisma.notification.createMany({ data: rows });
    console.log(`Added ${rows.length} starter notifications.`);
  }
}

main().finally(() => prisma.$disconnect());
