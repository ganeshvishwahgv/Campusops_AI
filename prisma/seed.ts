import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma/client";
import {
  Availability,
  IncidentStatus,
  Priority,
  Role,
} from "../src/generated/prisma/enums";

const adapter = new PrismaBetterSqlite3({
  url: "file:./campusops.db",
});

const prisma = new PrismaClient({ adapter });

async function main() {
  // Stable IDs prevent duplicate sample records on repeated runs.
  // Empty updates preserve any changes made to existing records.
  await prisma.$transaction(
    async (tx) => {
      const users = [
        {
          id: "demo-faculty",
          name: "Priya Raman",
          email: "priya@campus.example",
          role: Role.FACULTY,
          department: "Academics",
        },
        {
          id: "demo-electrician",
          name: "Arun Kumar",
          email: "arun@campus.example",
          role: Role.TECHNICIAN,
          department: "Electrical",
        },
        {
          id: "demo-network",
          name: "Meera Ravi",
          email: "meera@campus.example",
          role: Role.TECHNICIAN,
          department: "Network",
        },
        {
          id: "demo-av",
          name: "Dev Anand",
          email: "dev@campus.example",
          role: Role.TECHNICIAN,
          department: "AV Support",
        },
        {
          id: "demo-admin",
          name: "Kavya Suresh",
          email: "kavya@campus.example",
          role: Role.FACILITIES_ADMIN,
          department: "Facilities",
        },
      ];

      for (const user of users) {
        await tx.user.upsert({
          where: { id: user.id },
          update: {},
          create: user,
        });
      }

      const buildings = [
        { id: "A", code: "A", name: "Academic A", mapX: 8, mapY: 13 },
        { id: "B", code: "B", name: "Academic B", mapX: 40, mapY: 13 },
        { id: "C", code: "C", name: "Research C", mapX: 72, mapY: 13 },
        { id: "L", code: "L", name: "Library", mapX: 8, mapY: 62 },
        { id: "D", code: "D", name: "Administration", mapX: 40, mapY: 62 },
        { id: "T", code: "T", name: "Transport hub", mapX: 72, mapY: 62 },
      ];

      for (const building of buildings) {
        await tx.building.upsert({
          where: { id: building.id },
          update: {},
          create: building,
        });
      }

      const rooms = [
        {
          id: "A201",
          code: "201",
          name: "Examination Room A201",
          buildingId: "A",
          floor: 2,
          capacity: 60,
          roomType: "CLASSROOM",
          availability: Availability.UNAVAILABLE,
        },
        {
          id: "B104",
          code: "104",
          name: "Classroom B104",
          buildingId: "B",
          floor: 1,
          capacity: 40,
          roomType: "CLASSROOM",
          availability: Availability.AVAILABLE,
        },
        {
          id: "C101",
          code: "101",
          name: "Seminar Hall C101",
          buildingId: "C",
          floor: 0,
          capacity: 80,
          roomType: "SEMINAR_HALL",
          availability: Availability.AVAILABLE,
        },
        {
          id: "L101",
          code: "101",
          name: "Library Reading Room",
          buildingId: "L",
          floor: 1,
          capacity: 100,
          roomType: "READING_ROOM",
          availability: Availability.AVAILABLE,
        },
      ];

      for (const room of rooms) {
        await tx.room.upsert({
          where: { id: room.id },
          update: {},
          create: {
            ...room,
            accessible: room.floor === 0,
            hasProjector: room.id !== "L101",
          },
        });
      }

      const assets = [
        {
          id: "ASSET-A201",
          assetTag: "ELEC-A201-01",
          name: "Room electrical distribution unit",
          category: "ELECTRICAL",
          roomId: "A201",
          availability: Availability.MAINTENANCE,
        },
        {
          id: "ASSET-L101",
          assetTag: "NET-L101-01",
          name: "Library wireless access point",
          category: "NETWORK",
          roomId: "L101",
          availability: Availability.UNAVAILABLE,
        },
        {
          id: "ASSET-B104",
          assetTag: "AV-B104-01",
          name: "Classroom projector",
          category: "EQUIPMENT",
          roomId: "B104",
          availability: Availability.MAINTENANCE,
        },
      ];

      for (const asset of assets) {
        await tx.asset.upsert({
          where: { id: asset.id },
          update: {},
          create: asset,
        });
      }

      for (let number = 1; number <= 4; number++) {
        const id = `BUS-${String(number).padStart(2, "0")}`;

        await tx.bus.upsert({
          where: { id },
          update: {},
          create: {
            id,
            fleetCode: id,
            registrationNumber: `DEMO-REG-${number}`,
            capacity: [50, 45, 40, 50][number - 1],
            availability:
              number === 3
                ? Availability.UNAVAILABLE
                : Availability.AVAILABLE,
          },
        });
      }

      const incidents = [
        {
          id: "INC-001",
          title: "Electrical failure before examination",
          description:
            "Power loss in Room A201. A sample exam for 60 students is affected.",
          category: "ELECTRICAL",
          priority: Priority.CRITICAL,
          status: IncidentStatus.BLOCKED,
          locationText: "Academic Block A · Room 201",
          blockedReason: "Replacement component required.",
          buildingId: "A",
          roomId: "A201",
          assetId: "ASSET-A201",
          assigneeId: "demo-electrician",
        },
        {
          id: "INC-002",
          title: "Library Wi-Fi connectivity outage",
          description:
            "Users report connectivity problems in the library reading room. Related reports still require review.",
          category: "NETWORK",
          priority: Priority.HIGH,
          status: IncidentStatus.ASSIGNED,
          locationText: "Central Library · First floor",
          buildingId: "L",
          roomId: "L101",
          assetId: "ASSET-L101",
          assigneeId: "demo-network",
        },
        {
          id: "INC-003",
          title: "College bus unavailable",
          description:
            "Bus 03 has a reported mechanical fault. A sample service carrying 35 passengers needs transport review.",
          category: "TRANSPORT",
          priority: Priority.HIGH,
          status: IncidentStatus.REPORTED,
          locationText: "Transport hub · Bus 03",
          buildingId: "T",
          busId: "BUS-03",
        },
        {
          id: "INC-004",
          title: "Projector display flickering",
          description:
            "The projector in Room B104 flickers during lessons. Cable and input connections are being inspected.",
          category: "EQUIPMENT",
          priority: Priority.MEDIUM,
          status: IncidentStatus.IN_PROGRESS,
          locationText: "Academic Block B · Room 104",
          buildingId: "B",
          roomId: "B104",
          assetId: "ASSET-B104",
          assigneeId: "demo-av",
        },
      ];

      for (const incident of incidents) {
        await tx.incident.upsert({
          where: { id: incident.id },
          update: {},
          create: {
            ...incident,
            reporterId: "demo-faculty",
          },
        });
      }
    },
    { timeout: 30000 }
  );

  console.log("\nCampusOps sample data saved successfully.\n");

  console.table({
    Users: await prisma.user.count(),
    Buildings: await prisma.building.count(),
    Rooms: await prisma.room.count(),
    Assets: await prisma.asset.count(),
    Buses: await prisma.bus.count(),
    Incidents: await prisma.incident.count(),
  });
}

main()
  .catch((error) => {
    console.error("Sample data setup failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });