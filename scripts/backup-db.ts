import "dotenv/config";
import Database from "better-sqlite3";
import { mkdir } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

async function main() {
  const url = process.env.DATABASE_URL ?? "file:./campusops.db";
  if (!url.startsWith("file:") || url.includes(":memory:") || url.includes("?")) {
    throw new Error("DATABASE_URL must be a local file: SQLite path without query parameters.");
  }

  const sourcePath = resolve(url.slice("file:".length));
  const directory = resolve("backups");
  await mkdir(directory, { recursive: true });
  const stamp = new Date().toISOString().replaceAll(":", "-");
  const destination = join(directory, `${basename(sourcePath)}.${stamp}.${randomUUID()}.db`);
  const source = new Database(sourcePath, { readonly: true, fileMustExist: true });

  try {
    // SQLite's online backup API includes committed WAL data and creates a
    // consistent snapshot even when a development server has the file open.
    await source.backup(destination);
  } finally {
    source.close();
  }

  const backup = new Database(destination, { readonly: true, fileMustExist: true });
  try {
    const integrity = backup.pragma("integrity_check") as { integrity_check: string }[];
    if (integrity.length !== 1 || integrity[0]?.integrity_check !== "ok") {
      throw new Error("Backup integrity verification failed. Do not apply schema changes.");
    }
  } finally {
    backup.close();
  }

  console.log(`Verified SQLite backup: ${destination}`);
  console.log("Keep this backup private: it may contain password hashes and session records.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Database backup failed.");
  process.exitCode = 1;
});
