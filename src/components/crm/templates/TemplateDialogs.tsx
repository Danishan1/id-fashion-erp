"use client";

import { useEffect, useState } from "react";
import { crmRequest } from "@/components/crm/crm-api";
import { Button } from "@/components/ui/Button";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";
import { toast } from "@/components/ui/Toast";
import { PreviewContextPicker, TemplateIssueList, TemplatePreviewPane } from "./TemplateParts";
import { TEMPLATES_API, type TemplateDetailDto, type TemplateMetaDto, type TemplatePreviewContext, type TemplatePreviewDto } from "./template-types";

/**
 * Test send: ONE address the user types, sample data (or a chosen record),
 * through a configured channel's provider. Marked "[TEST]". Shows exactly
 * what will be sent and asks for confirmation; never a list of recipients.
 */
export function TemplateTestSendDialog({ open, onClose, template, meta, onSent }: { open: boolean; onClose: () => void; template: TemplateDetailDto; meta: TemplateMetaDto; onSent: () => void }) {
  const channels = meta.testChannels.filter((c) => c.channelType === template.channelType);
  const usable = channels.filter((c) => c.canSend);
  const [channelId, setChannelId] = useState(usable[0]?.id ?? "");
  const [to, setTo] = useState("");
  const [ctx, setCtx] = useState<TemplatePreviewContext | null>(null);
  const [preview, setPreview] = useState<TemplatePreviewDto | null>(null);
  const [step, setStep] = useState<"form" | "confirm">("form");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const isEmail = template.channelType === "EMAIL";

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    crmRequest<TemplatePreviewDto>(`${TEMPLATES_API}/${template.id}/preview`, { method: "POST", toast: "off", body: { ...(ctx ? { context: ctx } : { sample: true }), ...(channelId ? { channelId } : {}) } }).then((res) => {
      if (!cancelled) setPreview(res.ok ? res.data : null);
    });
    return () => {
      cancelled = true;
    };
  }, [open, ctx, channelId, template.id]);

  const close = () => {
    setStep("form");
    setError(null);
    onClose();
  };
  const send = async () => {
    setBusy(true);
    setError(null);
    const res = await crmRequest<{ to: string; channel: { name: string } }>(`${TEMPLATES_API}/${template.id}/test-send`, { method: "POST", toast: "off", body: { channelId, to: to.trim(), confirm: true, ...(ctx ? { context: ctx } : { sample: true }) } });
    setBusy(false);
    if (!res.ok) {
      setStep("form");
      setFieldErrors(res.error.fieldErrors);
      const issues = (res.error.details?.errors as { message: string }[] | undefined)?.map((e) => e.message).join(" ");
      return setError(issues ? `${res.error.message} ${issues}` : res.error.message);
    }
    toast.success(`Test sent to ${res.data.to} via ${res.data.channel.name}.`);
    onSent();
    close();
  };

  const mark = (s: string | null | undefined) => (s ? `[TEST] ${s}` : s);
  return (
    <Modal open={open} onClose={close} title="Send a test message" maxWidthClass="max-w-xl">
      <div className="space-y-4">
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200" role="note">
          <strong>This is a test message.</strong> It goes to the one address you enter, is marked “[TEST]”, and isn’t added to any customer conversation.
        </p>
        {!usable.length ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            No {template.channelLabel} channel can send yet.{" "}
            {channels.length ? channels.map((c) => `${c.name}: ${c.reason}`).join(" ") : "Add one in CRM Settings → Channels (with an outbound URL)."}
          </p>
        ) : step === "form" ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="Send through" htmlFor="tt-channel" required error={fieldErrors.channelId}>
                <select id="tt-channel" className={textInputClass()} value={channelId} onChange={(e) => setChannelId(e.target.value)}>
                  {usable.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField label={isEmail ? "Test email to" : "Test phone number"} htmlFor="tt-to" required error={fieldErrors.to}>
                <input id="tt-to" className={textInputClass(Boolean(fieldErrors.to))} value={to} onChange={(e) => setTo(e.target.value)} placeholder={isEmail ? "you@example.com" : "+91 98100 12345"} inputMode={isEmail ? "email" : "tel"} autoComplete="off" />
              </FormField>
            </div>
            <PreviewContextPicker value={ctx} onChange={setCtx} />
            {preview && <TemplatePreviewPane preview={{ ...preview, subject: mark(preview.subject) ?? null, body: isEmail ? preview.body : `[TEST] ${preview.body}` }} channelType={template.channelType} />}
            {error && (
              <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={close}>
                Cancel
              </Button>
              <Button onClick={() => setStep("confirm")} disabled={!to.trim() || !channelId || Boolean(preview && !preview.ok)}>
                Review &amp; send
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-zinc-700 dark:text-zinc-300">
              Send one test of <strong>{template.name}</strong> (version {preview?.version?.versionNumber ?? template.currentVersionNumber}) to <strong>{to.trim()}</strong> via <strong>{usable.find((c) => c.id === channelId)?.name}</strong>?
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setStep("form")} disabled={busy}>
                Back
              </Button>
              <Button onClick={send} isLoading={busy} loadingLabel="Sending…">
                Send test
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

/** Template categories = the CRM option list "template_category": add, rename, archive/restore (crm_settings.edit). */
export function TemplateCategoriesDialog({ open, onClose, meta, onChanged }: { open: boolean; onClose: () => void; meta: TemplateMetaDto; onChanged: () => void }) {
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const API = "/api/v1/crm/settings/option-values";
  const add = async () => {
    if (!name.trim()) return;
    setBusy("add");
    const res = await crmRequest(API, { method: "POST", body: { listKey: meta.categoryListKey, value: name.trim() }, successMessage: "Category added." });
    setBusy(null);
    if (res.ok) {
      setName("");
      onChanged();
    }
  };
  const patch = async (id: string, body: Record<string, unknown>, msg: string) => {
    setBusy(id);
    const res = await crmRequest(`${API}/${id}`, { method: "PATCH", body, successMessage: msg });
    setBusy(null);
    if (res.ok) {
      setEditing(null);
      onChanged();
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="Template categories" maxWidthClass="max-w-lg">
      <div className="space-y-4">
        <p className="text-sm text-zinc-500">Archived categories stay on the templates that use them but can’t be picked for others.</p>
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {meta.categories.map((c) => (
            <li key={c.id} className="flex items-center gap-2 py-2 text-sm">
              {editing?.id === c.id ? (
                <>
                  <input aria-label="Category name" className={`${textInputClass()} py-1`} value={editing.name} maxLength={100} onChange={(e) => setEditing({ id: c.id, name: e.target.value })} autoFocus />
                  <Button size="xs" onClick={() => patch(c.id, { value: editing.name.trim() }, "Category renamed.")} isLoading={busy === c.id} disabled={!editing.name.trim()}>
                    Save
                  </Button>
                  <Button size="xs" variant="secondary" onClick={() => setEditing(null)}>
                    Cancel
                  </Button>
                </>
              ) : (
                <>
                  <span className={`flex-1 ${c.archived ? "text-zinc-400 line-through" : "text-zinc-900 dark:text-zinc-100"}`}>{c.name}</span>
                  <button type="button" className="text-xs text-indigo-600 hover:underline" onClick={() => setEditing({ id: c.id, name: c.name })}>
                    Rename
                  </button>
                  <ToggleSwitch checked={!c.archived} onToggle={() => patch(c.id, { isActive: c.archived }, c.archived ? "Category restored." : "Category archived.")} disabled={busy === c.id} label={`${c.archived ? "Restore" : "Archive"} ${c.name}`} />
                </>
              )}
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <label htmlFor="tc-new" className="sr-only">
            New category
          </label>
          <input id="tc-new" className={textInputClass()} placeholder="New category…" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), void add())} />
          <Button variant="secondary" onClick={add} isLoading={busy === "add"} disabled={!name.trim()}>
            Add
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** Duplicate with a name of the user's choice (defaults to "… (copy)"). */
export function DuplicateTemplateDialog({ open, onClose, template, onDone }: { open: boolean; onClose: () => void; template: { id: string; name: string }; onDone: (id: string) => void }) {
  const [name, setName] = useState(`${template.name} (copy)`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    setBusy(true);
    const res = await crmRequest<{ id: string }>(`${TEMPLATES_API}/${template.id}/duplicate`, { method: "POST", toast: "off", body: { name: name.trim() } });
    setBusy(false);
    if (!res.ok) return setError(res.error.fieldErrors.name ?? res.error.message);
    toast.success("Template duplicated as a draft.");
    onDone(res.data.id);
  };
  return (
    <Modal open={open} onClose={onClose} title="Duplicate template">
      <div className="space-y-3">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Creates a new draft with the current text. It gets its own history, starting at version 1; the original isn’t changed.</p>
        <FormField label="Name of the copy" htmlFor="dup-name" required error={error ?? undefined}>
          <input id="dup-name" className={textInputClass(Boolean(error))} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
        </FormField>
        <TemplateIssueList errors={[]} warnings={[]} compact />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={go} isLoading={busy} disabled={!name.trim()}>
            Duplicate
          </Button>
        </div>
      </div>
    </Modal>
  );
}
