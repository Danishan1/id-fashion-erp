"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { textInputClass } from "@/components/ui/FormField";

interface Buyer {
  id: string;
  code: string;
  name: string;
  contactPerson: string | null;
  email: string | null;
}

interface BuyersSectionProps {
  customerId: string;
  initialBuyers: Buyer[];
}

export function BuyersSection({ customerId, initialBuyers }: BuyersSectionProps) {
  const router = useRouter();
  const [buyers, setBuyers] = useState(initialBuyers);
  const [showForm, setShowForm] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);

    const res = await fetch(`/api/v1/customers/${customerId}/buyers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name }),
    });

    setIsSubmitting(false);

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? "Failed to add buyer.");
      return;
    }

    const { data } = await res.json();
    setBuyers([...buyers, data]);
    setCode("");
    setName("");
    setShowForm(false);
    router.refresh();
  };

  return (
    <div className="max-w-xl space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Buyers</h2>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="text-sm font-medium text-indigo-600 hover:text-indigo-500"
        >
          {showForm ? "Cancel" : "+ Add buyer"}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="flex items-end gap-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
          <div className="flex-1">
            <label htmlFor="buyerCode" className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Code
            </label>
            <input
              id="buyerCode"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className={textInputClass()}
            />
          </div>
          <div className="flex-1">
            <label htmlFor="buyerName" className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Name
            </label>
            <input
              id="buyerName"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={textInputClass()}
            />
          </div>
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
          >
            Add
          </button>
        </form>
      )}
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {buyers.length === 0 ? (
        <p className="text-sm text-zinc-500">No buyers yet.</p>
      ) : (
        <ul className="divide-y divide-zinc-100 rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {buyers.map((buyer) => (
            <li key={buyer.id} className="flex justify-between px-3 py-2 text-sm">
              <span className="font-medium text-zinc-800 dark:text-zinc-100">
                {buyer.name} <span className="text-zinc-400">({buyer.code})</span>
              </span>
              <span className="text-zinc-500">{buyer.email ?? buyer.contactPerson ?? ""}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
