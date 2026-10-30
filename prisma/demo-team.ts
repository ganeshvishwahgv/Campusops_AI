import { randomInt } from "node:crypto";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma/client";
import type { Role } from "../src/generated/prisma/enums";
import { hashPassword } from "../src/lib/auth/password";

// Creates the demo team logins (skipping usernames that already exist) and puts
// technicians on duty with skills so work orders can be assigned.
// Passwords are printed once and only their hashes are stored.
const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? "file:./campusops.db" }) });

const team: { username: string; name: string; role: Role; department: string; skills?: string[] }[] = [
  { username: "ganeshvishwa", name: "GaneshVishwa", role: "SYSTEM_ADMIN", department: "Operations" },
  { username: "harrish", name: "Harrish", role: "TECHNICIAN", department: "Maintenance", skills: ["ELECTRICAL", "PLUMBING", "CLEANLINESS", "SAFETY", "OTHER"] },
  { username: "abirami", name: "Abirami", role: "FACULTY", department: "Computer Science" },
  { username: "jayavijaya", name: "Jayavijaya", role: "STUDENT", department: "Computer Science" },
];

// Existing demo technicians had no duty profile, so every one of them showed as off duty.
const roster: Record<string, string[]> = {
  "demo-electrician": ["ELECTRICAL", "SAFETY"],
  "demo-network": ["NETWORK", "EQUIPMENT"],
  "demo-av": ["EQUIPMENT", "EVENT", "TRANSPORT"],
};

function password(name: string) {
  const words = ["Campus", "Block", "Easwari", "Bus", "Lab", "Seminar", "Library", "Canteen"];
  return `${name}-${words[randomInt(words.length)]}-${randomInt(1000, 10000)}`;
}

async function onDuty(userId: string, skills: string[]) {
  await prisma.technicianProfile.upsert({
    where: { userId }, update: { onDuty: true, maxActiveJobs: 4, availableFrom: null, availableUntil: null, version: { increment: 1 } },
    create: { userId, onDuty: true, maxActiveJobs: 4 },
  });
  for (const category of skills) {
    await prisma.technicianSkill.upsert({ where: { userId_category: { userId, category } }, update: {}, create: { userId, category } });
  }
}

async function main() {
  const created: string[] = [];
  for (const member of team) {
    if (await prisma.credential.findUnique({ where: { username: member.username } })) { console.log(`${member.username}: already exists, unchanged`); continue; }
    const secret = password(member.name);
    const user = await prisma.user.create({ data: {
      name: member.name, role: member.role, department: member.department, email: `${member.username}@campus.example`,
      credential: { create: { username: member.username, passwordHash: await hashPassword(secret) } },
    } });
    if (member.skills) await onDuty(user.id, member.skills);
    created.push(`${member.name.padEnd(13)} ${member.role.padEnd(17)} username: ${member.username.padEnd(13)} password: ${secret}`);
  }
  for (const [userId, skills] of Object.entries(roster)) {
    if (await prisma.user.findUnique({ where: { id: userId } })) await onDuty(userId, skills);
  }
  console.log(created.length ? `\nNew logins (shown once):\n${created.join("\n")}` : "No new logins created.");
  console.log("Technicians are on duty with skills.");
}

main().finally(() => prisma.$disconnect());
