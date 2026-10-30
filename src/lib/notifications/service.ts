import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { Role } from "@/generated/prisma/enums";
import { db } from "@/lib/db";

type Writer = Prisma.TransactionClient;
export type NotificationInput = { kind: string; title: string; body: string; link?: string | null };

export const operationsRoles: Role[] = ["FACILITIES_ADMIN", "SYSTEM_ADMIN"];

/** Notify specific users. Call inside the transaction that makes the change, so both commit together. */
export async function notifyUsers(tx: Writer, userIds: (string | null | undefined)[], input: NotificationInput) {
  const ids = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
  if (!ids.length) return;
  await tx.notification.createMany({ data: ids.map((userId) => ({ userId, kind: input.kind, title: input.title.slice(0, 200), body: input.body.slice(0, 1000), link: input.link ?? null })) });
}

/** Notify every active user holding one of these roles, optionally skipping the person who acted. */
export async function notifyRoles(tx: Writer, roles: Role[], input: NotificationInput, exceptUserId?: string) {
  const users = await tx.user.findMany({ where: { role: { in: roles }, active: true, ...(exceptUserId ? { id: { not: exceptUserId } } : {}) }, select: { id: true } });
  await notifyUsers(tx, users.map((user) => user.id), input);
}

export async function listNotifications(userId: string) {
  const [items, unread] = await db.$transaction([
    db.notification.findMany({ where: { userId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 30,
      select: { id: true, kind: true, title: true, body: true, link: true, readAt: true, createdAt: true } }),
    db.notification.count({ where: { userId, readAt: null } }),
  ]);
  return { items, unread };
}

export async function markRead(userId: string, ids: string[] | "ALL") {
  await db.notification.updateMany({ where: { userId, readAt: null, ...(ids === "ALL" ? {} : { id: { in: ids.slice(0, 100) } }) }, data: { readAt: new Date() } });
  return listNotifications(userId);
}
