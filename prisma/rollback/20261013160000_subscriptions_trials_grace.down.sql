-- Rollback of 20261013160000_subscriptions_trials_grace (Platform SaaS Phase 4).
-- Roll back 20261014100000 first (it adds columns/FKs to subscription_payments).
-- DATA LOSS: every plan, company subscription and recorded payment. After this,
-- companies have no trial/expiry and every module follows the per-company
-- overrides only (pre-Phase-4 behaviour).

DROP TABLE IF EXISTS "subscription_payments";
DROP TABLE IF EXISTS "company_subscriptions";
DROP TABLE IF EXISTS "subscription_plan_modules";
DROP TABLE IF EXISTS "subscription_plans";

DROP TYPE IF EXISTS "SubscriptionBillingCycle";
DROP TYPE IF EXISTS "SubscriptionPaymentMethod";

DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261013160000_subscriptions_trials_grace';
