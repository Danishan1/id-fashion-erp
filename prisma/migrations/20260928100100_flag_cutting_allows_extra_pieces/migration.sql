-- Cutting can legitimately produce extra pieces from the fabric lay. Flag the
-- existing Cutting stage(s) so the explicit extra-pieces rule applies out of
-- the box; admins can change it per stage in Masters → Production Config.
UPDATE "production_stages"
SET "allows_extra_quantity" = true
WHERE UPPER("code") = 'CUT' OR LOWER("name") = 'cutting';
