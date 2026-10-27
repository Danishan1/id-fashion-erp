"use client";

import { useEffect, useState, type FormEvent } from "react";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { StagedFilesPicker, uploadFilesToRecord } from "@/components/ui/AttachmentsPanel";
import { todayIsoDate } from "@/lib/date";
import {
  PAYMENT_MODES_OF_TRANSFER,
  PAYMENT_REQUEST_TYPE_DEFS,
  type PaymentRequestTypeKey,
} from "@/modules/accounts/payment-requests/request-type-registry";

interface Option {
  id: string;
  label: string;
  sublabel?: string;
}

export interface EditablePaymentRequest {
  id: string;
  requestType: PaymentRequestTypeKey;
  amount: string;
  payToName: string;
  supplierId: string | null;
  employeeId: string | null;
  paymentDueDate: string;
  modeOfTransfer: string | null;
  remark: string | null;
}

interface PaymentRequestFormProps {
  requestType: PaymentRequestTypeKey;
  /** Edit mode when set. */
  initial?: EditablePaymentRequest;
  onSuccess: (id: string) => void;
  onCancel: () => void;
}

/**
 * The common Payments Request form: amount, pay-to, due date (default today),
 * mode of transfer where the type uses it, remark, and voice remark + files.
 * Type-specific fields are added by each request type's own skill.
 */
export function PaymentRequestForm({ requestType, initial, onSuccess, onCancel }: PaymentRequestFormProps) {
  const def = PAYMENT_REQUEST_TYPE_DEFS[requestType];
  const isEdit = !!initial;

  const [options, setOptions] = useState<Option[]>([]);
  const [amount, setAmount] = useState(initial?.amount ?? "");
  const [payToName, setPayToName] = useState(initial?.payToName ?? "");
  const [payToId, setPayToId] = useState(initial?.supplierId ?? initial?.employeeId ?? "");
  const [paymentDueDate, setPaymentDueDate] = useState(initial?.paymentDueDate.slice(0, 10) ?? todayIsoDate());
  const [modeOfTransfer, setModeOfTransfer] = useState(initial?.modeOfTransfer ?? "");
  const [remark, setRemark] = useState(initial?.remark ?? "");
  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    if (def.payTo === "TEXT") return;
    const url = def.payTo === "SUPPLIER" ? "/api/v1/suppliers?pageSize=500" : "/api/v1/employees?pageSize=500";
    fetch(url)
      .then((res) => (res.ok ? res.json() : { data: [] }))
      .then((body) =>
        setOptions(
          (body.data ?? [])
            .filter((r: { isActive?: boolean }) => r.isActive !== false)
            .map((r: { id: string; name?: string; fullName?: string; code?: string; employeeCode?: string }) => ({
              id: r.id,
              label: r.name ?? r.fullName ?? "",
              sublabel: r.code ?? r.employeeCode,
            }))
        )
      )
      .catch(() => {});
  }, [def.payTo]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);

    const payload = {
      ...(isEdit ? {} : { requestType, idempotencyKey }),
      amount: Number(amount),
      payToName: def.payTo === "TEXT" ? payToName : undefined,
      supplierId: def.payTo === "SUPPLIER" ? payToId : undefined,
      employeeId: def.payTo === "EMPLOYEE" ? payToId : undefined,
      paymentDueDate,
      modeOfTransfer: def.showModeOfTransfer ? modeOfTransfer : undefined,
      remark,
    };

    try {
      const res = await fetch(isEdit ? `/api/v1/payment-requests/${initial.id}` : "/api/v1/payment-requests", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error?.message ?? "Could not save the request.");
        return;
      }
      const id: string = body.data.id;
      if (stagedFiles.length > 0) {
        try {
          await uploadFilesToRecord("payment-request", id, stagedFiles);
        } catch (uploadErr) {
          setError(uploadErr instanceof Error ? uploadErr.message : "The request was saved, but its files could not be uploaded.");
          return;
        }
      }
      onSuccess(id);
    } catch {
      setError("Network error — please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">{def.description}</p>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Amount" htmlFor="amount" required>
          <input
            id="amount"
            type="number"
            inputMode="decimal"
            min="0.01"
            step="0.01"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={textInputClass()}
          />
        </FormField>

        <FormField label={def.payToLabel} htmlFor="payTo" required>
          {def.payTo === "TEXT" ? (
            <input
              id="payTo"
              required
              maxLength={200}
              value={payToName}
              onChange={(e) => setPayToName(e.target.value)}
              className={textInputClass()}
            />
          ) : (
            <SearchableSelect
              id="payTo"
              options={options}
              value={payToId}
              onChange={setPayToId}
              required
              placeholder={def.payTo === "SUPPLIER" ? "Select supplier…" : "Select employee…"}
            />
          )}
        </FormField>

        <FormField label="Payment Due Date" htmlFor="paymentDueDate">
          <input
            id="paymentDueDate"
            type="date"
            value={paymentDueDate}
            onChange={(e) => setPaymentDueDate(e.target.value)}
            className={textInputClass()}
          />
        </FormField>

        {def.showModeOfTransfer && (
          <FormField label="Mode of Transfer" htmlFor="modeOfTransfer">
            <select
              id="modeOfTransfer"
              value={modeOfTransfer}
              onChange={(e) => setModeOfTransfer(e.target.value)}
              className={textInputClass()}
            >
              <option value="">—</option>
              {PAYMENT_MODES_OF_TRANSFER.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </FormField>
        )}
      </div>

      <FormField label="Remark (optional)" htmlFor="remark">
        <textarea
          id="remark"
          rows={3}
          maxLength={2000}
          value={remark}
          onChange={(e) => setRemark(e.target.value)}
          className={textInputClass()}
        />
      </FormField>

      {!isEdit && (
        <FormField label="Voice remark & files (optional)" htmlFor="stagedFiles">
          <StagedFilesPicker files={stagedFiles} onChange={setStagedFiles} />
        </FormField>
      )}

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
        >
          {isSubmitting ? "Saving…" : isEdit ? "Save Changes" : "Submit Request"}
        </button>
      </div>
    </form>
  );
}
