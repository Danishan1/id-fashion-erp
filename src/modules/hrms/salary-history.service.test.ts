import { beforeEach, describe, expect, it, vi } from "vitest";
import { rupeesInWords } from "@/lib/amount-in-words";

const db = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  salaryRun: { findMany: vi.fn(), findFirst: vi.fn() },
  salaryRunLine: { findFirst: vi.fn() },
  company: { findUnique: vi.fn() },
}));
const perm = vi.hoisted(() => ({ can: vi.fn() }));
vi.mock("@/core/db/client", () => ({ prisma: db }));
vi.mock("@/core/rbac/PermissionService", () => ({ PermissionService: perm }));

const { listSalaryHistory, getSalarySlipData, getRunForExport } = await import("./salary-history.service");
const actor = { companyId: "c1", userId: "u1" };

beforeEach(() => {
  vi.clearAllMocks();
  db.salaryRun.findMany.mockResolvedValue([]);
});

describe("rupeesInWords", () => {
  it("uses lakh / crore and paise", () => {
    expect(rupeesInWords(43500)).toBe("Forty Three Thousand Five Hundred Rupees Only");
    expect(rupeesInWords(1250000)).toBe("Twelve Lakh Fifty Thousand Rupees Only");
    expect(rupeesInWords(12345678.5)).toBe("One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight Rupees and Fifty Paise Only");
    expect(rupeesInWords(0)).toBe("Zero Rupees Only");
  });
});

describe("salary history scope", () => {
  it("view_all sees every line of finalised runs", async () => {
    perm.can.mockResolvedValue(true);
    const r = await listSalaryHistory(actor, 2026);
    expect(r.canSeeAll).toBe(true);
    expect(db.salaryRun.findMany.mock.calls[0][0].where).toEqual({ companyId: "c1", status: "FINALISED", year: 2026 });
    expect(db.salaryRun.findMany.mock.calls[0][0].select.lines.where).toEqual({});
  });

  it("without view_all only the caller's own employee — not their team", async () => {
    perm.can.mockResolvedValue(false);
    db.user.findUnique.mockResolvedValue({ employeeId: "e7" });
    await listSalaryHistory(actor);
    expect(db.salaryRun.findMany.mock.calls[0][0].select.lines.where).toEqual({ employeeId: { in: ["e7"] } });
  });

  it("a user with no linked employee sees nothing", async () => {
    perm.can.mockResolvedValue(false);
    db.user.findUnique.mockResolvedValue({ employeeId: null });
    await listSalaryHistory(actor);
    expect(db.salaryRun.findMany.mock.calls[0][0].select.lines.where).toEqual({ employeeId: { in: [] } });
  });

  it("someone else's slip is NOT_FOUND, and only finalised runs give slips", async () => {
    perm.can.mockResolvedValue(false);
    db.user.findUnique.mockResolvedValue({ employeeId: "e7" });
    db.salaryRunLine.findFirst.mockResolvedValue(null);
    await expect(getSalarySlipData(actor, "l1")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(db.salaryRunLine.findFirst.mock.calls[0][0].where).toMatchObject({ id: "l1", run: { companyId: "c1", status: "FINALISED" }, employeeId: { in: ["e7"] } });
  });

  it("the Excel report needs company-wide access", async () => {
    perm.can.mockResolvedValue(false);
    db.user.findUnique.mockResolvedValue({ employeeId: "e7" });
    await expect(getRunForExport(actor, "r1")).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });
});
