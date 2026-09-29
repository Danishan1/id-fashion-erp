"use client";

import { useEffect, useState } from "react";
import { textInputClass } from "@/components/ui/FormField";

interface StageOption {
  id: string;
  name: string;
  sequence: number;
  isActive: boolean;
}

/**
 * Work Skills multi-select: the company's production stages, picked from a
 * dropdown and shown as removable chips. A stage that was since deactivated
 * still shows as a chip (so it can be removed) but can't be newly added.
 */
export function WorkSkillsSelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string[];
  onChange: (stageIds: string[]) => void;
}) {
  const [stages, setStages] = useState<StageOption[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/v1/production-stages")
      .then(async (res) => {
        if (!res.ok) {
          setLoadError("Could not load production stages.");
          return;
        }
        const body = await res.json();
        const list: StageOption[] = body.data ?? [];
        setStages([...list].sort((a, b) => a.sequence - b.sequence));
      })
      .catch(() => setLoadError("Could not load production stages."));
  }, []);

  const byId = new Map(stages.map((s) => [s.id, s]));
  const available = stages.filter((s) => s.isActive && !value.includes(s.id));

  return (
    <div className="space-y-2">
      <select
        id={id}
        value=""
        onChange={(e) => {
          if (e.target.value) onChange([...value, e.target.value]);
        }}
        className={textInputClass()}
        disabled={available.length === 0}
      >
        <option value="">
          {stages.length === 0 ? "No production stages configured" : available.length === 0 ? "All stages selected" : "Select Work Skills…"}
        </option>
        {available.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name.trim()}
          </option>
        ))}
      </select>

      {value.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {value.map((stageId) => {
            const stage = byId.get(stageId);
            return (
              <span
                key={stageId}
                className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300"
              >
                {stage ? stage.name.trim() : "Unknown stage"}
                {stage && !stage.isActive && <span className="text-zinc-500">(inactive)</span>}
                <button
                  type="button"
                  aria-label={`Remove ${stage?.name.trim() ?? "stage"}`}
                  onClick={() => onChange(value.filter((v) => v !== stageId))}
                  className="ml-0.5 rounded-full px-1 text-indigo-500 hover:bg-indigo-100 hover:text-indigo-800 dark:hover:bg-indigo-500/20"
                >
                  ×
                </button>
              </span>
            );
          })}
        </div>
      )}

      {loadError && <p className="text-xs text-red-600 dark:text-red-400">{loadError}</p>}
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Only employees with a stage here can be assigned work at that stage in Production.
      </p>
    </div>
  );
}
