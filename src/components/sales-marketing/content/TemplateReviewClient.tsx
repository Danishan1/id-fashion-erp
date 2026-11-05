"use client";

import Link from "next/link";
import { useState } from "react";
import { ErrorState, LoadingState } from "@/components/ui/PageStates";
import { CARD, ReviewActions, ReviewBadge, fmtDateTime, useApi } from "./content-ui";

interface TVersion {
  id: string;
  versionNumber: number;
  current: boolean;
  subject: string | null;
  body: string;
  providerMetadata: Record<string, string>;
  changeNote: string | null;
  createdBy: string;
  createdByMe: boolean;
  createdAt: string;
  review: string;
  submittedByMe: boolean;
  decidedBy: string | null;
  decisionComment: string | null;
  sample: { subject: string | null; body: string };
  deliveryProblems: string[];
  withoutFallback: string[];
}
interface Template {
  id: string;
  name: string;
  description: string | null;
  channelType: string;
  crmStatus: string;
  versions: TVersion[];
  usage: { channels: { id: string; isActive: boolean; campaign: { id: string; code: string; name: string; status: string } }[]; contents: { id: string; name: string; status: string; campaign: { id: string; code: string } }[] };
}

/** A CRM template's versions and their marketing review (Phase 11). Text is edited in CRM → Templates. */
export function TemplateReviewClient({ templateId, canEdit, canApprove, canReject, canOpenCrm }: { templateId: string; canEdit: boolean; canApprove: boolean; canReject: boolean; canOpenCrm: boolean }) {
  const { data: t, error, reload } = useApi<Template>(`/api/v1/sales-marketing/content/templates/${templateId}`);
  const [selected, setSelected] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!t) return <LoadingState />;
  const v = t.versions.find((x) => x.id === selected) ?? t.versions.find((x) => x.current) ?? t.versions[0];
  const approved = t.versions.find((x) => x.review === "APPROVED");
  return (
    <div className="space-y-4">
      <div className={`${CARD} text-sm`}>
        <div>
          {t.channelType.charAt(0) + t.channelType.slice(1).toLowerCase()} template · CRM status {t.crmStatus.toLowerCase()} ·{" "}
          {approved ? (
            <>
              campaigns send <strong>v{approved.versionNumber}</strong> (newest approved)
            </>
          ) : (
            <span className="text-amber-700">no version approved — campaigns can&apos;t send it yet</span>
          )}
        </div>
        {canOpenCrm && (
          <Link className="text-indigo-600 hover:underline dark:text-indigo-400" href={`/crm/templates/${t.id}`}>
            Edit the text in CRM → Templates
          </Link>
        )}
      </div>
      {msg && <p className="text-sm text-green-700 dark:text-green-400">{msg}</p>}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className={`${CARD} lg:col-span-2`}>
          {v && (
            <>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="font-medium">Version {v.versionNumber}</span>
                {v.current && <span className="text-xs text-zinc-500">current in the CRM</span>}
                <ReviewBadge status={v.review} />
              </div>
              <p className="mb-2 text-xs text-zinc-500">
                By {v.createdBy}, {fmtDateTime(v.createdAt)}
                {v.changeNote ? ` — ${v.changeNote}` : ""}
              </p>
              {v.subject !== null && (
                <div className="mb-2 text-sm">
                  <span className="text-zinc-500">Subject: </span>
                  {v.subject}
                </div>
              )}
              <pre className="whitespace-pre-wrap rounded bg-zinc-50 p-3 text-sm dark:bg-zinc-950">{v.body}</pre>
              {Object.keys(v.providerMetadata).length > 0 && <p className="mt-2 text-xs text-zinc-500">Provider settings: {Object.entries(v.providerMetadata).map(([k, x]) => `${k}=${x}`).join(", ")}</p>}
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer text-zinc-600">Preview with sample data</summary>
                {v.sample.subject && <div className="mt-2 font-medium">{v.sample.subject}</div>}
                <pre className="mt-1 whitespace-pre-wrap text-sm">{v.sample.body}</pre>
              </details>
              {v.deliveryProblems.length > 0 && (
                <ul className="mt-3 list-disc pl-5 text-sm text-red-700 dark:text-red-400">
                  {v.deliveryProblems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              )}
              {v.withoutFallback.length > 0 && (
                <p className="mt-2 text-sm text-amber-700">
                  No fallback for {v.withoutFallback.map((k) => `{{${k}}}`).join(", ")} — recipients without a value are skipped. Add one in the CRM, e.g. {`{{${v.withoutFallback[0]}|…}}`}.
                </p>
              )}
              {v.decidedBy && (
                <p className="mt-2 text-sm text-zinc-600">
                  Decided by {v.decidedBy}
                  {v.decisionComment ? `: ${v.decisionComment}` : ""}
                </p>
              )}
              <div className="mt-3">
                <ReviewActions subjectType="TEMPLATE_VERSION" subjectId={v.id} status={v.review} canEdit={canEdit && v.deliveryProblems.length === 0} canApprove={canApprove && v.deliveryProblems.length === 0} canReject={canReject} isAuthor={v.createdByMe || v.submittedByMe} onDone={(m) => (setMsg(m), reload())} />
              </div>
            </>
          )}
        </div>
        <div className="space-y-4">
          <div className={CARD}>
            <h3 className="mb-2 text-sm font-semibold">Versions</h3>
            <ul className="space-y-1 text-sm">
              {t.versions.map((x) => (
                <li key={x.id}>
                  <button type="button" className={`flex w-full items-center justify-between rounded px-1 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800 ${x.id === v?.id ? "font-medium" : ""}`} onClick={() => setSelected(x.id)}>
                    <span>
                      v{x.versionNumber}
                      {x.current ? " (current)" : ""}
                    </span>
                    <ReviewBadge status={x.review} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div className={CARD}>
            <h3 className="mb-2 text-sm font-semibold">Used by campaigns</h3>
            {t.usage.channels.length + t.usage.contents.length === 0 ? (
              <p className="text-sm text-zinc-500">Not used yet.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {t.usage.channels.map((c) => (
                  <li key={c.id}>
                    <Link className="text-indigo-600 hover:underline" href={`/sales-marketing/campaigns/${c.campaign.id}`}>
                      {c.campaign.code}
                    </Link>{" "}
                    sends it directly
                  </li>
                ))}
                {t.usage.contents.map((c) => (
                  <li key={c.id}>
                    <Link className="text-indigo-600 hover:underline" href={`/sales-marketing/content/items/${c.id}`}>
                      {c.campaign.code} · {c.name}
                    </Link>{" "}
                    was made from it
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
