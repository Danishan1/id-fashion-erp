"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { ErrorState, LoadingState } from "@/components/ui/PageStates";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { Badge, CARD, inr, send, useApi } from "../commissions/commission-ui";
import { selectClass, usePerformanceOptions } from "../performance/performance-ui";

interface Channel {
  id: string;
  code: string;
  name: string;
  description: string | null;
  active: boolean;
  managerUserId: string | null;
  manager: string | null;
  orders: number;
  bookedThisMonth: number | null;
}
interface ListResult {
  month: string;
  data: Channel[];
  noChannelThisMonth: number | null;
}

const EMPTY = { code: "", name: "", description: "", managerUserId: "" };

/** Sales & Marketing → Channels (Phase 07): flat master; deactivate, never delete. */
export function ChannelsClient({ canEdit }: { canEdit: boolean }) {
  const [status, setStatus] = useState("active");
  const { data, error, reload } = useApi<ListResult>(`/api/v1/sales-marketing/channels?status=${status}`);
  const [editing, setEditing] = useState<Channel | "new" | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [toggle, setToggle] = useState<Channel | null>(null);
  const { reps } = usePerformanceOptions(editing !== null);

  const open = (c: Channel | "new") => {
    setFormError(null);
    setForm(c === "new" ? EMPTY : { code: c.code, name: c.name, description: c.description ?? "", managerUserId: c.managerUserId ?? "" });
    setEditing(c);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className={selectClass}>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="all">All</option>
        </select>
        {canEdit && <Button onClick={() => open("new")}>New channel</Button>}
      </div>
      {error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !data ? (
        <LoadingState />
      ) : (
        <div className={CARD}>
          {data.data.length === 0 ? (
            <p className="text-sm text-zinc-500">No channels yet. Add the ways you sell — e.g. Export buyers, Domestic wholesale, Agents, Online.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-xs uppercase text-zinc-500 dark:border-zinc-800">
                  <th className="py-2 pr-3">Channel</th>
                  <th className="py-2 pr-3">Manager</th>
                  <th className="py-2 pr-3 text-right">Orders</th>
                  <th className="py-2 pr-3 text-right">Booked · {data.month}</th>
                  <th className="py-2 pr-3">Status</th>
                  {canEdit && <th className="py-2" />}
                </tr>
              </thead>
              <tbody>
                {data.data.map((c) => (
                  <tr key={c.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                    <td className="py-2 pr-3">
                      <div className="font-medium text-zinc-900 dark:text-zinc-100">{c.name}</div>
                      <div className="text-xs text-zinc-500">
                        {c.code}
                        {c.description ? ` · ${c.description}` : ""}
                      </div>
                    </td>
                    <td className="py-2 pr-3">{c.manager ?? <span className="text-zinc-400">—</span>}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{c.orders.toLocaleString("en-IN")}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{c.bookedThisMonth === null ? "—" : inr(c.bookedThisMonth)}</td>
                    <td className="py-2 pr-3">{c.active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</td>
                    {canEdit && (
                      <td className="py-2 text-right whitespace-nowrap">
                        <Button size="xs" variant="secondary" onClick={() => open(c)}>
                          Edit
                        </Button>{" "}
                        <Button size="xs" variant="secondary" onClick={() => setToggle(c)}>
                          {c.active ? "Deactivate" : "Reactivate"}
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {data.noChannelThisMonth !== null && data.noChannelThisMonth > 0 && (
            <p className="mt-3 text-xs text-zinc-500">Orders without a channel this month: {inr(data.noChannelThisMonth)}. Set the channel on each Sales Order (Channel &amp; agent → Change).</p>
          )}
          <p className="mt-2 text-xs text-zinc-500">Booked = Sales Orders that count as booked (same rule as targets), before GST, by the order&apos;s own channel.</p>
        </div>
      )}

      {editing && (
        <Modal open onClose={() => setEditing(null)} title={editing === "new" ? "New channel" : `Edit ${editing.name}`}>
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setFormError(null);
              try {
                if (editing === "new") await send("/api/v1/sales-marketing/channels", "POST", form);
                else await send(`/api/v1/sales-marketing/channels/${editing.id}`, "PATCH", { name: form.name, description: form.description, managerUserId: form.managerUserId });
                setEditing(null);
                reload();
              } catch (err) {
                setFormError((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {editing === "new" && (
              <FormField label="Code" htmlFor="ch-code" required>
                <input id="ch-code" required maxLength={40} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} className={textInputClass()} />
              </FormField>
            )}
            <FormField label="Name" htmlFor="ch-name" required>
              <input id="ch-name" required maxLength={200} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={textInputClass()} />
            </FormField>
            <FormField label="Description" htmlFor="ch-desc">
              <textarea id="ch-desc" rows={2} maxLength={1000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={textInputClass()} />
            </FormField>
            <FormField label="Channel manager" htmlFor="ch-mgr">
              <SearchableSelect id="ch-mgr" value={form.managerUserId} onChange={(managerUserId) => setForm({ ...form, managerUserId })} options={reps} placeholder="Search people…" emptyOptionLabel="— None —" />
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
      {toggle && (
        <Modal open onClose={() => setToggle(null)} title={toggle.active ? `Deactivate ${toggle.name}?` : `Reactivate ${toggle.name}?`}>
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            {toggle.active ? "It can't be picked on new enquiries, quotations or orders. Records already on this channel keep it, and reports still show it." : "It can be picked again."}
          </p>
          {formError && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{formError}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setToggle(null)}>
              Close
            </Button>
            <Button
              variant={toggle.active ? "danger" : "primary"}
              isLoading={busy}
              onClick={async () => {
                setBusy(true);
                setFormError(null);
                try {
                  await send(`/api/v1/sales-marketing/channels/${toggle.id}/status`, "PATCH", { isActive: !toggle.active });
                  setToggle(null);
                  reload();
                } catch (err) {
                  setFormError((err as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {toggle.active ? "Deactivate" : "Reactivate"}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
