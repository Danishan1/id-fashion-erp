"use client";

export interface StageOption {
  id: string;
  code: string;
  name: string;
  sequence: number;
  isActive: boolean;
}

interface StageSequencePickerProps {
  stages: StageOption[];
  /** Selected stage ids, in working order (index 0 first). */
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  /** Hint shown when nothing is selected. */
  emptyHint?: string;
}

/**
 * Multi-select for production stages with an explicit working order.
 * Ticking a stage appends it to the end of the order; the ordered list
 * underneath can be re-arranged with ↑/↓ or removed with ✕. Only active
 * stages are offered for new selection, but an already-selected stage that
 * was later deactivated stays listed (marked "inactive") so it can be seen
 * and removed.
 */
export function StageSequencePicker({ stages, value, onChange, disabled, emptyHint }: StageSequencePickerProps) {
  const byId = new Map(stages.map((s) => [s.id, s]));
  const offered = stages
    .filter((s) => s.isActive || value.includes(s.id))
    .sort((a, b) => a.sequence - b.sequence);

  const toggle = (id: string, checked: boolean) => {
    if (checked) onChange(value.includes(id) ? value : [...value, id]);
    else onChange(value.filter((v) => v !== id));
  };

  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= value.length) return;
    const next = [...value];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  const sortByProductionSequence = () => {
    onChange([...value].sort((a, b) => (byId.get(a)?.sequence ?? 0) - (byId.get(b)?.sequence ?? 0)));
  };

  return (
    <div className="space-y-3">
      {offered.length === 0 ? (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          No active production stages configured yet (Masters → Production Configuration).
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {offered.map((stage) => {
            const checked = value.includes(stage.id);
            return (
              <label
                key={stage.id}
                className={`flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm ${
                  checked
                    ? "border-indigo-300 bg-indigo-50 text-indigo-800 dark:border-indigo-700 dark:bg-indigo-950 dark:text-indigo-200"
                    : "border-zinc-300 text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
                } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled}
                  onChange={(e) => toggle(stage.id, e.target.checked)}
                />
                {stage.name}
                {!stage.isActive && <span className="text-xs text-amber-600">(inactive)</span>}
              </label>
            );
          })}
        </div>
      )}

      {value.length === 0 ? (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{emptyHint ?? "No stages selected."}</p>
      ) : (
        <div className="rounded-md border border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-1.5 dark:border-zinc-800">
            <span className="text-xs font-medium text-zinc-500">Working order</span>
            <button
              type="button"
              disabled={disabled}
              onClick={sortByProductionSequence}
              className="text-xs text-indigo-600 hover:text-indigo-500 disabled:opacity-50"
            >
              Sort by production sequence
            </button>
          </div>
          <ol className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {value.map((id, index) => {
              const stage = byId.get(id);
              return (
                <li key={id} className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm">
                  <span className="text-zinc-800 dark:text-zinc-200">
                    <span className="mr-2 text-xs text-zinc-400">{index + 1}.</span>
                    {stage?.name ?? "Unknown stage"}
                  </span>
                  <span className="flex items-center gap-1">
                    <button
                      type="button"
                      aria-label={`Move ${stage?.name ?? "stage"} up`}
                      disabled={disabled || index === 0}
                      onClick={() => move(index, -1)}
                      className="rounded px-1.5 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-800"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label={`Move ${stage?.name ?? "stage"} down`}
                      disabled={disabled || index === value.length - 1}
                      onClick={() => move(index, 1)}
                      className="rounded px-1.5 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-800"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      aria-label={`Remove ${stage?.name ?? "stage"}`}
                      disabled={disabled}
                      onClick={() => toggle(id, false)}
                      className="rounded px-1.5 text-red-500 hover:bg-red-50 disabled:opacity-30 dark:hover:bg-red-950"
                    >
                      ✕
                    </button>
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </div>
  );
}
