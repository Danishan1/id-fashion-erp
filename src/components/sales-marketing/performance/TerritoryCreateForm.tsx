"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { getApiErrorMessage } from "@/lib/api-client";
import { CARD } from "./performance-ui";

export function TerritoryCreateForm() {
  const router = useRouter();
  const [v, setV] = useState({ code: "", name: "", description: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className={`${CARD} grid max-w-2xl gap-4 sm:grid-cols-2`}
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const res = await fetch("/api/v1/sales-marketing/performance/territories", { method: "POST", headers: { "Content-Type": "application/json", "x-toast": "off" }, body: JSON.stringify(v) });
        setBusy(false);
        if (!res.ok) return setError(await getApiErrorMessage(res));
        const { data } = await res.json();
        router.push(`/sales-marketing/territories/${data.id}`);
      }}
    >
      <FormField label="Code" htmlFor="t-code" required>
        <input id="t-code" required maxLength={40} pattern="[A-Za-z0-9._\-]+" value={v.code} onChange={(e) => setV({ ...v, code: e.target.value })} className={textInputClass()} placeholder="e.g. NORTH" />
      </FormField>
      <FormField label="Name" htmlFor="t-name" required>
        <input id="t-name" required maxLength={200} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} className={textInputClass()} placeholder="e.g. North India" />
      </FormField>
      <div className="sm:col-span-2">
        <FormField label="Description" htmlFor="t-desc">
          <textarea id="t-desc" rows={2} maxLength={1000} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} className={textInputClass()} placeholder="Region, states or cities it covers" />
        </FormField>
      </div>
      {error && <p className="text-sm text-red-600 dark:text-red-400 sm:col-span-2">{error}</p>}
      <div className="sm:col-span-2">
        <Button type="submit" isLoading={busy} loadingLabel="Creating…">
          Create territory
        </Button>
      </div>
    </form>
  );
}
