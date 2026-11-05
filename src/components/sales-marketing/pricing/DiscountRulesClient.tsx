"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { getApiErrorMessage } from "@/lib/api-client";
import { todayIsoDate } from "@/lib/date";
import { formatDate } from "@/lib/date-format";
import { DISCOUNT_RULE_STATUSES, DISCOUNT_RULE_TYPES, DISCOUNT_STACKING, type DiscountRuleStatusKey } from "@/modules/sales-marketing/pricing/pricing-registry";
import { Badge, CARD, PricingHistory, TextDialog, inr, useLookups, type TextDialogSpec } from "./pricing-ui";

interface RuleRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  status: DiscountRuleStatusKey;
  discountType: "PERCENT" | "AMOUNT_PER_UNIT";
  value: string;
  stacking: "EXCLUSIVE" | "STACKABLE";
  priority: number;
  productId: string | null;
  categoryId: string | null;
  customerId: string | null;
  priceListId: string | null;
  minQuantity: string | null;
  validFrom: string;
  validTo: string | null;
  version: number;
  product: { styleName: string; styleCode: string } | null;
  category: { name: string } | null;
  customer: { name: string } | null;
  priceList: { code: string } | null;
}

export const ruleTone = (s: DiscountRuleStatusKey) => (s === "ACTIVE" ? "green" : s === "PENDING_APPROVAL" ? "amber" : "zinc");
const amount = (r: Pick<RuleRow, "discountType" | "value">) => (r.discountType === "PERCENT" ? `${Number(r.value)}% off` : `${inr(r.value)} off per unit`);
export const ruleScope = (r: RuleRow) =>
  [r.product && `Style ${r.product.styleName}`, r.category && `category ${r.category.name}`, r.customer && `customer ${r.customer.name}`, r.priceList && `list ${r.priceList.code}`, r.minQuantity && `${Number(r.minQuantity)}+ units`]
    .filter(Boolean)
    .join(" · ") || "Every priced line";

export function DiscountRulesListClient() {
  const [status, setStatus] = useState("");
  return (
    <DataTable<RuleRow>
      fetchUrl="/api/v1/sales-marketing/pricing/discount-rules"
      searchPlaceholder="Search code or name…"
      rowHref={(r) => `/sales-marketing/pricing/discounts/${r.id}`}
      extraParams={{ status: status || undefined }}
      toolbar={
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className={`${textInputClass()} !w-auto min-w-[9rem]`}>
          <option value="">All statuses</option>
          {(Object.keys(DISCOUNT_RULE_STATUSES) as DiscountRuleStatusKey[]).map((s) => (
            <option key={s} value={s}>
              {DISCOUNT_RULE_STATUSES[s]}
            </option>
          ))}
        </select>
      }
      columns={[
        {
          key: "code",
          header: "Rule",
          render: (r) => (
            <div>
              <div className="font-medium text-zinc-900 dark:text-zinc-100">{r.code}</div>
              <div className="text-xs text-zinc-500">{r.name}</div>
            </div>
          ),
        },
        { key: "amount", header: "Discount", render: (r) => amount(r) },
        { key: "stacking", header: "Combines", render: (r) => (r.stacking === "STACKABLE" ? "Stackable" : "Exclusive") },
        { key: "scope", header: "Applies to", render: (r) => <span className="text-sm">{ruleScope(r)}</span> },
        { key: "dates", header: "Valid", render: (r) => `${formatDate(r.validFrom)}${r.validTo ? ` – ${formatDate(r.validTo)}` : " onwards"}` },
        { key: "status", header: "Status", render: (r) => <Badge tone={ruleTone(r.status)}>{DISCOUNT_RULE_STATUSES[r.status]}</Badge> },
      ]}
    />
  );
}

// ── Form ─────────────────────────────────────────────────────────

const toForm = (r?: RuleRow) => ({
  code: r?.code ?? "",
  name: r?.name ?? "",
  description: r?.description ?? "",
  discountType: r?.discountType ?? ("PERCENT" as "PERCENT" | "AMOUNT_PER_UNIT"),
  value: r ? String(Number(r.value)) : "",
  stacking: r?.stacking ?? ("EXCLUSIVE" as "EXCLUSIVE" | "STACKABLE"),
  priority: r ? String(r.priority) : "0",
  productId: r?.productId ?? "",
  categoryId: r?.categoryId ?? "",
  customerId: r?.customerId ?? "",
  priceListId: r?.priceListId ?? "",
  minQuantity: r?.minQuantity ? String(Number(r.minQuantity)) : "",
  validFrom: r?.validFrom?.slice(0, 10) ?? todayIsoDate(),
  validTo: r?.validTo?.slice(0, 10) ?? "",
});

export function DiscountRuleForm({ rule, priceLists, onSaved }: { rule?: RuleRow; priceLists: { id: string; label: string }[]; onSaved?: (r: unknown) => void }) {
  const router = useRouter();
  const { styles, customers, categories } = useLookups(["styles", "customers", "categories"]);
  const [v, setV] = useState(toForm(rule));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<typeof v>) => setV((p) => ({ ...p, ...patch }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { code, ...rest } = v;
    const res = await fetch(rule ? `/api/v1/sales-marketing/pricing/discount-rules/${rule.id}` : "/api/v1/sales-marketing/pricing/discount-rules", {
      method: rule ? "PUT" : "POST",
      headers: { "Content-Type": "application/json", "x-toast": "off" },
      body: JSON.stringify(rule ? { ...rest, version: rule.version } : v),
    });
    setSaving(false);
    if (!res.ok) return setError(await getApiErrorMessage(res, "Couldn't save the rule."));
    const { data } = await res.json();
    if (onSaved) onSaved(data);
    else router.push(`/sales-marketing/pricing/discounts/${data.id}`);
  };

  return (
    <form onSubmit={submit} className={`${CARD} space-y-4`}>
      <div className="grid gap-4 sm:grid-cols-3">
        <FormField label="Code" htmlFor="r-code" required>
          <input id="r-code" required disabled={Boolean(rule)} maxLength={40} value={v.code} onChange={(e) => set({ code: e.target.value.toUpperCase() })} placeholder="e.g. BULK5" className={textInputClass()} />
        </FormField>
        <FormField label="Name" htmlFor="r-name" required>
          <input id="r-name" required maxLength={200} value={v.name} onChange={(e) => set({ name: e.target.value })} className={textInputClass()} />
        </FormField>
        <FormField label="Priority (higher first)" htmlFor="r-priority">
          <input id="r-priority" type="number" min={-1000} max={1000} value={v.priority} onChange={(e) => set({ priority: e.target.value })} className={textInputClass()} />
        </FormField>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <FormField label="Discount" htmlFor="r-type" required>
          <select id="r-type" value={v.discountType} onChange={(e) => set({ discountType: e.target.value as typeof v.discountType })} className={textInputClass()}>
            {Object.entries(DISCOUNT_RULE_TYPES).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label={v.discountType === "PERCENT" ? "Percent" : "₹ per base unit (e.g. per piece)"} htmlFor="r-value" required>
          <input id="r-value" type="number" required min={0.01} max={v.discountType === "PERCENT" ? 100 : undefined} step="0.01" value={v.value} onChange={(e) => set({ value: e.target.value })} className={textInputClass()} />
        </FormField>
        <FormField label="Combines with other rules" htmlFor="r-stacking" required>
          <select id="r-stacking" value={v.stacking} onChange={(e) => set({ stacking: e.target.value as typeof v.stacking })} className={textInputClass()}>
            {Object.entries(DISCOUNT_STACKING).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </FormField>
      </div>
      <p className="text-xs text-zinc-500">
        Exclusive: only the biggest exclusive rule counts. Stackable: all stackable rules apply one after another on the reduced price. A line gets whichever gives the bigger discount. Rules only apply to lines priced from a price list.
      </p>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Applies to (leave empty for all)</h3>
      <div className="grid gap-4 sm:grid-cols-3">
        <FormField label="Style" htmlFor="r-style">
          <SearchableSelect id="r-style" value={v.productId} onChange={(productId) => set({ productId })} options={styles} placeholder="Any style" />
        </FormField>
        <FormField label="Category" htmlFor="r-category">
          <SearchableSelect id="r-category" value={v.categoryId} onChange={(categoryId) => set({ categoryId })} options={categories} placeholder="Any category" />
        </FormField>
        <FormField label="Customer" htmlFor="r-customer">
          <SearchableSelect id="r-customer" value={v.customerId} onChange={(customerId) => set({ customerId })} options={customers} placeholder="Any customer" />
        </FormField>
        <FormField label="Price list" htmlFor="r-list">
          <SearchableSelect id="r-list" value={v.priceListId} onChange={(priceListId) => set({ priceListId })} options={priceLists} placeholder="Any price list" />
        </FormField>
        <FormField label="Minimum quantity (base unit)" htmlFor="r-minqty">
          <input id="r-minqty" type="number" min={0} step="0.001" value={v.minQuantity} onChange={(e) => set({ minQuantity: e.target.value })} className={textInputClass()} />
        </FormField>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <FormField label="Valid from" htmlFor="r-from" required>
          <input id="r-from" type="date" required value={v.validFrom} onChange={(e) => set({ validFrom: e.target.value })} className={textInputClass()} />
        </FormField>
        <FormField label="Valid to (optional)" htmlFor="r-to">
          <input id="r-to" type="date" min={v.validFrom} value={v.validTo} onChange={(e) => set({ validTo: e.target.value })} className={textInputClass()} />
        </FormField>
      </div>
      <FormField label="Description" htmlFor="r-desc">
        <textarea id="r-desc" rows={2} maxLength={1000} value={v.description} onChange={(e) => set({ description: e.target.value })} className={textInputClass()} />
      </FormField>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <Button type="submit" isLoading={saving} loadingLabel="Saving…">
        {rule ? "Save rule" : "Create draft rule"}
      </Button>
    </form>
  );
}

// ── Detail ───────────────────────────────────────────────────────

export interface DiscountRuleDetail extends RuleRow {
  approvalComment: string | null;
  viewerCanApprove: boolean;
  createdBy: { fullName: string } | null;
  approvedBy: { fullName: string } | null;
  events: { id: string; type: string; versionNumber: number | null; comment: string | null; createdAt: string; createdBy: { fullName: string } | null }[];
}

export function DiscountRuleDetailClient({ initial, priceLists, perms }: { initial: DiscountRuleDetail; priceLists: { id: string; label: string }[]; perms: { edit: boolean; approve: boolean; reject: boolean } }) {
  const [r, setR] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<TextDialogSpec | null>(null);
  const [editing, setEditing] = useState(false);
  const editable = perms.edit && (r.status === "DRAFT" || r.status === "INACTIVE");

  const act = async (action: string, body: Record<string, string> = {}) => {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/v1/sales-marketing/pricing/discount-rules/${r.id}/actions/${action}`, { method: "POST", headers: { "Content-Type": "application/json", "x-toast": "off" }, body: JSON.stringify(body) });
    setBusy(false);
    if (!res.ok) return setError(await getApiErrorMessage(res));
    setR((await res.json()).data);
    setDialog(null);
  };
  const open = (spec: TextDialogSpec) => {
    setError(null);
    if (!spec.field && !spec.help) return act(spec.action);
    setDialog(spec);
  };

  return (
    <div className="space-y-4">
      <div className={`${CARD} flex flex-wrap items-start justify-between gap-3`}>
        <div className="space-y-1 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={ruleTone(r.status)}>{DISCOUNT_RULE_STATUSES[r.status]}</Badge>
            <strong>{amount(r)}</strong>
            <span className="text-zinc-500">· {r.stacking === "STACKABLE" ? "stackable" : "exclusive"} · priority {r.priority}</span>
          </div>
          <div>{ruleScope(r)}</div>
          <div className="text-xs text-zinc-500">
            Valid {formatDate(r.validFrom)}
            {r.validTo ? ` – ${formatDate(r.validTo)}` : " onwards"} · prepared by {r.createdBy?.fullName ?? "—"}
            {r.approvedBy ? ` · approved by ${r.approvedBy.fullName}` : ""}
          </div>
          {r.description && <p className="text-zinc-600 dark:text-zinc-300">{r.description}</p>}
          {r.status === "DRAFT" && r.approvalComment && <p className="text-xs text-red-700 dark:text-red-400">Sent back by the approver: {r.approvalComment}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {editable && (
            <Button size="xs" variant="secondary" onClick={() => setEditing(!editing)}>
              {editing ? "Close editor" : "Edit"}
            </Button>
          )}
          {editable && (
            <Button size="xs" disabled={busy} onClick={() => open({ action: "submit", title: `Submit ${r.code} for approval`, field: { name: "comment", label: "Comment (optional)", required: false }, submitLabel: "Submit" })}>
              Submit for approval
            </Button>
          )}
          {r.status === "PENDING_APPROVAL" && r.viewerCanApprove && perms.approve && (
            <Button size="xs" disabled={busy} onClick={() => open({ action: "approve", title: `Approve ${r.code}`, help: "The rule applies to quotations priced from now on.", field: { name: "comment", label: "Comment (optional)", required: false }, submitLabel: "Approve" })}>
              Approve
            </Button>
          )}
          {r.status === "PENDING_APPROVAL" && r.viewerCanApprove && perms.reject && (
            <Button size="xs" variant="secondary" disabled={busy} onClick={() => open({ action: "decline", title: "Send back to draft", field: { name: "reason", label: "Reason", required: true }, submitLabel: "Decline", danger: true })}>
              Decline
            </Button>
          )}
          {r.status === "PENDING_APPROVAL" && perms.edit && (
            <Button size="xs" variant="secondary" disabled={busy} onClick={() => act("return-to-draft")}>
              Return to draft
            </Button>
          )}
          {r.status === "ACTIVE" && perms.edit && (
            <Button size="xs" variant="danger" disabled={busy} onClick={() => open({ action: "deactivate", title: `Deactivate ${r.code}`, help: "Quotations already issued keep their prices.", field: { name: "reason", label: "Reason", required: true }, submitLabel: "Deactivate", danger: true })}>
              Deactivate
            </Button>
          )}
        </div>
      </div>
      {r.status === "PENDING_APPROVAL" && !r.viewerCanApprove && <p className="text-xs text-amber-700 dark:text-amber-400">Waiting for approval by someone with pricing approval rights who didn&apos;t prepare it.</p>}
      {error && !dialog && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {editing && editable && (
        <DiscountRuleForm
          key={r.version}
          rule={r}
          priceLists={priceLists}
          onSaved={(next) => {
            setR(next as DiscountRuleDetail);
            setEditing(false);
          }}
        />
      )}
      <section className={`${CARD} space-y-2`}>
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">History</h2>
        <PricingHistory events={r.events} />
      </section>
      {dialog && <TextDialog key={dialog.action} spec={dialog} busy={busy} error={error} onClose={() => setDialog(null)} onSubmit={(body) => act(dialog.action, body)} />}
    </div>
  );
}
