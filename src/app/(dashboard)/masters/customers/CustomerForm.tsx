"use client";

import { useEffect, useState, type FormEvent } from "react";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { COUNTRIES } from "@/lib/countries";
import { getDefaultCurrencyForCountry } from "@/lib/country-currency";

export interface CustomerFormValues {
  code: string;
  name: string;
  type: "CUSTOMER" | "AGENT";
  contactPerson: string;
  phone: string;
  email: string;
  billingAddress: string;
  shippingAddress: string;
  city: string;
  pinCode: string;
  country: string;
  taxRegistrationNo: string;
  paymentTermsDays: string;
  creditLimit: string;
  defaultCurrencyCode: string;
  isActive: boolean;
}

const EMPTY_VALUES: CustomerFormValues = {
  code: "",
  name: "",
  type: "CUSTOMER",
  contactPerson: "",
  phone: "",
  email: "",
  billingAddress: "",
  shippingAddress: "",
  city: "",
  pinCode: "",
  country: "India",
  taxRegistrationNo: "",
  paymentTermsDays: "",
  creditLimit: "",
  defaultCurrencyCode: "INR",
  isActive: true,
};

interface Currency {
  code: string;
  name: string;
}

/** Currency model has no country column — this just labels the dropdown for the handful of seeded currencies. */
const COUNTRY_BY_CURRENCY: Record<string, string> = {
  INR: "India",
  USD: "United States",
  EUR: "Eurozone",
};

interface CustomerFormProps {
  initialValues?: CustomerFormValues;
  submitUrl: string;
  method: "POST" | "PATCH";
  onSuccess: () => void;
  onCancel: () => void;
}

export function CustomerForm({ initialValues, submitUrl, method, onSuccess, onCancel }: CustomerFormProps) {
  const [values, setValues] = useState<CustomerFormValues>(initialValues ?? EMPTY_VALUES);
  const [sameAsBilling, setSameAsBilling] = useState<boolean>(() => {
    if (!initialValues) return true;
    if (!initialValues.shippingAddress) return true;
    return initialValues.shippingAddress === initialValues.billingAddress;
  });
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/v1/currencies")
      .then((res) => res.json())
      .then((body) => setCurrencies(body.data ?? []))
      .catch(() => setCurrencies([]));
  }, []);

  // New records get a suggested sequential code (e.g. CUST-00006) — the field
  // itself is read-only (auto-generated, never manually editable, per explicit
  // request), so this is the ONLY thing that ever sets it.
  useEffect(() => {
    if (initialValues) return;
    fetch("/api/v1/customers/next-code")
      .then((res) => res.json())
      .then((body) => {
        if (body?.data?.code) setValues((prev) => (prev.code ? prev : { ...prev, code: body.data.code }));
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-selects that country's real default currency, but only if it's actually a
  // choosable option — the user can always change the Currency select afterward, and
  // this handler never fires again on its own to re-override a manual pick.
  const selectCountry = (country: string) => {
    const defaultCurrency = getDefaultCurrencyForCountry(country);
    const isSelectable = currencies.some((c) => c.code === defaultCurrency);
    setValues((prev) => ({
      ...prev,
      country,
      defaultCurrencyCode: isSelectable ? defaultCurrency! : prev.defaultCurrencyCode,
    }));
  };

  const handleBillingAddressChange = (address: string) => {
    setValues((prev) => ({
      ...prev,
      billingAddress: address,
      ...(sameAsBilling ? { shippingAddress: address } : {}),
    }));
  };

  const handleSameAsBillingToggle = (checked: boolean) => {
    setSameAsBilling(checked);
    if (checked) {
      setValues((prev) => ({ ...prev, shippingAddress: prev.billingAddress }));
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);

    const shippingAddress = sameAsBilling ? values.billingAddress : values.shippingAddress;

    const res = await fetch(submitUrl, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: values.code,
        name: values.name,
        type: values.type,
        contactPerson: values.contactPerson,
        phone: values.phone,
        email: values.email,
        billingAddress: values.billingAddress,
        shippingAddress,
        city: values.city,
        pinCode: values.pinCode,
        country: values.country,
        taxRegistrationNo: values.taxRegistrationNo,
        paymentTermsDays: values.paymentTermsDays ? Number(values.paymentTermsDays) : undefined,
        creditLimit: values.creditLimit ? Number(values.creditLimit) : undefined,
        defaultCurrencyCode: values.defaultCurrencyCode,
        isActive: values.isActive,
      }),
    });

    setIsSubmitting(false);

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? "Failed to save customer.");
      return;
    }

    onSuccess();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Code" htmlFor="code" required>
          <input
            id="code"
            required
            readOnly
            disabled
            value={values.code}
            title="Auto-generated — not editable"
            className={`${textInputClass()} cursor-not-allowed bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400`}
          />
        </FormField>
        <FormField label="Type" htmlFor="type" required>
          <select
            id="type"
            value={values.type}
            onChange={(e) => setValues({ ...values, type: e.target.value as "CUSTOMER" | "AGENT" })}
            className={textInputClass()}
          >
            <option value="CUSTOMER">Customer</option>
            <option value="AGENT">Agent</option>
          </select>
        </FormField>
      </div>

      <FormField label="Name" htmlFor="name" required>
        <input
          id="name"
          required
          value={values.name}
          onChange={(e) => setValues({ ...values, name: e.target.value })}
          className={textInputClass()}
        />
      </FormField>

      <div className="grid grid-cols-2 gap-4">
        <FormField label="Contact Person" htmlFor="contactPerson">
          <input
            id="contactPerson"
            value={values.contactPerson}
            onChange={(e) => setValues({ ...values, contactPerson: e.target.value })}
            className={textInputClass()}
          />
        </FormField>
        <FormField label="Phone" htmlFor="phone">
          <input
            id="phone"
            value={values.phone}
            onChange={(e) => setValues({ ...values, phone: e.target.value })}
            className={textInputClass()}
          />
        </FormField>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <FormField label="Email" htmlFor="email">
          <input
            id="email"
            type="email"
            value={values.email}
            onChange={(e) => setValues({ ...values, email: e.target.value })}
            className={textInputClass()}
          />
        </FormField>
        <FormField label="GST / VAT No." htmlFor="taxRegistrationNo">
          <input
            id="taxRegistrationNo"
            value={values.taxRegistrationNo}
            onChange={(e) => setValues({ ...values, taxRegistrationNo: e.target.value })}
            className={textInputClass()}
          />
        </FormField>
      </div>

      <FormField label="Billing Address" htmlFor="billingAddress">
        <textarea
          id="billingAddress"
          rows={2}
          value={values.billingAddress}
          onChange={(e) => handleBillingAddressChange(e.target.value)}
          className={textInputClass()}
        />
      </FormField>

      <div className="space-y-2">
        <label className="flex items-center gap-2 cursor-pointer select-none text-xs font-semibold text-stone-700">
          <input
            type="checkbox"
            checked={sameAsBilling}
            onChange={(e) => handleSameAsBillingToggle(e.target.checked)}
            className="rounded border-stone-300 text-stone-900 focus:ring-stone-500"
          />
          <span>Delivery address same as billing address</span>
        </label>

        {!sameAsBilling && (
          <FormField label="Delivery Address" htmlFor="shippingAddress">
            <textarea
              id="shippingAddress"
              rows={2}
              value={values.shippingAddress}
              onChange={(e) => setValues({ ...values, shippingAddress: e.target.value })}
              className={textInputClass()}
            />
          </FormField>
        )}
      </div>

      <div className="grid grid-cols-3 gap-4">
        <FormField label="City" htmlFor="city">
          <input
            id="city"
            value={values.city}
            onChange={(e) => setValues({ ...values, city: e.target.value })}
            className={textInputClass()}
          />
        </FormField>
        <FormField label="Pin Code" htmlFor="pinCode">
          <input
            id="pinCode"
            value={values.pinCode}
            onChange={(e) => setValues({ ...values, pinCode: e.target.value })}
            className={textInputClass()}
          />
        </FormField>
        <FormField label="Country" htmlFor="country">
          <select
            id="country"
            value={values.country}
            onChange={(e) => selectCountry(e.target.value)}
            className={textInputClass()}
          >
            <option value="">— Select —</option>
            {COUNTRIES.map((country) => (
              <option key={country} value={country}>
                {country}
              </option>
            ))}
          </select>
        </FormField>
      </div>

      <FormField label="Default Currency" htmlFor="currency">
        <select
          id="currency"
          value={values.defaultCurrencyCode}
          onChange={(e) => setValues({ ...values, defaultCurrencyCode: e.target.value })}
          className={textInputClass()}
        >
          <option value="">— None —</option>
          {currencies.map((c) => (
            <option key={c.code} value={c.code}>
              {c.code} — {c.name}
              {COUNTRY_BY_CURRENCY[c.code] ? ` (${COUNTRY_BY_CURRENCY[c.code]})` : ""}
            </option>
          ))}
        </select>
      </FormField>

      <div className="grid grid-cols-2 gap-4">
        <FormField label="Payment Terms (days)" htmlFor="paymentTerms">
          <input
            id="paymentTerms"
            type="number"
            min={0}
            value={values.paymentTermsDays}
            onChange={(e) => setValues({ ...values, paymentTermsDays: e.target.value })}
            className={textInputClass()}
          />
        </FormField>
        <FormField label="Credit Limit" htmlFor="creditLimit">
          <input
            id="creditLimit"
            type="number"
            min={0}
            step="0.01"
            value={values.creditLimit}
            onChange={(e) => setValues({ ...values, creditLimit: e.target.value })}
            className={textInputClass()}
          />
        </FormField>
      </div>

      <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
        <input
          type="checkbox"
          checked={values.isActive}
          onChange={(e) => setValues({ ...values, isActive: e.target.checked })}
        />
        Active
      </label>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="flex justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
        >
          {isSubmitting ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}
