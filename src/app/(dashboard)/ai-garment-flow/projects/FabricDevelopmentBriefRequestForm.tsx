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
  targetSellingPrice: string | number | null;
  currencyCode: string | null;
  buyerId: string | null;
  customerId: string | null;
}

/**
 * Mirrors DevelopmentBriefRequestForm.tsx exactly, minus the Garment
 * Category and Preferred Fabric fields — a FABRIC-sourced project has no
 * single project-level category (Product Suitability already determined
 * which specific garment types are viable) and no fabric to "prefer" (it is
 * already fixed and known).
 */
export function FabricDevelopmentBriefRequestForm({
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
  const [targetSellingPrice, setTargetSellingPrice] = useState(
    project.targetSellingPrice != null ? String(project.targetSellingPrice) : ""
  );
  const [currencyCode, setCurrencyCode] = useState(project.currencyCode ?? "");
  const [factoryCapabilities, setFactoryCapabilities] = useState("");
  const [buyerId, setBuyerId] = useState(project.buyerId ?? "");
  const [directionCount, setDirectionCount] = useState<(typeof DIRECTION_COUNTS)[number]>(6);
  const [designBalance, setDesignBalance] = useState<(typeof DESIGN_BALANCE_OPTIONS)[number]["value"]>("BALANCED");

  const [seasons, setSeasons] = useState<Option[]>([]);
  const [currencies, setCurrencies] = useState<{ code: string; name: string }[]>([]);
  const [buyers, setBuyers] = useState<Option[]>([]);

  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetch("/api/v1/seasons").then((r) => r.json()).then((b) => setSeasons(b.data ?? []));
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
      const res = await fetch(`/api/v1/ai-garment-projects/${projectId}/fabric-development-brief`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetMarket: targetMarket || undefined,
          targetCustomerProfile: targetCustomerProfile || undefined,
          seasonId: seasonId || undefined,
          targetSellingPrice: targetSellingPrice ? Number(targetSellingPrice) : undefined,
          currencyCode: currencyCode || undefined,
          factoryCapabilities: factoryCapabilities || undefined,
          buyerId: buyerId || undefined,
          directionCount,
          designBalance,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Failed to create the fabric development brief.");
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

      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Generates real design directions from the project&apos;s own approved Fabric Analysis and Product Suitability
        assessment — only for garment types already rated Highly Suitable or Suitable.
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField label="Target Market" htmlFor="fdbTargetMarket">
          <input id="fdbTargetMarket" className={textInputClass()} value={targetMarket} onChange={(e) => setTargetMarket(e.target.value)} />
        </FormField>
        <FormField label="Target Customer Age / Profile" htmlFor="fdbTargetCustomer">
          <input
            id="fdbTargetCustomer"
            className={textInputClass()}
            value={targetCustomerProfile}
            onChange={(e) => setTargetCustomerProfile(e.target.value)}
          />
        </FormField>
        <FormField label="Season" htmlFor="fdbSeason">
          <select id="fdbSeason" className={textInputClass()} value={seasonId} onChange={(e) => setSeasonId(e.target.value)}>
            <option value="">—</option>
            {seasons.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </FormField>
        <FormField label="Target Price" htmlFor="fdbPrice">
          <input
            id="fdbPrice"
            type="number"
            min="0"
            step="0.01"
            className={textInputClass()}
            value={targetSellingPrice}
            onChange={(e) => setTargetSellingPrice(e.target.value)}
          />
        </FormField>
        <FormField label="Currency" htmlFor="fdbCurrency">
          <select id="fdbCurrency" className={textInputClass()} value={currencyCode} onChange={(e) => setCurrencyCode(e.target.value)}>
            <option value="">—</option>
            {currencies.map((c) => (
              <option key={c.code} value={c.code}>{c.code} — {c.name}</option>
            ))}
          </select>
        </FormField>
        <FormField label="Factory Capabilities" htmlFor="fdbFactory">
          <input
            id="fdbFactory"
            className={textInputClass()}
            value={factoryCapabilities}
            onChange={(e) => setFactoryCapabilities(e.target.value)}
            placeholder="e.g. flat knits, basic wovens, no embroidery"
          />
        </FormField>
      </div>

      <FormField label="Buyer (if known)" htmlFor="fdbBuyer">
        <select id="fdbBuyer" className={textInputClass()} value={buyerId} onChange={(e) => setBuyerId(e.target.value)} disabled={buyers.length === 0}>
          <option value="">—</option>
          {buyers.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
      </FormField>

      <FormField label="Number of Design Directions" htmlFor="fdbCount">
        <div className="flex gap-3">
          {DIRECTION_COUNTS.map((count) => (
            <label key={count} className="flex items-center gap-1.5 text-sm">
              <input type="radio" name="fdbDirectionCount" checked={directionCount === count} onChange={() => setDirectionCount(count)} />
              {count}
            </label>
          ))}
        </div>
      </FormField>

      <FormField label="Design Balance" htmlFor="fdbBalance">
        <div className="flex flex-wrap gap-3">
          {DESIGN_BALANCE_OPTIONS.map((opt) => (
            <label key={opt.value} className="flex items-center gap-1.5 text-sm">
              <input type="radio" name="fdbDesignBalance" checked={designBalance === opt.value} onChange={() => setDesignBalance(opt.value)} />
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
        {creating ? "Creating Fabric Development Brief…" : "CREATE FABRIC DEVELOPMENT BRIEF"}
      </button>
    </div>
  );
}
