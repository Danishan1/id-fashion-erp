import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/db/client", () => {
  const p = {
    employee: { findMany: vi.fn() },
    holidayMaster: { findMany: vi.fn() },
    attendanceRecord: { findMany: vi.fn() },
    leaveDay: { findMany: vi.fn() },
    leaveRequest: { findMany: vi.fn() },
    overtimeRecord: { findMany: vi.fn() },
    attendanceSettings: { findUnique: vi.fn() },
  };
  return { prisma: p };
});

const { prisma } = await import("@/core/db/client");
const { computeEmployeesMonth } = await import("./attendance-month.service");

beforeEach(() => {
  vi.mocked(prisma.attendanceSettings.findUnique).mockReset().mockResolvedValue({
    defaultWeekends: ["SUNDAY"],
    maxSessionHours: 18,
    statusToleranceMinutes: 15,
  } as never);
  vi.mocked(prisma.holidayMaster.findMany).mockReset().mockResolvedValue([]);
  vi.mocked(prisma.attendanceRecord.findMany).mockReset().mockResolvedValue([]);
  vi.mocked(prisma.leaveDay.findMany).mockReset().mockResolvedValue([]);
  vi.mocked(prisma.leaveRequest.findMany).mockReset().mockResolvedValue([]);
  vi.mocked(prisma.overtimeRecord.findMany).mockReset().mockResolvedValue([]);
});

describe("attendance-month.service (month engine)", () => {
  const baseEmployee = {
    id: "emp-1",
    employeeCode: "EMP001",
    fullName: "Asha Rao",
    joinDate: new Date("2026-01-01T00:00:00Z"),
    fixedMonthlySalary: 30000,
    travelAllowance: 0,
    dearnessAllowance: 0,
    shift: { name: "General", startTime: "09:00", endTime: "17:00", graceMinutes: 15 }, // 8 h shift
    attendanceProfile: { useCompanyWeekends: true, weekends: ["SUNDAY"], overtimeRatePerHour: 150 },
  };

  it("calculates status bands: FULL, SEMI, HALF, LOW based on worked hours vs shift hours with 15m tolerance", async () => {
    vi.mocked(prisma.employee.findMany).mockResolvedValue([baseEmployee] as never);

    // 8 h shift:
    // FULL: >= 8h - 15m = 7h 45m = 7.75h (e.g. 7.8h)
    // SEMI: >= 6h - 15m = 5.75h (e.g. 6.0h)
    // HALF: >= 4h - 15m = 3.75h (e.g. 4.0h)
    // LOW: < 3.75h (e.g. 2.0h)
    vi.mocked(prisma.attendanceRecord.findMany).mockResolvedValue([
      {
        employeeId: "emp-1",
        attendanceDate: new Date("2026-09-01T00:00:00Z"), // Tuesday
        sessions: [
          {
            id: "s-1",
            checkInAt: new Date("2026-09-01T03:30:00Z"), // 09:00 IST
            checkOutAt: new Date("2026-09-01T11:20:00Z"), // 16:50 IST = 7h 50m = 7.83h -> FULL
            status: "PRESENT",
            isLoginFromOffice: true,
            isLogoutFromOffice: true,
          },
        ],
      },
      {
        employeeId: "emp-1",
        attendanceDate: new Date("2026-09-02T00:00:00Z"), // Wednesday
        sessions: [
          {
            id: "s-2",
            checkInAt: new Date("2026-09-02T03:30:00Z"),
            checkOutAt: new Date("2026-09-02T09:30:00Z"), // 6h -> SEMI
            status: "PRESENT",
            isLoginFromOffice: true,
            isLogoutFromOffice: true,
          },
        ],
      },
      {
        employeeId: "emp-1",
        attendanceDate: new Date("2026-09-03T00:00:00Z"), // Thursday
        sessions: [
          {
            id: "s-3",
            checkInAt: new Date("2026-09-03T03:30:00Z"),
            checkOutAt: new Date("2026-09-03T07:30:00Z"), // 4h -> HALF
            status: "PRESENT",
            isLoginFromOffice: true,
            isLogoutFromOffice: true,
          },
        ],
      },
      {
        employeeId: "emp-1",
        attendanceDate: new Date("2026-09-04T00:00:00Z"), // Friday
        sessions: [
          {
            id: "s-4",
            checkInAt: new Date("2026-09-04T03:30:00Z"),
            checkOutAt: new Date("2026-09-04T05:30:00Z"), // 2h -> LOW
            status: "PRESENT",
            isLoginFromOffice: true,
            isLogoutFromOffice: true,
          },
        ],
      },
    ] as never);

    const now = new Date("2026-09-30T23:59:59Z");
    const [result] = await computeEmployeesMonth("co-1", ["emp-1"], 2026, 9, now);

    const d1 = result.days.find((d) => d.dateKey === "2026-09-01")!;
    expect(d1.band).toBe("FULL");
    expect(d1.present).toBe(1);
    expect(d1.code).toBe("P");

    const d2 = result.days.find((d) => d.dateKey === "2026-09-02")!;
    expect(d2.band).toBe("SEMI");
    expect(d2.present).toBe(0.75);
    expect(d2.code).toBe("SP");

    const d3 = result.days.find((d) => d.dateKey === "2026-09-03")!;
    expect(d3.band).toBe("HALF");
    expect(d3.present).toBe(0.5);
    expect(d3.code).toBe("HP");

    const d4 = result.days.find((d) => d.dateKey === "2026-09-04")!;
    expect(d4.band).toBe("LOW");
    expect(d4.present).toBe(0);
    expect(d4.code).toBe("LH");
  });

  it("handles work on weekly off or holiday as extra payable", async () => {
    vi.mocked(prisma.employee.findMany).mockResolvedValue([baseEmployee] as never);
    // 2026-09-06 is Sunday (weekly off)
    vi.mocked(prisma.attendanceRecord.findMany).mockResolvedValue([
      {
        employeeId: "emp-1",
        attendanceDate: new Date("2026-09-06T00:00:00Z"),
        sessions: [
          {
            id: "s-sun",
            checkInAt: new Date("2026-09-06T03:30:00Z"),
            checkOutAt: new Date("2026-09-06T11:30:00Z"), // 8h worked
            status: "PRESENT",
            isLoginFromOffice: true,
            isLogoutFromOffice: true,
          },
        ],
      },
    ] as never);

    const now = new Date("2026-09-30T23:59:59Z");
    const [result] = await computeEmployeesMonth("co-1", ["emp-1"], 2026, 9, now);
    const sun = result.days.find((d) => d.dateKey === "2026-09-06")!;

    expect(sun.isWeekend).toBe(true);
    expect(sun.paidOff).toBe(1);
    expect(sun.extraPayable).toBe(1); // worked full shift on off day
    expect(sun.code).toBe("W");
  });

  it("applies sandwich rule: weekly off between two absent or full leave days is marked absent (S)", async () => {
    vi.mocked(prisma.employee.findMany).mockResolvedValue([baseEmployee] as never);
    // 2026-09-05 Saturday (absent, no punch)
    // 2026-09-06 Sunday (weekly off)
    // 2026-09-07 Monday (absent, no punch)
    const now = new Date("2026-09-30T23:59:59Z");
    const [result] = await computeEmployeesMonth("co-1", ["emp-1"], 2026, 9, now);

    const sat = result.days.find((d) => d.dateKey === "2026-09-05")!;
    const sun = result.days.find((d) => d.dateKey === "2026-09-06")!;
    const mon = result.days.find((d) => d.dateKey === "2026-09-07")!;

    expect(sat.absent).toBe(1);
    expect(mon.absent).toBe(1);

    expect(sun.isSandwich).toBe(true);
    expect(sun.paidOff).toBe(0);
    expect(sun.absent).toBe(1);
    expect(sun.code).toBe("S");
  });

  it("combines half-day leave with half-day worked hours", async () => {
    vi.mocked(prisma.employee.findMany).mockResolvedValue([baseEmployee] as never);
    // 2026-09-01: 0.5 paid leave + 4h worked (half day)
    vi.mocked(prisma.leaveDay.findMany).mockResolvedValue([
      {
        employeeId: "emp-1",
        leaveDate: new Date("2026-09-01T00:00:00Z"),
        fraction: 0.5,
        paymentType: "PAID",
        durationType: "F_HALF",
        leaveRequest: { leaveType: { name: "Casual Leave" } },
      },
    ] as never);
    vi.mocked(prisma.attendanceRecord.findMany).mockResolvedValue([
      {
        employeeId: "emp-1",
        attendanceDate: new Date("2026-09-01T00:00:00Z"),
        sessions: [
          {
            id: "s-1",
            checkInAt: new Date("2026-09-01T08:00:00Z"),
            checkOutAt: new Date("2026-09-01T12:00:00Z"), // 4h
            status: "PRESENT",
            isLoginFromOffice: true,
            isLogoutFromOffice: true,
          },
        ],
      },
    ] as never);

    const now = new Date("2026-09-30T23:59:59Z");
    const [result] = await computeEmployeesMonth("co-1", ["emp-1"], 2026, 9, now);
    const d1 = result.days.find((d) => d.dateKey === "2026-09-01")!;

    expect(d1.leaveFraction).toBe(0.5);
    expect(d1.paidLeaveFraction).toBe(0.5);
    expect(d1.present).toBe(0.5); // 4h worked covers 0.5
    expect(d1.absent).toBe(0); // 0.5 leave + 0.5 present = 1 (0 absent)
  });
});
