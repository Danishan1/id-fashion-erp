"use client";

import { useEffect, useState } from "react";
import { crmRequest } from "@/components/crm/crm-api";
import { CrmEmptyState, CrmLoadingState } from "@/components/crm/CrmStates";
import { Button } from "@/components/ui/Button";
import { textInputClass } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { TemplatePreviewPane } from "./TemplateParts";
import { TEMPLATES_API, type TemplateListRowDto, type TemplatePreviewDto } from "./template-types";

export interface PickedTemplate {
  templateId: string;
  versionId: string;
  versionNumber: number;
  name: string;
  subject: string | null;
  body: string;
}

/**
 * Inbox → "Use template": the active templates of this conversation's channel,
 * rendered for THIS conversation (its contact / company / opportunity and you
 * as the sender) by the server. Inserting fills the composer — the text can
 * still be edited before sending; the sent message stores the final text and
 * the exact template version.
 */
export function TemplatePickerDialog({ open, onClose, conversationId, channelType, channelLabel, onPick }: { open: boolean; onClose: () => void; conversationId: string; channelType: string; channelLabel: string; onPick: (t: PickedTemplate) => void }) {
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<TemplateListRowDto[] | null>(null);
  const [selected, setSelected] = useState<TemplateListRowDto | null>(null);
  const [preview, setPreview] = useState<TemplatePreviewDto | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const t = setTimeout(() => {
      const qs = new URLSearchParams({ usable: "true", channels: channelType, pageSize: "30", sortBy: "name", sortOrder: "asc", ...(search.trim() ? { search: search.trim() } : {}) });
      crmRequest<TemplateListRowDto[]>(`${TEMPLATES_API}?${qs}`).then((res) => {
        if (!cancelled) setRows(res.ok ? res.data : []);
      });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [open, search, channelType]);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    crmRequest<TemplatePreviewDto>(`${TEMPLATES_API}/${selected.id}/preview`, { method: "POST", toast: "off", body: { context: { conversationId } } }).then((res) => {
      if (cancelled) return;
      setLoadingPreview(false);
      setPreview(res.ok ? res.data : { subject: null, body: "", ok: false, missing: [], warnings: [], errors: [{ code: "ERROR", severity: "error", source: "template", message: res.error.message }] });
    });
    return () => {
      cancelled = true;
    };
  }, [selected, conversationId]);

  const close = () => {
    setSelected(null);
    setPreview(null);
    onClose();
  };

  return (
    <Modal open={open} onClose={close} title={`Use a ${channelLabel} template`} maxWidthClass="max-w-3xl">
      <div className="grid gap-4 md:grid-cols-[16rem_minmax(0,1fr)]">
        <div className="space-y-2">
          <label htmlFor="tpl-pick-search" className="sr-only">
            Search templates
          </label>
          <input id="tpl-pick-search" className={textInputClass()} placeholder="Search templates…" value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
          {!rows ? (
            <CrmLoadingState />
          ) : !rows.length ? (
            <CrmEmptyState title="No active templates" description={`Create and activate a ${channelLabel} template under CRM → Templates.`} />
          ) : (
            <ul className="max-h-80 space-y-1 overflow-auto" role="listbox" aria-label="Templates">
              {rows.map((r) => (
                <li key={r.id}>
                  <button type="button" role="option" aria-selected={selected?.id === r.id} onClick={() => {
                      setLoadingPreview(true);
                      setSelected(r);
                    }} className={`w-full rounded-md px-2.5 py-1.5 text-left text-sm ${selected?.id === r.id ? "bg-indigo-50 text-indigo-900 dark:bg-indigo-500/10 dark:text-indigo-100" : "hover:bg-zinc-50 dark:hover:bg-zinc-800"}`}>
                    <span className="block font-medium">{r.name}</span>
                    <span className="block text-xs text-zinc-500">
                      {r.category?.name ?? "No category"} · v{r.currentVersionNumber}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="space-y-3">
          {!selected ? (
            <p className="text-sm text-zinc-500">Choose a template to see it filled in for this conversation.</p>
          ) : (
            <>
              <TemplatePreviewPane preview={preview} loading={loadingPreview} channelType={channelType} />
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={close}>
                  Cancel
                </Button>
                <Button
                  disabled={!preview || !preview.ok || !preview.version || loadingPreview}
                  onClick={() => {
                    if (!preview?.version) return;
                    onPick({ templateId: selected.id, versionId: preview.version.id, versionNumber: preview.version.versionNumber, name: selected.name, subject: preview.subject, body: preview.body });
                    close();
                  }}
                >
                  Insert into reply
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
