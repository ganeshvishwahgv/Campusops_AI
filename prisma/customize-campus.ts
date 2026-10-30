import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma/client";
import { IncidentStatus, Priority } from "../src/generated/prisma/enums";

const adapter = new PrismaBetterSqlite3({
  url: "file:./campusops.db",
});

const prisma = new PrismaClient({ adapter });

async function main() {
  await prisma.$transaction(
    async (tx) => {
      // Existing IDs are retained to preserve linked records.
      // Coordinates are percentages on the generated illustration.
      const locations = [
        {
          id: "A",
          code: "MAIN",
          name: "Main Block",
          mapX: 36,
          mapY: 40,
        },
        {
          id: "B",
          code: "ACADEMIC",
          name: "Academic Block",
          mapX: 14,
          mapY: 58,
        },
        {
          id: "C",
          code: "CIVIL",
          name: "Civil Block",
          mapX: 48,
          mapY: 77,
        },
        {
          id: "D",
          code: "ADMIN",
          name: "Admin Block",
          mapX: 58,
          mapY: 43,
        },
        {
          id: "L",
          code: "MECH",
          name: "Mechanical Block",
          mapX: 64,
          mapY: 81,
        },
        {
          id: "T",
          code: "BUS",
          name: "Bus Stops",
          mapX: 63,
          mapY: 17,
        },
        {
          id: "OAT",
          code: "OAT",
          name: "Open Air Theatre",
          mapX: 48,
          mapY: 64,
        },
      ];

      for (const location of locations) {
        const { id, ...values } = location;

        await tx.building.upsert({
          where: { id },
          update: values,
          create: location,
        });
      }

      // Room numbers and capacities remain fictional demo values.
      await tx.room.update({
        where: { id: "A201" },
        data: { name: "Main Block — Demo Exam Room 201" },
      });

      await tx.room.update({
        where: { id: "B104" },
        data: { name: "Academic Block — Demo Classroom 104" },
      });

      await tx.room.update({
        where: { id: "C101" },
        data: {
          name: "TRP Auditorium",
          roomType: "AUDITORIUM",
        },
      });

      await tx.room.update({
        where: { id: "L101" },
        data: {
          name: "Mechanical Block — Demo Laboratory",
          roomType: "LABORATORY",
          capacity: 40,
        },
      });

      // Move the existing fictional Wi-Fi asset into Academic Block.
      await tx.asset.update({
        where: { id: "ASSET-L101" },
        data: {
          name: "Academic Block wireless access point",
          assetTag: "NET-ACADEMIC-01",
          roomId: "B104",
        },
      });

      await tx.incident.update({
        where: { id: "INC-001" },
        data: {
          locationText: "Main Block · Demo Exam Room 201",
          description:
            "Fictional scenario: power loss in Main Block Room 201 affects an examination for 60 students.",
        },
      });

      await tx.incident.update({
        where: { id: "INC-002" },
        data: {
          title: "Academic Block Wi-Fi connectivity outage",
          locationText: "Academic Block · Demo Classroom 104",
          buildingId: "B",
          roomId: "B104",
          description:
            "Fictional scenario: several users report Wi-Fi connectivity problems in Academic Block. Related reports require review.",
        },
      });

      await tx.incident.update({
        where: { id: "INC-003" },
        data: {
          locationText: "Bus Stops · Bus 03",
          description:
            "Fictional scenario: Bus 03 develops a mechanical fault before collecting 35 participants for a TRP Auditorium event.",
        },
      });

      await tx.incident.update({
        where: { id: "INC-004" },
        data: {
          locationText: "Academic Block · Demo Classroom 104",
        },
      });

      await tx.incident.upsert({
        where: { id: "INC-005" },
        update: {},
        create: {
          id: "INC-005",
          title: "Rain disrupts OAT cultural rehearsal",
          description:
            "Fictional scenario: a simulated rain report interrupts an Open Air Theatre rehearsal for 120 participants. An indoor alternative requires capacity, equipment, and booking checks.",
          category: "EVENT",
          priority: Priority.HIGH,
          status: IncidentStatus.REPORTED,
          locationText: "Open Air Theatre",
          buildingId: "OAT",
          reporterId: "demo-faculty",
        },
      });

      await tx.incident.upsert({
        where: { id: "INC-006" },
        update: {},
        create: {
          id: "INC-006",
          title: "TRP Auditorium microphone failure",
          description:
            "Fictional scenario: the microphone fails before a competition inauguration at TRP Auditorium. AV staff and spare equipment need to be checked.",
          category: "EQUIPMENT",
          priority: Priority.HIGH,
          status: IncidentStatus.REPORTED,
          locationText: "Civil Block · TRP Auditorium",
          buildingId: "C",
          roomId: "C101",
          reporterId: "demo-faculty",
        },
      });
    },
    { timeout: 30000 }
  );

  console.log("\nEaswari campus locations saved successfully.\n");

  console.table(
    await prisma.building.findMany({
      select: {
        code: true,
        name: true,
        mapX: true,
        mapY: true,
      },
      orderBy: { code: "asc" },
    })
  );

  console.log("Total incidents:", await prisma.incident.count());
}

main()
  .catch((error) => {
    console.error("Campus customisation failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });