#!/usr/bin/env node
/**
 * Merges Colors-master rows that share a name within a company (2026-10-24).
 *
 * Two colours with the same name split stock: stock was booked under one and
 * requests asked for the other, so Available showed 0.
 *
 * For each duplicate group:
 * - Keeper: the colour holding the most colour-wise stock, then the one with
 *   the most ledger rows, then the oldest.
 * - Every reference moves onto the keeper. A style variant that would clash
 *   with an existing keeper variant (same style + size) has its records moved
 *   onto that variant and is then deleted. Colour stock rows are added together.
 * - The extra colour is deactivated and renamed "<name> (merged into <code>)".
 *
 * Each group runs in its own transaction; any unique-key clash rolls it back.
 *
 *   node scripts/merge-duplicate-colors.mjs            # dry run, changes nothing
 *   node scripts/merge-duplicate-colors.mjs --apply
 */
import fs from "node:fs";
import pg from "pg";

const apply = process.argv.includes("--apply");
const envUrl = process.env.DATABASE_URL ?? fs.readFileSync(".env", "utf8").match(/^DATABASE_URL="?([^"\n]+)/m)?.[1];
if (!envUrl) throw new Error("DATABASE_URL is not set.");
const db = new pg.Client({ connectionString: envUrl });
await db.connect();

const fkColumns = async (table) =>
  (
    await db.query(
      `SELECT DISTINCT tc.table_name, kcu.column_name
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
         JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY' AND ccu.table_name = $1`,
      [table]
    )
  ).rows;

const colorRefs = (await fkColumns("colors")).filter((r) => !(r.table_name === "product_variants" || r.table_name === "stock_color_balances"));
const variantRefs = await fkColumns("product_variants");

const groups = (
  await db.query(
    `SELECT c.company_id, lower(trim(c.name)) AS key,
            json_agg(json_build_object(
              'id', c.id, 'code', c.code, 'name', c.name, 'createdAt', c.created_at,
              'stock', COALESCE((SELECT sum(quantity_on_hand) FROM stock_color_balances s WHERE s.color_id = c.id), 0),
              'ledger', (SELECT count(*) FROM inventory_transactions t WHERE t.color_id = c.id)
            )) AS colors
       FROM colors c
      GROUP BY 1, 2
     HAVING count(*) > 1`
  )
).rows;

if (groups.length === 0) console.log("No duplicate colour names found.");

for (const group of groups) {
  const colors = [...group.colors].sort(
    (a, b) => Number(b.stock) - Number(a.stock) || Number(b.ledger) - Number(a.ledger) || new Date(a.createdAt) - new Date(b.createdAt)
  );
  const keep = colors[0];
  const drops = colors.slice(1);
  console.log(`\n"${keep.name}": keep ${keep.code}, merge ${drops.map((d) => d.code).join(", ")}`);

  try {
    await db.query("BEGIN");
    for (const drop of drops) {
      const moved = {};
      const count = (key, n) => {
        if (n) moved[key] = (moved[key] ?? 0) + n;
      };

      // Style variants: re-colour, or fold into the keeper's same style+size variant.
      const variants = (
        await db.query(
          `SELECT d.id AS drop_id, k.id AS keep_id
             FROM product_variants d
             LEFT JOIN product_variants k ON k.product_id = d.product_id AND k.size_id = d.size_id AND k.color_id = $1
            WHERE d.color_id = $2`,
          [keep.id, drop.id]
        )
      ).rows;
      for (const v of variants) {
        if (!v.keep_id) {
          count("product_variants (re-coloured)", (await db.query(`UPDATE product_variants SET color_id = $1 WHERE id = $2`, [keep.id, v.drop_id])).rowCount);
          continue;
        }
        for (const ref of variantRefs) {
          count(`${ref.table_name} (variant merged)`, (await db.query(`UPDATE ${ref.table_name} SET ${ref.column_name} = $1 WHERE ${ref.column_name} = $2`, [v.keep_id, v.drop_id])).rowCount);
        }
        const keeperHasSku = (await db.query(`SELECT 1 FROM barcodes WHERE entity_type = 'SKU' AND entity_id = $1`, [v.keep_id])).rowCount > 0;
        if (keeperHasSku) await db.query(`DELETE FROM barcodes WHERE entity_type = 'SKU' AND entity_id = $1`, [v.drop_id]);
        else await db.query(`UPDATE barcodes SET entity_id = $1 WHERE entity_type = 'SKU' AND entity_id = $2`, [v.keep_id, v.drop_id]);
        count("product_variants (merged and deleted)", (await db.query(`DELETE FROM product_variants WHERE id = $1`, [v.drop_id])).rowCount);
      }

      // Colour-wise stock: add into the keeper's row for the same material+warehouse.
      const balances = (await db.query(`SELECT id, company_id, product_id, warehouse_id, quantity_on_hand FROM stock_color_balances WHERE color_id = $1`, [drop.id])).rows;
      for (const b of balances) {
        const merged = await db.query(
          `UPDATE stock_color_balances SET quantity_on_hand = quantity_on_hand + $1, updated_at = now()
            WHERE company_id = $2 AND product_id = $3 AND warehouse_id = $4 AND color_id = $5`,
          [b.quantity_on_hand, b.company_id, b.product_id, b.warehouse_id, keep.id]
        );
        if (merged.rowCount) await db.query(`DELETE FROM stock_color_balances WHERE id = $1`, [b.id]);
        else await db.query(`UPDATE stock_color_balances SET color_id = $1 WHERE id = $2`, [keep.id, b.id]);
        count("stock_color_balances", 1);
      }

      for (const ref of colorRefs) {
        count(`${ref.table_name}.${ref.column_name}`, (await db.query(`UPDATE ${ref.table_name} SET ${ref.column_name} = $1 WHERE ${ref.column_name} = $2`, [keep.id, drop.id])).rowCount);
      }

      await db.query(`UPDATE colors SET is_active = false, name = $1, updated_at = now() WHERE id = $2`, [`${drop.name} (merged into ${keep.code})`, drop.id]);
      await db.query(
        `INSERT INTO audit_logs (id, company_id, table_name, record_id, action, old_values, new_values, performed_at)
         VALUES (gen_random_uuid(), $1, 'colors', $2, 'UPDATE', $3, $4, now())`,
        [group.company_id, drop.id, JSON.stringify({ name: drop.name, code: drop.code, isActive: true }), JSON.stringify({ mergedIntoColorId: keep.id, mergedIntoCode: keep.code, moved })]
      );
      console.log(`  ${drop.code} -> ${keep.code}:`, moved);
    }
    await db.query(apply ? "COMMIT" : "ROLLBACK");
  } catch (err) {
    await db.query("ROLLBACK");
    console.error(`  FAILED, nothing changed for "${keep.name}":`, err.message);
  }
}

console.log(apply ? "\nApplied." : "\nDry run only — re-run with --apply to save.");
await db.end();
