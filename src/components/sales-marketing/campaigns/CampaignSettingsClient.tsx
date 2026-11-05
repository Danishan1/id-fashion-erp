"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { ErrorState, LoadingState } from "@/components/ui/PageStates";
import { Badge, CARD, send, useApi } from "./campaign-ui";

interface Row {
  id: string;
  kind: "TYPE" | "OBJECTIVE";
  code: string;
  name: string;
  description: string | null;
  sortOrder: number;
  active: boolean;
  campaigns: number;
}

const KIND_LABEL = { TYPE: "Campaign types", OBJECTIVE: "Campaign objectives" } as const;

/** Campaign types and objectives (Phase 08): the company's own lists; deactivate, never delete. */
export function CampaignSettingsClient({ canEdit }: { canEdit: boolean }) {
  const { data, error, reload } = useApi<Row[]>("/api/v1/sales-marketing/campaigns/lookups?includeInactive=true");
  const [editing, setEditing] = useState<Row | { kind: "TYPE" | "OBJECTIVE" } | null>(null);
  const [v, setV] = useState({ code: "", name: "", description: "", sortOrder: "" });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const open = (r: Row | { kind: "TYPE" | "OBJECTIVE" }) => {
    setFormError(null);
    setV("id" in r ? { code: r.code, name: r.name, description: r.description ?? "", sortOrder: String(r.sortOrder) } : { code: "", name: "", description: "", sortOrder: "" });
    setEditing(r);
  };
  const save = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setFormError(null);
    try {
      await fn();
      setEditing(null);
      reload();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return <LoadingState />;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {(["TYPE", "OBJECTIVE"] as const).map((kind) => (
        <section key={kind} className={CARD} aria-label={KIND_LABEL[kind]}>
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">{KIND_LABEL[kind]}</h2>
            {canEdit && (
              <Button size="xs" variant="secondary" onClick={() => open({ kind })}>
                Add
              </Button>
            )}
          </div>
          <table className="mt-2 w-full text-sm">
            <tbody>
              {data
                .filter((r) => r.kind === kind)
                .map((r) => (
                  <tr key={r.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                    <td className="py-2 pr-2">
                      <div className="font-medium">{r.name}</div>
                      <div className="text-xs text-zinc-500">
                        {r.code}
                        {r.description ? ` · ${r.description}` : ""} · {r.campaigns} campaign{r.campaigns === 1 ? "" : "s"}
                      </div>
                    </td>
                    <td className="py-2 pr-2">{r.active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</td>
                    {canEdit && (
                      <td className="py-2 text-right whitespace-nowrap">
                        <Button size="xs" variant="secondary" onClick={() => open(r)}>
                          Edit
                        </Button>{" "}
                        <Button size="xs" variant="secondary" onClick={() => save(() => send(`/api/v1/sales-marketing/campaigns/lookups/${r.id}`, "PATCH", { name: r.name, description: r.description ?? "", isActive: !r.active }))}>
                          {r.active ? "Deactivate" : "Reactivate"}
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
            </tbody>
          </table>
        </section>
      ))}
      {editing && (
        <Modal open onClose={() => setEditing(null)} title={"id" in editing ? `Edit ${editing.name}` : `New ${editing.kind === "TYPE" ? "campaign type" : "objective"}`}>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              const body = { name: v.name, description: v.description, ...(v.sortOrder ? { sortOrder: Number(v.sortOrder) } : {}) };
              save(() => ("id" in editing ? send(`/api/v1/sales-marketing/campaigns/lookups/${editing.id}`, "PATCH", body) : send("/api/v1/sales-marketing/campaigns/lookups", "POST", { ...body, kind: editing.kind, code: v.code })));
            }}
          >
            {!("id" in editing) && (
              <FormField label="Code" htmlFor="lk-code" required>
                <input id="lk-code" required maxLength={40} value={v.code} onChange={(e) => setV({ ...v, code: e.target.value })} className={textInputClass()} />
              </FormField>
            )}
            <FormField label="Name" htmlFor="lk-name" required>
              <input id="lk-name" required maxLength={120} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} className={textInputClass()} />
            </FormField>
            <FormField label="Description" htmlFor="lk-desc">
              <input id="lk-desc" maxLength={500} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} className={textInputClass()} />
            </FormField>
            <FormField label="Sort order" htmlFor="lk-sort">
              <input id="lk-sort" type="number" min={0} max={9999} value={v.sortOrder} onChange={(e) => setV({ ...v, sortOrder: e.target.value })} className={textInputClass()} />
            </FormField>
            {formError && <p className="text-sm text-red-600 dark:text-red-400">{formError}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setEditing(null)}>
                Close
              </Button>
              <Button type="submit" isLoading={busy}>
                Save
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
