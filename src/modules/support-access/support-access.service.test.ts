import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NEXTAUTH_SECRET ??= "test-secret";
});

const { db, eventMock, liveMock } = vi.hoisted(() => {
  const fn = () => vi.fn();
  const db = {
    company: { findUnique: fn() },
    platformUser: { findUniqueOrThrow: fn() },
    user: { findUnique: fn(), update: fn(), create: fn() },
    userBranchRole: { count: fn() },
    supportAccessRequest: { findMany: fn(), findFirst: fn(), findUnique: fn(), create: fn(), update: fn(), updateMany: fn(), count: fn() },
    supportAccessSession: { findUnique: fn(), findUniqueOrThrow: fn(), findFirst: fn(), create: fn(), update: fn(), updateMany: fn(), count: fn() },
    $transaction: vi.fn(),
  };
  return { db, eventMock: vi.fn(), liveMock: vi.fn() };
});

vi.mock("@/core/db/client", () => ({ prisma: db }));
vi.mock("@/core/support-access/support-events", () => ({
  recordSupportEventInTx: eventMock,
  verifySupportEventChain: vi.fn(),
}));
vi.mock("@/core/support-access/support-session-guard", async (importActual) => ({
  ...(await importActual<typeof import("@/core/support-access/support-session-guard")>()),
  getLiveSupportSession: liveMock,
}));

const { hashVerificationCode } = await import("@/core/support-access/codes");
const service = await import("./support-access.service");

const operator = { platformUserId: "op-1", role: "SUPPORT_AGENT" as const };
const customerAdmin = { userId: "admin-1", companyId: "co-1" };

function pendingRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: "req-1",
    companyId: "co-1",
    platformUserId: "op-1",
    durationMinutes: 30,
    status: "PENDING",
    codeHash: hashVerificationCode("access", "req-1", "123456"),
    codeExpiresAt: new Date(Date.now() + 600_000),
    failedAttempts: 0,
    ...overrides,
  };
}

beforeEach(() => {
  for (const model of Object.values(db)) {
    if (typeof model === "function") continue;
    for (const method of Object.values(model)) (method as ReturnType<typeof vi.fn>).mockReset();
  }
  db.$transaction.mockReset().mockImplementation(async (fn: (tx: typeof db) => unknown) => fn(db));
  eventMock.mockReset().mockResolvedValue(undefined);
  liveMock.mockReset();
  db.supportAccessRequest.findMany.mockResolvedValue([]);
  db.userBranchRole.count.mockResolvedValue(1); // customer admin holds SUPER_ADMIN
});

describe("createSupportRequest (PLAT-009)", () => {
  const input = { companyId: "co-1", reason: "Ticket 142 — wrong carton count", durationMinutes: 30 };

  it("refuses a Billing Admin", async () => {
    await expect(service.createSupportRequest({ platformUserId: "op-1", role: "BILLING_ADMIN" }, input)).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    });
  });

  it("refuses a suspended company", async () => {
    db.company.findUnique.mockResolvedValue({ id: "co-1", name: "Acme", isActive: false });
    await expect(service.createSupportRequest(operator, input)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("refuses a second pending request for the same company", async () => {
    db.company.findUnique.mockResolvedValue({ id: "co-1", name: "Acme", isActive: true });
    db.supportAccessRequest.findFirst.mockResolvedValue({ id: "req-old" });
    await expect(service.createSupportRequest(operator, input)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("returns a 6-digit code once and stores only its hash", async () => {
    db.company.findUnique.mockResolvedValue({ id: "co-1", name: "Acme", isActive: true });
    db.supportAccessRequest.findFirst.mockResolvedValue(null);
    db.supportAccessRequest.create.mockResolvedValue({ id: "req-1" });
    db.supportAccessRequest.update.mockImplementation(async ({ data }: { data: { codeHash: string } }) => ({
      id: "req-1",
      status: "PENDING",
      codeHash: data.codeHash,
      codeExpiresAt: new Date(),
    }));
    const result = await service.createSupportRequest(operator, input);
    expect(result.code).toMatch(/^\d{6}$/);
    const stored = db.supportAccessRequest.update.mock.calls[0][0].data.codeHash;
    expect(stored).toBe(hashVerificationCode("access", "req-1", result.code));
    expect(eventMock).toHaveBeenCalledWith(db, expect.objectContaining({ eventType: "REQUEST_CREATED" }));
  });
});

describe("approveSupportRequest (PLAT-010/011)", () => {
  it("is refused for anyone but the company's Super Admin", async () => {
    db.userBranchRole.count.mockResolvedValue(0);
    await expect(service.approveSupportRequest(customerAdmin, "req-1", "123456")).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    });
  });

  it("counts a wrong code and says how many attempts are left", async () => {
    db.supportAccessRequest.findFirst.mockResolvedValue(pendingRequest());
    await expect(service.approveSupportRequest(customerAdmin, "req-1", "000000")).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: expect.stringContaining("4 attempt"),
    });
    expect(db.supportAccessRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { failedAttempts: { increment: 1 } } })
    );
    expect(db.supportAccessSession.create).not.toHaveBeenCalled();
  });

  it("locks the request on the fifth wrong code", async () => {
    db.supportAccessRequest.findFirst.mockResolvedValue(pendingRequest({ failedAttempts: 4 }));
    await expect(service.approveSupportRequest(customerAdmin, "req-1", "000000")).rejects.toMatchObject({
      code: "INVALID_STATE_TRANSITION",
    });
    expect(db.supportAccessRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { failedAttempts: { increment: 1 }, status: "LOCKED" } })
    );
  });

  it("refuses an expired code", async () => {
    db.supportAccessRequest.findFirst.mockResolvedValue(pendingRequest({ codeExpiresAt: new Date(Date.now() - 1000) }));
    await expect(service.approveSupportRequest(customerAdmin, "req-1", "123456")).rejects.toMatchObject({
      code: "INVALID_STATE_TRANSITION",
    });
    expect(db.supportAccessSession.create).not.toHaveBeenCalled();
  });

  it("with the right code starts a READ-ONLY session for the approved duration, as the proxy user", async () => {
    db.supportAccessRequest.findFirst.mockResolvedValue(pendingRequest());
    db.supportAccessRequest.updateMany.mockResolvedValue({ count: 1 });
    db.platformUser.findUniqueOrThrow.mockResolvedValue({ fullName: "Asha" });
    db.user.findUnique.mockResolvedValue(null);
    db.user.create.mockResolvedValue({ id: "proxy-1" });
    db.supportAccessSession.create.mockImplementation(async ({ data }: { data: { expiresAt: Date; mode: string } }) => ({
      id: "sess-1",
      expiresAt: data.expiresAt,
      mode: data.mode,
    }));

    const before = Date.now();
    const session = await service.approveSupportRequest(customerAdmin, "req-1", "123456");
    expect(session.mode).toBe("READ_ONLY");
    const minutes = (session.expiresAt.getTime() - before) / 60_000;
    expect(minutes).toBeGreaterThan(29.9);
    expect(minutes).toBeLessThan(30.1);

    const proxy = db.user.create.mock.calls[0][0].data;
    expect(proxy).toMatchObject({ companyId: "co-1", supportForPlatformUserId: "op-1", fullName: "Support — Asha" });
    expect(proxy.passwordHash.startsWith("!")).toBe(true);
    expect(db.supportAccessSession.create.mock.calls[0][0].data.proxyUserId).toBe("proxy-1");
  });
});

describe("revoke / write access (PLAT-013, PLAT-014)", () => {
  const liveSession = {
    id: "sess-1",
    requestId: "req-1",
    companyId: "co-1",
    proxyUserId: "proxy-1",
    platformUserId: "op-1",
    writeStatus: "PENDING",
    writeCodeHash: hashVerificationCode("write", "sess-1", "654321"),
    writeCodeExpiresAt: new Date(Date.now() + 300_000),
    writeFailedAttempts: 0,
  };

  it("revokes a live session", async () => {
    db.supportAccessSession.findFirst.mockResolvedValue(liveSession);
    db.supportAccessSession.updateMany.mockResolvedValue({ count: 1 });
    await service.revokeSupportSession(customerAdmin, "sess-1");
    expect(db.supportAccessSession.updateMany.mock.calls[0][0].data).toMatchObject({ revokedByUserId: "admin-1" });
    expect(eventMock).toHaveBeenCalledWith(db, expect.objectContaining({ eventType: "SESSION_REVOKED" }));
  });

  it("can't revoke a session of another company", async () => {
    db.supportAccessSession.findFirst.mockResolvedValue(null);
    await expect(service.revokeSupportSession(customerAdmin, "sess-x")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("requires the separate write code — the access code doesn't work", async () => {
    db.supportAccessSession.findFirst.mockResolvedValue(liveSession);
    liveMock.mockResolvedValue({ id: "sess-1" });
    await expect(service.approveWriteAccess(customerAdmin, "sess-1", "123456")).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("switches the session to READ_WRITE with the write code", async () => {
    db.supportAccessSession.findFirst.mockResolvedValue(liveSession);
    liveMock.mockResolvedValue({ id: "sess-1" });
    db.supportAccessSession.updateMany.mockResolvedValue({ count: 1 });
    await service.approveWriteAccess(customerAdmin, "sess-1", "654321");
    expect(db.supportAccessSession.updateMany.mock.calls[0][0].data).toMatchObject({ mode: "READ_WRITE", writeStatus: "APPROVED" });
  });

  it("a write request needs a live session and returns a fresh code", async () => {
    liveMock.mockResolvedValue({ id: "sess-1", requestId: "req-1", platformUserId: "op-1", mode: "READ_ONLY", writeStatus: "NONE" });
    db.supportAccessSession.update.mockResolvedValue({});
    const result = await service.requestWriteAccess("sess-1", "Fix wrong UOM on MR-2026-00012");
    expect(result.code).toMatch(/^\d{6}$/);
    expect(db.supportAccessSession.update.mock.calls[0][0].data).toMatchObject({ writeStatus: "PENDING" });

    liveMock.mockResolvedValue(null);
    await expect(service.requestWriteAccess("sess-1", "Fix wrong UOM on MR-2026-00012")).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    });
  });
});
