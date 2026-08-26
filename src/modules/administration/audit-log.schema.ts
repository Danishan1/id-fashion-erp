import { z } from "zod";
import { AuditAction } from "@prisma/client";

export const auditLogListFiltersSchema = z.object({
  tableName: z.string().max(100).optional(),
  action: z.nativeEnum(AuditAction).optional(),
  userId: z.string().uuid().optional(),
  recordId: z.string().uuid().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});

export type AuditLogListFiltersInput = z.infer<typeof auditLogListFiltersSchema>;
