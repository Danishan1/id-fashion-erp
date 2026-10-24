import { logger } from "@/core/logging/logger";
import { recalculateOvertimeForDay } from "./overtime.service";

/**
 * Runs after any change to an employee-day's sessions (punch out, admin
 * correction, regularization, outdoor trim/restore). The old system queued
 * this on punch-out; here it runs straight after the commit (same formula),
 * so overtime never waits on a background worker. Never fails the caller.
 */
export async function onAttendanceDayChanged(companyId: string, employeeId: string, dateKey: string) {
  try {
    await recalculateOvertimeForDay(companyId, employeeId, dateKey);
  } catch (error) {
    logger.error("Overtime recalculation failed", { companyId, employeeId, dateKey, error });
  }
}
