// Migration rehearsal (Platform SaaS Phase 6, PLAT-033).
//
//   node --env-file=.env scripts/qa/rehearse-migrations.mjs
//
// Builds a throwaway database next to DATABASE_URL ("<name>_rehearsal"), applies
// every migration from zero with `prisma migrate deploy`, seeds it, runs the
// permission catalog sync, then checks the result has no drift from
// prisma/schema.prisma. The rehearsal database is dropped at the end unless
// --keep is passed.
import pg from "pg";
import { execSync } from "child_process";

const source = new URL(process.env.DATABASE_URL);
const rehearsalName = `${source.pathname.slice(1)}_rehearsal`;
const rehearsalUrl = new URL(source);
rehearsalUrl.pathname = `/${rehearsalName}`;
const adminUrl = new URL(source);
adminUrl.pathname = "/postgres";
const keep = process.argv.includes("--keep");

const run = (cmd) => {
  console.log(`\n$ ${cmd}`);
  return execSync(cmd, {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, DATABASE_URL: rehearsalUrl.toString() },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
};

const admin = new pg.Client({ connectionString: adminUrl.toString() });
await admin.connect();
await admin.query(`drop database if exists "${rehearsalName}" with (force)`);
await admin.query(`create database "${rehearsalName}"`);
console.log(`Created empty database ${rehearsalName}`);

let ok = true;
try {
  const deploy = run("npx prisma migrate deploy");
  const applied = deploy.match(/(\d+) migrations? found/);
  console.log(deploy.split("\n").filter((l) => /migrations? (found|applied)|successfully/i.test(l)).join("\n"));
  console.log(applied ? `Migrations in folder: ${applied[1]}` : "");

  console.log(run("npx prisma db seed").split("\n").filter((l) => /Seed|error/i.test(l)).slice(-5).join("\n"));
  console.log(run("node --experimental-strip-types --no-warnings scripts/sync-permission-catalog.mjs").trim().split("\n").slice(-2).join("\n"));

  const diff = run("npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script");
  const statements = diff
    .split("\n")
    .filter((l) => l.trim() && !l.trim().startsWith("--"))
    .join("\n")
    .trim();
  if (statements && !/^-- This is an empty migration\.?$/m.test(diff)) {
    ok = false;
    console.log("\nDRIFT between migrations and schema.prisma:\n" + statements);
  } else {
    console.log("\nNo drift: the migrations produce exactly prisma/schema.prisma.");
  }

  const db = new pg.Client({ connectionString: rehearsalUrl.toString() });
  await db.connect();
  const counts = {};
  for (const t of ["companies", "permissions", "role_permissions", "platform_users", "subscription_plans", "_prisma_migrations"]) {
    counts[t] = Number((await db.query(`select count(*) from "${t}"`)).rows[0].count);
  }
  const failed = Number((await db.query(`select count(*) from _prisma_migrations where finished_at is null or rolled_back_at is not null`)).rows[0].count);
  await db.end();
  console.log("Row counts:", counts);
  if (failed) {
    ok = false;
    console.log(`${failed} migration(s) did not finish cleanly.`);
  }
} catch (e) {
  ok = false;
  console.log("FAILED:", e.stdout ?? "", e.stderr ?? e.message);
} finally {
  if (!keep) {
    await admin.query(`drop database if exists "${rehearsalName}" with (force)`);
    console.log(`Dropped ${rehearsalName}`);
  }
  await admin.end();
}
console.log(ok ? "\nREHEARSAL PASSED" : "\nREHEARSAL FAILED");
process.exit(ok ? 0 : 1);
