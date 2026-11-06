-- Rollback for 20261028250000_sales_marketing_foundation
-- Removes the sales_marketing permission rows (their role grants and user
-- overrides cascade) and gives plans/companies their old "MARKETING" package
-- key back. Run before rolling back 20261028240000_remove_legacy_marketing.
DELETE FROM "permissions" WHERE "module" = 'sales_marketing';
UPDATE "company_module_entitlements" SET "package_key" = 'MARKETING' WHERE "package_key" = 'SALES_MARKETING';
UPDATE "subscription_plan_modules" SET "package_key" = 'MARKETING' WHERE "package_key" = 'SALES_MARKETING';
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261028250000_sales_marketing_foundation';
