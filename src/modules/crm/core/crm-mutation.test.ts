import { beforeEach, describe, expect, it, vi } from "vitest";

const { transactionMock, txClient } = vi.hoisted(() => {
  const txClient = { marker: "tx" };
  return { txClient, transactionMock: vi.fn(async (fn: (tx: unknown) => unknown) => fn(txClient)) };
});

vi.mock("@/core/db/client", () => ({ prisma: { $transaction: transactionMock } }));
vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/logging/requestContext", () => ({ getRequestContext: () => ({ requestId: "req-9" }) }));
vi.mock("./crm-event.repository", () => ({ CrmEventRepository: { create: vi.fn() } }));
vi.mock("./crm-event-bus", () => ({ dispatchCrmEvents: vi.fn() }));

const { writeAuditLog } = await import("@/core/audit/AuditLogger");
const { CrmEventRepository } = await import("./crm-event.repository");
const { dispatchCrmEvents } = await import("./crm-event-bus");
const { runCrmMutation } = await import("./crm-mutation");

const ID = "6f1c2f1e-1f2a-4b1a-9d1a-2b3c4d5e6f70";
const actor = { companyId: "co-1", userId: "user-1", branchId: null };

beforeEach(() => {
  transactionMock.mockClear();
  vi.mocked(writeAuditLog).mockReset();
  vi.mocked(CrmEventRepository.create)
    .mockReset()
    .mockImplementation(((data: object) => Promise.resolve({ id: "ev-1", ...data })) as never);
  vi.mocked(dispatchCrmEvents).mockReset();
});

describe("runCrmMutation", () => {
  it("runs the work, the audit row and the events in one transaction, then dispatches after commit", async () => {
    const result = await runCrmMutation(actor, async ({ tx, emit, audit }) => {
      expect(tx).toBe(txClient);
      await audit({ tableName: "crm_leads", recordId: ID, action: "CREATE", newValues: { name: "Acme" } });
      emit({ entityType: "LEAD", entityId: ID, eventType: "lead.created", summary: "Acme" });
      return "done";
    });

    expect(result).toBe("done");
    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(writeAuditLog).toHaveBeenCalledWith(
      { companyId: "co-1", userId: "user-1", tableName: "crm_leads", recordId: ID, action: "CREATE", newValues: { name: "Acme" } },
      txClient
    );
    expect(CrmEventRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: "co-1", eventType: "lead.created", correlationId: "req-9" }),
      txClient
    );
    expect(dispatchCrmEvents).toHaveBeenCalledWith([expect.objectContaining({ id: "ev-1", eventType: "lead.created" })]);
  });

  it("rejects an unknown event before anything is written, and dispatches nothing", async () => {
    await expect(
      runCrmMutation(actor, async ({ emit }) => {
        emit({ entityType: "LEAD", entityId: ID, eventType: "lead.teleported" as never });
      })
    ).rejects.toThrow();
    expect(CrmEventRepository.create).not.toHaveBeenCalled();
    expect(dispatchCrmEvents).not.toHaveBeenCalled();
  });

  it("does not dispatch when the work itself fails (transaction rolls back)", async () => {
    await expect(
      runCrmMutation(actor, async ({ emit }) => {
        emit({ entityType: "LEAD", entityId: ID, eventType: "lead.created" });
        throw new Error("db down");
      })
    ).rejects.toThrow("db down");
    expect(CrmEventRepository.create).not.toHaveBeenCalled();
    expect(dispatchCrmEvents).not.toHaveBeenCalled();
  });
});
