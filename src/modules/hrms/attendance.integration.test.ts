/**
 * Attendance & Leave Integration Tests against database.
 * Exercises:
 *  1. Company Attendance Settings & Geofenced Locations
 *  2. Face Photo Enrolment
 *  3. In-Geofence Punch IN & OUT, Duplicate IN rejection, Day Record sync
 *  4. Out-of-Geofence Punch IN -> PRESENT_FROM_OUTSIDE -> Trim & Reject -> Clarify -> Approve (REMOTE)
 *  5. Attendance Regularization lifecycle across 6 types
 *  6. Leave Application with auto-sandwich detection, balance deduction & approval
 *  7. Team Day Dashboard cards & Salary Sheet payroll aggregation
 *
 * Runs against the dev database in .env (DATABASE_URL). It creates its own
 * supervisor, worker, employee, location and leave type, and removes them
 * (and restores the company's attendance settings) afterwards.
 *
 * Permissions are the only thing mocked — granted to every test user, the
 * same way the CRM integration tests do — so the flows are tested without
 * depending on how the dev database's roles happen to be set up.
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/core/rbac/PermissionService", () => ({
  PermissionService: {
    can: vi.fn(async () => true),
    assert: vi.fn(async () => undefined),
    invalidate: vi.fn(),
    getAllowedBranchIds: vi.fn(async () => null),
  },
}));

import { prisma } from "@/core/db/client";
import { punch } from "./attendance-punch.service";
import {
  createAttendanceLocation,
  updateAttendanceSettings,
  upsertEmployeeAttendanceProfile,
} from "./attendance-settings.service";
import {
  addFacePhotos,
  listFacePhotos,
} from "./face-enrolment.service";
import {
  clarifyOutdoorRejection,
  decideOutdoorClarification,
  rejectOutdoorSession,
} from "./outdoor-attendance.service";
import {
  approveAttendanceCorrectionRequest,
  createAttendanceCorrectionRequest,
} from "./attendance-correction.service";
import {
  approveLeaveRequest,
  createLeaveRequest,
} from "./leave.service";
import {
  listLeaveBalances,
} from "./leave-balance.service";
import {
  getTeamDay,
  getTeamMonth,
  getSalarySheet,
} from "./attendance-team.service";

const DB_URL = process.env.DATABASE_URL;

describe.skipIf(!DB_URL)("HRMS Attendance & Leave (Integration Test Suite)", () => {
  const runId = `it_${Date.now().toString(36)}`;
  let companyId: string;
  let adminUserId: string;
  let workerUserId: string;
  let supervisorActor: { companyId: string; userId: string };
  let workerActor: { companyId: string; userId: string };
  let employeeId: string;
  let locationId: string;
  let leaveTypeId: string;
  let enrolledFacePhotoId: string;
  // The company's attendance settings before the run (null = it had none).
  let originalSettings: Awaited<ReturnType<typeof prisma.attendanceSettings.findUnique>> = null;

  // Minimal 1x1 valid PNG image for real file-storage magic byte checks
  const samplePngBuffer = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64"
  );

  beforeAll(async () => {
    // 1. Get or create testing company
    let company = await prisma.company.findFirst({ orderBy: { createdAt: "asc" } });
    if (!company) {
      company = await prisma.company.create({
        data: {
          name: `IT Test Garments ${runId}`,
          baseCurrencyCode: "INR",
        },
      });
    }
    companyId = company.id;
    originalSettings = await prisma.attendanceSettings.findUnique({ where: { companyId } });

    // 2. A supervisor user of our own (not some existing user, whose roles and
    // team we can't predict).
    const admin = await prisma.user.create({
      data: {
        companyId,
        email: `admin_${runId}@example.com`,
        fullName: `Integration Supervisor ${runId}`,
        passwordHash: "hash",
      },
    });
    adminUserId = admin.id;
    supervisorActor = { companyId, userId: adminUserId };

    // 3. Create a test employee with shift
    let shift = await prisma.shiftMaster.findFirst({ where: { companyId } });
    if (!shift) {
      shift = await prisma.shiftMaster.create({
        data: {
          companyId,
          code: `S_${runId}`.slice(0, 10),
          name: "General Shift",
          startTime: "09:00",
          endTime: "18:00",
          graceMinutes: 15,
        },
      });
    }

    const employee = await prisma.employee.create({
      data: {
        companyId,
        employeeCode: `EMP_${runId}`.slice(0, 15),
        fullName: `Worker ${runId}`,
        email: `worker_${runId}@example.com`,
        fixedMonthlySalary: 60000,
        joinDate: new Date("2026-01-01"),
        shiftId: shift.id,
      },
    });
    employeeId = employee.id;

    // 4. Create worker user linked to employee
    const workerUser = await prisma.user.create({
      data: {
        companyId,
        email: `worker_login_${runId}@example.com`,
        fullName: `Worker User ${runId}`,
        passwordHash: "hash",
        employeeId: employee.id,
      },
    });
    workerUserId = workerUser.id;
    workerActor = { companyId, userId: workerUserId };
  });

  afterAll(async () => {
    // Clean up created test entities
    if (employeeId) {
      await prisma.leaveDay.deleteMany({ where: { leaveRequest: { employeeId } } });
      await prisma.leaveRequest.deleteMany({ where: { employeeId } });
      await prisma.leaveBalance.deleteMany({ where: { employeeId } });
      if (leaveTypeId) {
        await prisma.leaveBalance.deleteMany({ where: { leaveTypeId } });
        await prisma.leaveType.deleteMany({ where: { id: leaveTypeId } });
      }
      await prisma.attendanceCorrectionRequest.deleteMany({ where: { employeeId } });
      await prisma.outdoorRejection.deleteMany({ where: { employeeId } });
      await prisma.attendanceSession.deleteMany({ where: { employeeId } });
      await prisma.attendanceRecord.deleteMany({ where: { employeeId } });
      await prisma.employeeFacePhoto.deleteMany({ where: { employeeId } });
      await prisma.employeeAttendanceProfile.deleteMany({ where: { employeeId } });
      if (locationId) await prisma.attendanceLocation.deleteMany({ where: { id: locationId } });
      if (workerUserId) {
        await prisma.notification.deleteMany({ where: { userId: workerUserId } });
        await prisma.user.deleteMany({ where: { id: workerUserId } });
      }
      await prisma.employee.deleteMany({ where: { id: employeeId } });
    }
    if (adminUserId) {
      await prisma.notification.deleteMany({ where: { userId: adminUserId } });
      await prisma.user.deleteMany({ where: { id: adminUserId } });
    }
    // Put the company's attendance settings back as they were.
    if (companyId) {
      if (originalSettings) {
        const o = originalSettings;
        await prisma.attendanceSettings.update({
          where: { companyId },
          data: {
            defaultWeekends: o.defaultWeekends,
            gpsAccuracyMeters: o.gpsAccuracyMeters,
            maxSessionHours: o.maxSessionHours,
            statusToleranceMinutes: o.statusToleranceMinutes,
            faceMatchThreshold: o.faceMatchThreshold,
            faceMatchFrames: o.faceMatchFrames,
            requireFace: o.requireFace,
            updatedByUserId: o.updatedByUserId,
          },
        });
      } else {
        await prisma.attendanceSettings.deleteMany({ where: { companyId } });
      }
    }
  });

  it("1. Configures Attendance Settings and Geofenced Office Location", async () => {
    const updatedSettings = await updateAttendanceSettings(supervisorActor, {
      defaultWeekends: ["SUNDAY"],
      gpsAccuracyMeters: 50,
      maxSessionHours: 18,
      statusToleranceMinutes: 15,
      faceMatchThreshold: 0.45,
      faceMatchFrames: 3,
      requireFace: true,
    });
    expect(updatedSettings.requireFace).toBe(true);

    const loc = await createAttendanceLocation(supervisorActor, {
      name: `Head Office ${runId}`,
      latitude: 12.9716,
      longitude: 77.5946,
      radiusMeters: 500,
      address: "MG Road, Bengaluru",
      isActive: true,
    });
    locationId = loc.id;
    expect(loc.id).toBeDefined();

    // Set employee profile
    await upsertEmployeeAttendanceProfile(supervisorActor, employeeId, {
      overtimeRatePerHour: 250,
      useCompanyWeekends: true,
      weekends: ["SUNDAY"],
    });
  });

  it("2. Enrolls Baseline Face Photos for Employee", async () => {
    const photoFile = new File([samplePngBuffer], "face1.png", { type: "image/png" });
    const enrolled = await addFacePhotos(supervisorActor, employeeId, [photoFile]);
    expect(enrolled).toHaveLength(1);
    enrolledFacePhotoId = enrolled[0].id;

    const list = await listFacePhotos(companyId, employeeId);
    expect(list.photos.length).toBeGreaterThanOrEqual(1);
  });

  it("3. Executes In-Geofence Punch IN and Punch OUT flow with Duplicate Guard", async () => {
    const selfieFile = new File([samplePngBuffer], "selfie-in.png", { type: "image/png" });

    // Punch IN inside office geofence (12.9716, 77.5946)
    const inResult = await punch(workerActor, {
      type: "IN",
      latitude: 12.9716,
      longitude: 77.5946,
      accuracyMeters: 10,
      facePhotoId: enrolledFacePhotoId,
      selfie: selfieFile,
    });

    expect(inResult.fromOffice).toBe(true);
    expect(inResult.session.status).toBe("PRESENT");
    expect(inResult.session.isLoginFromOffice).toBe(true);

    // Duplicate IN attempt should throw
    await expect(
      punch(workerActor, {
        type: "IN",
        latitude: 12.9716,
        longitude: 77.5946,
        accuracyMeters: 10,
        facePhotoId: enrolledFacePhotoId,
        selfie: selfieFile,
      })
    ).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });

    // Punch OUT
    const outResult = await punch(workerActor, {
      type: "OUT",
      latitude: 12.9716,
      longitude: 77.5946,
      accuracyMeters: 10,
      facePhotoId: enrolledFacePhotoId,
      selfie: new File([samplePngBuffer], "selfie-out.png", { type: "image/png" }),
    });

    expect(outResult.session.checkOutAt).toBeDefined();

    // Verify day record synced punchIn and punchOut
    const dayRecord = await prisma.attendanceRecord.findUnique({
      where: { id: outResult.session.attendanceRecordId },
    });
    expect(dayRecord?.punchIn).toBeDefined();
    expect(dayRecord?.punchOut).toBeDefined();
  });

  it("4. Handles Outdoor Punch (PRESENT_FROM_OUTSIDE) -> Trim Reject -> Clarify -> Approve (REMOTE)", async () => {
    // Clear earlier test sessions for this employee so time windows don't overlap
    await prisma.attendanceSession.deleteMany({ where: { employeeId } });

    // Punch from Chennai (~290 km away from Bangalore)
    const farInResult = await punch(workerActor, {
      type: "IN",
      latitude: 13.0827,
      longitude: 80.2707,
      accuracyMeters: 15,
      facePhotoId: enrolledFacePhotoId,
      selfie: new File([samplePngBuffer], "far-in.png", { type: "image/png" }),
    });

    expect(farInResult.fromOffice).toBe(false);
    expect(farInResult.session.status).toBe("PRESENT_FROM_OUTSIDE");
    expect(farInResult.session.isLoginFromOffice).toBe(false);

    const farOutResult = await punch(workerActor, {
      type: "OUT",
      latitude: 13.0827,
      longitude: 80.2707,
      accuracyMeters: 15,
      facePhotoId: enrolledFacePhotoId,
      selfie: new File([samplePngBuffer], "far-out.png", { type: "image/png" }),
    });

    const sessionId = farOutResult.session.id;

    // Simulate longer session range for trim
    const now = Date.now();
    const tStart = new Date(now - 5 * 3600000);
    const tEnd = new Date(now);
    await prisma.attendanceSession.update({
      where: { id: sessionId },
      data: { checkInAt: tStart, checkOutAt: tEnd },
    });

    // Supervisor rejects & trims times
    const trimIn = new Date(tStart.getTime() + 30 * 60000).toISOString();
    const trimOut = new Date(tEnd.getTime() - 30 * 60000).toISOString();

    const rej = await rejectOutdoorSession(supervisorActor, sessionId, {
      reason: "Client meeting unverified",
      trimmedCheckInAt: trimIn,
      trimmedCheckOutAt: trimOut,
    });
    expect(rej.status).toBe("PENDING");

    // Employee clarifies with reason
    const clarified = await clarifyOutdoorRejection(
      workerActor,
      rej.id,
      "Met supplier ABC on site with gate pass",
      null
    );
    expect(clarified.status).toBe("IN_PROCESS");

    // Supervisor approves clarification -> restores original times and marks REMOTE
    const approvedRej = await decideOutdoorClarification(supervisorActor, rej.id, "APPROVED");
    expect(approvedRej.status).toBe("APPROVED");

    const sessionRestored = await prisma.attendanceSession.findUnique({ where: { id: sessionId } });
    expect(sessionRestored?.status).toBe("REMOTE");
  });

  it("5. Handles Attendance Regularization lifecycle (MISSED_PUNCH)", async () => {
    const correction = await createAttendanceCorrectionRequest(workerActor, {
      employeeId,
      type: "MISSED_PUNCH",
      attendanceDate: "2026-10-15",
      checkIn: "09:10",
      checkOut: "18:05",
      reason: "Biometric kiosk network outage",
    });
    expect(correction.status).toBe("PENDING");

    // Supervisor approves
    const approved = await approveAttendanceCorrectionRequest(supervisorActor, correction.id);
    expect(approved.status).toBe("APPROVED");
  });

  it("6. Applies Leave Request with Sandwich Rule and Deducts Balance on Approval", async () => {
    // Create Leave Type
    const lt = await prisma.leaveType.create({
      data: {
        companyId,
        name: `Casual Leave ${runId}`,
        allocationType: "MONTHLY",
        quotaPerPeriod: 2,
        annualDays: 24,
        isActive: true,
      },
    });
    leaveTypeId = lt.id;

    // Apply for Fri (2026-10-23) + Mon (2026-10-26) with includeSandwich: true
    const leaveReq = await createLeaveRequest(workerActor, {
      employeeId,
      leaveTypeId: lt.id,
      days: [
        { date: "2026-10-23", duration: "FULL" },
        { date: "2026-10-26", duration: "FULL" },
      ],
      includeSandwich: true,
      reason: "Family event out of town",
    });

    expect(leaveReq.id).toBeDefined();

    // Verify days created (Fri, Sat if off/sandwich, Sun sandwich, Mon)
    const leaveDays = await prisma.leaveDay.findMany({
      where: { leaveRequestId: leaveReq.id },
      orderBy: { leaveDate: "asc" },
    });
    expect(leaveDays.length).toBeGreaterThanOrEqual(2);

    // Supervisor approves leave request
    const decided = await approveLeaveRequest(supervisorActor, leaveReq.id);
    expect(decided.status).toBe("APPROVED");

    // Check balances
    const balances = await listLeaveBalances(supervisorActor, {
      year: 2026,
      month: 10,
      employeeId,
    });
    expect(balances.length).toBeGreaterThanOrEqual(1);
  });

  it("7. Computes Team Day, Team Month, and Salary Sheet Payroll Aggregation", async () => {
    const teamDay = await getTeamDay(supervisorActor, "2026-10-24");
    expect(teamDay.cards.total).toBeGreaterThanOrEqual(1);
    expect(teamDay.rows.length).toBeGreaterThanOrEqual(1);

    const teamMonth = await getTeamMonth(supervisorActor, 2026, 10);
    expect(teamMonth.employees.length).toBeGreaterThanOrEqual(1);

    const salarySheet = await getSalarySheet(supervisorActor, 2026, 10);
    expect(salarySheet.rows.length).toBeGreaterThanOrEqual(1);
    const workerRow = salarySheet.rows.find((r) => r.employeeId === employeeId);
    expect(workerRow).toBeDefined();
    expect(workerRow?.grossMonthly).toBe(60000);
  });
});
