"use client";

import { useEffect, useState } from "react";
import { FormField, textInputClass } from "@/components/ui/FormField";

interface Option {
  id: string;
  name: string;
}

const DIRECTION_COUNTS = [3, 6, 9] as const;

const DESIGN_BALANCE_OPTIONS = [
  { value: "COMMERCIAL_LOWER_RISK", label: "Commercial / Lower Risk" },
  { value: "BALANCED", label: "Balanced" },
  { value: "FASHION_FORWARD", label: "Fashion Forward" },
] as const;

interface ProjectSnapshot {
  targetMarket: string | null;
  targetCustomerProfile: string | null;
  seasonId: string | null;
  categoryId: string | null;
  targetSellingPrice: string | number | null;
  currencyCode: string | null;
  buyerId: string | null;
  customerId: string | null;
}

/** Screen for Process 2's short form — pre-filled from the Style Master, editable for just this one generation run (see the backend's own contextSnapshotJson comment for why this never writes back to the project). */
export function DevelopmentBriefRequestForm({
  projectId,
  project,
  onCreated,
}: {
  projectId: string;
  project: ProjectSnapshot;
  onCreated: () => void;
}) {
  const [targetMarket, setTargetMarket] = useState(project.targetMarket ?? "");
  const [targetCustomerProfile, setTargetCustomerProfile] = useState(project.targetCustomerProfile ?? "");
  const [seasonId, setSeasonId] = useState(project.seasonId ?? "");
  const [categoryId, setCategoryId] = useState(project.categoryId ?? "");
  const [targetSellingPrice, setTargetSellingPrice] = useState(
    project.targetSellingPrice != null ? String(project.targetSellingPrice) : ""
  );
  const [currencyCode, setCurrencyCode] = useState(project.currencyCode ?? "");
  const [preferredFabric, setPreferredFabric] = useState("");
  const [factoryCapabilities, setFactoryCapabilities] = useState("");
  const [buyerId, setBuyerId] = useState(project.buyerId ?? "");
  const [directionCount, setDirectionCount] = useState<(typeof DIRECTION_COUNTS)[number]>(6);
  const [designBalance, setDesignBalance] = useState<(typeof DESIGN_BALANCE_OPTIONS)[number]["value"]>("BALANCED");

  const [seasons, setSeasons] = useState<Option[]>([]);
  const [categories, setCategories] = useState<Option[]>([]);
  const [currencies, setCurrencies] = useState<{ code: string; name: string }[]>([]);
  const [buyers, setBuyers] = useState<Option[]>([]);

  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetch("/api/v1/seasons").then((r) => r.json()).then((b) => setSeasons(b.data ?? []));
    fetch("/api/v1/categories").then((r) => r.json()).then((b) => setCategories(b.data ?? []));
    fetch("/api/v1/currencies").then((r) => r.json()).then((b) => setCurrencies(b.data ?? []));
    if (project.customerId) {
      fetch(`/api/v1/customers/${project.customerId}`)
        .then((r) => r.json())
        .then((b) => setBuyers(b.data?.buyers ?? []));
    }
  }, [project.customerId]);

  async function create() {
    setError(null);
    setCreating(true);
    try {
      const res = await fetch(`/api/v1/ai-garment-projects/${projectId}/development-brief`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetMarket: targetMarket || undefined,
          targetCustomerProfile: targetCustomerProfile || undefined,
          seasonId: seasonId || undefined,
          categoryId: categoryId || undefined,
          targetSellingPrice: targetSellingPrice ? Number(targetSellingPrice) : undefined,
          currencyCode: currencyCode || undefined,
          preferredFabric: preferredFabric || undefined,
          factoryCapabilities: factoryCapabilities || undefined,
          buyerId: buyerId || undefined,
          directionCount,
          designBalance,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Failed to create the development brief.");
      onCreated();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</p>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField label="Target Market" htmlFor="dbTargetMarket">
          <input id="dbTargetMarket" className={textInputClass()} value={targetMarket} onChange={(e) => setTargetMarket(e.target.value)} />
        </FormField>
        <FormField label="Target Customer Age / Profile" htmlFor="dbTargetCustomer">
          <input
            id="dbTargetCustomer"
            className={textInputClass()}
            value={targetCustomerProfile}
            onChange={(e) => setTargetCustomerProfile(e.target.value)}
          />
        </FormField>
        <FormField label="Season" htmlFor="dbSeason">
          <select id="dbSeason" className={textInputClass()} value={seasonId} onChange={(e) => setSeasonId(e.target.value)}>
            <option value="">—</option>
            {seasons.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </FormField>
        <FormField label="Garment Category" htmlFor="dbCategory">
          <select id="dbCategory" className={textInputClass()} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">—</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </FormField>
        <FormField label="Target Price" htmlFor="dbPrice">
          <input
            id="dbPrice"
            type="number"
            min="0"
            step="0.01"
            className={textInputClass()}
            value={targetSellingPrice}
            onChange={(e) => setTargetSellingPrice(e.target.value)}
          />
        </FormField>
        <FormField label="Currency" htmlFor="dbCurrency">
          <select id="dbCurrency" className={textInputClass()} value={currencyCode} onChange={(e) => setCurrencyCode(e.target.value)}>
            <option value="">—</option>
            {currencies.map((c) => (
              <option key={c.code} value={c.code}>{c.code} — {c.name}</option>
            ))}
          </select>
        </FormField>
        <FormField label="Preferred Fabric (if known)" htmlFor="dbFabric">
          <input id="dbFabric" className={textInputClass()} value={preferredFabric} onChange={(e) => setPreferredFabric(e.target.value)} placeholder="e.g. lightweight cotton poplin" />
        </FormField>
        <FormField label="Factory Capabilities" htmlFor="dbFactory">
          <input id="dbFactory" className={textInputClass()} value={factoryCapabilities} onChange={(e) => setFactoryCapabilities(e.target.value)} placeholder="e.g. flat knits, basic wovens, no embroidery" />
        </FormField>
      </div>

      <FormField label="Buyer (if known)" htmlFor="dbBuyer">
        <select id="dbBuyer" className={textInputClass()} value={buyerId} onChange={(e) => setBuyerId(e.target.value)} disabled={buyers.length === 0}>
          <option value="">—</option>
          {buyers.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
      </FormField>

      <FormField label="Number of Design Directions" htmlFor="dbCount">
        <div className="flex gap-3">
          {DIRECTION_COUNTS.map((count) => (
            <label key={count} className="flex items-center gap-1.5 text-sm">
              <input type="radio" name="directionCount" checked={directionCount === count} onChange={() => setDirectionCount(count)} />
              {count}
            </label>
          ))}
        </div>
      </FormField>

      <FormField label="Design Balance" htmlFor="dbBalance">
        <div className="flex flex-wrap gap-3">
          {DESIGN_BALANCE_OPTIONS.map((opt) => (
            <label key={opt.value} className="flex items-center gap-1.5 text-sm">
              <input type="radio" name="designBalance" checked={designBalance === opt.value} onChange={() => setDesignBalance(opt.value)} />
              {opt.label}
            </label>
          ))}
        </div>
      </FormField>

      <button
        type="button"
        disabled={creating}
        onClick={create}
        className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
      >
        {creating ? "Creating Development Brief…" : "CREATE DEVELOPMENT BRIEF"}
      </button>
    </div>
  );
}
