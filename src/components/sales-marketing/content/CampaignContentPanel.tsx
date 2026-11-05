"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { textInputClass } from "@/components/ui/FormField";
import { ErrorState, LoadingState } from "@/components/ui/PageStates";
import { CARD, ReviewBadge, send, useApi } from "./content-ui";

interface Row {
  id: string;
  name: string;
  channelType: string;
  locale: string;
  status: string;
  template: { id: string; name: string };
  currentVersionNumber: number | null;
  currentReview: string;
  approvedVersionNumber: number | null;
  channelCount: number;
}
interface TemplateOption {
  id: string;
  name: string;
  channelType: string;
  approvedVersionNumber: number | null;
}

/** Campaign → Content (Phase 11): campaign-specific wording made from CRM templates. */
export function CampaignContentPanel({ campaignId, canCreate }: { campaignId: string; canCreate: boolean }) {
  const { data, error, reload } = useApi<{ campaign: { status: string }; contents: Row[] }>(`/api/v1/sales-marketing/campaigns/${campaignId}/contents`);
  const [adding, setAdding] = useState(false);
  if (error) return <div className={`${CARD} mt-4`}><ErrorState message={error} onRetry={reload} /></div>;
  if (!data) return <div className={`${CARD} mt-4`}><LoadingState /></div>;
  const closed = ["COMPLETED", "CANCELLED"].includes(data.campaign.status);
  return (
    <section className={`${CARD} mt-4 space-y-3`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Content</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">This campaign&apos;s own wording and attachments, made from a template. Each change is a new version; only an approved version can be sent.</p>
        </div>
        {canCreate && !closed && !adding && (
          <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
            New content
          </Button>
        )}
      </div>
      {adding && <NewContent campaignId={campaignId} onCancel={() => setAdding(false)} />}
      {data.contents.length === 0 && !adding ? (
        <p className="text-sm text-zinc-500">No campaign content yet. A channel can also send an approved template as it is.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-zinc-500">
              <th className="py-1">Content</th>
              <th>Channel</th>
              <th>Latest</th>
              <th>Sent version</th>
              <th>Channels</th>
            </tr>
          </thead>
          <tbody>
            {data.contents.map((c) => (
              <tr key={c.id} className="border-t border-zinc-100 dark:border-zinc-800">
                <td className="py-1">
                  <Link className="text-indigo-600 hover:underline dark:text-indigo-400" href={`/sales-marketing/content/items/${c.id}`}>
                    {c.name}
                  </Link>
                  {c.status === "ARCHIVED" && <span className="ml-1 text-xs text-zinc-500">archived</span>}
                  <div className="text-xs text-zinc-500">
                    from {c.template.name} · {c.locale}
                  </div>
                </td>
                <td>{c.channelType.charAt(0) + c.channelType.slice(1).toLowerCase()}</td>
                <td>
                  <span className="flex items-center gap-1">
                    v{c.currentVersionNumber} <ReviewBadge status={c.currentReview} />
                  </span>
                </td>
                <td>{c.approvedVersionNumber ? `v${c.approvedVersionNumber}` : <span className="text-amber-700">none approved</span>}</td>
                <td>{c.channelCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function NewContent({ campaignId, onCancel }: { campaignId: string; onCancel: () => void }) {
  const router = useRouter();
  const { data: templates } = useApi<TemplateOption[]>("/api/v1/sales-marketing/content/templates?pageSize=100");
  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [locale, setLocale] = useState("en");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const create = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await send<{ id: string }>(`/api/v1/sales-marketing/campaigns/${campaignId}/contents`, "POST", { name, templateId, locale });
      router.push(`/sales-marketing/content/items/${r.id}`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <div className="rounded border border-dashed border-zinc-300 p-3 dark:border-zinc-700">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-sm">
          <span className="mb-1 block text-zinc-600 dark:text-zinc-400">Name</span>
          <input className={`${textInputClass()} !w-56`} value={name} onChange={(e) => setName(e.target.value)} placeholder="Launch email" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-zinc-600 dark:text-zinc-400">Start from template</span>
          <select className={`${textInputClass()} !w-auto min-w-[16rem]`} value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            <option value="">{templates ? "Choose…" : "Loading…"}</option>
            {(templates ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.channelType.toLowerCase()}){t.approvedVersionNumber ? ` — v${t.approvedVersionNumber} approved` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-zinc-600 dark:text-zinc-400">Language</span>
          <input className={`${textInputClass()} !w-24`} value={locale} onChange={(e) => setLocale(e.target.value)} />
        </label>
        <Button size="sm" disabled={busy || !name.trim() || !templateId} onClick={create}>
          {busy ? "Creating…" : "Create"}
        </Button>
        <Button size="sm" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {err && <p className="mt-2 text-sm text-red-700 dark:text-red-400">{err}</p>}
    </div>
  );
}
