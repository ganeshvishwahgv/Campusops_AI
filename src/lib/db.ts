import "server-only";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as {
  campusopsPrisma?: PrismaClient;
};

function createClient() {
  const adapter = new PrismaBetterSqlite3({
    url: process.env.DATABASE_URL ?? "file:./campusops.db",
  });

  return new PrismaClient({ adapter });
}

export const db = globalForPrisma.campusopsPrisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.campusopsPrisma = db;
}
