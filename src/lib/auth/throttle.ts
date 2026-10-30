import "server-only";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";

export function usernameThrottleKey(username: string) {
  return createHash("sha256").update(`login:username:${username}`).digest("hex");
}

const GLOBAL_KEY = createHash("sha256").update("login:global").digest("hex");

export async function consumeLoginAttempt(username: string): Promise<number | null> {
  const now = new Date();
  // The transaction serializes admission; parallel requests cannot skip the limit.
  return db.$transaction(async (tx) => {
    await tx.loginThrottle.deleteMany({ where: { expiresAt: { lte: now } } });
    for (const bucket of [
      { key: GLOBAL_KEY, limit: 100, seconds: 60 },
      { key: usernameThrottleKey(username), limit: 5, seconds: 15 * 60 },
    ]) {
      const row = await tx.loginThrottle.upsert({
        where: { key: bucket.key },
        create: { key: bucket.key, attempts: 1, expiresAt: new Date(now.getTime() + bucket.seconds * 1000) },
        update: { attempts: { increment: 1 } },
      });
      if (row.attempts > bucket.limit) return Math.max(1, Math.ceil((row.expiresAt.getTime() - now.getTime()) / 1000));
    }
    return null;
  });
}
