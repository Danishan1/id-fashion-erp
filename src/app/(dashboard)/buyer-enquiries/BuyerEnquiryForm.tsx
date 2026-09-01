"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { todayIsoDate } from "@/lib/date";

interface Option {
  id: string;
  name?: string;
  styleName?: string;
}

const TODAY = todayIsoDate();

const SOURCE_OPTIONS = [
  { value: "EMAIL", label: "Email" },
  { value: "PHONE", label: "Phone" },
  { value: "TRADE_SHOW", label: "Trade Show" },
  { value: "REFERRAL", label: "Referral" },
  { value: "WEBSITE", label: "Website" },
  { value: "OTHER", label: "Other" },
];

interface LineDraft {
  productId: string;
  styleNameFreeText: string;
  description: string;
  colorRemarks: string;
  targetQuantity: string;
  targetUnitPrice: string;
  targetDeliveryDate: string;
  remarks: string;
}

function emptyLine(): LineDraft {
  return {
    productId: "",
    styleNameFreeText: "",
    description: "",
    colorRemarks: "",
    targetQuantity: "",
    targetUnitPrice: "",
    targetDeliveryDate: "",
    remarks: "",
  };
}

export function BuyerEnquiryForm() {
  const router = useRouter();

  // Off by default — the common case is a known Customer. Toggling this on
  // reveals the prospect quick-capture fields instead of the Customer/Buyer
  // pickers; the two are mutually exclusive at submit time.
  const [isProspect, setIsProspect] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [buyerId, setBuyerId] = useState("");
  const [prospectName, setProspectName] = useState("");
  const [prospectContactPerson, setProspectContactPerson] = useState("");
  const [prospectEmail, setProspectEmail] = useState("");
  const [prospectPhone, setProspectPhone] = useState("");
  const [prospectCountry, setProspectCountry] = useState("");

  const [enquiryDate, setEnquiryDate] = useState(TODAY);
  const [source, setSource] = useState("OTHER");
  const [remarks, setRemarks] = useState("");

  const [customers, setCustomers] = useState<Option[]>([]);
  const [buyers, setBuyers] = useState<Option[]>([]);
  const [styles, setStyles] = useState<Option[]>([]);
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);

  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/v1/customers?pageSize=200")
      .then((res) => res.json())
      .then((body) => setCustomers(body.data ?? []));
    fetch("/api/v1/products?pageSize=200")
      .then((res) => res.json())
      .then((body) => setStyles(body.data ?? []));
  }, []);

  useEffect(() => {
    if (!customerId) return;
    fetch(`/api/v1/customers/${customerId}`)
      .then((res) => res.json())
      .then((body) => setBuyers(body.data?.buyers ?? []));
  }, [customerId]);

  const updateLine = (index: number, patch: Partial<LineDraft>) => {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  };
  const addLine = () => setLines((prev) => [...prev, emptyLine()]);
  const removeLine = (index: number) => setLines((prev) => prev.filter((_, i) => i !== index));

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);

    const res = await fetch("/api/v1/buyer-enquiries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerId: isProspect ? undefined : customerId || undefined,
        buyerId: isProspect ? undefined : buyerId || undefined,
        prospectName: isProspect ? prospectName : undefined,
        prospectContactPerson: isProspect ? prospectContactPerson || undefined : undefined,
        prospectEmail: isProspect ? prospectEmail || undefined : undefined,
        prospectPhone: isProspect ? prospectPhone || undefined : undefined,
        prospectCountry: isProspect ? prospectCountry || undefined : undefined,
        enquiryDate,
        source,
        remarks: remarks || undefined,
        lines: lines.map((line) => ({
          productId: line.productId || undefined,
          styleNameFreeText: line.styleNameFreeText || undefined,
          description: line.description || undefined,
          colorRemarks: line.colorRemarks || undefined,
          targetQuantity: line.targetQuantity ? Number(line.targetQuantity) : undefined,
          targetUnitPrice: line.targetUnitPrice ? Number(line.targetUnitPrice) : undefined,
          targetDeliveryDate: line.targetDeliveryDate || undefined,
          remarks: line.remarks || undefined,
        })),
      }),
    });

    setIsSubmitting(false);

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? "Failed to save this enquiry.");
      return;
    }

    const { data } = await res.json();
    router.push(`/buyer-enquiries/${data.id}`);
    router.refresh();
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Who is this enquiry from?</h2>
        <label className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
          <input
            type="checkbox"
            checked={isProspect}
            onChange={(e) => {
              setIsProspect(e.target.checked);
              setCustomerId("");
              setBuyerId("");
            }}
          />
          This is a new prospect, not yet a Customer
        </label>
      </div>

      {!isProspect ? (
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Customer" htmlFor="customerId" required>
            <select
              id="customerId"
              required={!isProspect}
              value={customerId}
              onChange={(e) => {
                setCustomerId(e.target.value);
                setBuyerId("");
                setBuyers([]);
              }}
              className={textInputClass()}
            >
              <option value="">— Select —</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Buyer" htmlFor="buyerId">
            <select
              id="buyerId"
              value={buyerId}
              onChange={(e) => setBuyerId(e.target.value)}
              disabled={!customerId}
              className={textInputClass()}
            >
              <option value="">— None —</option>
              {buyers.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </FormField>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 rounded-md border border-dashed border-zinc-300 p-3 dark:border-zinc-700">
          <FormField label="Prospect / Company Name" htmlFor="prospectName" required>
            <input
              id="prospectName"
              required={isProspect}
              value={prospectName}
              onChange={(e) => setProspectName(e.target.value)}
              className={textInputClass()}
            />
          </FormField>
          <FormField label="Contact Person" htmlFor="prospectContactPerson">
            <input
              id="prospectContactPerson"
              value={prospectContactPerson}
              onChange={(e) => setProspectContactPerson(e.target.value)}
              className={textInputClass()}
            />
          </FormField>
          <FormField label="Email" htmlFor="prospectEmail">
            <input
              id="prospectEmail"
              type="email"
              value={prospectEmail}
              onChange={(e) => setProspectEmail(e.target.value)}
              className={textInputClass()}
            />
          </FormField>
          <FormField label="Phone" htmlFor="prospectPhone">
            <input
              id="prospectPhone"
              type="tel"
              value={prospectPhone}
              onChange={(e) => setProspectPhone(e.target.value)}
              className={textInputClass()}
            />
          </FormField>
          <FormField label="Country" htmlFor="prospectCountry">
            <input
              id="prospectCountry"
              value={prospectCountry}
              onChange={(e) => setProspectCountry(e.target.value)}
              className={textInputClass()}
            />
          </FormField>
          <p className="col-span-2 text-xs text-zinc-500 dark:text-zinc-400">
            A prospect stays informal — no Customer master record is created automatically. Converting a line
            to a Sample Request later will require a real Customer to be linked first.
          </p>
        </div>
      )}

      <div className="grid grid-cols-3 gap-4">
        <FormField label="Enquiry Date" htmlFor="enquiryDate" required>
          <input
            id="enquiryDate"
            type="date"
            required
            value={enquiryDate}
            onChange={(e) => setEnquiryDate(e.target.value)}
            className={textInputClass()}
          />
        </FormField>
        <FormField label="Source" htmlFor="source">
          <select id="source" value={source} onChange={(e) => setSource(e.target.value)} className={textInputClass()}>
            {SOURCE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Remarks" htmlFor="remarks">
          <input id="remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} className={textInputClass()} />
        </FormField>
      </div>

      <div className="space-y-4">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Enquiry Lines</h2>
        {lines.map((line, index) => (
          <div key={index} className="space-y-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-500">Line {index + 1}</span>
              {lines.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeLine(index)}
                  className="text-xs font-medium text-red-600 hover:text-red-500"
                >
                  Remove
                </button>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <FormField label="Existing Style (optional)" htmlFor={`style-${index}`}>
                <select
                  id={`style-${index}`}
                  value={line.productId}
                  onChange={(e) => updateLine(index, { productId: e.target.value })}
                  className={textInputClass()}
                >
                  <option value="">— None, describe below —</option>
                  {styles.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.styleName}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField label="Style Name / Description (if new)" htmlFor={`styleName-${index}`}>
                <input
                  id={`styleName-${index}`}
                  value={line.styleNameFreeText}
                  onChange={(e) => updateLine(index, { styleNameFreeText: e.target.value })}
                  disabled={!!line.productId}
                  placeholder={line.productId ? "Using the selected Style" : "e.g. Slim Fit Chino Trouser"}
                  className={textInputClass()}
                />
              </FormField>
            </div>

            <FormField label="Description / Remarks from buyer" htmlFor={`description-${index}`}>
              <input
                id={`description-${index}`}
                value={line.description}
                onChange={(e) => updateLine(index, { description: e.target.value })}
                className={textInputClass()}
              />
            </FormField>

            <div className="grid grid-cols-4 gap-3">
              <FormField label="Color" htmlFor={`color-${index}`}>
                <input
                  id={`color-${index}`}
                  value={line.colorRemarks}
                  onChange={(e) => updateLine(index, { colorRemarks: e.target.value })}
                  className={textInputClass()}
                />
              </FormField>
              <FormField label="Target Qty" htmlFor={`qty-${index}`}>
                <input
                  id={`qty-${index}`}
                  type="number"
                  min={0}
                  value={line.targetQuantity}
                  onChange={(e) => updateLine(index, { targetQuantity: e.target.value })}
                  className={textInputClass()}
                />
              </FormField>
              <FormField label="Target Price" htmlFor={`price-${index}`}>
                <input
                  id={`price-${index}`}
                  type="number"
                  min={0}
                  step="0.01"
                  value={line.targetUnitPrice}
                  onChange={(e) => updateLine(index, { targetUnitPrice: e.target.value })}
                  className={textInputClass()}
                />
              </FormField>
              <FormField label="Target Delivery" htmlFor={`delivery-${index}`}>
                <input
                  id={`delivery-${index}`}
                  type="date"
                  value={line.targetDeliveryDate}
                  onChange={(e) => updateLine(index, { targetDeliveryDate: e.target.value })}
                  className={textInputClass()}
                />
              </FormField>
            </div>

            <FormField label="Remarks" htmlFor={`lineRemarks-${index}`}>
              <input
                id={`lineRemarks-${index}`}
                value={line.remarks}
                onChange={(e) => updateLine(index, { remarks: e.target.value })}
                className={textInputClass()}
              />
            </FormField>
          </div>
        ))}

        <button
          type="button"
          onClick={addLine}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 dark:border-zinc-700 dark:text-zinc-200"
        >
          + Add Line
        </button>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
        >
          {isSubmitting ? "Saving…" : "Create Buyer Enquiry"}
        </button>
        <button
          type="button"
          onClick={() => router.push("/buyer-enquiries")}
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm text-zinc-700 dark:border-zinc-700 dark:text-zinc-200"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
