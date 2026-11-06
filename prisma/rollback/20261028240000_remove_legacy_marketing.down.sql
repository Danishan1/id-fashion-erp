-- Rollback for 20261028240000_remove_legacy_marketing
-- Recreates the old Marketing schema EMPTY. The forward migration deleted the
-- campaign data, the CAMPAIGN_DAILY_METRIC import history, the CAMPAIGN number
-- sequences and every role grant on "marketing"; none of that comes back from
-- this script — restore it from the pre-deploy backup if it is needed.
-- Old code also needs its "marketing" role grants re-done by an admin.

-- Shared enum values (ADD VALUE can't run inside a transaction block).
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'CAMPAIGN';
ALTER TYPE "ImportBatchType" ADD VALUE IF NOT EXISTS 'CAMPAIGN_DAILY_METRIC';

ALTER TABLE "crm_leads" ADD COLUMN IF NOT EXISTS "campaign_id" UUID;

CREATE TYPE public."AdConnectionStatus" AS ENUM (
    'CONNECTED',
    'DISCONNECTED',
    'ERROR'
);
CREATE TYPE public."AdPlatform" AS ENUM (
    'META',
    'GOOGLE'
);
CREATE TYPE public."CampaignAlertPriority" AS ENUM (
    'MEDIUM',
    'HIGH'
);
CREATE TYPE public."CampaignAlertStatus" AS ENUM (
    'OPEN',
    'RESOLVED'
);
CREATE TYPE public."CampaignAlertType" AS ENUM (
    'BUDGET_OVERSPEND',
    'BUDGET_80_PERCENT',
    'LOW_ROAS',
    'ROAS_WATCH',
    'HIGH_CPL',
    'LOW_CONVERSION'
);
CREATE TYPE public."CampaignApprovalStatus" AS ENUM (
    'PENDING',
    'APPROVED',
    'REJECTED'
);
CREATE TYPE public."CampaignChannel" AS ENUM (
    'META_ADS',
    'GOOGLE_ADS',
    'LINKEDIN',
    'YOUTUBE',
    'EMAIL',
    'WHATSAPP',
    'SEO',
    'ORGANIC',
    'REFERRAL',
    'OFFLINE'
);
CREATE TYPE public."CampaignStatus" AS ENUM (
    'DRAFT',
    'ACTIVE',
    'PAUSED',
    'COMPLETED'
);

CREATE TABLE public.ad_account_connections (
    id uuid NOT NULL,
    company_id uuid NOT NULL,
    platform public."AdPlatform" NOT NULL,
    external_account_id text NOT NULL,
    account_name text NOT NULL,
    access_token_encrypted text NOT NULL,
    refresh_token_encrypted text,
    token_expires_at timestamp(3) without time zone,
    status public."AdConnectionStatus" DEFAULT 'CONNECTED'::public."AdConnectionStatus" NOT NULL,
    last_synced_at timestamp(3) without time zone,
    last_sync_error text,
    connected_by_user_id uuid NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);
CREATE TABLE public.ad_campaign_links (
    id uuid NOT NULL,
    connection_id uuid NOT NULL,
    external_campaign_id text NOT NULL,
    external_campaign_name text NOT NULL,
    local_campaign_id uuid,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);
CREATE TABLE public.mkt_campaign_alerts (
    id uuid NOT NULL,
    company_id uuid NOT NULL,
    campaign_id uuid,
    alert_type public."CampaignAlertType" NOT NULL,
    priority public."CampaignAlertPriority" NOT NULL,
    title text NOT NULL,
    message text NOT NULL,
    metric_value numeric(15,4),
    threshold_value numeric(15,4),
    status public."CampaignAlertStatus" DEFAULT 'OPEN'::public."CampaignAlertStatus" NOT NULL,
    resolved_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE public.mkt_campaign_attributions (
    id uuid NOT NULL,
    company_id uuid NOT NULL,
    campaign_id uuid,
    lead_id uuid,
    prospect_name text,
    source text,
    medium text,
    content text,
    term text,
    utm_campaign text,
    landing_page text,
    is_first_touch boolean DEFAULT false NOT NULL,
    is_last_touch boolean DEFAULT false NOT NULL,
    attributed_revenue numeric(15,2) DEFAULT 0 NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE public.mkt_campaign_daily_metrics (
    id uuid NOT NULL,
    campaign_id uuid NOT NULL,
    metric_date date NOT NULL,
    spend numeric(15,2) DEFAULT 0 NOT NULL,
    impressions integer DEFAULT 0 NOT NULL,
    clicks integer DEFAULT 0 NOT NULL,
    notes text,
    recorded_by_user_id uuid NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE public.mkt_campaigns (
    id uuid NOT NULL,
    company_id uuid NOT NULL,
    branch_id uuid,
    campaign_number text NOT NULL,
    name text NOT NULL,
    objective text,
    channel public."CampaignChannel" NOT NULL,
    start_date date,
    end_date date,
    budget numeric(15,2) DEFAULT 0 NOT NULL,
    owner_user_id uuid,
    status public."CampaignStatus" DEFAULT 'DRAFT'::public."CampaignStatus" NOT NULL,
    approval_status public."CampaignApprovalStatus" DEFAULT 'PENDING'::public."CampaignApprovalStatus" NOT NULL,
    notes text,
    created_by_user_id uuid NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    approved_at timestamp(3) without time zone,
    approved_by_user_id uuid,
    rejection_reason text
);

ALTER TABLE ONLY public.ad_account_connections
    ADD CONSTRAINT ad_account_connections_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.ad_campaign_links
    ADD CONSTRAINT ad_campaign_links_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.mkt_campaign_alerts
    ADD CONSTRAINT mkt_campaign_alerts_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.mkt_campaign_attributions
    ADD CONSTRAINT mkt_campaign_attributions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.mkt_campaign_daily_metrics
    ADD CONSTRAINT mkt_campaign_daily_metrics_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.mkt_campaigns
    ADD CONSTRAINT mkt_campaigns_pkey PRIMARY KEY (id);

CREATE UNIQUE INDEX ad_account_connections_company_id_platform_external_account_key ON public.ad_account_connections USING btree (company_id, platform, external_account_id);
CREATE INDEX ad_account_connections_company_id_platform_idx ON public.ad_account_connections USING btree (company_id, platform);
CREATE UNIQUE INDEX ad_campaign_links_connection_id_external_campaign_id_key ON public.ad_campaign_links USING btree (connection_id, external_campaign_id);
CREATE INDEX ad_campaign_links_local_campaign_id_idx ON public.ad_campaign_links USING btree (local_campaign_id);
CREATE INDEX crm_leads_company_id_campaign_id_idx ON public.crm_leads USING btree (company_id, campaign_id);
CREATE INDEX mkt_campaign_alerts_company_id_campaign_id_idx ON public.mkt_campaign_alerts USING btree (company_id, campaign_id);
CREATE INDEX mkt_campaign_alerts_company_id_status_idx ON public.mkt_campaign_alerts USING btree (company_id, status);
CREATE INDEX mkt_campaign_attributions_company_id_campaign_id_idx ON public.mkt_campaign_attributions USING btree (company_id, campaign_id);
CREATE INDEX mkt_campaign_attributions_company_id_lead_id_idx ON public.mkt_campaign_attributions USING btree (company_id, lead_id);
CREATE UNIQUE INDEX mkt_campaign_daily_metrics_campaign_id_metric_date_key ON public.mkt_campaign_daily_metrics USING btree (campaign_id, metric_date);
CREATE UNIQUE INDEX mkt_campaigns_company_id_campaign_number_key ON public.mkt_campaigns USING btree (company_id, campaign_number);
CREATE INDEX mkt_campaigns_company_id_channel_idx ON public.mkt_campaigns USING btree (company_id, channel);
CREATE INDEX mkt_campaigns_company_id_status_idx ON public.mkt_campaigns USING btree (company_id, status);

ALTER TABLE ONLY public.ad_account_connections
    ADD CONSTRAINT ad_account_connections_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE ONLY public.ad_account_connections
    ADD CONSTRAINT ad_account_connections_connected_by_user_id_fkey FOREIGN KEY (connected_by_user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE ONLY public.ad_campaign_links
    ADD CONSTRAINT ad_campaign_links_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES public.ad_account_connections(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE ONLY public.ad_campaign_links
    ADD CONSTRAINT ad_campaign_links_local_campaign_id_fkey FOREIGN KEY (local_campaign_id) REFERENCES public.mkt_campaigns(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE ONLY public.crm_leads
    ADD CONSTRAINT crm_leads_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.mkt_campaigns(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE ONLY public.mkt_campaign_alerts
    ADD CONSTRAINT mkt_campaign_alerts_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.mkt_campaigns(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE ONLY public.mkt_campaign_alerts
    ADD CONSTRAINT mkt_campaign_alerts_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE ONLY public.mkt_campaign_attributions
    ADD CONSTRAINT mkt_campaign_attributions_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.mkt_campaigns(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE ONLY public.mkt_campaign_attributions
    ADD CONSTRAINT mkt_campaign_attributions_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE ONLY public.mkt_campaign_attributions
    ADD CONSTRAINT mkt_campaign_attributions_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.crm_leads(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE ONLY public.mkt_campaign_daily_metrics
    ADD CONSTRAINT mkt_campaign_daily_metrics_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.mkt_campaigns(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE ONLY public.mkt_campaign_daily_metrics
    ADD CONSTRAINT mkt_campaign_daily_metrics_recorded_by_user_id_fkey FOREIGN KEY (recorded_by_user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE ONLY public.mkt_campaigns
    ADD CONSTRAINT mkt_campaigns_approved_by_user_id_fkey FOREIGN KEY (approved_by_user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE ONLY public.mkt_campaigns
    ADD CONSTRAINT mkt_campaigns_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE ONLY public.mkt_campaigns
    ADD CONSTRAINT mkt_campaigns_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE ONLY public.mkt_campaigns
    ADD CONSTRAINT mkt_campaigns_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE ONLY public.mkt_campaigns
    ADD CONSTRAINT mkt_campaigns_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;

-- Permission catalog rows for "marketing" (no grants: see header).
WITH actions(action) AS (
  VALUES ('view'), ('create'), ('edit'), ('delete'), ('approve'), ('reject'), ('post'),
         ('cancel'), ('export'), ('print'), ('override'), ('scan'), ('view_all')
)
INSERT INTO "permissions" ("id", "key", "module", "description", "created_at")
SELECT gen_random_uuid(), 'marketing.' || a.action, 'marketing', a.action || ' access for marketing', now()
FROM actions a
ON CONFLICT ("key") DO NOTHING;

DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261028240000_remove_legacy_marketing';
