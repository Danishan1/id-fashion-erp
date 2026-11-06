/**
 * Sales & Marketing Phase 17 — performance of the live governed queries on
 * synthetic volume in a throw-away company: 50,000 enquiries (25,000 with a
 * "qualified" activity, 20,000 with an issued quotation revision, 10,000
 * accepted and converted to an order), 40,000 direct booked Sales Orders plus
 * the 10,000 converted ones across 200 customers and 20 reps over two years,
 * and ~37,500 posted invoices. Each report must finish well inside the 8 s statement timeout; the
 * timings are printed and recorded in docs/sales-marketing/PHASE_17_ANALYTICS.md.
 *
 * Opt-in (it adds ~200k rows): set ANALYTICS_PERF=1 and CRM_IT_DATABASE_URL to a
 * DISPOSABLE database.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const DB_URL = process.env.CRM_IT_DATABASE_URL;
if (DB_URL) process.env.DATABASE_URL = DB_URL;

vi.mock("@/core/rbac/PermissionService", () => ({
  PermissionService: {
    can: vi.fn(async () => true),
    assert: vi.fn(async () => undefined),
    assertAny: vi.fn(async () => undefined),
    getAllowedBranchIds: vi.fn(async () => null),
    getViewableModules: vi.fn(async () => []),
    invalidate: vi.fn(),
  },
}));

describe.skipIf(!DB_URL || !process.env.ANALYTICS_PERF)("S&M analytics performance (synthetic volume)", async () => {
  const { prisma } = await import("@/core/db/client");
  const engine = await import("./analytics-engine");
  const run = `p${Date.now().toString(36)}`;
  let actor = { companyId: "", userId: "", branchId: null as string | null };
  const timings: [string, number][] = [];
  const from = new Date(Date.now() - 729 * 86_400_000).toISOString().slice(0, 10);
  const to = new Date().toISOString().slice(0, 10);

  beforeAll(async () => {
    const company = await prisma.company.create({ data: { name: `Analytics Perf ${run}`, baseCurrencyCode: "INR" } });
    const user = await prisma.user.create({ data: { companyId: company.id, email: `perf.${run}@an-perf.local`, passwordHash: "x", fullName: `Perf ${run}` } });
    actor = { companyId: company.id, userId: user.id, branchId: null };
    const c = company.id;
    // Reps and customers.
    await prisma.$executeRawUnsafe(`INSERT INTO users (id, company_id, email, password_hash, full_name, updated_at) SELECT gen_random_uuid(), '${c}', 'rep' || g || '.${run}@an-perf.local', 'x', 'Rep ' || g, now() FROM generate_series(1, 20) g`);
    await prisma.$executeRawUnsafe(`INSERT INTO customers (id, company_id, code, name, updated_at) SELECT gen_random_uuid(), '${c}', 'PC' || g || '-${run}', 'Perf customer ' || g, now() FROM generate_series(1, 200) g`);
    await prisma.$executeRawUnsafe(`
      WITH reps AS (SELECT array_agg(id) a FROM users WHERE company_id = '${c}'), cus AS (SELECT array_agg(id) a FROM customers WHERE company_id = '${c}')
      INSERT INTO buyer_enquiries (id, company_id, enquiry_number, enquiry_date, requested_by_user_id, owner_user_id, customer_id, updated_at)
      SELECT gen_random_uuid(), '${c}', 'PENQ-${run}-' || g, CURRENT_DATE - (g % 729), reps.a[1 + g % array_length(reps.a, 1)], reps.a[1 + g % array_length(reps.a, 1)], cus.a[1 + g % array_length(cus.a, 1)], now()
      FROM generate_series(1, 50000) g, reps, cus`);
    await prisma.$executeRawUnsafe(`
      WITH reps AS (SELECT array_agg(id) a FROM users WHERE company_id = '${c}'), cus AS (SELECT array_agg(id) a FROM customers WHERE company_id = '${c}')
      INSERT INTO sales_orders (id, company_id, order_number, customer_id, order_date, status, currency_code, base_currency_code, total_amount, base_total_amount, requested_by_user_id, sales_rep_user_id, updated_at)
      SELECT gen_random_uuid(), '${c}', 'PORD-${run}-' || g, cus.a[1 + g % array_length(cus.a, 1)], CURRENT_DATE - (g % 729), 'CONFIRMED', 'INR', 'INR', 1000 + g % 5000, 1000 + g % 5000, reps.a[1 + g % 20], reps.a[1 + g % 20], now()
      FROM generate_series(1, 40000) g, reps, cus`);
    // Funnel volume: qualified activities, quotations with an issued revision, half of them accepted and ordered.
    await prisma.$executeRawUnsafe(`
      INSERT INTO buyer_enquiry_activities (id, company_id, buyer_enquiry_id, type, created_by_user_id, metadata)
      SELECT gen_random_uuid(), e.company_id, e.id, 'STAGE_CHANGED', e.requested_by_user_id, '{"to":"QUALIFIED"}'::jsonb
      FROM buyer_enquiries e WHERE e.company_id = '${c}' AND (substring(e.enquiry_number from '[0-9]+$')::int % 2) = 0`);
    await prisma.$executeRawUnsafe(`
      INSERT INTO quotations (id, company_id, quotation_number, buyer_enquiry_id, customer_id, owner_user_id, created_by_user_id, updated_at)
      SELECT gen_random_uuid(), e.company_id, 'PQ-' || e.enquiry_number, e.id, e.customer_id, e.owner_user_id, e.requested_by_user_id, now()
      FROM buyer_enquiries e WHERE e.company_id = '${c}' AND (substring(e.enquiry_number from '[0-9]+$')::int % 5) IN (0, 1)`);
    await prisma.$executeRawUnsafe(`
      INSERT INTO quotation_revisions (id, company_id, quotation_id, revision_number, title, quotation_date, valid_until, currency_code, created_by_user_id, issued_at, status, taxable_total, updated_at)
      SELECT gen_random_uuid(), q.company_id, q.id, 1, 'Quote', CURRENT_DATE, CURRENT_DATE + 30, 'INR', q.created_by_user_id, now(),
        CASE WHEN (substring(q.quotation_number from '[0-9]+$')::int % 5) = 0 THEN 'ACCEPTED' ELSE 'ISSUED' END::"QuotationRevisionStatus", 1000, now()
      FROM quotations q WHERE q.company_id = '${c}'`);
    await prisma.$executeRawUnsafe(`
      INSERT INTO sales_orders (id, company_id, order_number, customer_id, order_date, status, currency_code, base_currency_code, total_amount, base_total_amount, requested_by_user_id, sales_rep_user_id, source_quotation_revision_id, updated_at)
      SELECT gen_random_uuid(), q.company_id, 'PQO-' || q.quotation_number, q.customer_id, CURRENT_DATE, 'CONFIRMED', 'INR', 'INR', 1000, 1000, q.created_by_user_id, q.owner_user_id, r.id, now()
      FROM quotations q JOIN quotation_revisions r ON r.quotation_id = q.id WHERE q.company_id = '${c}' AND r.status::text = 'ACCEPTED'`);
    await prisma.$executeRawUnsafe(`
      INSERT INTO sales_invoices (id, company_id, invoice_number, sales_order_id, customer_id, invoice_date, due_date, status, currency_code, base_currency_code, subtotal_amount, tax_amount, total_amount, base_total_amount, created_by_user_id, updated_at)
      SELECT gen_random_uuid(), so.company_id, 'PINV-' || so.order_number, so.id, so.customer_id, so.order_date, so.order_date, 'POSTED', 'INR', 'INR', so.base_total_amount, so.base_total_amount * 0.05, so.base_total_amount * 1.05, so.base_total_amount * 1.05, '${user.id}', now()
      FROM sales_orders so WHERE so.company_id = '${c}' AND (substring(so.order_number from '[0-9]+$')::int % 4) <> 0`);
    await prisma.$executeRawUnsafe(`ANALYZE buyer_enquiries; ANALYZE buyer_enquiry_activities; ANALYZE quotations; ANALYZE quotation_revisions; ANALYZE sales_orders; ANALYZE sales_invoices;`).catch(() => undefined);
  }, 300_000);

  afterAll(async () => {
    process.stderr.write(`\nPhase 17 analytics timings (ms):\n${timings.map(([k, v]) => `  ${k.padEnd(48)} ${v}`).join("\n")}\n`);
    await prisma.$disconnect();
  });

  const time = async (label: string, q: Record<string, unknown>) => {
    const t = Date.now();
    const r = await engine.runReport(actor, { from, to, ...q });
    const ms = Date.now() - t;
    timings.push([label, ms]);
    return { r, ms };
  };

  it("bounded reports on ~200k source rows stay well inside the timeout", async () => {
    const cases: [string, Record<string, unknown>][] = [
      ["orders total + reconciliation (2 years)", { dataset: "orders", metrics: ["booked_order_value", "booked_order_count", "avg_order_value"] }],
      ["orders by month, vs previous period", { dataset: "orders", metrics: ["booked_order_value"], groupBy: ["period"], compare: "previous_period", from: new Date(Date.now() - 364 * 86_400_000).toISOString().slice(0, 10) }],
      ["orders by customer × rep (top 500)", { dataset: "orders", metrics: ["booked_order_value", "booked_order_count"], groupBy: ["customer", "rep"], limit: 500 }],
      ["orders by fiscal quarter", { dataset: "orders", metrics: ["booked_order_value"], groupBy: ["period"], timeGrain: "fiscal_quarter" }],
      ["invoices by customer + reconciliation", { dataset: "invoices", metrics: ["invoiced_value", "invoiced_value_incl_tax"], groupBy: ["customer"] }],
      ["enquiries by owner × month", { dataset: "enquiries", metrics: ["enquiry_count", "qualified_enquiry_count"], groupBy: ["owner", "period"] }],
      ["funnel (50k enquiries, all stages)", { dataset: "funnel", metrics: ["funnel_received", "funnel_qualified", "funnel_quoted", "funnel_accepted", "funnel_ordered", "funnel_invoiced"] }],
    ];
    for (const [label, q] of cases) {
      const { r, ms } = await time(label, q);
      expect(ms, label).toBeLessThan(6_000);
      if (r.meta.reconciliation) expect(r.meta.reconciliation.matches, label).toBe(true);
    }
    const t = await time("orders total (again, warm)", cases[0][1]);
    expect(t.r.totals.values.booked_order_count).toBe(50_000);
    const f = await time("funnel by owner", { dataset: "funnel", metrics: ["funnel_received", "funnel_qualified", "funnel_quoted", "funnel_accepted", "funnel_ordered", "funnel_invoiced"], groupBy: ["owner"] });
    expect(f.r.totals.values).toMatchObject({ funnel_received: 50_000, funnel_qualified: 25_000, funnel_quoted: 20_000, funnel_accepted: 10_000, funnel_ordered: 10_000 });
  }, 300_000);
});
