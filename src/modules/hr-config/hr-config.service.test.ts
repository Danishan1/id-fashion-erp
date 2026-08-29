import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/db/client", () => ({
  prisma: {
    designation: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    employeeCategory: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    shiftMaster: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    holidayMaster: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    department: { findFirst: vi.fn() },
  },
}));

const { prisma } = await import("@/core/db/client");
const {
  createDesignation,
  updateDesignation,
  createEmployeeCategory,
  updateEmployeeCategory,
  createShiftMaster,
  updateShiftMaster,
  createHolidayMaster,
  updateHolidayMaster,
} = await import("./hr-config.service");

const actor = { companyId: "co-1", userId: "user-1" };

beforeEach(() => {
  vi.mocked(prisma.designation.findFirst).mockReset();
  vi.mocked(prisma.designation.create).mockReset().mockResolvedValue({ id: "des-1" } as never);
  vi.mocked(prisma.designation.update).mockReset().mockResolvedValue({ id: "des-1" } as never);
  vi.mocked(prisma.employeeCategory.findFirst).mockReset();
  vi.mocked(prisma.employeeCategory.create).mockReset().mockResolvedValue({ id: "cat-1" } as never);
  vi.mocked(prisma.employeeCategory.update).mockReset().mockResolvedValue({ id: "cat-1" } as never);
  vi.mocked(prisma.shiftMaster.findFirst).mockReset();
  vi.mocked(prisma.shiftMaster.create).mockReset().mockResolvedValue({ id: "shift-1" } as never);
  vi.mocked(prisma.shiftMaster.update).mockReset().mockResolvedValue({ id: "shift-1" } as never);
  vi.mocked(prisma.holidayMaster.findFirst).mockReset();
  vi.mocked(prisma.holidayMaster.create).mockReset().mockResolvedValue({ id: "hol-1" } as never);
  vi.mocked(prisma.holidayMaster.update).mockReset().mockResolvedValue({ id: "hol-1" } as never);
  vi.mocked(prisma.department.findFirst).mockReset();
});

describe("createDesignation / updateDesignation — department-wise", () => {
  it("rejects a departmentId that doesn't belong to the company", async () => {
    vi.mocked(prisma.designation.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.department.findFirst).mockResolvedValue(null);

    await expect(
      createDesignation(actor, { code: "CM", name: "Cutting Master", departmentId: "dept-other-co" } as never)
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(prisma.designation.create).not.toHaveBeenCalled();
  });

  it("accepts a valid company-scoped departmentId and stores it", async () => {
    vi.mocked(prisma.designation.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.department.findFirst).mockResolvedValue({ id: "dept-cutting", companyId: "co-1" } as never);

    await createDesignation(actor, { code: "CM", name: "Cutting Master", departmentId: "dept-cutting" } as never);

    expect(prisma.designation.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ departmentId: "dept-cutting" }) })
    );
  });

  it("allows no department at all (usable across every department)", async () => {
    vi.mocked(prisma.designation.findFirst).mockResolvedValue(null);

    await createDesignation(actor, { code: "GM", name: "General Manager" } as never);

    expect(prisma.department.findFirst).not.toHaveBeenCalled();
    expect(prisma.designation.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ departmentId: null }) })
    );
  });

  it("update re-validates a changed departmentId", async () => {
    vi.mocked(prisma.designation.findFirst).mockResolvedValue({ id: "des-1", isActive: true } as never);
    vi.mocked(prisma.department.findFirst).mockResolvedValue(null);

    await expect(
      updateDesignation(actor, "des-1", { code: "CM", name: "Cutting Master", departmentId: "dept-bad" } as never)
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(prisma.designation.update).not.toHaveBeenCalled();
  });
});

// Regression tests for the same P3-class fix already applied to Color/Size/
// UnitOfMeasure: isActive previously had a Zod `.default(true)`, so the
// regular "Edit" form (which never sends this field — only the dedicated
// Active/Inactive toggle does) silently reactivated an already-deactivated
// record on every ordinary edit. All 4 hr-config entities shared the
// identical bug.
describe("isActive preserved across an ordinary edit, for every hr-config entity", () => {
  it("designation: create defaults to active when omitted", async () => {
    vi.mocked(prisma.designation.findFirst).mockResolvedValue(null);
    await createDesignation(actor, { code: "CM", name: "Cutting Master" } as never);
    expect(prisma.designation.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ isActive: true }) }));
  });

  it("designation: update preserves existing isActive when omitted from the payload", async () => {
    vi.mocked(prisma.designation.findFirst).mockResolvedValue({ id: "des-1", isActive: false } as never);
    await updateDesignation(actor, "des-1", { code: "CM", name: "Cutting Master" } as never);
    expect(prisma.designation.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ isActive: false }) }));
  });

  it("designation: update still applies an explicit isActive (the toggle's own flow)", async () => {
    vi.mocked(prisma.designation.findFirst).mockResolvedValue({ id: "des-1", isActive: false } as never);
    await updateDesignation(actor, "des-1", { code: "CM", name: "Cutting Master", isActive: true } as never);
    expect(prisma.designation.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ isActive: true }) }));
  });

  it("employeeCategory: create defaults to active when omitted", async () => {
    vi.mocked(prisma.employeeCategory.findFirst).mockResolvedValue(null);
    await createEmployeeCategory(actor, { code: "PERM", name: "Permanent" } as never);
    expect(prisma.employeeCategory.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ isActive: true }) }));
  });

  it("employeeCategory: update preserves existing isActive when omitted", async () => {
    vi.mocked(prisma.employeeCategory.findFirst).mockResolvedValue({ id: "cat-1", isActive: false } as never);
    await updateEmployeeCategory(actor, "cat-1", { code: "PERM", name: "Permanent" } as never);
    expect(prisma.employeeCategory.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ isActive: false }) }));
  });

  it("shiftMaster: create defaults to active when omitted", async () => {
    vi.mocked(prisma.shiftMaster.findFirst).mockResolvedValue(null);
    await createShiftMaster(actor, { code: "GEN", name: "General", startTime: "09:00", endTime: "18:00", graceMinutes: 10 } as never);
    expect(prisma.shiftMaster.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ isActive: true }) }));
  });

  it("shiftMaster: update preserves existing isActive when omitted", async () => {
    vi.mocked(prisma.shiftMaster.findFirst).mockResolvedValue({ id: "shift-1", isActive: false } as never);
    await updateShiftMaster(actor, "shift-1", { code: "GEN", name: "General", startTime: "09:00", endTime: "18:00", graceMinutes: 10 } as never);
    expect(prisma.shiftMaster.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ isActive: false }) }));
  });

  it("holidayMaster: create defaults to active when omitted", async () => {
    vi.mocked(prisma.holidayMaster.findFirst).mockResolvedValue(null);
    await createHolidayMaster(actor, { name: "Diwali", date: new Date("2026-11-08") } as never);
    expect(prisma.holidayMaster.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ isActive: true }) }));
  });

  it("holidayMaster: update preserves existing isActive when omitted", async () => {
    vi.mocked(prisma.holidayMaster.findFirst).mockResolvedValue({ id: "hol-1", isActive: false } as never);
    await updateHolidayMaster(actor, "hol-1", { name: "Diwali", date: new Date("2026-11-08") } as never);
    expect(prisma.holidayMaster.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ isActive: false }) }));
  });
});
