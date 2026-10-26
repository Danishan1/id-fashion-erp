#!/usr/bin/env node
/**
 * Pre-deploy migration checks. Run before any `prisma migrate deploy`:
 *   node scripts/check-migrations.mjs
 *
 * Fails (exit 1) when a migration would break or conflict on deploy:
 *  - a migration folder with a bad name, or no / an empty migration.sql;
 *  - a migration.sql that was EDITED after it was first committed (Prisma
 *    stores a checksum when it applies a migration — an edited file no longer
 *    matches what the database ran);
 *  - the known schema drift line `ALTER TABLE "sample_requests" DROP COLUMN
 *    "color"` outside the one old migration that legitimately ran it;
 *  - schema.prisma no longer matching the migrations (only when a
 *    SHADOW_DATABASE_URL is set; skipped otherwise).
 *
 * Two migrations sharing a timestamp is only a warning — Prisma orders by the
 * full folder name, and many already-deployed folders share one.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const MIGRATIONS_DIR = path.join(ROOT, "prisma", "migrations");

// Migrations whose files were already edited after being committed, before
// this check existed. Never add to this list — create a new migration instead.
const EDITED_ALLOWLIST = new Set(["20260827100000_add_supplier_category_master"]);

// The one old migration that really dropped sample_requests.color.
const COLOR_DROP_ALLOWLIST = new Set(["20260915120000_add_masters_and_sample_color_size"]);

const errors = [];
const warnings = [];

const folders = readdirSync(MIGRATIONS_DIR)
  .filter((name) => statSync(path.join(MIGRATIONS_DIR, name)).isDirectory())
  .sort();

const byTimestamp = new Map();
for (const name of folders) {
  if (!/^\d{14}(_[A-Za-z0-9_]+)?$/.test(name)) {
    errors.push(`${name}: folder name must be <14-digit timestamp>_<name>.`);
  }
  const file = path.join(MIGRATIONS_DIR, name, "migration.sql");
  if (!existsSync(file)) {
    errors.push(`${name}: migration.sql is missing.`);
    continue;
  }
  const sql = readFileSync(file, "utf8");
  if (!sql.trim()) errors.push(`${name}: migration.sql is empty.`);

  const executable = sql
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  if (/ALTER\s+TABLE\s+"sample_requests"\s+DROP\s+COLUMN\s+"color"/i.test(executable) && !COLOR_DROP_ALLOWLIST.has(name)) {
    errors.push(`${name}: drops sample_requests.color (known schema drift) — remove that line from the migration.`);
  }

  const ts = name.slice(0, 14);
  byTimestamp.set(ts, [...(byTimestamp.get(ts) ?? []), name]);
}

for (const [ts, names] of byTimestamp) {
  if (names.length > 1) warnings.push(`timestamp ${ts} is shared by: ${names.join(", ")}`);
}

if (!existsSync(path.join(MIGRATIONS_DIR, "migration_lock.toml"))) {
  errors.push("prisma/migrations/migration_lock.toml is missing.");
}

// Edited-after-commit check (needs git history).
try {
  const shallow = execFileSync("git", ["rev-parse", "--is-shallow-repository"], { cwd: ROOT, encoding: "utf8" }).trim();
  if (shallow === "true") {
    warnings.push("shallow git clone — skipped the edited-migration check.");
  } else {
    const modified = execFileSync(
      "git",
      ["log", "--diff-filter=M", "--name-only", "--format=", "--", "prisma/migrations"],
      { cwd: ROOT, encoding: "utf8" }
    );
    // Uncommitted edits count too.
    const dirty = execFileSync("git", ["diff", "--name-only", "HEAD", "--", "prisma/migrations"], { cwd: ROOT, encoding: "utf8" });
    const edited = new Set();
    for (const line of `${modified}\n${dirty}`.split(/\r?\n/)) {
      const m = line.trim().match(/^prisma\/migrations\/([^/]+)\/migration\.sql$/);
      if (m && !EDITED_ALLOWLIST.has(m[1])) edited.add(m[1]);
    }
    for (const name of edited) {
      errors.push(`${name}: migration.sql was edited after it was committed. Revert it and put the change in a NEW migration.`);
    }
  }
} catch {
  warnings.push("git is not available — skipped the edited-migration check.");
}

// Schema vs migrations (needs a throwaway shadow database).
if (process.env.SHADOW_DATABASE_URL) {
  try {
    execFileSync(
      "npx",
      [
        "prisma",
        "migrate",
        "diff",
        "--from-migrations",
        "prisma/migrations",
        "--to-schema",
        "prisma/schema.prisma",
        "--shadow-database-url",
        process.env.SHADOW_DATABASE_URL,
        "--exit-code",
      ],
      { cwd: ROOT, stdio: "pipe", shell: process.platform === "win32" }
    );
  } catch (e) {
    if (e.status === 2) {
      errors.push("schema.prisma has changes that no migration creates. Add a migration for them.");
    } else {
      warnings.push(`schema-vs-migrations check could not run: ${String(e.stderr ?? e.message).trim().split("\n")[0]}`);
    }
  }
}

for (const w of warnings) console.warn(`WARN  ${w}`);
if (errors.length) {
  for (const e of errors) console.error(`ERROR ${e}`);
  console.error(`\nMigration check failed (${errors.length} problem(s)). Nothing was deployed.`);
  process.exit(1);
}
console.log(`Migration check passed: ${folders.length} migrations.`);
