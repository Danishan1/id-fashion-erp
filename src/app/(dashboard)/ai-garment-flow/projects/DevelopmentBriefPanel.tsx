"use client";

import { useEffect, useMemo, useState } from "react";
import { DevelopmentBriefRequestForm } from "./DevelopmentBriefRequestForm";
import { DesignDirectionCard, type DesignDirection } from "./DesignDirectionCard";

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

export function DevelopmentBriefPanel({ projectId, project }: { projectId: string; project: ProjectSnapshot }) {
  const [directions, setDirections] = useState<DesignDirection[] | undefined>(undefined);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await fetch(`/api/v1/ai-garment-projects/${projectId}/development-brief/directions`);
    const body = await res.json();
    if (res.ok) setDirections(body.data ?? []);
  }

  useEffect(() => {
    fetch(`/api/v1/ai-garment-projects/${projectId}/development-brief/directions`)
      .then((res) => res.json())
      .then((body) => setDirections(body.data ?? []));
  }, [projectId]);

  const ranked = useMemo(() => (directions ? [...directions].sort((a, b) => b.overallScore - a.overallScore) : []), [directions]);
  const approvedCount = ranked.filter((d) => d.status === "APPROVED").length;

  if (directions === undefined) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>;
  }

  return (
    <div className="space-y-4">
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</p>}

      {directions.length === 0 || showForm ? (
        <DevelopmentBriefRequestForm
          projectId={projectId}
          project={project}
          onCreated={() => {
            setShowForm(false);
            void load();
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="rounded-md border border-dashed border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          Generate More Directions
        </button>
      )}

      {ranked.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            {ranked.length} design direction{ranked.length === 1 ? "" : "s"}, ranked by overall score — {approvedCount} approved.
          </p>
          {ranked.map((direction) => (
            <DesignDirectionCard
              key={direction.id}
              direction={direction}
              onChanged={load}
              setError={setError}
            />
          ))}
        </div>
      )}
    </div>
  );
}
