import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import type { NotificationChannel, Prisma, RelatedModule } from "@prisma/client";

/**
 * The `Notification` table has existed since Phase 1/2 planning but had zero
 * real caller anywhere in the codebase until now (confirmed by a repo-wide
 * grep as part of the CRM/Marketing enhancement audit) — this is its first
 * real consumer, matching the request's own "do not introduce a completely
 * new notification architecture if an existing one can be reused" instruction.
 * In-app only (`channel` defaults to `IN_APP`) — no email/SMS delivery exists
 * in this project, so `EMAIL`/`SMS` stay reserved enum values, not wired.
 */
export interface CreateNotificationInput {
  companyId: string;
  userId: string;
  title: string;
  body: string;
  relatedModule?: RelatedModule;
  relatedRecordId?: string;
  channel?: NotificationChannel;
}

/** `db` lets a caller write the notification inside its own transaction (CRM activity reminders / assignments). */
export async function createNotification(input: CreateNotificationInput, db: Prisma.TransactionClient | typeof prisma = prisma) {
  return db.notification.create({
    data: {
      companyId: input.companyId,
      userId: input.userId,
      title: input.title,
      body: input.body,
      relatedModule: input.relatedModule,
      relatedRecordId: input.relatedRecordId,
      channel: input.channel ?? "IN_APP",
    },
  });
}

export async function listNotifications(companyId: string, userId: string, options: { unreadOnly?: boolean } = {}) {
  return prisma.notification.findMany({
    where: { companyId, userId, ...(options.unreadOnly ? { isRead: false } : {}) },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

export async function getUnreadNotificationCount(companyId: string, userId: string) {
  return prisma.notification.count({ where: { companyId, userId, isRead: false } });
}

export async function markNotificationRead(companyId: string, userId: string, id: string) {
  const result = await prisma.notification.updateMany({ where: { id, companyId, userId }, data: { isRead: true } });
  if (result.count === 0) throw new BusinessRuleError("NOT_FOUND", "Notification not found.", { id });
}

export async function markAllNotificationsRead(companyId: string, userId: string) {
  await prisma.notification.updateMany({ where: { companyId, userId, isRead: false }, data: { isRead: true } });
}
