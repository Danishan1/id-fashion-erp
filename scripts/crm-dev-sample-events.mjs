// DEV ONLY — CRM Phase 01 UI check. Inserts a handful of clearly labelled
// sample CRM events so the CRM Dashboard timeline and Activity Log (filters,
// drawer, paging) can be checked before real CRM records exist (Phase 02+).
// Sample rows point at random record ids and carry correlation_id
// "dev-sample", so they are easy to spot and to remove.
//
//   node scripts/crm-dev-sample-events.mjs            # add samples to the first company
//   node scripts/crm-dev-sample-events.mjs --remove   # delete only those samples
//
// Never run against production data.
import pkg from "@prisma/client";
const { PrismaClient } = pkg;
import { PrismaPg } from "@prisma/adapter-pg";
import { randomUUID } from "node:crypto";
import "dotenv/config";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const TAG = "dev-sample";

async function main() {
  if (process.argv.includes("--remove")) {
    const { count } = await prisma.crmEvent.deleteMany({ where: { correlationId: TAG } });
    console.log(`Removed ${count} sample CRM event(s).`);
    return;
  }

  const company = await prisma.company.findFirst({ orderBy: { createdAt: "asc" } });
  if (!company) throw new Error("No company found — run the seed first.");
  const user = await prisma.user.findFirst({ where: { companyId: company.id }, orderBy: { createdAt: "asc" } });

  const lead = randomUUID();
  const contact = randomUUID();
  const org = randomUUID();
  const opp = randomUUID();
  const day = 24 * 60 * 60 * 1000;
  const now = Date.now();

  const rows = [
    ["LEAD", lead, "lead.created", "[Sample] Lead created: Nordic Threads AB", 3 * day, { source: "Trade show" }],
    ["LEAD", lead, "lead.updated", "[Sample] Lead phone number updated", 3 * day - 2 * 3600e3, { changed: ["phone"] }],
    ["COMPANY", org, "company.created", "[Sample] Company created: Nordic Threads AB", 2 * day, null],
    ["CONTACT", contact, "contact.created", "[Sample] Contact created: Elin Berg (Buyer)", 2 * day - 3600e3, null],
    ["OPPORTUNITY", opp, "opportunity.created", "[Sample] Opportunity: SS27 knit tops, 12,000 pcs", 1 * day, { value: 54000, currency: "USD" }],
    ["OPPORTUNITY", opp, "opportunity.stage_changed", "[Sample] Stage: Qualified → Sampling", 1 * day - 4 * 3600e3, { from: "Qualified", to: "Sampling" }],
    ["OPPORTUNITY", opp, "opportunity.stage_changed", "[Sample] Stage: Sampling → Negotiation", 2 * 3600e3, { from: "Sampling", to: "Negotiation" }],
    ["OPPORTUNITY", opp, "opportunity.won", "[Sample] Opportunity won", 30 * 60e3, { value: 54000, currency: "USD" }],
  ];

  await prisma.crmEvent.createMany({
    data: rows.map(([entityType, entityId, eventType, summary, ago, payload]) => ({
      companyId: company.id,
      entityType,
      entityId,
      eventType,
      summary,
      payload: payload ?? undefined,
      actorUserId: user?.id ?? null,
      correlationId: TAG,
      occurredAt: new Date(now - ago),
    })),
  });
  console.log(`Added ${rows.length} sample CRM events to "${company.name}". Remove with: node scripts/crm-dev-sample-events.mjs --remove`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
