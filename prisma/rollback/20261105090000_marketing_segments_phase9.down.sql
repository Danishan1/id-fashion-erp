-- Rollback for 20261105090000_marketing_segments_phase9. Run before the Phase 08 down script.
-- Loses segments, their versions, members, evaluations / snapshots and campaign
-- audiences. CRM records, customers and campaigns themselves are untouched.
BEGIN;
DROP TABLE IF EXISTS "marketing_campaign_audiences";
DROP TABLE IF EXISTS "marketing_segment_snapshot_entries";
DROP TABLE IF EXISTS "marketing_segment_evaluations";
DROP TABLE IF EXISTS "marketing_segment_members";
DROP TABLE IF EXISTS "marketing_segment_versions";
DROP FUNCTION IF EXISTS marketing_segment_versions_guard();
DROP TABLE IF EXISTS "marketing_segments";
DROP TYPE IF EXISTS "MarketingCampaignAudienceRole";
DROP TYPE IF EXISTS "MarketingSegmentEntryOutcome";
DROP TYPE IF EXISTS "MarketingSegmentEvaluationStatus";
DROP TYPE IF EXISTS "MarketingSegmentMemberKind";
DROP TYPE IF EXISTS "MarketingSegmentRefresh";
DROP TYPE IF EXISTS "MarketingSegmentStatus";
DROP TYPE IF EXISTS "MarketingSegmentType";
DROP TYPE IF EXISTS "MarketingSegmentSource";
DELETE FROM "permissions" WHERE "module" = 'marketing_segments';
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261105090000_marketing_segments_phase9';
COMMIT;
