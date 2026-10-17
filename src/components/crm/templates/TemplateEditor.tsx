"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { crmRequest } from "@/components/crm/crm-api";
import { CrmErrorState, CrmLoadingState } from "@/components/crm/CrmStates";
import { Button } from "@/components/ui/Button";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { toast } from "@/components/ui/Toast";
import { insertVariable } from "@/modules/crm/templates/template-engine";
import { PreviewContextPicker, TemplateIssueList, TemplatePreviewPane, TemplateStatusBadge, VariablePicker, useTemplateMeta } from "./TemplateParts";
import { TEMPLATES_API, type TemplateDetailDto, type TemplatePreviewContext, type TemplatePreviewDto } from "./template-types";

interface Draft {
  name: string;
  channelType: string;
  categoryId: string;
  description: string;
  subject: string;
  body: string;
  providerMetadata: Record<string, string>;
  changeNote: string;
}

const fromDetail = (t: TemplateDetailDto | null, defaultChannel = "EMAIL"): Draft => ({
  name: t?.name ?? "",
  channelType: t?.channelType ?? defaultChannel,
  categoryId: t?.category?.id ?? "",
  description: t?.description ?? "",
  subject: t?.currentVersion?.subject ?? "",
  body: t?.currentVersion?.body ?? "",
  providerMetadata: t?.currentVersion?.providerMetadata ?? {},
  changeNote: "",
});

const contentKey = (d: Draft) => JSON.stringify([d.channelType === "EMAIL" ? d.subject : "", d.body, Object.entries(d.providerMetadata).filter(([, v]) => v).sort()]);

/**
 * Create / edit a template. Live preview + validation come from the server
 * (same renderer used for sending). Saving changed content on an existing
 * template asks for confirmation: it becomes a NEW version — history is never
 * overwritten. Leaving with unsaved changes asks first.
 */
export function TemplateEditor({ template, canEdit, canCreate }: { template: TemplateDetailDto | null; canEdit: boolean; canCreate: boolean }) {
  const router = useRouter();
  const { meta, error } = useTemplateMeta();
  const initial = useMemo(() => fromDetail(template), [template]);
  const [draft, setDraft] = useState<Draft>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<TemplatePreviewDto | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [ctx, setCtx] = useState<TemplatePreviewContext | null>(null);
  const [confirmVersion, setConfirmVersion] = useState<null | { activate: boolean }>(null);
  const [confirmLeave, setConfirmLeave] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const subjectRef = useRef<HTMLInputElement>(null);
  const lastFocus = useRef<"subject" | "body">("body");
  const isNew = !template;
  const allowed = isNew ? canCreate : canEdit;
  const channel = meta?.channels.find((c) => c.key === draft.channelType);
  const hasSubject = channel?.subject === "required";
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const contentChanged = !isNew && contentKey(draft) !== contentKey(initial);
  const savedRef = useRef(false);

  // Never silently lose work: warn on tab close / reload.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty && !savedRef.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  // Live server preview (debounced).
  useEffect(() => {
    if (!meta) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      setPreviewing(true);
      const res = await crmRequest<TemplatePreviewDto>(`${TEMPLATES_API}/preview`, {
        method: "POST",
        toast: "off",
        body: { channelType: draft.channelType, subject: hasSubject ? draft.subject : null, body: draft.body, providerMetadata: draft.providerMetadata, ...(ctx ? { context: ctx } : { sample: true }) },
      });
      if (cancelled) return;
      setPreviewing(false);
      if (res.ok) setPreview(res.data);
      else setPreview({ subject: null, body: "", errors: [{ code: res.error.code ?? "ERROR", severity: "error", source: "template", message: res.error.message }], warnings: [], ok: false, missing: [] });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [meta, draft.channelType, draft.subject, draft.body, draft.providerMetadata, hasSubject, ctx]);

  if (error) return <CrmErrorState message={error} />;
  if (!meta) return <CrmLoadingState />;

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const insert = (key: string) => {
    const target = hasSubject && lastFocus.current === "subject" ? subjectRef.current : bodyRef.current;
    const field = target === subjectRef.current ? "subject" : "body";
    const text = draft[field];
    const r = insertVariable(text, key, target?.selectionStart ?? text.length, target?.selectionEnd ?? text.length);
    set(field, r.text);
    requestAnimationFrame(() => {
      target?.focus();
      target?.setSelectionRange(r.caret, r.caret);
    });
  };
  const leave = (href: string) => (dirty ? setConfirmLeave(href) : router.push(href));

  const save = async (activate: boolean) => {
    setErrors({});
    setBusy(true);
    const content = { subject: hasSubject ? draft.subject : null, body: draft.body, providerMetadata: draft.providerMetadata };
    let id = template?.id;
    let version = template?.version;
    if (isNew) {
      const res = await crmRequest<{ id: string }>(TEMPLATES_API, { method: "POST", toast: "errors", body: { name: draft.name, channelType: draft.channelType, categoryId: draft.categoryId || null, description: draft.description || null, ...content, changeNote: draft.changeNote || null } });
      if (!res.ok) {
        setBusy(false);
        return setErrors(res.error.fieldErrors);
      }
      id = res.data.id;
      version = 1;
    } else if (dirty) {
      const res = await crmRequest<{ versionCreated: boolean; versionNumber: number }>(`${TEMPLATES_API}/${template!.id}`, { method: "PATCH", toast: "errors", body: { version: template!.version, name: draft.name, categoryId: draft.categoryId || null, description: draft.description || null, ...content, changeNote: draft.changeNote || null } });
      if (!res.ok) {
        setBusy(false);
        return setErrors(res.error.fieldErrors);
      }
      version = template!.version + 1;
      toast.success(res.data.versionCreated ? `Saved as version ${res.data.versionNumber}.` : "Saved.");
    }
    if (activate) {
      const res = await crmRequest(`${TEMPLATES_API}/${id}/activate`, { method: "POST", toast: "errors", body: { version } });
      if (res.ok) toast.success("Template activated — it can now be used when sending.");
    } else if (isNew) toast.success("Draft saved.");
    savedRef.current = true;
    setBusy(false);
    router.push(`/crm/templates/${id}`);
    router.refresh();
  };

  const submit = (activate: boolean) => {
    if (contentChanged) setConfirmVersion({ activate });
    else void save(activate);
  };

  const archive = async () => {
    setBusy(true);
    const res = await crmRequest(`${TEMPLATES_API}/${template!.id}/archive`, { method: "POST", body: { version: template!.version }, successMessage: "Template archived." });
    setBusy(false);
    setConfirmArchive(false);
    if (res.ok) {
      savedRef.current = true;
      router.push(`/crm/templates/${template!.id}`);
      router.refresh();
    }
  };

  const activeCategories = meta.categories.filter((c) => !c.archived || c.id === draft.categoryId);
  const status = template?.status;
  const nextVersion = (template?.currentVersionNumber ?? 0) + 1;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit(false);
        }}
      >
        {!allowed && <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">You can view this template but not change it.</p>}
        {status === "ACTIVE" && (
          <p className="rounded-md bg-indigo-50 px-3 py-2 text-sm text-indigo-900 dark:bg-indigo-500/10 dark:text-indigo-200">
            This template is active. Changing its text saves <strong>version {nextVersion}</strong>, used for new messages from then on — messages already sent keep the text they were sent with.
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Template name" htmlFor="tpl-name" required error={errors.name}>
            <input id="tpl-name" className={textInputClass(Boolean(errors.name))} value={draft.name} onChange={(e) => set("name", e.target.value)} maxLength={120} disabled={!allowed} placeholder="e.g. Follow-up — Day 1" />
          </FormField>
          <FormField label="Channel" htmlFor="tpl-channel" required error={errors.channelType}>
            <select id="tpl-channel" className={textInputClass()} value={draft.channelType} onChange={(e) => set("channelType", e.target.value)} disabled={!isNew || !allowed}>
              {meta.channels.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Category" htmlFor="tpl-category" error={errors.categoryId}>
            <select id="tpl-category" className={textInputClass(Boolean(errors.categoryId))} value={draft.categoryId} onChange={(e) => set("categoryId", e.target.value)} disabled={!allowed}>
              <option value="">No category</option>
              {activeCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.archived ? " (archived)" : ""}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Description (internal)" htmlFor="tpl-description" error={errors.description}>
            <input id="tpl-description" className={textInputClass()} value={draft.description} onChange={(e) => set("description", e.target.value)} maxLength={500} disabled={!allowed} placeholder="When to use it" />
          </FormField>
        </div>
        {hasSubject && (
          <FormField label="Subject" htmlFor="tpl-subject" required error={errors.subject}>
            <input id="tpl-subject" ref={subjectRef} onFocus={() => (lastFocus.current = "subject")} className={textInputClass(Boolean(errors.subject))} value={draft.subject} onChange={(e) => set("subject", e.target.value)} maxLength={250} disabled={!allowed} />
          </FormField>
        )}
        <div>
          <div className="mb-1 flex items-center justify-between gap-2">
            <label htmlFor="tpl-body" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Message <span className="text-red-600">*</span>
            </label>
            <VariablePicker meta={meta} onPick={insert} disabled={!allowed} />
          </div>
          <textarea
            id="tpl-body"
            ref={bodyRef}
            onFocus={() => (lastFocus.current = "body")}
            className={`${textInputClass(Boolean(errors.body))} min-h-[220px] font-mono text-[13px]`}
            value={draft.body}
            onChange={(e) => set("body", e.target.value)}
            maxLength={10_000}
            disabled={!allowed}
            placeholder={"Hi {{contact.first_name|there}},\n\n…"}
          />
          <p className="mt-1 text-xs text-zinc-500">
            Plain text. Variables look like <code>{"{{contact.first_name}}"}</code>; add a fallback with a bar: <code>{"{{contact.first_name|there}}"}</code>.{channel?.maxBodyLength ? ` Up to ${channel.maxBodyLength.toLocaleString("en-IN")} characters after filling in.` : ""}
          </p>
          {errors.body && <p className="mt-1 text-sm text-red-600">{errors.body}</p>}
        </div>
        {channel && channel.providerFields.length > 0 && (
          <fieldset className="space-y-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
            <legend className="px-1 text-xs font-medium text-zinc-500">Provider settings</legend>
            {channel.providerFields.map((f) => (
              <FormField key={f.key} label={f.label} htmlFor={`tpl-pm-${f.key}`}>
                <input id={`tpl-pm-${f.key}`} className={textInputClass()} value={draft.providerMetadata[f.key] ?? ""} maxLength={f.maxLength} disabled={!allowed} onChange={(e) => set("providerMetadata", { ...draft.providerMetadata, [f.key]: e.target.value })} />
                <span className="mt-1 block text-xs text-zinc-500">{f.help}</span>
              </FormField>
            ))}
          </fieldset>
        )}
        {(isNew || contentChanged) && (
          <FormField label={isNew ? "Note for version 1 (optional)" : `What changed in version ${nextVersion}? (optional)`} htmlFor="tpl-note">
            <input id="tpl-note" className={textInputClass()} value={draft.changeNote} onChange={(e) => set("changeNote", e.target.value)} maxLength={200} disabled={!allowed} placeholder="e.g. Shorter greeting" />
          </FormField>
        )}
        <div className="flex flex-wrap items-center gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
          {allowed && (
            <>
              <Button type="submit" variant={status === "ACTIVE" ? "primary" : "secondary"} isLoading={busy} disabled={busy || (!isNew && !dirty)}>
                {isNew ? "Save draft" : status === "ACTIVE" ? "Save" : "Save draft"}
              </Button>
              {(isNew || status === "DRAFT") && (
                <Button type="button" onClick={() => submit(true)} disabled={busy || Boolean(preview && !preview.ok)} title={preview && !preview.ok ? "Fix the errors first" : undefined}>
                  Save &amp; activate
                </Button>
              )}
              {!isNew && status !== "ARCHIVED" && (
                <Button type="button" variant="danger" onClick={() => setConfirmArchive(true)} disabled={busy}>
                  Archive
                </Button>
              )}
            </>
          )}
          <button type="button" className="ml-auto text-sm text-zinc-600 hover:underline dark:text-zinc-400" onClick={() => leave(template ? `/crm/templates/${template.id}` : "/crm/templates")}>
            Cancel
          </button>
          {dirty && <span className="w-full text-xs text-amber-700 dark:text-amber-300">Unsaved changes</span>}
        </div>
      </form>

      <aside className="space-y-3 lg:sticky lg:top-4 lg:self-start" aria-label="Preview">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Preview</h2>
          {status && <TemplateStatusBadge status={status} />}
        </div>
        <PreviewContextPicker value={ctx} onChange={setCtx} />
        <TemplatePreviewPane preview={preview} loading={previewing} channelType={draft.channelType} />
        {!preview && <TemplateIssueList errors={[]} warnings={[]} />}
        <p className="text-xs text-zinc-500">
          {template ? (
            <Link className="text-indigo-600 hover:underline" href={`/crm/templates/${template.id}`}>
              View details, history and test send →
            </Link>
          ) : (
            "Test sending is available once the draft is saved."
          )}
        </p>
      </aside>

      <ConfirmModal
        open={Boolean(confirmVersion)}
        title={`Save as version ${nextVersion}?`}
        message={`The text changed, so this saves version ${nextVersion}. Version ${template?.currentVersionNumber ?? 1} and every message already sent stay exactly as they were.${status === "ACTIVE" ? " New messages will use the new version straight away." : ""}`}
        confirmLabel={confirmVersion?.activate ? "Save & activate" : `Save version ${nextVersion}`}
        isBusy={busy}
        onCancel={() => setConfirmVersion(null)}
        onConfirm={() => {
          const a = confirmVersion?.activate ?? false;
          setConfirmVersion(null);
          void save(a);
        }}
      />
      <ConfirmModal open={Boolean(confirmLeave)} title="Discard unsaved changes?" message="You have changes that aren't saved. Leave without saving?" confirmLabel="Discard changes" isDangerous onCancel={() => setConfirmLeave(null)} onConfirm={() => {
        savedRef.current = true;
        router.push(confirmLeave!);
      }} />
      <ConfirmModal open={confirmArchive} title="Archive this template?" message="It won't be offered for new messages. Its versions and the messages sent from it are kept, and you can restore it later. Unsaved changes are discarded." confirmLabel="Archive" isDangerous isBusy={busy} onCancel={() => setConfirmArchive(false)} onConfirm={archive} />
    </div>
  );
}
