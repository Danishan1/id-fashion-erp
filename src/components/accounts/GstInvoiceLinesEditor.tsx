"use client";

import { useEffect, useMemo, useState } from "react";
import { GST_STATE_CODES } from "@/lib/gst";
import { calculatePayableInvoice, isInterStateSupply } from "@/lib/payables-gst";
import { SearchableSelect } from "@/components/ui/SearchableSelect";

/**
 * Shared GST invoice block for payment requests (2026-10-28): invoice no/date,
 * ITC / RCM / place of supply, and the invoice lines with a live preview of
 * the totals. The server recomputes everything (computeGstInvoice) — this only
 * previews with the same calculator, so the two agree.
 */

/** Common GST slabs. */
export const GST_RATE_OPTIONS = [0, 0.25, 3, 5, 12, 18, 28];

export interface GstInvoiceLineDraft {
  description: string;
  isForStock: boolean;
  purposeId: string;
  expenseAccountId: string;
  hsnCode: string;
  mrp: string;
  rate: string;
  quantity: string;
  discountPercentage: string;
  discountAmount: string;
  gstRate: string;
}

export interface GstInvoiceDraft {
  invoiceNumber: string;
  invoiceDate: string;
  isItcApplicable: boolean;
  isReverseCharge: boolean;
  placeOfSupplyStateCode: string;
  payToGstin: string;
  isRawMaterialForProduction: boolean;
  lines: GstInvoiceLineDraft[];
}

export const EMPTY_GST_INVOICE_LINE: GstInvoiceLineDraft = {
  description: "",
  isForStock: false,
  purposeId: "",
  expenseAccountId: "",
  hsnCode: "",
  mrp: "",
  rate: "",
  quantity: "1",
  discountPercentage: "",
  discountAmount: "",
  gstRate: "18",
};

export function emptyGstInvoiceDraft(placeOfSupplyStateCode = ""): GstInvoiceDraft {
  return {
    invoiceNumber: "",
    invoiceDate: "",
    isItcApplicable: true,
    isReverseCharge: false,
    placeOfSupplyStateCode,
    payToGstin: "",
    isRawMaterialForProduction: false,
    lines: [{ ...EMPTY_GST_INVOICE_LINE }],
  };
}

const num = (v: string) => (v.trim() === "" ? undefined : Number(v));

/** Draft -> API body (gstInvoiceSchema). */
export function toGstInvoicePayload(draft: GstInvoiceDraft) {
  return {
    ...draft,
    lines: draft.lines.map((l) => ({
      ...l,
      mrp: num(l.mrp),
      rate: num(l.rate),
      quantity: num(l.quantity),
      discountPercentage: num(l.discountPercentage),
      discountAmount: num(l.discountAmount),
      gstRate: num(l.gstRate),
    })),
  };
}

interface PurposeOption {
  id: string;
  name: string;
  code: string;
  isActive: boolean;
  expenseAccount: { id: string } | null;
}

const inr = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function GstInvoiceLinesEditor({
  value,
  onChange,
  companyStateCode,
  disabled,
}: {
  value: GstInvoiceDraft;
  onChange: (next: GstInvoiceDraft) => void;
  /** Our own state (from the company GSTIN) — decides CGST+SGST vs IGST. */
  companyStateCode: string | null;
  disabled?: boolean;
}) {
  const [purposes, setPurposes] = useState<PurposeOption[]>([]);
  const [showMrp, setShowMrp] = useState(false);

  useEffect(() => {
    fetch("/api/v1/expense-purposes")
      .then((res) => (res.ok ? res.json() : { data: [] }))
      .then((body) => setPurposes(body.data ?? []))
      .catch(() => setPurposes([]));
  }, []);

  const preview = useMemo(() => {
    const placeOfSupply = value.placeOfSupplyStateCode || companyStateCode;
    const isInterState = isInterStateSupply(companyStateCode, placeOfSupply);
    const lines = value.lines.map((l) => ({
      rate: num(l.rate) ?? 0,
      quantity: num(l.quantity) ?? 0,
      discountPercentage: num(l.discountPercentage) ?? null,
      discountAmount: num(l.discountAmount) ?? null,
      gstRate: num(l.gstRate) ?? 0,
    }));
    return calculatePayableInvoice(lines, { isInterState, isReverseCharge: value.isReverseCharge });
  }, [value, companyStateCode]);

  const set = (patch: Partial<GstInvoiceDraft>) => onChange({ ...value, ...patch });
  const setLine = (index: number, patch: Partial<GstInvoiceLineDraft>) =>
    set({ lines: value.lines.map((l, i) => (i === index ? { ...l, ...patch } : l)) });

  const purposeOptions = purposes
    .filter((p) => p.isActive || value.lines.some((l) => l.purposeId === p.id))
    .map((p) => ({ id: p.id, label: p.name, sublabel: p.code }));

  const inputCls = "w-full rounded border border-gray-300 px-2 py-1 text-sm disabled:bg-gray-100 dark:border-gray-600 dark:bg-gray-900";
  const stateOptions = Object.entries(GST_STATE_CODES).sort((a, b) => a[1].localeCompare(b[1]));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-sm">
          <span className="mb-1 block font-medium">Invoice No. *</span>
          <input className={inputCls} value={value.invoiceNumber} disabled={disabled} onChange={(e) => set({ invoiceNumber: e.target.value })} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">Invoice Date *</span>
          <input type="date" className={inputCls} value={value.invoiceDate} disabled={disabled} onChange={(e) => set({ invoiceDate: e.target.value })} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">Place of Supply</span>
          <select
            className={inputCls}
            value={value.placeOfSupplyStateCode}
            disabled={disabled}
            onChange={(e) => set({ placeOfSupplyStateCode: e.target.value })}
          >
            <option value="">Our state{companyStateCode ? ` (${GST_STATE_CODES[companyStateCode]})` : ""}</option>
            {stateOptions.map(([code, name]) => (
              <option key={code} value={code}>
                {code} — {name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">Party GSTIN</span>
          <input
            className={inputCls}
            value={value.payToGstin}
            disabled={disabled}
            placeholder="Filled from the party; you can change it"
            onChange={(e) => set({ payToGstin: e.target.value.toUpperCase() })}
          />
        </label>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={value.isItcApplicable} disabled={disabled} onChange={(e) => set({ isItcApplicable: e.target.checked })} />
          Input tax credit (ITC) can be claimed
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={value.isReverseCharge} disabled={disabled} onChange={(e) => set({ isReverseCharge: e.target.checked })} />
          Reverse charge (RCM)
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={value.isRawMaterialForProduction}
            disabled={disabled}
            onChange={(e) => set({ isRawMaterialForProduction: e.target.checked })}
          />
          Raw material for production
        </label>
        <label className="flex items-center gap-2 text-gray-500">
          <input type="checkbox" checked={showMrp} onChange={(e) => setShowMrp(e.target.checked)} />
          Show MRP column
        </label>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500 dark:bg-gray-800">
            <tr>
              <th className="px-2 py-2">#</th>
              <th className="min-w-[180px] px-2 py-2">Description *</th>
              <th className="px-2 py-2">Stock</th>
              <th className="min-w-[180px] px-2 py-2">Purpose</th>
              <th className="w-24 px-2 py-2">HSN/SAC</th>
              {showMrp && <th className="w-24 px-2 py-2">MRP</th>}
              <th className="w-24 px-2 py-2">Rate *</th>
              <th className="w-20 px-2 py-2">Qty *</th>
              <th className="w-20 px-2 py-2">Disc %</th>
              <th className="w-24 px-2 py-2">Disc ₹</th>
              <th className="w-24 px-2 py-2 text-right">Taxable</th>
              <th className="w-20 px-2 py-2">GST %</th>
              <th className="w-24 px-2 py-2 text-right">{preview.isInterState ? "IGST" : "CGST + SGST"}</th>
              <th className="w-28 px-2 py-2 text-right">Amount</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {value.lines.map((line, i) => {
              const r = preview.lines[i];
              return (
                <tr key={i} className="border-t border-gray-100 align-top dark:border-gray-700">
                  <td className="px-2 py-2 text-gray-500">{i + 1}</td>
                  <td className="px-2 py-2">
                    <input className={inputCls} value={line.description} disabled={disabled} onChange={(e) => setLine(i, { description: e.target.value })} />
                  </td>
                  <td className="px-2 py-2 text-center">
                    <input type="checkbox" checked={line.isForStock} disabled={disabled} onChange={(e) => setLine(i, { isForStock: e.target.checked })} />
                  </td>
                  <td className="px-2 py-2">
                    <SearchableSelect
                      options={purposeOptions}
                      value={line.purposeId}
                      disabled={disabled}
                      placeholder="Pick a purpose"
                      onChange={(id) => {
                        const purpose = purposes.find((p) => p.id === id);
                        setLine(i, { purposeId: id, expenseAccountId: purpose?.expenseAccount?.id ?? "" });
                      }}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <input className={inputCls} inputMode="numeric" value={line.hsnCode} disabled={disabled} onChange={(e) => setLine(i, { hsnCode: e.target.value })} />
                  </td>
                  {showMrp && (
                    <td className="px-2 py-2">
                      <input className={inputCls} inputMode="decimal" value={line.mrp} disabled={disabled} onChange={(e) => setLine(i, { mrp: e.target.value })} />
                    </td>
                  )}
                  <td className="px-2 py-2">
                    <input className={inputCls} inputMode="decimal" value={line.rate} disabled={disabled} onChange={(e) => setLine(i, { rate: e.target.value })} />
                  </td>
                  <td className="px-2 py-2">
                    <input className={inputCls} inputMode="decimal" value={line.quantity} disabled={disabled} onChange={(e) => setLine(i, { quantity: e.target.value })} />
                  </td>
                  <td className="px-2 py-2">
                    <input
                      className={inputCls}
                      inputMode="decimal"
                      value={line.discountPercentage}
                      disabled={disabled}
                      onChange={(e) => setLine(i, { discountPercentage: e.target.value, discountAmount: "" })}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <input
                      className={inputCls}
                      inputMode="decimal"
                      value={line.discountPercentage ? String(r?.discountAmount ?? "") : line.discountAmount}
                      disabled={disabled}
                      onChange={(e) => setLine(i, { discountAmount: e.target.value, discountPercentage: "" })}
                    />
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{inr(r?.taxableAmount ?? 0)}</td>
                  <td className="px-2 py-2">
                    <select className={inputCls} value={line.gstRate} disabled={disabled} onChange={(e) => setLine(i, { gstRate: e.target.value })}>
                      {GST_RATE_OPTIONS.map((g) => (
                        <option key={g} value={String(g)}>
                          {g}%
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {preview.isInterState ? inr(r?.igstAmount ?? 0) : `${inr(r?.cgstAmount ?? 0)} + ${inr(r?.sgstAmount ?? 0)}`}
                  </td>
                  <td className="px-2 py-2 text-right font-medium tabular-nums">{inr(r?.lineAmount ?? 0)}</td>
                  <td className="px-2 py-2">
                    {!disabled && value.lines.length > 1 && (
                      <button
                        type="button"
                        className="text-xs text-red-600 hover:underline"
                        onClick={() => set({ lines: value.lines.filter((_, j) => j !== i) })}
                      >
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!disabled && (
        <button
          type="button"
          className="text-sm font-medium text-indigo-600 hover:underline"
          onClick={() => set({ lines: [...value.lines, { ...EMPTY_GST_INVOICE_LINE }] })}
        >
          + Add line
        </button>
      )}

      <dl className="ml-auto grid max-w-sm grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <dt className="text-gray-500">Taxable total</dt>
        <dd className="text-right tabular-nums">₹{inr(preview.taxableTotal)}</dd>
        <dt className="text-gray-500">Total GST</dt>
        <dd className="text-right tabular-nums">₹{inr(preview.gstTotal)}</dd>
        {preview.discountTotal > 0 && (
          <>
            <dt className="text-gray-500">Total discount</dt>
            <dd className="text-right tabular-nums">₹{inr(preview.discountTotal)}</dd>
          </>
        )}
        <dt className="font-medium">Grand total</dt>
        <dd className="text-right font-medium tabular-nums">₹{inr(preview.grandTotal)}</dd>
        <dt className="font-semibold">Payable to party</dt>
        <dd className="text-right font-semibold tabular-nums">₹{inr(preview.payableToParty)}</dd>
      </dl>
      {value.isReverseCharge && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          Reverse charge: the GST of ₹{inr(preview.gstTotal)} is paid by us to the government, not to the party.
        </p>
      )}
    </div>
  );
}
