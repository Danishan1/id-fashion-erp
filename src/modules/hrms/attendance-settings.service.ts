import type { AttendanceWeekday, Prisma } from "@prisma/client";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import {
  DEFAULT_MAX_SESSION_HOURS,
  DEFAULT_STATUS_TOLERANCE_MINUTES,
  type Weekday,
} from "./attendance-calculator";
import type {
  AttendanceLocationInput,
  EmployeeAttendanceProfileInput,
  UpdateAttendanceSettingsInput,
} from "./attendance-settings.schema";

export interface HrmsActor {
  companyId: string;
  userId: string;
}

export interface EffectiveAttendanceSettings {
  defaultWeekends: Weekday[];
  gpsAccuracyMeters: number;
  maxSessionHours: number;
  statusToleranceMinutes: number;
  faceMatchThreshold: number;
  faceMatchFrames: number;
  requireFace: boolean;
}

/** The old system's fixed values — used until a company saves its own. */
export const DEFAULT_ATTENDANCE_SETTINGS: EffectiveAttendanceSettings = {
  defaultWeekends: ["SUNDAY"],
  gpsAccuracyMeters: 50,
  maxSessionHours: DEFAULT_MAX_SESSION_HOURS,
  statusToleranceMinutes: DEFAULT_STATUS_TOLERANCE_MINUTES,
  faceMatchThreshold: 0.45,
  faceMatchFrames: 3,
  requireFace: true,
};

export async function getAttendanceSettings(companyId: string): Promise<EffectiveAttendanceSettings> {
  const row = await prisma.attendanceSettings.findUnique({ where: { companyId } });
  if (!row) return { ...DEFAULT_ATTENDANCE_SETTINGS };
  return {
    defaultWeekends: row.defaultWeekends as Weekday[],
    gpsAccuracyMeters: row.gpsAccuracyMeters,
    maxSessionHours: row.maxSessionHours,
    statusToleranceMinutes: row.statusToleranceMinutes,
    faceMatchThreshold: Number(row.faceMatchThreshold),
    faceMatchFrames: row.faceMatchFrames,
    requireFace: row.requireFace,
  };
}

export async function updateAttendanceSettings(actor: HrmsActor, input: UpdateAttendanceSettingsInput) {
  const before = await getAttendanceSettings(actor.companyId);
  const data = {
    defaultWeekends: input.defaultWeekends as AttendanceWeekday[],
    gpsAccuracyMeters: input.gpsAccuracyMeters,
    maxSessionHours: input.maxSessionHours,
    statusToleranceMinutes: input.statusToleranceMinutes,
    faceMatchThreshold: input.faceMatchThreshold,
    faceMatchFrames: input.faceMatchFrames,
    requireFace: input.requireFace,
    updatedByUserId: actor.userId,
  };
  const row = await prisma.attendanceSettings.upsert({
    where: { companyId: actor.companyId },
    create: { companyId: actor.companyId, ...data },
    update: data,
  });
  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "hrms_attendance_settings",
    recordId: row.id,
    action: "UPDATE",
    oldValues: { ...before },
    newValues: { ...input },
  });
  return getAttendanceSettings(actor.companyId);
}

/** Old "set weekends for everyone": company default + every employee back on it. */
export async function applyWeekendsToAll(actor: HrmsActor, weekends: Weekday[]) {
  const current = await getAttendanceSettings(actor.companyId);
  await prisma.$transaction(async (tx) => {
    const row = await tx.attendanceSettings.upsert({
      where: { companyId: actor.companyId },
      create: { companyId: actor.companyId, defaultWeekends: weekends as AttendanceWeekday[], updatedByUserId: actor.userId },
      update: { defaultWeekends: weekends as AttendanceWeekday[], updatedByUserId: actor.userId },
    });
    const updated = await tx.employeeAttendanceProfile.updateMany({
      where: { companyId: actor.companyId },
      data: { useCompanyWeekends: true },
    });
    await writeAuditLog(
      {
        companyId: actor.companyId,
        userId: actor.userId,
        tableName: "hrms_attendance_settings",
        recordId: row.id,
        action: "UPDATE",
        oldValues: { defaultWeekends: current.defaultWeekends },
        newValues: { defaultWeekends: weekends, appliedToAllEmployees: true, profilesReset: updated.count },
      },
      tx
    );
  });
  return getAttendanceSettings(actor.companyId);
}

// ─── Office locations (geofence) ─────────────────────────────

export function listAttendanceLocations(companyId: string, options: { activeOnly?: boolean } = {}) {
  return prisma.attendanceLocation.findMany({
    where: { companyId, ...(options.activeOnly ? { isActive: true } : {}) },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
  });
}

async function assertBranch(companyId: string, branchId: string | null) {
  if (!branchId) return;
  const branch = await prisma.branch.findFirst({ where: { id: branchId, companyId }, select: { id: true } });
  if (!branch) throw new BusinessRuleError("NOT_FOUND", "Branch not found.", { id: branchId });
}

function locationData(input: AttendanceLocationInput) {
  return {
    name: input.name,
    code: input.code || null,
    latitude: input.latitude,
    longitude: input.longitude,
    radiusMeters: input.radiusMeters,
    address: input.address || null,
    branchId: input.branchId || null,
  };
}

async function assertUniqueName(companyId: string, name: string, excludeId?: string) {
  const dup = await prisma.attendanceLocation.findFirst({
    where: { companyId, name: { equals: name, mode: "insensitive" }, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true },
  });
  if (dup) throw new BusinessRuleError("VALIDATION_ERROR", `An office location named "${name}" already exists.`);
}

export async function createAttendanceLocation(actor: HrmsActor, input: AttendanceLocationInput) {
  const data = locationData(input);
  if (data.latitude === 0 && data.longitude === 0) throw new BusinessRuleError("VALIDATION_ERROR", "Latitude and longitude can't both be 0.");
  await assertBranch(actor.companyId, data.branchId);
  await assertUniqueName(actor.companyId, data.name);
  const row = await prisma.attendanceLocation.create({ data: { companyId: actor.companyId, ...data, isActive: input.isActive ?? true } });
  await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: "hrms_attendance_locations", recordId: row.id, action: "CREATE", newValues: { ...data } });
  return row;
}

export async function updateAttendanceLocation(actor: HrmsActor, id: string, input: AttendanceLocationInput) {
  const existing = await prisma.attendanceLocation.findFirst({ where: { id, companyId: actor.companyId } });
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Office location not found.", { id });
  const data = locationData(input);
  if (data.latitude === 0 && data.longitude === 0) throw new BusinessRuleError("VALIDATION_ERROR", "Latitude and longitude can't both be 0.");
  await assertBranch(actor.companyId, data.branchId);
  await assertUniqueName(actor.companyId, data.name, id);
  const row = await prisma.attendanceLocation.update({
    where: { id },
    data: { ...data, ...(input.isActive === undefined ? {} : { isActive: input.isActive }) },
  });
  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "hrms_attendance_locations",
    recordId: id,
    action: "UPDATE",
    oldValues: { name: existing.name, latitude: existing.latitude, longitude: existing.longitude, radiusMeters: existing.radiusMeters, isActive: existing.isActive },
    newValues: { ...data, isActive: input.isActive },
  });
  return row;
}

export async function setAttendanceLocationActive(actor: HrmsActor, id: string, isActive: boolean) {
  const existing = await prisma.attendanceLocation.findFirst({ where: { id, companyId: actor.companyId } });
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Office location not found.", { id });
  const row = await prisma.attendanceLocation.update({ where: { id }, data: { isActive } });
  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "hrms_attendance_locations",
    recordId: id,
    action: "UPDATE",
    oldValues: { isActive: existing.isActive },
    newValues: { isActive },
  });
  return row;
}

// ─── Per-employee attendance profile ────────────────────────

export function effectiveWeekends(settings: Pick<EffectiveAttendanceSettings, "defaultWeekends">, profile: { useCompanyWeekends: boolean; weekends: string[] } | null | undefined): Weekday[] {
  if (!profile || profile.useCompanyWeekends) return settings.defaultWeekends;
  return profile.weekends as Weekday[];
}

/** Every active employee with their attendance profile, shift and face enrolment count. */
export async function listEmployeeAttendanceProfiles(companyId: string, search?: string) {
  const where: Prisma.EmployeeWhereInput = {
    companyId,
    isActive: true,
    deletedAt: null,
    ...(search
      ? { OR: [{ fullName: { contains: search, mode: "insensitive" } }, { employeeCode: { contains: search, mode: "insensitive" } }] }
      : {}),
  };
  const [settings, employees] = await Promise.all([
    getAttendanceSettings(companyId),
    prisma.employee.findMany({
      where,
      orderBy: { fullName: "asc" },
      select: {
        id: true,
        employeeCode: true,
        fullName: true,
        user: { select: { id: true } },
        shift: { select: { id: true, name: true, startTime: true, endTime: true, graceMinutes: true } },
        attendanceProfile: true,
        _count: { select: { facePhotos: true } },
      },
    }),
  ]);
  return employees.map((e) => ({
    id: e.id,
    employeeCode: e.employeeCode,
    fullName: e.fullName,
    hasLogin: !!e.user,
    shift: e.shift,
    facePhotoCount: e._count.facePhotos,
    useCompanyWeekends: e.attendanceProfile?.useCompanyWeekends ?? true,
    weekends: (e.attendanceProfile?.weekends as Weekday[] | undefined) ?? [],
    effectiveWeekends: effectiveWeekends(settings, e.attendanceProfile),
    overtimeRatePerHour: e.attendanceProfile?.overtimeRatePerHour ? Number(e.attendanceProfile.overtimeRatePerHour) : null,
  }));
}

export async function upsertEmployeeAttendanceProfile(actor: HrmsActor, employeeId: string, input: EmployeeAttendanceProfileInput) {
  const employee = await prisma.employee.findFirst({ where: { id: employeeId, companyId: actor.companyId, deletedAt: null }, select: { id: true } });
  if (!employee) throw new BusinessRuleError("NOT_FOUND", "Employee not found.", { id: employeeId });
  const existing = await prisma.employeeAttendanceProfile.findUnique({ where: { employeeId } });
  const data = {
    useCompanyWeekends: input.useCompanyWeekends,
    weekends: input.weekends as AttendanceWeekday[],
    overtimeRatePerHour: input.overtimeRatePerHour ?? null,
  };
  const row = await prisma.employeeAttendanceProfile.upsert({
    where: { employeeId },
    create: { companyId: actor.companyId, employeeId, ...data },
    update: data,
  });
  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "hrms_employee_attendance_profiles",
    recordId: row.id,
    action: existing ? "UPDATE" : "CREATE",
    oldValues: existing
      ? { useCompanyWeekends: existing.useCompanyWeekends, weekends: existing.weekends, overtimeRatePerHour: existing.overtimeRatePerHour?.toString() ?? null }
      : null,
    newValues: { ...input },
  });
  return row;
}

/** Employees the caller can see in HRMS (self + team, or everyone with view_all) — for pickers. */
export async function listScopedEmployees(actor: HrmsActor) {
  const { getHrmsEmployeeScope } = await import("./hrms-scope");
  const scope = await getHrmsEmployeeScope(actor.userId, "hrms_attendance");
  return prisma.employee.findMany({
    where: { companyId: actor.companyId, deletedAt: null, isActive: true, ...(scope === null ? {} : { id: { in: scope } }) },
    orderBy: { fullName: "asc" },
    select: { id: true, employeeCode: true, fullName: true },
  });
}
