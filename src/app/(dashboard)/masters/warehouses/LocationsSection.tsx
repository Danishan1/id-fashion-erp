"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { textInputClass } from "@/components/ui/FormField";

interface Location {
  id: string;
  code: string;
  zone: string | null;
  rack: string | null;
  bin: string | null;
}

interface LocationsSectionProps {
  warehouseId: string;
  initialLocations: Location[];
}

export function LocationsSection({ warehouseId, initialLocations }: LocationsSectionProps) {
  const router = useRouter();
  const [locations, setLocations] = useState(initialLocations);
  const [showForm, setShowForm] = useState(false);
  const [code, setCode] = useState("");
  const [zone, setZone] = useState("");
  const [rack, setRack] = useState("");
  const [bin, setBin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);

    const res = await fetch(`/api/v1/warehouses/${warehouseId}/locations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, zone, rack, bin }),
    });

    setIsSubmitting(false);

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? "Failed to add location.");
      return;
    }

    const { data } = await res.json();
    setLocations([...locations, data]);
    setCode("");
    setZone("");
    setRack("");
    setBin("");
    setShowForm(false);
    router.refresh();
  };

  return (
    <div className="max-w-xl space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Locations</h2>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="text-sm font-medium text-indigo-600 hover:text-indigo-500"
        >
          {showForm ? "Cancel" : "+ Add location"}
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="flex flex-wrap items-end gap-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800"
        >
          <div className="flex-1 min-w-[100px]">
            <label htmlFor="locCode" className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Code
            </label>
            <input id="locCode" required value={code} onChange={(e) => setCode(e.target.value)} className={textInputClass()} />
          </div>
          <div className="flex-1 min-w-[100px]">
            <label htmlFor="locZone" className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Zone
            </label>
            <input id="locZone" value={zone} onChange={(e) => setZone(e.target.value)} className={textInputClass()} />
          </div>
          <div className="flex-1 min-w-[100px]">
            <label htmlFor="locRack" className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Rack
            </label>
            <input id="locRack" value={rack} onChange={(e) => setRack(e.target.value)} className={textInputClass()} />
          </div>
          <div className="flex-1 min-w-[100px]">
            <label htmlFor="locBin" className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Bin
            </label>
            <input id="locBin" value={bin} onChange={(e) => setBin(e.target.value)} className={textInputClass()} />
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

      {locations.length === 0 ? (
        <p className="text-sm text-zinc-500">No locations yet.</p>
      ) : (
        <ul className="divide-y divide-zinc-100 rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {locations.map((loc) => (
            <li key={loc.id} className="flex justify-between px-3 py-2 text-sm">
              <span className="font-medium text-zinc-800 dark:text-zinc-100">{loc.code}</span>
              <span className="text-zinc-500">
                {[loc.zone, loc.rack, loc.bin].filter(Boolean).join(" / ") || "—"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
