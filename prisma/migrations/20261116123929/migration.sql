-- DropForeignKey
ALTER TABLE "buyer_enquiries" DROP CONSTRAINT "buyer_enquiries_campaign_id_fkey";

-- DropForeignKey
ALTER TABLE "crm_leads" DROP CONSTRAINT "crm_leads_campaign_id_fkey";

-- DropForeignKey
ALTER TABLE "expenses" DROP CONSTRAINT "expenses_budget_allocation_id_fkey";

-- DropForeignKey
ALTER TABLE "expenses" DROP CONSTRAINT "expenses_campaign_id_fkey";

-- DropForeignKey
ALTER TABLE "marketing_asset_versions" DROP CONSTRAINT "marketing_asset_versions_created_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "marketing_assets" DROP CONSTRAINT "marketing_assets_approved_version_id_fkey";

-- DropForeignKey
ALTER TABLE "marketing_assets" DROP CONSTRAINT "marketing_assets_created_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "marketing_assets" DROP CONSTRAINT "marketing_assets_current_version_id_fkey";

-- DropForeignKey
ALTER TABLE "marketing_assets" DROP CONSTRAINT "marketing_assets_owner_user_id_fkey";

-- DropForeignKey
ALTER TABLE "marketing_attribution_checkpoints" DROP CONSTRAINT "marketing_attribution_checkpoints_company_id_fkey";

-- DropForeignKey
ALTER TABLE "marketing_attribution_credits" DROP CONSTRAINT "marketing_attribution_credits_campaign_id_fkey";

-- DropForeignKey
ALTER TABLE "marketing_attribution_model_versions" DROP CONSTRAINT "marketing_attribution_versions_created_by_fkey";

-- DropForeignKey
ALTER TABLE "marketing_attribution_model_versions" DROP CONSTRAINT "marketing_attribution_versions_decided_by_fkey";

-- DropForeignKey
ALTER TABLE "marketing_attribution_models" DROP CONSTRAINT "marketing_attribution_models_approved_version_id_fkey";

-- DropForeignKey
ALTER TABLE "marketing_attribution_models" DROP CONSTRAINT "marketing_attribution_models_company_id_fkey";

-- DropForeignKey
ALTER TABLE "marketing_attribution_models" DROP CONSTRAINT "marketing_attribution_models_created_by_fkey";

-- DropForeignKey
ALTER TABLE "marketing_attribution_models" DROP CONSTRAINT "marketing_attribution_models_owner_user_id_fkey";

-- DropForeignKey
ALTER TABLE "marketing_attribution_runs" DROP CONSTRAINT "marketing_attribution_runs_requested_by_fkey";

-- DropForeignKey
ALTER TABLE "marketing_budget_allocations" DROP CONSTRAINT "marketing_budget_allocations_campaign_channel_id_fkey";

-- DropForeignKey
ALTER TABLE "marketing_budget_allocations" DROP CONSTRAINT "marketing_budget_allocations_created_by_fkey";

-- DropForeignKey
ALTER TABLE "marketing_campaign_audiences" DROP CONSTRAINT "marketing_campaign_audiences_pinned_evaluation_id_fkey";

-- DropForeignKey
ALTER TABLE "marketing_campaign_channels" DROP CONSTRAINT "marketing_campaign_channels_content_id_fkey";

-- DropForeignKey
ALTER TABLE "marketing_campaign_content_versions" DROP CONSTRAINT "marketing_campaign_content_versions_created_by_fkey";

-- DropForeignKey
ALTER TABLE "marketing_campaign_contents" DROP CONSTRAINT "marketing_campaign_contents_approved_version_id_fkey";

-- DropForeignKey
ALTER TABLE "marketing_campaign_contents" DROP CONSTRAINT "marketing_campaign_contents_created_by_fkey";

-- DropForeignKey
ALTER TABLE "marketing_campaign_contents" DROP CONSTRAINT "marketing_campaign_contents_current_version_id_fkey";

-- DropForeignKey
ALTER TABLE "marketing_campaigns" DROP CONSTRAINT "marketing_campaigns_parent_campaign_id_fkey";

-- DropForeignKey
ALTER TABLE "marketing_content_review_events" DROP CONSTRAINT "marketing_content_review_events_actor_fkey";

-- DropForeignKey
ALTER TABLE "marketing_content_reviews" DROP CONSTRAINT "marketing_content_reviews_company_id_fkey";

-- DropForeignKey
ALTER TABLE "marketing_content_reviews" DROP CONSTRAINT "marketing_content_reviews_decided_by_fkey";

-- DropForeignKey
ALTER TABLE "marketing_content_reviews" DROP CONSTRAINT "marketing_content_reviews_submitted_by_fkey";

-- DropForeignKey
ALTER TABLE "marketing_conversions" DROP CONSTRAINT "marketing_conversions_company_id_fkey";

-- DropForeignKey
ALTER TABLE "marketing_delivery_runs" DROP CONSTRAINT "marketing_delivery_runs_content_version_id_fkey";

-- DropForeignKey
ALTER TABLE "marketing_promotion_redemptions" DROP CONSTRAINT "marketing_promotion_redemptions_quotation_id_fkey";

-- DropForeignKey
ALTER TABLE "marketing_promotion_redemptions" DROP CONSTRAINT "marketing_promotion_redemptions_quotation_revision_id_fkey";

-- DropForeignKey
ALTER TABLE "marketing_promotion_redemptions" DROP CONSTRAINT "marketing_promotion_redemptions_sales_order_id_fkey";

-- DropForeignKey
ALTER TABLE "marketing_promotion_versions" DROP CONSTRAINT "marketing_promotion_versions_created_by_fkey";

-- DropForeignKey
ALTER TABLE "marketing_promotion_versions" DROP CONSTRAINT "marketing_promotion_versions_decided_by_fkey";

-- DropForeignKey
ALTER TABLE "marketing_promotion_versions" DROP CONSTRAINT "marketing_promotion_versions_segment_evaluation_id_fkey";

-- DropForeignKey
ALTER TABLE "marketing_promotions" DROP CONSTRAINT "marketing_promotions_approved_version_id_fkey";

-- DropForeignKey
ALTER TABLE "marketing_promotions" DROP CONSTRAINT "marketing_promotions_company_id_fkey";

-- DropForeignKey
ALTER TABLE "marketing_promotions" DROP CONSTRAINT "marketing_promotions_created_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "marketing_touchpoints" DROP CONSTRAINT "marketing_touchpoints_campaign_id_fkey";

-- DropForeignKey
ALTER TABLE "marketing_touchpoints" DROP CONSTRAINT "marketing_touchpoints_company_id_fkey";

-- DropForeignKey
ALTER TABLE "purchase_invoices" DROP CONSTRAINT "purchase_invoices_budget_allocation_id_fkey";

-- DropForeignKey
ALTER TABLE "purchase_invoices" DROP CONSTRAINT "purchase_invoices_campaign_id_fkey";

-- DropForeignKey
ALTER TABLE "purchase_orders" DROP CONSTRAINT "purchase_orders_budget_allocation_id_fkey";

-- DropForeignKey
ALTER TABLE "purchase_orders" DROP CONSTRAINT "purchase_orders_campaign_id_fkey";

-- DropForeignKey
ALTER TABLE "quotations" DROP CONSTRAINT "quotations_campaign_id_fkey";

-- DropForeignKey
ALTER TABLE "sales_orders" DROP CONSTRAINT "sales_orders_campaign_id_fkey";

-- DropIndex
DROP INDEX "crm_webhook_deliveries_sub_status_idx";

-- DropIndex
DROP INDEX "crm_webhook_subscriptions_company_scope_idx";

-- DropIndex
DROP INDEX "expenses_budget_allocation_id_idx";

-- DropIndex
DROP INDEX "marketing_asset_versions_storage_key_key";

-- DropIndex
DROP INDEX "marketing_assets_tags_idx";

-- DropIndex
DROP INDEX "marketing_touchpoints_identity_keys_idx";

-- DropIndex
DROP INDEX "purchase_invoices_budget_allocation_id_idx";

-- DropIndex
DROP INDEX "purchase_invoices_company_id_campaign_id_idx";

-- DropIndex
DROP INDEX "purchase_orders_budget_allocation_id_idx";

-- DropIndex
DROP INDEX "purchase_orders_company_id_campaign_id_idx";

-- DropIndex
DROP INDEX "sm_workflow_instances_watch_keys_idx";

-- AlterTable
ALTER TABLE "integration_api_usage" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "integration_conflicts" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "integration_events" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "integration_external_refs" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "integration_idempotency" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "integration_sync_checkpoints" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "integrations" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "marketing_attribution_credits" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "marketing_attribution_model_versions" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "marketing_attribution_models" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "marketing_attribution_results" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "marketing_attribution_runs" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "marketing_conversions" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "marketing_touchpoints" ALTER COLUMN "id" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "marketing_budget_alerts_campaign_id_status_idx" ON "marketing_budget_alerts"("campaign_id", "status");

-- RenameForeignKey
ALTER TABLE "marketing_campaign_content_versions" RENAME CONSTRAINT "marketing_campaign_content_versions_source_template_version_id_" TO "marketing_campaign_content_versions_source_template_versio_fkey";

-- AddForeignKey
ALTER TABLE "buyer_enquiries" ADD CONSTRAINT "buyer_enquiries_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "marketing_campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "marketing_campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "marketing_campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_budget_allocation_id_fkey" FOREIGN KEY ("budget_allocation_id") REFERENCES "marketing_budget_allocations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "marketing_campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_budget_allocation_id_fkey" FOREIGN KEY ("budget_allocation_id") REFERENCES "marketing_budget_allocations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "marketing_campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_budget_allocation_id_fkey" FOREIGN KEY ("budget_allocation_id") REFERENCES "marketing_budget_allocations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "marketing_campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "marketing_campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_campaigns" ADD CONSTRAINT "marketing_campaigns_parent_campaign_id_fkey" FOREIGN KEY ("parent_campaign_id") REFERENCES "marketing_campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_campaign_audiences" ADD CONSTRAINT "marketing_campaign_audiences_pinned_evaluation_id_fkey" FOREIGN KEY ("pinned_evaluation_id") REFERENCES "marketing_segment_evaluations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_campaign_channels" ADD CONSTRAINT "marketing_campaign_channels_content_id_fkey" FOREIGN KEY ("content_id") REFERENCES "marketing_campaign_contents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_delivery_runs" ADD CONSTRAINT "marketing_delivery_runs_content_version_id_fkey" FOREIGN KEY ("content_version_id") REFERENCES "marketing_campaign_content_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_assets" ADD CONSTRAINT "marketing_assets_current_version_id_fkey" FOREIGN KEY ("current_version_id") REFERENCES "marketing_asset_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_assets" ADD CONSTRAINT "marketing_assets_approved_version_id_fkey" FOREIGN KEY ("approved_version_id") REFERENCES "marketing_asset_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_campaign_contents" ADD CONSTRAINT "marketing_campaign_contents_current_version_id_fkey" FOREIGN KEY ("current_version_id") REFERENCES "marketing_campaign_content_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_campaign_contents" ADD CONSTRAINT "marketing_campaign_contents_approved_version_id_fkey" FOREIGN KEY ("approved_version_id") REFERENCES "marketing_campaign_content_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_promotions" ADD CONSTRAINT "marketing_promotions_approved_version_id_fkey" FOREIGN KEY ("approved_version_id") REFERENCES "marketing_promotion_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_attribution_models" ADD CONSTRAINT "marketing_attribution_models_approved_version_id_fkey" FOREIGN KEY ("approved_version_id") REFERENCES "marketing_attribution_model_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "integration_external_refs_company_id_system_external_type_exter" RENAME TO "integration_external_refs_company_id_system_external_type_e_key";

-- RenameIndex
ALTER INDEX "marketing_attribution_model_versions_model_id_version_number_ke" RENAME TO "marketing_attribution_model_versions_model_id_version_numbe_key";

-- RenameIndex
ALTER INDEX "marketing_attribution_runs_model_version_id_status_finished_at_" RENAME TO "marketing_attribution_runs_model_version_id_status_finished_idx";

-- RenameIndex
ALTER INDEX "marketing_campaign_content_versions_content_id_version_number_k" RENAME TO "marketing_campaign_content_versions_content_id_version_numb_key";

-- RenameIndex
ALTER INDEX "marketing_channel_connections_company_id_channel_type_status_id" RENAME TO "marketing_channel_connections_company_id_channel_type_statu_idx";

-- RenameIndex
ALTER INDEX "marketing_content_version_assets_content_version_id_asset_versi" RENAME TO "marketing_content_version_assets_content_version_id_asset_v_key";

-- RenameIndex
ALTER INDEX "marketing_promotion_redemptions_promotion_id_quotation_revision" RENAME TO "marketing_promotion_redemptions_promotion_id_quotation_revi_key";

-- RenameIndex
ALTER INDEX "sm_workflow_definition_versions_definition_id_version_number_ke" RENAME TO "sm_workflow_definition_versions_definition_id_version_numbe_key";
