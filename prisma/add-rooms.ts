import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma/client";

// Additive only: creates missing demo rooms and never edits or removes existing ones.
// Capacities and facilities are fictional, like the rest of the seeded campus records.
const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? "file:./campusops.db" }) });

const rooms = [
  { id: "A202", code: "202", name: "Main Block — Demo Classroom 202", floor: 2, capacity: 60, roomType: "CLASSROOM", accessible: false, hasProjector: true, buildingId: "A" },
  { id: "A105", code: "105", name: "Main Block — Demo Seminar Hall 105", floor: 1, capacity: 120, roomType: "SEMINAR_HALL", accessible: true, hasProjector: true, buildingId: "A" },
  { id: "A110", code: "110", name: "Main Block — Demo Tutorial Room 110", floor: 1, capacity: 30, roomType: "CLASSROOM", accessible: true, hasProjector: false, buildingId: "A" },
  { id: "B201", code: "201", name: "Academic Block — Demo Classroom 201", floor: 2, capacity: 66, roomType: "CLASSROOM", accessible: false, hasProjector: true, buildingId: "B" },
  { id: "B105", code: "105", name: "Academic Block — Demo Classroom 105", floor: 1, capacity: 45, roomType: "CLASSROOM", accessible: true, hasProjector: true, buildingId: "B" },
  { id: "B301", code: "301", name: "Academic Block — Demo Computer Lab 301", floor: 3, capacity: 40, roomType: "LAB", accessible: false, hasProjector: true, buildingId: "B" },
  { id: "C102", code: "102", name: "Civil Block — Demo Drawing Hall 102", floor: 1, capacity: 70, roomType: "CLASSROOM", accessible: true, hasProjector: false, buildingId: "C" },
  { id: "L201", code: "201", name: "Mechanical Block — Demo Classroom 201", floor: 2, capacity: 60, roomType: "CLASSROOM", accessible: false, hasProjector: true, buildingId: "L" },
  { id: "D101", code: "101", name: "Admin Block — Demo Board Room", floor: 1, capacity: 20, roomType: "MEETING_ROOM", accessible: true, hasProjector: true, buildingId: "D" },
];

async function main() {
  let created = 0;
  for (const room of rooms) {
    const exists = await prisma.room.findFirst({ where: { OR: [{ id: room.id }, { buildingId: room.buildingId, code: room.code }] }, select: { id: true } });
    if (exists) continue;
    await prisma.room.create({ data: room });
    created += 1;
  }
  console.log(`Added ${created} demo room(s); ${rooms.length - created} already present.`);
}

main().finally(() => prisma.$disconnect());
