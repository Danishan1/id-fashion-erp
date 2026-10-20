"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CrmBadge, type CrmBadgeTone } from "@/components/crm/CrmBadge";
import { CrmErrorState, CrmLoadingState } from "@/components/crm/CrmStates";
import { crmRequest } from "@/components/crm/crm-api";
import type { CrmPagePermissions } from "@/modules/crm/core/crm-page";
import type { CrmSettingsTab } from "./CrmSettingsClient";

/**
 * Phase 22 — CRM Settings: Overview (General), Users & access and the
 * Integrations catalogue. All statuses come from GET /settings/overview, which
 * computes them from this company's real configuration.
 */

export interface IntegrationCardDto {
  key: string;
  name: string;
  category: string;
  status: "CONNECTED" | "NEEDS_ATTENTION" | "AVAILABLE" | "PLANNED";
  summary: string;
  description: string;
  settingsTab?: CrmSettingsTab;
  href?: string;
  docs?: string;
}
export interface SettingsOverviewDto {
  timezone: string;
  configuration: { leadStatuses: number; leadSources: number; pipelines: number; defaultPipeline: string | null };
  integrations: IntegrationCardDto[];
}

const STATUS: Record<IntegrationCardDto["status"], { label: string; tone: CrmBadgeTone }> = {
  CONNECTED: { label: "Connected", tone: "green" },
  NEEDS_ATTENTION: { label: "Needs attention", tone: "red" },
  AVAILABLE: { label: "Available — not set up", tone: "indigo" },
  PLANNED: { label: "Planned", tone: "neutral" },
};

function useOverview() {
  const [data, setData] = useState<SettingsOverviewDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    crmRequest<SettingsOverviewDto>("/api/v1/crm/settings/overview").then((r) => {
      if (cancelled) return;
      if (r.ok) {
        setData(r.data);
        setError(null);
      } else setError(r.error.message);
    });
    return () => {
      cancelled = true;
    };
  }, [tick]);
  return { data, error, reload: () => setTick((t) => t + 1) };
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

const linkCls = "text-indigo-700 hover:underline dark:text-indigo-300";

function TabLink({ tab, onSelect, children }: { tab: CrmSettingsTab; onSelect: (t: CrmSettingsTab) => void; children: React.ReactNode }) {
  return (
    <button type="button" className={linkCls} onClick={() => onSelect(tab)}>
      {children}
    </button>
  );
}

export function OverviewTab({ onSelect }: { onSelect: (t: CrmSettingsTab) => void }) {
  const { data, error, reload } = useOverview();
  if (error) return <CrmErrorState message={error} onRetry={reload} />;
  if (!data) return <CrmLoadingState />;
  const attention = data.integrations.filter((i) => i.status === "NEEDS_ATTENTION");
  const connected = data.integrations.filter((i) => i.status === "CONNECTED");
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="General">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-zinc-500">Business time zone</dt>
          <dd>
            {data.timezone} (IST) <span className="text-xs text-zinc-500">— used for due dates, reminders, appointments and dashboard date ranges. Fixed for the CRM.</span>
          </dd>
          <dt className="text-zinc-500">Default pipeline</dt>
          <dd>{data.configuration.defaultPipeline ?? "None set"}</dd>
          <dt className="text-zinc-500">Pipelines</dt>
          <dd>{data.configuration.pipelines}</dd>
          <dt className="text-zinc-500">Lead statuses / sources</dt>
          <dd>
            {data.configuration.leadStatuses} / {data.configuration.leadSources}
          </dd>
        </dl>
      </Card>
      <Card title="Integrations at a glance">
        {attention.length > 0 && (
          <p className="rounded-md bg-red-50 p-2 text-sm text-red-800 dark:bg-red-500/10 dark:text-red-200">
            {attention.map((a) => a.name).join(", ")} {attention.length === 1 ? "needs" : "need"} attention — <TabLink tab="integrations" onSelect={onSelect}>review</TabLink>.
          </p>
        )}
        <p className="text-sm text-zinc-600 dark:text-zinc-300">{connected.length ? `Connected: ${connected.map((c) => c.name).join(", ")}.` : "Nothing is connected yet."}</p>
        <TabLink tab="integrations" onSelect={onSelect}>
          See all integrations →
        </TabLink>
      </Card>
      <Card title="Set up the CRM">
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>
            Leads: <TabLink tab="statuses" onSelect={onSelect}>statuses</TabLink>, <TabLink tab="sources" onSelect={onSelect}>sources</TabLink>, <TabLink tab="tags" onSelect={onSelect}>tags</TabLink>,{" "}
            <TabLink tab="custom-fields" onSelect={onSelect}>custom fields</TabLink> and <TabLink tab="duplicates" onSelect={onSelect}>duplicate rules</TabLink>
          </li>
          <li>
            Sales: <TabLink tab="pipelines" onSelect={onSelect}>pipelines &amp; stages</TabLink>
          </li>
          <li>
            Data in: <Link className={linkCls} href="/crm/leads/import">import leads from a file</Link>, the <TabLink tab="api" onSelect={onSelect}>lead capture API</TabLink> and <TabLink tab="webhooks" onSelect={onSelect}>incoming webhooks</TabLink>
          </li>
          <li>
            Messaging: <TabLink tab="channels" onSelect={onSelect}>channels</TabLink> and <Link className={linkCls} href="/crm/templates">message templates</Link>
          </li>
          <li>
            Automation: <Link className={linkCls} href="/crm/workflows">workflows</Link> and <TabLink tab="webhooks-out" onSelect={onSelect}>outgoing webhooks</TabLink>
          </li>
        </ul>
      </Card>
      <Card title="People and audit">
        <p className="text-sm text-zinc-600 dark:text-zinc-300">
          Who can use and configure the CRM is managed with roles — see <TabLink tab="access" onSelect={onSelect}>Users &amp; access</TabLink>. Every settings change (including creating, rotating and revoking secrets — never their values) is
          recorded in the <Link className={linkCls} href="/admin">Administration</Link> audit log.
        </p>
      </Card>
    </div>
  );
}

export function IntegrationsTab({ onSelect }: { onSelect: (t: CrmSettingsTab) => void }) {
  const { data, error, reload } = useOverview();
  if (error) return <CrmErrorState message={error} onRetry={reload} />;
  if (!data) return <CrmLoadingState />;
  const live = data.integrations.filter((i) => i.status !== "PLANNED");
  const planned = data.integrations.filter((i) => i.status === "PLANNED");
  const card = (i: IntegrationCardDto) => (
    <li key={i.key} className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800" data-testid={`integration-${i.key}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium">{i.name}</p>
          <p className="text-xs text-zinc-500">{i.category}</p>
        </div>
        <CrmBadge label={STATUS[i.status].label} tone={STATUS[i.status].tone} />
      </div>
      <p className="text-sm text-zinc-700 dark:text-zinc-300">{i.summary}</p>
      <p className="text-xs text-zinc-500">{i.description}</p>
      <div className="mt-auto flex flex-wrap gap-3 text-sm">
        {i.status !== "PLANNED" && i.settingsTab && (
          <TabLink tab={i.settingsTab} onSelect={onSelect}>
            {i.status === "AVAILABLE" ? "Set up" : "Manage"}
          </TabLink>
        )}
        {i.status === "PLANNED" && i.settingsTab && (
          <TabLink tab={i.settingsTab} onSelect={onSelect}>
            Use the workaround
          </TabLink>
        )}
        {i.href && (
          <Link className={linkCls} href={i.href}>
            Open
          </Link>
        )}
        {i.docs && <span className="w-full break-all text-xs text-zinc-500">Docs: {i.docs}</span>}
      </div>
    </li>
  );
  return (
    <div className="space-y-6">
      <p className="max-w-3xl text-sm text-zinc-500 dark:text-zinc-400">
        What this CRM can connect to today, and its status for your company. &quot;Planned&quot; items don&apos;t exist yet — nothing about them is active; each one lists the working alternative.
      </p>
      <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{live.map(card)}</ul>
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Planned</h3>
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{planned.map(card)}</ul>
      </div>
    </div>
  );
}

const PERMISSIONS: { key: string; what: string; held: (p: CrmPagePermissions) => boolean | null }[] = [
  { key: "crm.view", what: "Open the CRM and see your own records (and records assigned to you).", held: () => true },
  { key: "crm.view_all", what: "See every record in the company, including unassigned ones and the unmatched Inbox queue.", held: (p) => p.viewAll },
  { key: "crm.create", what: "Create leads, contacts, companies, opportunities, tasks and messages; import leads.", held: (p) => p.create },
  { key: "crm.edit", what: "Edit, assign, convert and run bulk actions on records you can see.", held: (p) => p.edit },
  { key: "crm.export", what: "Export records (bulk export / download).", held: () => null },
  { key: "crm_settings.view", what: "Open CRM Settings and see configuration — never stored secrets.", held: (p) => p.settings },
  { key: "crm_settings.edit", what: "Change CRM Settings and workflows; create, rotate and revoke API keys, webhook and channel secrets.", held: (p) => p.settingsEdit },
];

export function AccessTab({ permissions }: { permissions: CrmPagePermissions }) {
  return (
    <div className="max-w-4xl space-y-4">
      <p className="text-sm text-zinc-600 dark:text-zinc-300">
        CRM access comes from roles. Users, roles and their permissions are managed in <Link className={linkCls} href="/admin">Administration</Link> (Users and Roles tabs) by someone with the administration permissions; this page explains what
        each CRM permission allows.
      </p>
      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
          <thead className="bg-zinc-50 text-left text-xs font-medium uppercase text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
            <tr>
              <th className="px-3 py-2">Permission</th>
              <th className="px-3 py-2">Allows</th>
              <th className="px-3 py-2">You</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {PERMISSIONS.map((p) => {
              const held = p.held(permissions);
              return (
                <tr key={p.key}>
                  <td className="whitespace-nowrap px-3 py-2">
                    <code className="text-xs">{p.key}</code>
                  </td>
                  <td className="px-3 py-2">{p.what}</td>
                  <td className="px-3 py-2">{held === null ? <span className="text-xs text-zinc-500">see your role</span> : held ? <CrmBadge label="Yes" tone="green" /> : <CrmBadge label="No" />}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ul className="list-disc space-y-1 pl-5 text-sm text-zinc-600 dark:text-zinc-300">
        <li>API keys act for the CRM user who created them (they create leads only — scope <code>leads:ingest</code>). Revoke a key when that person leaves.</li>
        <li>Secrets are write-only: after the one-time display at creation or rotation, nobody — including administrators — can read them back. Rotate to issue a new one.</li>
        <li>Each settings change is written to the audit log with who made it; secret values are never logged.</li>
      </ul>
    </div>
  );
}
