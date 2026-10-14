"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { todayIsoDate } from "@/lib/date";
import { GST_STATE_CODES, extractStateCodeFromGstin } from "@/lib/gst";

const INVOICE_TYPE_OPTIONS = [
  { value: "TAX_INVOICE", label: "Tax Invoice" },
  { value: "PROFORMA_INVOICE", label: "Proforma Invoice" },
];

interface CustomerOption {
  id: string;
  name: string;
  code: string;
  taxRegistrationNo?: string | null;
  billingAddress?: string | null;
  shippingAddress?: string | null;
  city?: string | null;
  pinCode?: string | null;
}

interface InvoiceSeriesOption {
  id: string;
  name: string;
  prefix: string;
  fiscalYearLabel: string;
  isActive: boolean;
}

interface IncomeAccountOption {
  id: string;
  code: string;
  name: string;
  accountType: string;
  isActive: boolean;
}

interface ItemLinkOption {
  id: string;
  styleName: string;
  hsnSacCode: string | null;
  unitCost: string | null;
  kind: "Style" | "Material";
}

interface ServicePreset {
  id: string;
  name: string;
  sacCode: string;
  defaultGst: string;
}

export const COMMON_FASHION_SERVICES: ServicePreset[] = [
  { id: "srv-stitching", name: "Job Work / Stitching Charges", sacCode: "998822", defaultGst: "5" },
  { id: "srv-embroidery", name: "Embroidery & Embellishment Work", sacCode: "9988", defaultGst: "5" },
  { id: "srv-printing", name: "Fabric Printing & Dyeing", sacCode: "9988", defaultGst: "5" },
  { id: "srv-washing", name: "Washing & Garment Finishing", sacCode: "9988", defaultGst: "5" },
  { id: "srv-pattern", name: "Pattern Making & Sample Development", sacCode: "9983", defaultGst: "18" },
  { id: "srv-design", name: "Fashion Design & Styling Consultancy", sacCode: "9983", defaultGst: "18" },
  { id: "srv-freight", name: "Freight, Shipping & Delivery Charges", sacCode: "996511", defaultGst: "18" },
  { id: "srv-packing", name: "Packing & Handling Charges", sacCode: "9985", defaultGst: "18" },
  { id: "srv-alteration", name: "Alteration & Tailoring Services", sacCode: "9987", defaultGst: "5" },
];

interface ItemDraft {
  productId: string;
  itemName: string;
  hsnCode: string;
  quantity: string;
  unitPrice: string;
  gstPercentage: string;
  itemType?: "ALL" | "PRODUCT" | "SERVICE";
}

const emptyItem = (): ItemDraft => ({
  productId: "",
  itemName: "",
  hsnCode: "",
  quantity: "1",
  unitPrice: "0",
  gstPercentage: "0",
  itemType: "ALL",
});

interface InitialInvoice {
  id: string;
  invoiceDate: string;
  invoiceType: string;
  hasDueDate: boolean;
  dueDate: string | null;
  invoiceSeriesId: string;
  invoiceNumber: string;
  customerId: string;
  placeOfSupplyStateCode?: string | null;
  incomeAccountId: string | null;
  discountPercentage: string;
  isReverseCharge: boolean;
  advancePaymentTitle: string | null;
  advancePaymentAmount: string | null;
  payableAmountTitle: string | null;
  payableAmountValue: string | null;
  termsAndConditions: string | null;
  items: { productId: string | null; itemName: string; hsnCode: string | null; quantity: string; unitPrice: string; gstPercentage: string }[];
  notes: { note: string }[];
}

export function CustomInvoiceForm({ initialInvoice }: { initialInvoice?: InitialInvoice }) {
  const router = useRouter();
  const isEdit = !!initialInvoice;

  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [series, setSeries] = useState<InvoiceSeriesOption[]>([]);
  const [itemLinkOptions, setItemLinkOptions] = useState<ItemLinkOption[]>([]);
  const [incomeAccounts, setIncomeAccounts] = useState<IncomeAccountOption[]>([]);
  const [incomeAccountId, setIncomeAccountId] = useState(initialInvoice?.incomeAccountId ?? "");

  const [invoiceDate, setInvoiceDate] = useState(initialInvoice?.invoiceDate.slice(0, 10) ?? todayIsoDate());
  const [invoiceType, setInvoiceType] = useState(initialInvoice?.invoiceType ?? "TAX_INVOICE");
  const [hasDueDate, setHasDueDate] = useState(initialInvoice?.hasDueDate ?? false);
  const [dueDate, setDueDate] = useState(initialInvoice?.dueDate?.slice(0, 10) ?? "");
  const [invoiceSeriesId, setInvoiceSeriesId] = useState(initialInvoice?.invoiceSeriesId ?? "");
  const [invoiceNumber, setInvoiceNumber] = useState(initialInvoice?.invoiceNumber ?? "");
  const [numberManuallyEdited, setNumberManuallyEdited] = useState(isEdit);
  const [numberCheckStatus, setNumberCheckStatus] = useState<"idle" | "checking" | "available" | "unavailable">("idle");
  const [numberCheckMessage, setNumberCheckMessage] = useState<string>("");
  const [customerId, setCustomerId] = useState(initialInvoice?.customerId ?? "");
  const [placeOfSupplyStateCode, setPlaceOfSupplyStateCode] = useState(initialInvoice?.placeOfSupplyStateCode ?? "");
  const [discountPercentage, setDiscountPercentage] = useState(initialInvoice?.discountPercentage ?? "0");
  const [isReverseCharge, setIsReverseCharge] = useState(initialInvoice?.isReverseCharge ?? false);
  const [items, setItems] = useState<ItemDraft[]>(
    initialInvoice?.items.length
      ? initialInvoice.items.map((i) => ({
          productId: i.productId ?? "",
          itemName: i.itemName,
          hsnCode: i.hsnCode ?? "",
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          gstPercentage: i.gstPercentage,
        }))
      : [emptyItem()]
  );
  const [notes, setNotes] = useState<string[]>(initialInvoice?.notes.map((n) => n.note) ?? []);
  const [advancePaymentTitle, setAdvancePaymentTitle] = useState(initialInvoice?.advancePaymentTitle ?? "");
  const [advancePaymentAmount, setAdvancePaymentAmount] = useState(initialInvoice?.advancePaymentAmount ?? "");
  const [payableAmountTitle, setPayableAmountTitle] = useState(initialInvoice?.payableAmountTitle ?? "");
  const [payableAmountValue, setPayableAmountValue] = useState(initialInvoice?.payableAmountValue ?? "");
  const [termsAndConditions, setTermsAndConditions] = useState(initialInvoice?.termsAndConditions ?? "");

  const [showCreateClient, setShowCreateClient] = useState(false);
  const [newClientName, setNewClientName] = useState("");
  const [newClientCode, setNewClientCode] = useState("");
  const [isCreatingClient, setIsCreatingClient] = useState(false);
  const [createClientError, setCreateClientError] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/v1/customers?pageSize=500")
      .then((res) => res.json())
      .then((body) => setCustomers(body.data ?? []))
      .catch(() => {});
    fetch("/api/v1/invoice-series")
      .then((res) => res.json())
      .then((body) => setSeries(body.data ?? []))
      .catch(() => {});
    fetch("/api/v1/chart-of-accounts?pageSize=200")
      .then((res) => res.json())
      .then((body) => setIncomeAccounts((body.data ?? []).filter((a: IncomeAccountOption) => a.accountType === "INCOME" && a.isActive)))
      .catch(() => {});
    Promise.all([
      fetch("/api/v1/products?pageSize=200")
        .then((res) => res.json())
        .then((body) => (body.data ?? []).map((p: ItemLinkOption) => ({ ...p, kind: "Style" as const }))),
      fetch("/api/v1/materials?pageSize=200")
        .then((res) => res.json())
        .then((body) => (body.data ?? []).map((p: ItemLinkOption) => ({ ...p, kind: "Material" as const }))),
    ])
      .then(([styles, materials]) => setItemLinkOptions([...styles, ...materials]))
      .catch(() => {});
  }, []);

  // Pre-fill the suggested next number whenever the series changes, unless
  // the user has already started typing their own number — matches the
  // reference tool's "Edit" button behavior (suggested, always overridable).
  useEffect(() => {
    if (!invoiceSeriesId || numberManuallyEdited) return;
    fetch(`/api/v1/custom-invoices/next-number?seriesId=${invoiceSeriesId}`)
      .then((res) => res.json())
      .then((body) => body.data?.invoiceNumber && setInvoiceNumber(body.data.invoiceNumber))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceSeriesId]);

  const checkInvoiceNumberAvailability = async (numToTest?: string) => {
    const targetNumber = (numToTest ?? invoiceNumber).trim();
    if (!targetNumber) {
      setNumberCheckStatus("idle");
      setNumberCheckMessage("");
      return;
    }
    setNumberCheckStatus("checking");
    setNumberCheckMessage("");
    try {
      const url = `/api/v1/custom-invoices/check-number?number=${encodeURIComponent(targetNumber)}${
        isEdit && initialInvoice ? `&excludeId=${encodeURIComponent(initialInvoice.id)}` : ""
      }`;
      const res = await fetch(url);
      const body = await res.json();
      if (!res.ok) {
        setNumberCheckStatus("unavailable");
        setNumberCheckMessage(body?.error?.message ?? "Failed to check invoice number.");
        return;
      }
      if (body.data?.available) {
        setNumberCheckStatus("available");
        setNumberCheckMessage(body.data?.message ?? "Number is available.");
      } else {
        setNumberCheckStatus("unavailable");
        setNumberCheckMessage(body.data?.message ?? "Number already exists.");
      }
    } catch {
      setNumberCheckStatus("unavailable");
      setNumberCheckMessage("Unable to reach server to verify number.");
    }
  };

  const updateItem = (index: number, patch: Partial<ItemDraft>) => {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  };

  const applyItemLink = (index: number, selectedId: string) => {
    if (!selectedId) {
      updateItem(index, { productId: "" });
      return;
    }

    const serviceMatch = COMMON_FASHION_SERVICES.find((s) => s.id === selectedId);
    if (serviceMatch) {
      updateItem(index, {
        productId: "",
        itemName: serviceMatch.name,
        hsnCode: serviceMatch.sacCode,
        gstPercentage: serviceMatch.defaultGst,
      });
      return;
    }

    const picked = itemLinkOptions.find((o) => o.id === selectedId);
    updateItem(index, {
      productId: selectedId,
      itemName: picked?.styleName ?? "",
      hsnCode: picked?.hsnSacCode ?? "",
      unitPrice: picked?.unitCost ?? "0",
    });
  };

  const getItemOptionsForLine = (lineType: "ALL" | "PRODUCT" | "SERVICE" = "ALL") => {
    const productOptions = itemLinkOptions.map((o) => ({
      id: o.id,
      label: o.styleName,
      sublabel: o.kind,
    }));
    const serviceOptions = COMMON_FASHION_SERVICES.map((s) => ({
      id: s.id,
      label: s.name,
      sublabel: `SAC ${s.sacCode} • GST ${s.defaultGst}%`,
    }));

    if (lineType === "PRODUCT") return productOptions;
    if (lineType === "SERVICE") return serviceOptions;
    return [...productOptions, ...serviceOptions];
  };

  const addItem = () => setItems((prev) => [...prev, emptyItem()]);
  const removeItem = (index: number) => setItems((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));

  const addNote = () => setNotes((prev) => [...prev, ""]);
  const updateNote = (index: number, value: string) => setNotes((prev) => prev.map((n, i) => (i === index ? value : n)));
  const removeNote = (index: number) => setNotes((prev) => prev.filter((_, i) => i !== index));

  // Live client-side preview only — the server always recomputes these
  // authoritatively from scratch, never trusts this calculation.
  const computedLines = useMemo(() => {
    const discount = Number(discountPercentage) || 0;
    return items.map((it) => {
      const qty = Number(it.quantity) || 0;
      const price = Number(it.unitPrice) || 0;
      const gst = Number(it.gstPercentage) || 0;
      const discountedPrice = price * (1 - discount / 100);
      const lineAmount = qty * discountedPrice;
      const lineTax = isReverseCharge ? 0 : lineAmount * (gst / 100);
      return { lineAmount, lineTax, lineTotal: lineAmount + lineTax };
    });
  }, [items, discountPercentage, isReverseCharge]);

  const subtotalAmount = computedLines.reduce((sum, l) => sum + l.lineAmount, 0);
  const taxAmount = computedLines.reduce((sum, l) => sum + l.lineTax, 0);
  const grandTotal = subtotalAmount + taxAmount;
  const balanceDue = grandTotal - (Number(advancePaymentAmount) || 0) - (Number(payableAmountValue) || 0);

  const openCreateClient = () => {
    setNewClientName("");
    setCreateClientError(null);
    setShowCreateClient(true);
    fetch("/api/v1/customers/next-code")
      .then((res) => res.json())
      .then((body) => setNewClientCode(body.data?.code ?? ""))
      .catch(() => setNewClientCode(""));
  };

  const handleCreateClient = async () => {
    if (isCreatingClient || !newClientName.trim()) return;
    setIsCreatingClient(true);
    setCreateClientError(null);
    try {
      const res = await fetch("/api/v1/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: newClientCode, name: newClientName, type: "CUSTOMER", isActive: true }),
      });
      const body = await res.json();
      if (!res.ok) {
        setCreateClientError(body?.error?.message ?? "Failed to create client.");
        return;
      }
      setCustomers((prev) => [...prev, { id: body.data.id, name: body.data.name, code: body.data.code }]);
      setCustomerId(body.data.id);
      setShowCreateClient(false);
    } catch {
      setCreateClientError("Could not reach the server.");
    } finally {
      setIsCreatingClient(false);
    }
  };

  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === customerId) ?? null,
    [customers, customerId]
  );

  const handleCustomerChange = (id: string) => {
    setCustomerId(id);
    const cust = customers.find((c) => c.id === id);
    if (cust?.taxRegistrationNo) {
      const code = extractStateCodeFromGstin(cust.taxRegistrationNo);
      if (code) {
        setPlaceOfSupplyStateCode(code);
      }
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);

    try {
      const payload = {
        invoiceDate,
        invoiceType,
        hasDueDate,
        dueDate: hasDueDate ? dueDate : "",
        invoiceSeriesId,
        invoiceNumber,
        customerId,
        placeOfSupplyStateCode: placeOfSupplyStateCode.trim() || undefined,
        incomeAccountId: incomeAccountId || undefined,
        discountPercentage: Number(discountPercentage) || 0,
        isReverseCharge,
        items: items.map((it) => ({
          productId: it.productId || undefined,
          itemName: it.itemName,
          hsnCode: it.hsnCode || undefined,
          quantity: Number(it.quantity) || 0,
          unitPrice: Number(it.unitPrice) || 0,
          gstPercentage: Number(it.gstPercentage) || 0,
        })),
        notes: notes.filter((n) => n.trim().length > 0),
        advancePaymentTitle: advancePaymentTitle || undefined,
        advancePaymentAmount: advancePaymentAmount ? Number(advancePaymentAmount) : undefined,
        payableAmountTitle: payableAmountTitle || undefined,
        payableAmountValue: payableAmountValue ? Number(payableAmountValue) : undefined,
        termsAndConditions: termsAndConditions || undefined,
      };

      const res = await fetch(isEdit ? `/api/v1/custom-invoices/${initialInvoice!.id}` : "/api/v1/custom-invoices", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error?.message ?? "Failed to save invoice.");
        return;
      }

      const body = await res.json();
      router.push(`/accounts/custom-invoices/${body.data.id}`);
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-5xl space-y-5">
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Invoice Date" htmlFor="invoiceDate" required>
          <input
            id="invoiceDate"
            type="date"
            required
            value={invoiceDate}
            onChange={(e) => setInvoiceDate(e.target.value)}
            className={textInputClass()}
          />
        </FormField>
        <FormField label="Invoice Type" htmlFor="invoiceType" required>
          <select id="invoiceType" value={invoiceType} onChange={(e) => setInvoiceType(e.target.value)} className={textInputClass()}>
            {INVOICE_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </FormField>
      </div>

      <div className="flex items-center justify-between rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
        <div>
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">Set Payment Due Date</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Enable this to add a due date for the payment</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={hasDueDate}
          onClick={() => setHasDueDate((v) => !v)}
          className={`h-6 w-11 shrink-0 rounded-full transition-colors ${hasDueDate ? "bg-indigo-600" : "bg-zinc-300 dark:bg-zinc-700"}`}
        >
          <span className={`block h-5 w-5 translate-y-0.5 rounded-full bg-white shadow transition-transform ${hasDueDate ? "translate-x-5" : "translate-x-0.5"}`} />
        </button>
      </div>
      {hasDueDate && (
        <FormField label="Payment Due Date" htmlFor="dueDate" required>
          <input id="dueDate" type="date" required value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={textInputClass()} />
        </FormField>
      )}

      <div className="grid grid-cols-2 gap-4">
        <FormField label="Select Invoice Series" htmlFor="invoiceSeriesId" required>
          <select
            id="invoiceSeriesId"
            required
            value={invoiceSeriesId}
            onChange={(e) => setInvoiceSeriesId(e.target.value)}
            className={textInputClass()}
          >
            <option value="">— Select a series —</option>
            {series
              .filter((s) => s.isActive)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.prefix}/{s.fiscalYearLabel})
                </option>
              ))}
          </select>
          {series.length === 0 && (
            <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
              No invoice series configured yet — create one under Masters → Finance Configuration → Invoice Series.
            </p>
          )}
        </FormField>
        <FormField label="Invoice Number" htmlFor="invoiceNumber" required>
          <div className="flex gap-2">
            <input
              id="invoiceNumber"
              required
              value={invoiceNumber}
              onChange={(e) => {
                setInvoiceNumber(e.target.value);
                setNumberManuallyEdited(true);
                setNumberCheckStatus("idle");
                setNumberCheckMessage("");
              }}
              onBlur={() => {
                if (invoiceNumber.trim()) checkInvoiceNumberAvailability();
              }}
              className={textInputClass()}
            />
            <button
              type="button"
              onClick={() => checkInvoiceNumberAvailability()}
              disabled={!invoiceNumber.trim() || numberCheckStatus === "checking"}
              className="shrink-0 rounded-md border border-zinc-300 bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-200 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
            >
              {numberCheckStatus === "checking" ? "Checking…" : "Verify"}
            </button>
          </div>
          {numberCheckStatus === "available" && (
            <p className="mt-1 flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
              <span aria-hidden="true">✓</span> {numberCheckMessage || "Invoice number is available."}
            </p>
          )}
          {numberCheckStatus === "unavailable" && (
            <p className="mt-1 flex items-center gap-1 text-xs text-rose-600 dark:text-rose-400">
              <span aria-hidden="true">✗</span> {numberCheckMessage || "Invoice number already in use."}
            </p>
          )}
        </FormField>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <FormField label="Select Client" htmlFor="customerId" required>
          <div className="flex gap-2">
            <SearchableSelect
              id="customerId"
              required
              value={customerId}
              onChange={handleCustomerChange}
              options={customers.map((c) => ({ id: c.id, label: c.name, sublabel: c.code }))}
              placeholder="Search client…"
            />
          </div>
          <button
            type="button"
            onClick={openCreateClient}
            className="mt-2 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500"
          >
            Create Client
          </button>
        </FormField>

        <FormField label="Place of Supply (State)" htmlFor="placeOfSupplyStateCode">
          <select
            id="placeOfSupplyStateCode"
            value={placeOfSupplyStateCode}
            onChange={(e) => setPlaceOfSupplyStateCode(e.target.value)}
            className={textInputClass()}
          >
            <option value="">— Auto-detect from GSTIN / Default —</option>
            {Object.entries(GST_STATE_CODES)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([code, name]) => (
                <option key={code} value={code}>
                  {code} - {name}
                </option>
              ))}
          </select>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Determines CGST + SGST (intra-state) vs IGST (inter-state).
          </p>
        </FormField>
      </div>

      {selectedCustomer && (selectedCustomer.billingAddress || selectedCustomer.shippingAddress || selectedCustomer.taxRegistrationNo) && (
        <div className="rounded-lg border border-zinc-200 bg-zinc-50/50 p-3 text-xs dark:border-zinc-800 dark:bg-zinc-900/50">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <span className="font-semibold text-zinc-600 dark:text-zinc-400">GSTIN / Tax ID:</span>
              <p className="mt-0.5 text-zinc-900 dark:text-zinc-100">{selectedCustomer.taxRegistrationNo || "Unregistered"}</p>
            </div>
            <div>
              <span className="font-semibold text-zinc-600 dark:text-zinc-400">Billing Address:</span>
              <p className="mt-0.5 text-zinc-900 dark:text-zinc-100">
                {selectedCustomer.billingAddress || "—"}
                {selectedCustomer.city ? `, ${selectedCustomer.city}` : ""}
                {selectedCustomer.pinCode ? ` - ${selectedCustomer.pinCode}` : ""}
              </p>
            </div>
            <div>
              <span className="font-semibold text-zinc-600 dark:text-zinc-400">Delivery / Shipping Address:</span>
              <p className="mt-0.5 text-zinc-900 dark:text-zinc-100">
                {selectedCustomer.shippingAddress && selectedCustomer.shippingAddress !== selectedCustomer.billingAddress
                  ? selectedCustomer.shippingAddress
                  : "Same as billing address"}
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <FormField label="Discount(%)" htmlFor="discountPercentage">
          <input
            id="discountPercentage"
            type="number"
            min={0}
            max={100}
            step="0.01"
            value={discountPercentage}
            onChange={(e) => setDiscountPercentage(e.target.value)}
            className={textInputClass()}
          />
        </FormField>

        <FormField label="Income Category (optional)" htmlFor="incomeAccountId">
          <SearchableSelect
            id="incomeAccountId"
            value={incomeAccountId}
            onChange={setIncomeAccountId}
            options={incomeAccounts.map((a) => ({ id: a.id, label: a.name, sublabel: a.code }))}
            placeholder="Search account…"
          />
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Classifies this invoice&apos;s revenue against your Chart of Accounts, for reporting only.
          </p>
        </FormField>
      </div>

      <div>
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Items</h2>
        <div className="mt-2 space-y-3">
          {items.map((item, index) => {
            const line = computedLines[index];
            return (
              <div key={index} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">Line {index + 1}</span>
                  <button type="button" onClick={() => removeItem(index)} className="text-xs font-medium text-red-600 hover:underline dark:text-red-400">
                    Remove
                  </button>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-3 md:grid-cols-3">
                  <div>
                    <div className="mb-1.5 flex items-center gap-1">
                      <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">Filter:</span>
                      {(["ALL", "PRODUCT", "SERVICE"] as const).map((type) => {
                        const active = (item.itemType ?? "ALL") === type;
                        const label = type === "ALL" ? "All" : type === "PRODUCT" ? "Products" : "Services";
                        return (
                          <button
                            key={type}
                            type="button"
                            onClick={() => updateItem(index, { itemType: type })}
                            className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors ${
                              active
                                ? "bg-indigo-600 text-white"
                                : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                            }`}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                    <FormField label="Link Item / Service (optional)" htmlFor={`link-${index}`}>
                      <SearchableSelect
                        id={`link-${index}`}
                        value={item.productId}
                        onChange={(next) => applyItemLink(index, next)}
                        options={getItemOptionsForLine(item.itemType)}
                        placeholder={
                          item.itemType === "SERVICE"
                            ? "Search services (Job Work, Embroidery…)"
                            : item.itemType === "PRODUCT"
                            ? "Search products (Styles, Materials…)"
                            : "Search styles, materials, or services…"
                        }
                        emptyOptionLabel="— Free text item —"
                      />
                    </FormField>
                  </div>
                  <FormField label="Name" htmlFor={`name-${index}`} required>
                    <input
                      id={`name-${index}`}
                      required
                      value={item.itemName}
                      onChange={(e) => updateItem(index, { itemName: e.target.value })}
                      className={textInputClass()}
                    />
                  </FormField>
                  <FormField label="HSN" htmlFor={`hsn-${index}`}>
                    <input id={`hsn-${index}`} value={item.hsnCode} onChange={(e) => updateItem(index, { hsnCode: e.target.value })} className={textInputClass()} />
                  </FormField>
                  <FormField label="Qty" htmlFor={`qty-${index}`} required>
                    <input
                      id={`qty-${index}`}
                      type="number"
                      min={0}
                      step="0.0001"
                      required
                      value={item.quantity}
                      onChange={(e) => updateItem(index, { quantity: e.target.value })}
                      className={textInputClass()}
                    />
                  </FormField>
                  <FormField label="Price" htmlFor={`price-${index}`} required>
                    <input
                      id={`price-${index}`}
                      type="number"
                      min={0}
                      step="0.01"
                      required
                      value={item.unitPrice}
                      onChange={(e) => updateItem(index, { unitPrice: e.target.value })}
                      className={textInputClass()}
                    />
                  </FormField>
                  <FormField label="GST %" htmlFor={`gst-${index}`}>
                    <input
                      id={`gst-${index}`}
                      type="number"
                      min={0}
                      max={100}
                      step="0.01"
                      value={item.gstPercentage}
                      onChange={(e) => updateItem(index, { gstPercentage: e.target.value })}
                      className={textInputClass()}
                    />
                  </FormField>
                </div>
                <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                  Total: ₹{(line?.lineTotal ?? 0).toFixed(2)}
                </p>
              </div>
            );
          })}
        </div>
        <button type="button" onClick={addItem} className="mt-3 rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">
          + Add Product
        </button>
      </div>

      <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Notes</h2>
          <button type="button" onClick={addNote} className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400">
            + Add Note
          </button>
        </div>
        {notes.length === 0 ? (
          <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">No notes added yet. Click &quot;Add Note&quot;.</p>
        ) : (
          <div className="mt-2 space-y-2">
            {notes.map((note, index) => (
              <div key={index} className="flex gap-2">
                <input value={note} onChange={(e) => updateNote(index, e.target.value)} className={textInputClass()} />
                <button type="button" onClick={() => removeNote(index)} className="text-xs font-medium text-red-600 hover:underline dark:text-red-400">
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
        <div>
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">Tax is payable on reverse charge basis</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">When enabled, GST is not charged on any line — the buyer self-assesses it.</p>
        </div>
        <input type="checkbox" checked={isReverseCharge} onChange={(e) => setIsReverseCharge(e.target.checked)} className="h-5 w-5" />
      </div>

      <div className="flex items-center justify-end gap-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
        Grand Total: ₹{grandTotal.toFixed(2)}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Advance Payment</h3>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <input placeholder="Enter Title" value={advancePaymentTitle} onChange={(e) => setAdvancePaymentTitle(e.target.value)} className={textInputClass()} />
            <input
              type="number"
              min={0}
              step="0.01"
              placeholder="Enter Advance Payment"
              value={advancePaymentAmount}
              onChange={(e) => setAdvancePaymentAmount(e.target.value)}
              className={textInputClass()}
            />
          </div>
        </div>
        <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Payable Amount</h3>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <input
              placeholder="Enter Payable Amount Title"
              value={payableAmountTitle}
              onChange={(e) => setPayableAmountTitle(e.target.value)}
              className={textInputClass()}
            />
            <input
              type="number"
              min={0}
              step="0.01"
              value={payableAmountValue}
              onChange={(e) => setPayableAmountValue(e.target.value)}
              className={textInputClass()}
            />
          </div>
        </div>
      </div>

      <p className="text-right text-sm text-zinc-500 dark:text-zinc-400">Balance Due: ₹{balanceDue.toFixed(2)}</p>

      <FormField label="Terms & Conditions" htmlFor="termsAndConditions">
        <textarea
          id="termsAndConditions"
          rows={3}
          placeholder="One term per line"
          value={termsAndConditions}
          onChange={(e) => setTermsAndConditions(e.target.value)}
          className={textInputClass()}
        />
      </FormField>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
        >
          {isSubmitting ? "Saving…" : isEdit ? "Save Changes" : "Create Invoice"}
        </button>
        <button
          type="button"
          onClick={() => router.push("/accounts/custom-invoices")}
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm text-zinc-700 dark:border-zinc-700 dark:text-zinc-200"
        >
          Cancel
        </button>
      </div>

      <Modal open={showCreateClient} onClose={() => setShowCreateClient(false)} title="Create Client">
        <div className="space-y-3">
          <FormField label="Code" htmlFor="newClientCode">
            <input id="newClientCode" value={newClientCode} onChange={(e) => setNewClientCode(e.target.value)} className={textInputClass()} />
          </FormField>
          <FormField label="Name" htmlFor="newClientName" required>
            <input id="newClientName" required value={newClientName} onChange={(e) => setNewClientName(e.target.value)} className={textInputClass()} />
          </FormField>
          {createClientError && <p className="text-sm text-red-600 dark:text-red-400">{createClientError}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowCreateClient(false)} className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700">
              Cancel
            </button>
            <button
              type="button"
              onClick={handleCreateClient}
              disabled={isCreatingClient || !newClientName.trim()}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
            >
              {isCreatingClient ? "Creating…" : "Create"}
            </button>
          </div>
        </div>
      </Modal>
    </form>
  );
}
