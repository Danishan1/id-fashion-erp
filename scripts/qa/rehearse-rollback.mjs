// Rollback rehearsal on a staging snapshot (Platform SaaS Phase 6, PLAT-034).
//
//   node --env-file=.env scripts/qa/rehearse-rollback.mjs [--keep]
//
// 1. Snapshots DATABASE_URL with pg_dump into "<name>_rollback_staging".
// 2. Runs prisma/rollback/*.down.sql newest-first, each in its own transaction.
// 3. Checks: every SaaS table is gone, the last applied migration is the one
//    before the SaaS work, and core business row counts are unchanged.
// 4. Re-applies the migrations with `prisma migrate deploy` and checks the
//    database matches prisma/schema.prisma again (roll forward works).
// The snapshot database is dropped at the end unless --keep is passed.
// Needs pg_dump / pg_restore: set PG_BIN if they aren't on PATH.
import pg from "pg";
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync, execSync } from "child_process";

const PG_BIN = process.env.PG_BIN ?? (process.platform === "win32" ? "C:/Program Files/PostgreSQL/16/bin" : "");
const bin = (name) => (PG_BIN ? path.join(PG_BIN, process.platform === "win32" ? `${name}.exe` : name) : name);
const keep = process.argv.includes("--keep");

const source = new URL(process.env.DATABASE_URL);
const stagingName = `${source.pathname.slice(1)}_rollback_staging`;
const stagingUrl = new URL(source);
stagingUrl.pathname = `/${stagingName}`;
const adminUrl = new URL(source);
adminUrl.pathname = "/postgres";
const pgEnv = { ...process.env, PGPASSWORD: decodeURIComponent(source.password) };
const connArgs = ["-h", source.hostname, "-p", source.port || "5432", "-U", decodeURIComponent(source.username)];

const SAAS_TABLES = [
  "platform_users", "support_access_requests", "support_access_sessions", "support_access_events",
  "company_module_entitlements", "subscription_plans", "subscription_plan_modules", "company_subscriptions",
  "subscription_payments", "coupons", "coupon_plans", "coupon_redemptions", "support_tickets",
  "support_ticket_messages", "support_ticket_attachments",
];
const CORE_TABLES = [
  "companies", "users", "roles", "role_permissions", "customers", "suppliers", "products", "sales_orders",
  "purchase_orders", "production_orders", "journals", "journal_lines", "inventory_transactions", "audit_logs",
  "attachments", "document_sequences",
];
const LAST_PRE_SAAS_MIGRATION = "20261011100000_crm_message_templates";

let ok = true;
const fail = (msg) => {
  ok = false;
  console.log(`FAIL  ${msg}`);
};
const okMsg = (msg) => console.log(`PASS  ${msg}`);

const admin = new pg.Client({ connectionString: adminUrl.toString() });
await admin.connect();
await admin.query(`drop database if exists "${stagingName}" with (force)`);
await admin.query(`create database "${stagingName}"`);

const dumpFile = path.join(os.tmpdir(), `${stagingName}-${Date.now()}.dump`);
console.log(`Snapshotting ${source.pathname.slice(1)} → ${stagingName} ...`);
execFileSync(bin("pg_dump"), [...connArgs, "-Fc", "-f", dumpFile, source.pathname.slice(1)], { env: pgEnv, stdio: "inherit" });
execFileSync(bin("pg_restore"), [...connArgs, "--no-owner", "-d", stagingName, dumpFile], { env: pgEnv, stdio: "inherit" });
fs.unlinkSync(dumpFile);

const db = new pg.Client({ connectionString: stagingUrl.toString() });
await db.connect();
const counts = async (tables) => {
  const out = {};
  for (const t of tables) {
    const exists = (await db.query(`select to_regclass($1) r`, [`public.${t}`])).rows[0].r;
    // The rollback deliberately removes SUPPORT_TICKET numbering rows (it must, to drop that
    // enum value), so they are not counted as core data.
    const where = t === "document_sequences" ? " where document_type::text <> 'SUPPORT_TICKET'" : "";
    out[t] = exists ? Number((await db.query(`select count(*) from "${t}"${where}`)).rows[0].count) : null;
  }
  return out;
};

try {
  const coreBefore = await counts(CORE_TABLES);
  const saasBefore = await counts(SAAS_TABLES);
  console.log("SaaS rows before rollback:", saasBefore);

  const dir = path.join("prisma", "rollback");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".down.sql")).sort().reverse();
  for (const file of files) {
    const sql = fs.readFileSync(path.join(dir, file), "utf8");
    try {
      await db.query("begin");
      await db.query(sql);
      await db.query("commit");
      okMsg(`rolled back ${file.replace(".down.sql", "")}`);
    } catch (e) {
      await db.query("rollback");
      fail(`${file}: ${e.message}`);
      throw e;
    }
  }

  const saasAfter = await counts(SAAS_TABLES);
  const left = Object.entries(saasAfter).filter(([, v]) => v !== null).map(([k]) => k);
  left.length ? fail(`SaaS tables still present: ${left.join(", ")}`) : okMsg("every SaaS table removed");

  const { rows: [last] } = await db.query(
    `select migration_name from _prisma_migrations where finished_at is not null order by migration_name desc limit 1`
  );
  last?.migration_name === LAST_PRE_SAAS_MIGRATION
    ? okMsg(`last applied migration is ${LAST_PRE_SAAS_MIGRATION}`)
    : fail(`last applied migration is ${last?.migration_name}`);

  const { rows: enumLeft } = await db.query(
    `select 1 from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='DocumentType' and e.enumlabel='SUPPORT_TICKET'`
  );
  enumLeft.length ? fail("DocumentType still has SUPPORT_TICKET") : okMsg("DocumentType enum restored");

  const coreAfter = await counts(CORE_TABLES);
  const changed = CORE_TABLES.filter((t) => coreBefore[t] !== coreAfter[t]);
  changed.length
    ? fail(`core row counts changed: ${changed.map((t) => `${t} ${coreBefore[t]}→${coreAfter[t]}`).join(", ")}`)
    : okMsg(`core business data untouched (${CORE_TABLES.length} tables, same row counts)`);

  // Roll forward again.
  await db.end();
  const env = { ...process.env, DATABASE_URL: stagingUrl.toString() };
  const deploy = execSync("npx prisma migrate deploy", { env, encoding: "utf8" });
  /successfully applied|already in sync/i.test(deploy) ? okMsg("migrations re-applied on the rolled-back database") : fail(deploy);
  const diff = execSync("npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script", { env, encoding: "utf8" });
  const statements = diff.split("\n").filter((l) => l.trim() && !l.trim().startsWith("--"));
  // The source database may carry drift that predates this work; report it, but only
  // fail if it touches a SaaS table.
  const saasDrift = statements.filter((l) => SAAS_TABLES.some((t) => l.includes(`"${t}"`)));
  saasDrift.length ? fail(`SaaS drift after roll-forward:\n${saasDrift.join("\n")}`) : okMsg("SaaS schema identical to schema.prisma after roll-forward");
  if (statements.length) console.log(`(pre-existing, non-SaaS drift in the source database:\n  ${statements.join("\n  ")})`);
  await db.connect().catch(() => {});
} catch (e) {
  ok = false;
  console.log("ERROR", e.message);
} finally {
  await db.end().catch(() => {});
  if (!keep) {
    await admin.query(`drop database if exists "${stagingName}" with (force)`);
    console.log(`Dropped ${stagingName}`);
  }
  await admin.end();
}
console.log(ok ? "\nROLLBACK REHEARSAL PASSED" : "\nROLLBACK REHEARSAL FAILED");
process.exit(ok ? 0 : 1);
