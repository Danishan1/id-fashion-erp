/**
 * Lead Board against a real, migrated + seeded Postgres database: columns per
 * lead status, totals over the filtered and visible set, per-column paging,
 * and the status-change path a drop uses.
 *
 * Skipped unless CRM_IT_DATABASE_URL points at a DISPOSABLE database:
 *   CRM_IT_DATABASE_URL=postgresql://…/crm_it npx vitest run src/modules/crm/leads/lead-board.integration.test.ts
 *
 * Statuses are company-wide, so every assertion is narrowed to this run's
 * leads with a search on the run token. Only permissions are mocked.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const DB_URL = process.env.CRM_IT_DATABASE_URL;
if (DB_URL) process.env.DATABASE_URL = DB_URL;

const viewAllUsers = new Set<string>();
vi.mock("@/core/rbac/PermissionService", () => ({
  PermissionService: {
    can: vi.fn(async (userId: string, _module: string, action: string) => (action === "view_all" ? viewAllUsers.has(userId) : true)),
    assert: vi.fn(async () => undefined),
    getAllowedBranchIds: vi.fn(async () => null),
    invalidate: vi.fn(),
  },
}));

type Actor = { companyId: string; userId: string; branchId: string | null };

describe.skipIf(!DB_URL)("CRM lead board (database integration)", async () => {
  const { prisma } = await import("@/core/db/client");
  const leads = await import("./lead.service");
  const board = await import("./lead-board.service");
  const settings = await import("../settings/crm-settings.service");

  const run = `lb${Date.now().toString(36)}`;
  let manager: Actor;
  let rep: Actor;
  let otherRep: Actor;
  let statuses: { id: string; key: string; name: string; kind: string; isActive: boolean }[];
  const st = (key: string) => statuses.find((s) => s.key === key)!;
  const expectCode = (p: Promise<unknown>, code: string) => expect(p).rejects.toMatchObject({ code });
  const mine = (extra: Record<string, string> = {}) => ({ search: run, ...extra });
  const mk = (actor: Actor, first: string, extra: Record<string, unknown> = {}) => leads.createLead(actor, { firstName: first, lastName: run, companyName: `${first} Co ${run}`, ...extra });
  const raw = (id: string) => prisma.crmLead.findUniqueOrThrow({ where: { id } });

  beforeAll(async () => {
    const company = await prisma.company.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
    const user = (n: string) => prisma.user.create({ data: { companyId: company.id, email: `${n}.${run}@crm-it.local`, passwordHash: "x", fullName: `${n} ${run}` } });
    const [m, r, o] = await Promise.all([user("lbmanager"), user("lbrep"), user("lbother")]);
    manager = { companyId: company.id, userId: m.id, branchId: null };
    rep = { companyId: company.id, userId: r.id, branchId: null };
    otherRep = { companyId: company.id, userId: o.id, branchId: null };
    viewAllUsers.add(m.id);
    statuses = await settings.listLeadStatuses(company.id);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("shows one column per active status in the configured order, with count, estimated value and average from the filtered, visible set", async () => {
    await mk(rep, "Asha", { estimatedValue: "100000", currencyCode: "INR" });
    await mk(rep, "Bala", { estimatedValue: "50000", currencyCode: "INR", temperature: "HOT" });
    await mk(rep, "Chen"); // no value
    await mk(rep, "Dev", { statusId: st("qualified").id, estimatedValue: "2000", currencyCode: "USD" });
    await mk(otherRep, "Esha", { estimatedValue: "999", currencyCode: "INR" });
    const archived = await mk(rep, "Faiz", { estimatedValue: "1", currencyCode: "INR" });
    await leads.archiveLead(rep, archived.id);

    const b = await board.getLeadBoard(manager, mine());
    const expected = statuses.filter((s) => s.isActive).map((s) => s.name);
    expect(b.statuses.map((s) => s.name)).toEqual(expected);
    const col = (bd: typeof b, key: string) => bd.statuses.find((s) => s.id === st(key).id)!;
    // Archived leads never appear; the value average counts only leads with a value.
    expect(col(b, "new")).toMatchObject({ kind: "OPEN", count: 4, values: [{ currencyCode: "INR", total: 150999, average: 50333 }] });
    expect(col(b, "qualified")).toMatchObject({ count: 1, values: [{ currencyCode: "USD", total: 2000, average: 2000 }] });
    expect(col(b, "converted")).toMatchObject({ kind: "CONVERTED", count: 0, records: [] });
    const card = col(b, "new").records.find((r) => r.firstName === "Bala")!;
    expect(card).toMatchObject({ estimatedValue: "50000", temperature: "HOT", ownerInactive: false, owner: { id: rep.userId }, status: { id: st("new").id } });
    expect(card).toHaveProperty("customFields");

    // Visibility: a rep only sees (and totals) their own leads.
    expect(col(await board.getLeadBoard(rep, mine()), "new")).toMatchObject({ count: 3, values: [expect.objectContaining({ total: 150000 })] });
    // Same filters as the list, applied server-side.
    expect(col(await board.getLeadBoard(manager, mine({ temperatures: "HOT" })), "new").count).toBe(1);
    expect(col(await board.getLeadBoard(manager, mine({ estimatedValueMin: "60000" })), "new").count).toBe(1);
    expect(col(await board.getLeadBoard(manager, mine({ ownerUserIds: otherRep.userId })), "new").count).toBe(1);
    // The board ignores an archived filter: archived leads stay off the board.
    expect(col(await board.getLeadBoard(manager, mine({ archived: "only" })), "new").count).toBe(4);
    await expect(board.getLeadBoard(manager, mine({ estimatedValueMin: "abc" }))).rejects.toMatchObject({ name: "ZodError" });
  });

  it("pages one column at a time without duplicates", async () => {
    for (let i = 0; i < 5; i++) await mk(rep, `Page${i}`, { statusId: st("contacted").id });
    const first = await board.getLeadBoard(rep, mine({ perStatus: "2" }));
    const c = first.statuses.find((s) => s.id === st("contacted").id)!;
    expect(c).toMatchObject({ count: 5, hasMore: true });
    const seen = c.records.map((r) => r.id);
    for (;;) {
      const next = await board.getLeadBoard(rep, mine({ perStatus: "2", statusId: st("contacted").id, offset: String(seen.length) }));
      expect(next.statuses.map((s) => s.id)).toEqual([st("contacted").id]);
      seen.push(...next.statuses[0].records.map((r) => r.id));
      if (!next.statuses[0].hasMore) break;
    }
    expect(new Set(seen).size).toBe(5);
  });

  it("keeps an inactive status as a column only while leads still use it", async () => {
    const parked = await settings.createLeadStatus(manager, { name: `Parked ${run}` });
    const empty = await settings.createLeadStatus(manager, { name: `Unused ${run}` });
    await mk(rep, "Parked", { statusId: parked.id });
    await settings.updateLeadStatus(manager, parked.id, { isActive: false });
    await settings.updateLeadStatus(manager, empty.id, { isActive: false });
    const b = await board.getLeadBoard(manager, mine());
    expect(b.statuses.find((s) => s.id === parked.id)).toMatchObject({ archived: true, count: 1 });
    expect(b.statuses.some((s) => s.id === empty.id)).toBe(false);
  });

  it("a drop uses the existing status change: version-checked, audited, and Converted is refused (Convert is its own flow)", async () => {
    const lead = await mk(rep, "Drop");
    const v1 = (await raw(lead.id)).version;
    await leads.changeLeadStatus(rep, lead.id, { statusId: st("contacted").id, version: v1 });
    await expectCode(leads.changeLeadStatus(rep, lead.id, { statusId: st("qualified").id, version: v1 }), "RECORD_VERSION_CONFLICT");
    expect((await raw(lead.id)).statusId).toBe(st("contacted").id);
    await expectCode(leads.changeLeadStatus(rep, lead.id, { statusId: st("converted").id, version: v1 + 1 }), "VALIDATION_ERROR");
    expect(await prisma.auditLog.count({ where: { tableName: "crm_leads", recordId: lead.id, action: "UPDATE" } })).toBeGreaterThan(0);
    const b = await board.getLeadBoard(rep, mine());
    expect(b.statuses.find((s) => s.id === st("contacted").id)!.records.map((r) => r.id)).toContain(lead.id);
  });
});
