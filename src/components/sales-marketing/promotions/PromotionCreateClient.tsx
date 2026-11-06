"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { textInputClass } from "@/components/ui/FormField";
import { ErrorState, LoadingState } from "@/components/ui/PageStates";
import { APPLY_MODES } from "@/modules/sales-marketing/promotions/promotion-registry";
import { CARD, FormButtons, FormField, TermsEditor, emptyTerms, send, termsPayload, useApi, type PromotionOptions, type TermsDraft } from "./promotion-ui";

/** New promotion: header + the terms of version 1 (saved as a draft; nothing applies until approved and switched on). */
export function PromotionCreateClient({ today }: { today: string }) {
  const router = useRouter();
  const { data: options, error: loadError, reload } = useApi<PromotionOptions>("/api/v1/sales-marketing/promotions/options");
  const [header, setHeader] = useState({ code: "", name: "", applyMode: "AUTO", description: "", objective: "" });
  const [terms, setTerms] = useState<TermsDraft>(emptyTerms(today));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (loadError) return <ErrorState message={loadError} onRetry={reload} />;
  if (!options) return <LoadingState />;
  const input = textInputClass();
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          const res = await send<{ id: string }>("/api/v1/sales-marketing/promotions", "POST", { ...header, code: header.code.trim().toUpperCase(), terms: termsPayload(terms) });
          router.push(`/sales-marketing/promotions/${res.id}`);
        } catch (err) {
          setError((err as Error).message);
          setBusy(false);
        }
      }}
    >
      <section className={`${CARD} grid gap-3 sm:grid-cols-2`}>
        <FormField label="Code" htmlFor="p-code" required hint="3–30 letters, digits, - or _. Customers type this for a code promotion.">
          <input id="p-code" required maxLength={30} value={header.code} onChange={(e) => setHeader({ ...header, code: e.target.value.toUpperCase() })} className={input} />
        </FormField>
        <FormField label="Name" htmlFor="p-name" required>
          <input id="p-name" required maxLength={150} value={header.name} onChange={(e) => setHeader({ ...header, name: e.target.value })} className={input} />
        </FormField>
        <FormField label="How it applies" htmlFor="p-mode" required hint={APPLY_MODES[header.applyMode as keyof typeof APPLY_MODES].help}>
          <select id="p-mode" value={header.applyMode} onChange={(e) => setHeader({ ...header, applyMode: e.target.value })} className={input}>
            {Object.entries(APPLY_MODES).map(([k, m]) => (
              <option key={k} value={k}>
                {m.label}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Objective" htmlFor="p-objective">
          <input id="p-objective" maxLength={300} value={header.objective} onChange={(e) => setHeader({ ...header, objective: e.target.value })} className={input} />
        </FormField>
        <div className="sm:col-span-2">
          <FormField label="Description" htmlFor="p-desc">
            <textarea id="p-desc" rows={2} maxLength={2000} value={header.description} onChange={(e) => setHeader({ ...header, description: e.target.value })} className={input} />
          </FormField>
        </div>
      </section>
      <section className={CARD}>
        <h2 className="mb-3 text-base font-semibold text-zinc-900 dark:text-zinc-100">Terms — version 1</h2>
        <TermsEditor value={terms} onChange={setTerms} options={options} />
      </section>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <FormButtons busy={busy} onCancel={() => router.push("/sales-marketing/promotions")} submitLabel="Save as draft" />
    </form>
  );
}
