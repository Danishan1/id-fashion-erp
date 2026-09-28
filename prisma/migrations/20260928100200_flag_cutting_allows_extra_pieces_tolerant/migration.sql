-- Follow-up to 20260928100100: real stage data uses codes like 'CUTTING'
-- and names with stray whitespace ('Cutting '), which the first, exact
-- match missed. Match trimmed, case-insensitively, on the common variants.
UPDATE "production_stages"
SET "allows_extra_quantity" = true
WHERE UPPER(TRIM("code")) IN ('CUT', 'CUTTING')
   OR LOWER(TRIM("name")) = 'cutting';
