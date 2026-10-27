import { beforeEach, describe, expect, it, vi } from "vitest";
import { approvalRuleSchema } from "./approval-matrix.schema";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("./approval-matrix.repository", () => ({
  ApprovalMatrixRepository: {
    findActiveRulesFor: vi.fn(),
    findActiveSiblings: vi.fn(),
    findRule: vi.fn(),
    createRule: vi.fn(),
    replaceRule: vi.fn(),
    setActive: vi.fn(),
    countCompanyRoles: vi.fn(),
    countCompanyUsers: vi.fn(),
    findBranch: vi.fn(),
  },
}));

const { ApprovalMatrixRepository } = await import("./approval-matrix.repository");
const { createApprovalRule, resolveApprovalPlan, setApprovalRuleActive, isListedApprover } = await import("./approval-matrix.service");

const actor = { companyId: "co-1", userId: "admin" };
const ROLE = "11111111-1111-1111-1111-111111111111";
const USER = "22222222-2222-2222-2222-222222222222";

const rule = (o: Record<string, unknown>) => ({
  id: "r",
  branchId: null,
  minAmount: 0,
  maxAmount: null,
  routing: "APPROVAL_THEN_PAY",
  approvalLevels: 1,
  approverMayPay: false,
  approvers: [{ level: 1, roleId: ROLE, userId: null, role: { id: ROLE, name: "MANAGEMENT" }, user: null }],
  ...o,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(ApprovalMatrixRepository.findActiveSiblings).mockResolvedValue([]);
  vi.mocked(ApprovalMatrixRepository.countCompanyRoles).mockImplementation((async (_c: string, ids: string[]) => ids.length) as never);
  vi.mocked(ApprovalMatrixRepository.countCompanyUsers).mockImplementation((async (_c: string, ids: string[]) => ids.length) as never);
  vi.mocked(ApprovalMatrixRepository.findBranch).mockResolvedValue({ id: "br-1" } as never);
  vi.mocked(ApprovalMatrixRepository.createRule).mockImplementation((async (data: object) => ({ id: "new", ...data })) as never);
});

describe("schema", () => {
  it("treats an empty 'amount up to' as no limit, not 0", () => {
    const parsed = approvalRuleSchema.parse({ requestType: "INVESTMENT", routing: "DIRECT_TO_ACCOUNTANT", maxAmount: "" });
    expect(parsed.maxAmount).toBeUndefined();
  });

  it("refuses an upper amount not above the lower one", () => {
    expect(approvalRuleSchema.safeParse({ requestType: "INVESTMENT", routing: "DIRECT_TO_ACCOUNTANT", minAmount: 100, maxAmount: 100 }).success).toBe(false);
  });
});

describe("resolveApprovalPlan", () => {
  it("falls back to the type's default (one any-approver level) when no rule matches", async () => {
    vi.mocked(ApprovalMatrixRepository.findActiveRulesFor).mockResolvedValue([]);
    const plan = await resolveApprovalPlan("co-1", "INVESTMENT", null, 500);
    expect(plan).toEqual({ ruleId: null, routing: "APPROVAL_THEN_PAY", approverMayPay: false, levels: [{ level: 1, anyApprover: true, users: [], roles: [] }] });
  });

  it("uses the amount slab [min, max) and prefers a branch rule over an all-branch rule", async () => {
    vi.mocked(ApprovalMatrixRepository.findActiveRulesFor).mockResolvedValue([
      rule({ id: "all-small", maxAmount: 10000 }),
      rule({ id: "all-big", minAmount: 10000 }),
      rule({ id: "branch-big", branchId: "br-1", minAmount: 10000 }),
    ] as never);
    expect((await resolveApprovalPlan("co-1", "INVESTMENT", "br-1", 9999.99)).ruleId).toBe("all-small");
    expect((await resolveApprovalPlan("co-1", "INVESTMENT", "br-1", 10000)).ruleId).toBe("branch-big");
    // Without a branch the repository returns only all-branch rules.
    vi.mocked(ApprovalMatrixRepository.findActiveRulesFor).mockResolvedValue([
      rule({ id: "all-small", maxAmount: 10000 }),
      rule({ id: "all-big", minAmount: 10000 }),
    ] as never);
    expect((await resolveApprovalPlan("co-1", "INVESTMENT", null, 10000)).ruleId).toBe("all-big");
  });

  it("copies each level's approvers into the plan", async () => {
    vi.mocked(ApprovalMatrixRepository.findActiveRulesFor).mockResolvedValue([
      rule({
        approvalLevels: 2,
        approvers: [
          { level: 1, roleId: ROLE, userId: null, role: { id: ROLE, name: "MANAGEMENT" }, user: null },
          { level: 2, roleId: null, userId: USER, role: null, user: { id: USER, fullName: "CFO" } },
        ],
      }),
    ] as never);
    const plan = await resolveApprovalPlan("co-1", "INVESTMENT", null, 1);
    expect(plan.levels).toEqual([
      { level: 1, anyApprover: false, users: [], roles: [{ id: ROLE, name: "MANAGEMENT" }] },
      { level: 2, anyApprover: false, users: [{ id: USER, name: "CFO" }], roles: [] },
    ]);
  });
});

describe("rule maintenance", () => {
  const base = { requestType: "INVESTMENT" as const, routing: "APPROVAL_THEN_PAY" as const, minAmount: 0, approvalLevels: 2, approverMayPay: false, approvers: [] as { level: number; roleId?: string; userId?: string }[] };

  it("needs an approver on every level", async () => {
    await expect(createApprovalRule(actor, { ...base, approvers: [{ level: 1, roleId: ROLE }] })).rejects.toThrow(/level 2/);
  });

  it("refuses an amount range overlapping another active rule of the same type and branch", async () => {
    vi.mocked(ApprovalMatrixRepository.findActiveSiblings).mockResolvedValue([{ id: "old", minAmount: 0, maxAmount: 5000 }] as never);
    await expect(
      createApprovalRule(actor, { ...base, approvalLevels: 1, minAmount: 4000, maxAmount: 9000, approvers: [{ level: 1, userId: USER }] })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    // Touching ranges [0,5000) and [5000,∞) do not overlap.
    await createApprovalRule(actor, { ...base, approvalLevels: 1, minAmount: 5000, approvers: [{ level: 1, userId: USER }] });
    expect(ApprovalMatrixRepository.createRule).toHaveBeenCalled();
  });

  it("a direct-to-accountant rule stores no approvers", async () => {
    await createApprovalRule(actor, { ...base, routing: "DIRECT_TO_ACCOUNTANT", approvers: [{ level: 1, roleId: ROLE }] });
    expect(vi.mocked(ApprovalMatrixRepository.createRule).mock.calls[0][0]).toMatchObject({ approvalLevels: 1, approvers: { create: [] } });
  });

  it("re-checks overlap when a rule is switched back on", async () => {
    vi.mocked(ApprovalMatrixRepository.findRule).mockResolvedValue(rule({ isActive: false, requestType: "INVESTMENT" }) as never);
    vi.mocked(ApprovalMatrixRepository.findActiveSiblings).mockResolvedValue([{ id: "other", minAmount: 0, maxAmount: null }] as never);
    await expect(setApprovalRuleActive(actor, "r", true)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("isListedApprover", () => {
  const req = { currentLevelAnyApprover: false, currentApproverUserIds: [USER], currentApproverRoleIds: [ROLE] };
  it("matches a listed user, a role holder, or a Super Admin — nobody else", () => {
    expect(isListedApprover(req, USER, { roleIds: [], isSuperAdmin: false })).toBe(true);
    expect(isListedApprover(req, "x", { roleIds: [ROLE], isSuperAdmin: false })).toBe(true);
    expect(isListedApprover(req, "x", { roleIds: [], isSuperAdmin: true })).toBe(true);
    expect(isListedApprover(req, "x", { roleIds: ["other"], isSuperAdmin: false })).toBe(false);
  });
});
