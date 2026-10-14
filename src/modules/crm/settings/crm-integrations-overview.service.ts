import { prisma } from "@/core/db/client";
import type { CrmActor } from "../core/crm-actor";
import { BUSINESS_TIME_ZONE } from "../core/crm-timezone";
import { WEBHOOK_ATTENTION_THRESHOLD } from "../webhooks-out/webhook-events";

/**
 * Phase 22 — the CRM Settings overview and the integrations catalogue.
 *
 * Every status here is computed from the database: an integration is
 * "Connected" only when this company has an active record for it, "Available"
 * when the feature exists but nothing is set up yet, and "Planned" for
 * connectors that do not exist in the product (nothing about them is
 * functional, and nothing here pretends otherwise). No secrets, URLs with
 * tokens or provider credentials are ever part of this response.
 */

export type IntegrationStatus = "CONNECTED" | "NEEDS_ATTENTION" | "AVAILABLE" | "PLANNED";

export interface IntegrationCard {
  key: string;
  name: string;
  category: "Lead capture" | "Conversations" | "Automation" | "Data";
  status: IntegrationStatus;
  /** One line from real data, e.g. "2 active keys · last used 14 Oct". */
  summary: string;
  description: string;
  /** Settings tab (or app page) where it's configured. */
  settingsTab?: string;
  href?: string;
  /** Repository documentation path, for developers. */
  docs?: string;
}

const PLANNED: IntegrationCard[] = [
  {
    key: "meta-lead-ads",
    name: "Meta Lead Ads (Facebook / Instagram forms)",
    category: "Lead capture",
    status: "PLANNED",
    summary: "Planned — no built-in connector yet.",
    description: "Until it exists, forward Meta lead-form submissions through Zapier, Make or n8n to an incoming lead webhook.",
    settingsTab: "webhooks",
  },
  {
    key: "indiamart",
    name: "IndiaMART lead sync",
    category: "Lead capture",
    status: "PLANNED",
    summary: "Planned — no built-in connector yet.",
    description: "Until it exists, use IndiaMART's export or an automation tool to post leads to the lead capture API or an incoming lead webhook.",
    settingsTab: "api",
  },
  {
    key: "whatsapp-cloud-native",
    name: "WhatsApp Cloud API (built-in, no bridge)",
    category: "Conversations",
    status: "PLANNED",
    summary: "Planned — today WhatsApp connects through a bridge you run (see Channels).",
    description: "A built-in provider would replace the bridge for a channel without changing conversations or history.",
    settingsTab: "channels",
  },
  {
    key: "email-sync",
    name: "Mailbox sync (Gmail / Microsoft 365)",
    category: "Conversations",
    status: "PLANNED",
    summary: "Planned — today email connects through a bridge (e.g. Mailgun routes).",
    description: "Two-way mailbox sync is not available; an email channel receives and sends through the generic signed protocol.",
    settingsTab: "channels",
  },
];

const fmtDate = (d: Date | null | undefined) => (d ? d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: BUSINESS_TIME_ZONE }) : null);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export async function getSettingsOverview(actor: CrmActor) {
  const companyId = actor.companyId;
  const now = new Date();
  const [
    leadStatuses,
    leadSources,
    pipelines,
    defaultPipeline,
    keys,
    keyLastUsed,
    leadHooks,
    leadHookLast,
    channels,
    subs,
    subsAttention,
    subLastSuccess,
    workflowsLive,
    templatesLive,
  ] = await Promise.all([
    prisma.crmLeadStatus.count({ where: { companyId } }),
    prisma.crmLeadSource.count({ where: { companyId } }),
    prisma.crmPipeline.count({ where: { companyId, isActive: true, archivedAt: null } }),
    prisma.crmPipeline.findFirst({ where: { companyId, isDefault: true, archivedAt: null }, select: { name: true } }),
    prisma.crmApiKey.count({ where: { companyId, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } }),
    prisma.crmApiKey.aggregate({ where: { companyId, revokedAt: null }, _max: { lastUsedAt: true } }),
    prisma.crmWebhookEndpoint.count({ where: { companyId, isActive: true } }),
    prisma.crmWebhookEndpoint.aggregate({ where: { companyId, isActive: true }, _max: { lastReceivedAt: true } }),
    prisma.crmChannel.groupBy({ by: ["status"], where: { companyId }, _count: { _all: true } }),
    prisma.crmWebhookSubscription.count({ where: { companyId, isActive: true } }),
    prisma.crmWebhookSubscription.count({ where: { companyId, isActive: true, consecutiveFailures: { gte: WEBHOOK_ATTENTION_THRESHOLD } } }),
    prisma.crmWebhookSubscription.aggregate({ where: { companyId }, _max: { lastSuccessAt: true } }),
    prisma.crmWorkflow.count({ where: { companyId, status: "PUBLISHED", archivedAt: null } }),
    prisma.crmMessageTemplate.count({ where: { companyId, status: "ACTIVE", archivedAt: null } }),
  ]);
  const activeChannels = channels.find((c) => c.status === "ACTIVE")?._count._all ?? 0;
  const otherChannels = channels.filter((c) => c.status !== "ACTIVE").reduce((n, c) => n + c._count._all, 0);

  const live: IntegrationCard[] = [
    {
      key: "lead-api",
      name: "Lead capture API",
      category: "Lead capture",
      status: keys ? "CONNECTED" : "AVAILABLE",
      summary: keys ? `${plural(keys, "active key")}${keyLastUsed._max.lastUsedAt ? ` · last used ${fmtDate(keyLastUsed._max.lastUsedAt)}` : " · not used yet"}` : "No API keys yet.",
      description: "Websites and other systems POST leads to /api/v1/crm/leads/ingest with a CRM API key.",
      settingsTab: "api",
      docs: "docs/crm/PHASE_03_LEAD_IMPORT_CAPTURE.md",
    },
    {
      key: "lead-webhooks",
      name: "Incoming lead webhooks",
      category: "Lead capture",
      status: leadHooks ? "CONNECTED" : "AVAILABLE",
      summary: leadHooks ? `${plural(leadHooks, "active webhook")}${leadHookLast._max.lastReceivedAt ? ` · last lead ${fmtDate(leadHookLast._max.lastReceivedAt)}` : " · nothing received yet"}` : "No incoming webhooks yet.",
      description: "A private, signed URL per form or tool (Zapier, Make, Pabbly, n8n, your website) that creates leads.",
      settingsTab: "webhooks",
      docs: "docs/crm/PHASE_03_LEAD_IMPORT_CAPTURE.md",
    },
    {
      key: "lead-import",
      name: "Lead import (CSV / Excel)",
      category: "Data",
      status: "AVAILABLE",
      summary: "Upload a file, map columns, preview and import.",
      description: "Uses the same validation and duplicate rules as the API.",
      href: "/crm/leads/import",
    },
    {
      key: "channels",
      name: "Conversation channels",
      category: "Conversations",
      status: activeChannels ? "CONNECTED" : "AVAILABLE",
      summary: activeChannels || otherChannels ? `${plural(activeChannels, "active channel")}${otherChannels ? ` · ${otherChannels} paused / inactive` : ""}` : "No channels yet.",
      description: "Website chat, WhatsApp, Messenger, Instagram, SMS or email through a signed bridge you run; messages land in the Inbox.",
      settingsTab: "channels",
      docs: "docs/crm/integrations/README.md",
    },
    {
      key: "outgoing-webhooks",
      name: "Outgoing webhooks",
      category: "Automation",
      status: subsAttention ? "NEEDS_ATTENTION" : subs ? "CONNECTED" : "AVAILABLE",
      summary: subs ? `${plural(subs, "active subscription")}${subsAttention ? ` · ${subsAttention} failing` : ""}${subLastSuccess._max.lastSuccessAt ? ` · last delivered ${fmtDate(subLastSuccess._max.lastSuccessAt)}` : ""}` : "No subscriptions yet.",
      description: "Signed HTTPS POSTs to your system when CRM events happen (lead created, stage changed, …), with retries and a delivery log.",
      settingsTab: "webhooks-out",
      docs: "docs/crm/PHASE_22_SETTINGS_INTEGRATIONS.md",
    },
    {
      key: "workflows",
      name: "Workflow automation",
      category: "Automation",
      status: workflowsLive ? "CONNECTED" : "AVAILABLE",
      summary: workflowsLive ? `${plural(workflowsLive, "published workflow")}` : "No published workflows.",
      description: "Triggers, conditions and actions — including the \"Call a webhook\" action for one-off calls to other systems.",
      settingsTab: "automation",
      docs: "docs/crm/workflows/README.md",
    },
    {
      key: "templates",
      name: "Message templates",
      category: "Conversations",
      status: templatesLive ? "CONNECTED" : "AVAILABLE",
      summary: templatesLive ? `${plural(templatesLive, "active template")}` : "No active templates.",
      description: "Reusable messages with variables, used in the Inbox and by workflows.",
      href: "/crm/templates",
      docs: "docs/crm/PHASE_12_MESSAGE_TEMPLATES.md",
    },
  ];

  return {
    timezone: BUSINESS_TIME_ZONE,
    configuration: { leadStatuses, leadSources, pipelines, defaultPipeline: defaultPipeline?.name ?? null },
    integrations: [...live, ...PLANNED],
  };
}
