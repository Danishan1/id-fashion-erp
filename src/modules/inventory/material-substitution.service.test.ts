import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/rbac/PermissionService", () => ({ PermissionService: { assert: vi.fn() } }));
vi.mock("@/core/db/client", () => ({
  prisma: { $transaction: vi.fn((fn: (tx: unknown) => unknown) => fn({})), color: { findFirst: vi.fn().mockResolvedValue({ id: "col-x" }) } },
}));
vi.mock("@/modules/lookups/lookup.repository", () => ({ LookupRepository: { unit: { findUnique: vi.fn() } } }));
vi.mock("@/modules/products/product.repository", () => ({ ProductRepository: { findMaterialById: vi.fn() } }));
vi.mock("./material-request.repository", () => ({ MaterialRequestItemRepository: { findWithRequestOwner: vi.fn() } }));
vi.mock("./material-request.service", () => ({ issueSubstituteMaterial: vi.fn() }));
vi.mock("./material-substitution.repository", () => ({
  MaterialSubstitutionRepository: {
    findManyForLine: vi.fn(),
    findById: vi.fn(),
    findActiveForLineQuantityCheck: vi.fn(),
    create: vi.fn(),
    decideInTx: vi.fn(),
  },
}));

const { writeAuditLog } = await import("@/core/audit/AuditLogger");
const { PermissionService } = await import("@/core/rbac/PermissionService");
const { LookupRepository } = await import("@/modules/lookups/lookup.repository");
const { ProductRepository } = await import("@/modules/products/product.repository");
const { MaterialRequestItemRepository } = await import("./material-request.repository");
const { issueSubstituteMaterial } = await import("./material-request.service");
const { MaterialSubstitutionRepository } = await import("./material-substitution.repository");
const {
  listMaterialSubstitutionsForLine,
  proposeMaterialSubstitution,
  approveMaterialSubstitution,
  rejectMaterialSubstitution,
  proposeApproveAndIssueMaterialSubstitution,
} = await import("./material-substitution.service");

const actor = { companyId: "co-1", userId: "user-1" };

const uom = { id: "uom-mtr", code: "MTR", name: "Metre", baseUnitId: null, conversionFactor: 1 };

const openLine = {
  id: "line-1",
  materialId: "green-fabric",
  requestedQuantity: 100,
  issuedQuantity: 60,
  material: { styleName: "Green Fabric", baseUom: uom },
  materialRequest: { id: "mr-1", companyId: "co-1", warehouseId: "wh-1", status: "PARTIALLY_ISSUED" },
};

beforeEach(() => {
  vi.mocked(writeAuditLog).mockReset();
  vi.mocked(PermissionService.assert).mockReset().mockResolvedValue(undefined);
  vi.mocked(LookupRepository.unit.findUnique).mockReset().mockResolvedValue(uom as never);
  vi.mocked(ProductRepository.findMaterialById).mockReset().mockResolvedValue({ id: "light-blue-fabric" } as never);
  vi.mocked(MaterialRequestItemRepository.findWithRequestOwner).mockReset().mockResolvedValue(openLine as never);
  vi.mocked(MaterialSubstitutionRepository.findManyForLine).mockReset().mockResolvedValue([]);
  vi.mocked(MaterialSubstitutionRepository.findById).mockReset();
  vi.mocked(MaterialSubstitutionRepository.findActiveForLineQuantityCheck).mockReset().mockResolvedValue([]);
  vi.mocked(MaterialSubstitutionRepository.create).mockReset().mockResolvedValue({ id: "sub-1" } as never);
  vi.mocked(MaterialSubstitutionRepository.decideInTx).mockReset().mockResolvedValue({ count: 1 } as never);
  vi.mocked(issueSubstituteMaterial).mockReset().mockResolvedValue({ id: "sub-1", status: "APPROVED", inventoryTransactionId: "txn-1" } as never);
});

const proposeInput = { substituteMaterialId: "light-blue-fabric", quantity: 40, uomId: "uom-mtr", reason: "ORIGINAL_MATERIAL_NOT_AVAILABLE" as const, remarks: "Out of stock", autoApprove: false };

describe("proposeMaterialSubstitution", () => {
  it("creates a PENDING record by default — the Store/Warehouse User path", async () => {
    await proposeMaterialSubstitution(actor, "line-1", proposeInput);

    expect(MaterialSubstitutionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        materialRequestItemId: "line-1",
        originalMaterialId: "green-fabric",
        substituteMaterialId: "light-blue-fabric",
        quantity: 40,
        status: "PENDING",
        approvedByUserId: null,
        requestedByUserId: "user-1",
      })
    );
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "CREATE" }));
  });

  it("matches the spec's own worked example exactly: 100 M requested, 60 M already issued, a 40 M substitute proposal fits precisely (remaining is exactly 40)", async () => {
    await expect(proposeMaterialSubstitution(actor, "line-1", { ...proposeInput, quantity: 40 })).resolves.toBeDefined();
  });

  it("rejects a substitution that would exceed what remains on the line, accounting for already-issued quantity", async () => {
    await expect(proposeMaterialSubstitution(actor, "line-1", { ...proposeInput, quantity: 41 })).rejects.toMatchObject({
      code: "OVER_ISSUE_NOT_ALLOWED",
    });
    expect(MaterialSubstitutionRepository.create).not.toHaveBeenCalled();
  });

  it("PARTIAL/MULTIPLE SUBSTITUTION: caps a new proposal against remaining capacity after accounting for an already-PENDING substitution on the same line — Green 100M, 60M issued, 30M already proposed as Dark Blue, a further 15M Light Blue proposal must fail (only 10M left)", async () => {
    vi.mocked(MaterialSubstitutionRepository.findActiveForLineQuantityCheck).mockResolvedValue([
      { id: "sub-existing", quantity: 30, uom },
    ] as never);

    await expect(proposeMaterialSubstitution(actor, "line-1", { ...proposeInput, quantity: 15 })).rejects.toMatchObject({
      code: "OVER_ISSUE_NOT_ALLOWED",
    });

    // But exactly the remaining 10M succeeds.
    await expect(proposeMaterialSubstitution(actor, "line-1", { ...proposeInput, quantity: 10 })).resolves.toBeDefined();
  });

  it("rejects when the substitute material is the same as the line's own original material", async () => {
    vi.mocked(ProductRepository.findMaterialById).mockResolvedValue({ id: "green-fabric" } as never);
    await expect(proposeMaterialSubstitution(actor, "line-1", proposeInput)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  // Colour-wise stock (2026-10-21).
  it("allows the same material in a different colour, storing the substitute colour", async () => {
    vi.mocked(ProductRepository.findMaterialById).mockResolvedValue({ id: "green-fabric" } as never);
    await proposeMaterialSubstitution(actor, "line-1", { ...proposeInput, substituteMaterialId: "green-fabric", substituteColorId: "col-x" });
    expect(MaterialSubstitutionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ substituteMaterialId: "green-fabric", substituteColorId: "col-x" })
    );
  });

  it("rejects the same material in the line's own colour", async () => {
    vi.mocked(MaterialRequestItemRepository.findWithRequestOwner).mockResolvedValue({ ...openLine, colorId: "col-x" } as never);
    vi.mocked(ProductRepository.findMaterialById).mockResolvedValue({ id: "green-fabric" } as never);
    await expect(
      proposeMaterialSubstitution(actor, "line-1", { ...proposeInput, substituteMaterialId: "green-fabric", substituteColorId: "col-x" })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects when the line's request is CANCELLED/CLOSED/ON_HOLD", async () => {
    vi.mocked(MaterialRequestItemRepository.findWithRequestOwner).mockResolvedValue({
      ...openLine,
      materialRequest: { ...openLine.materialRequest, status: "CLOSED" },
    } as never);
    await expect(proposeMaterialSubstitution(actor, "line-1", proposeInput)).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });

  describe("autoApprove — the authorized fast path", () => {
    it("creates the record already APPROVED, stamping the same actor as both requester and approver — still a complete record, per decision #3", async () => {
      await proposeMaterialSubstitution(actor, "line-1", { ...proposeInput, autoApprove: true });

      expect(PermissionService.assert).toHaveBeenCalledWith("user-1", "production", "approve");
      expect(MaterialSubstitutionRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: "APPROVED", approvedByUserId: "user-1", requestedByUserId: "user-1" })
      );
    });

    it("rejects autoApprove outright when the caller doesn't actually hold production.approve — never silently downgrades to a plain PENDING propose", async () => {
      vi.mocked(PermissionService.assert).mockImplementation(async (_userId, module, action) => {
        if (module === "production" && action === "approve") {
          throw Object.assign(new Error("denied"), { code: "PERMISSION_DENIED" });
        }
      });

      await expect(proposeMaterialSubstitution(actor, "line-1", { ...proposeInput, autoApprove: true })).rejects.toMatchObject({
        code: "PERMISSION_DENIED",
      });
      expect(MaterialSubstitutionRepository.create).not.toHaveBeenCalled();
    });
  });
});

describe("approveMaterialSubstitution / rejectMaterialSubstitution", () => {
  const pending = {
    id: "sub-1",
    materialRequestItemId: "line-1",
    status: "PENDING",
    requestedByUserId: "user-2",
    quantity: 40,
    uom,
  };

  it("approves a PENDING substitution, self-approval-guarded against the ORIGINAL requester, not the approver", async () => {
    vi.mocked(MaterialSubstitutionRepository.findById).mockResolvedValue(pending as never);

    await approveMaterialSubstitution(actor, "sub-1", { approvalRemark: "Looks fine" });

    expect(PermissionService.assert).toHaveBeenCalledWith("user-1", "production", "approve", { createdBy: "user-2" });
    expect(MaterialSubstitutionRepository.decideInTx).toHaveBeenCalledWith(
      {},
      "sub-1",
      expect.objectContaining({ status: "APPROVED", approvedByUserId: "user-1" })
    );
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "UPDATE" }));
  });

  it("rejects approving an already-decided substitution", async () => {
    vi.mocked(MaterialSubstitutionRepository.findById).mockResolvedValue({ ...pending, status: "APPROVED" } as never);
    await expect(approveMaterialSubstitution(actor, "sub-1", {})).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });

  it("surfaces a clean error when a concurrent decision wins the race (guarded update affected 0 rows)", async () => {
    vi.mocked(MaterialSubstitutionRepository.findById).mockResolvedValue(pending as never);
    vi.mocked(MaterialSubstitutionRepository.decideInTx).mockResolvedValue({ count: 0 } as never);
    await expect(approveMaterialSubstitution(actor, "sub-1", {})).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });

  it("rejects when the substitution doesn't exist for this company", async () => {
    vi.mocked(MaterialSubstitutionRepository.findById).mockResolvedValue(null);
    await expect(approveMaterialSubstitution(actor, "sub-missing", {})).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects a PENDING substitution and writes its own audit entry", async () => {
    vi.mocked(MaterialSubstitutionRepository.findById).mockResolvedValue(pending as never);
    await rejectMaterialSubstitution(actor, "sub-1", { approvalRemark: "Wrong shade" });
    expect(MaterialSubstitutionRepository.decideInTx).toHaveBeenCalledWith({}, "sub-1", expect.objectContaining({ status: "REJECTED" }));
  });
});

describe("listMaterialSubstitutionsForLine", () => {
  it("returns the full decision history for the line, not just active rows", async () => {
    vi.mocked(MaterialSubstitutionRepository.findManyForLine).mockResolvedValue([{ id: "sub-1", status: "REJECTED" }] as never);
    const result = await listMaterialSubstitutionsForLine(actor, "line-1");
    expect(result).toEqual([{ id: "sub-1", status: "REJECTED" }]);
  });
});

describe("proposeApproveAndIssueMaterialSubstitution — the authorized fast path (decision #3)", () => {
  it("forces autoApprove regardless of what was submitted, then issues the resulting substitution — one call, three verbs, still the complete record", async () => {
    const { autoApprove: _unused, ...inputWithoutAutoApprove } = proposeInput;
    void _unused;
    await proposeApproveAndIssueMaterialSubstitution(actor, "line-1", inputWithoutAutoApprove);

    expect(MaterialSubstitutionRepository.create).toHaveBeenCalledWith(expect.objectContaining({ status: "APPROVED", approvedByUserId: "user-1" }));
    expect(issueSubstituteMaterial).toHaveBeenCalledWith(actor, "sub-1", undefined);
  });

  it("still requires production.approve — the same gate proposeMaterialSubstitution's own autoApprove branch already enforces", async () => {
    vi.mocked(PermissionService.assert).mockImplementation(async (_userId, module, action) => {
      if (module === "production" && action === "approve") {
        throw Object.assign(new Error("denied"), { code: "PERMISSION_DENIED" });
      }
    });

    const { autoApprove: _unused2, ...inputWithoutAutoApprove } = proposeInput;
    void _unused2;
    await expect(proposeApproveAndIssueMaterialSubstitution(actor, "line-1", inputWithoutAutoApprove)).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    });
    expect(issueSubstituteMaterial).not.toHaveBeenCalled();
  });
});
