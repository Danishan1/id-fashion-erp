"use client";

import { useEffect, useState } from "react";
import { textInputClass } from "@/components/ui/FormField";

export interface CrmTagChip {
  id?: string;
  name: string;
  color?: string | null;
}

/**
 * Tag chips with type-ahead over existing tags. Typing a new name and pressing
 * Enter adds it as a new tag (created on save; the server de-duplicates by
 * normalised name, so "VIP" and "vip" stay one tag).
 */
export function CrmTagInput({
  value,
  onChange,
  id = "crm-tags",
  allowCreate = true,
}: {
  value: CrmTagChip[];
  onChange: (tags: CrmTagChip[]) => void;
  id?: string;
  allowCreate?: boolean;
}) {
  const [text, setText] = useState("");
  const [suggestions, setSuggestions] = useState<CrmTagChip[]>([]);
  const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  const has = (name: string) => value.some((t) => norm(t.name) === norm(name));

  useEffect(() => {
    const term = text.trim();
    const controller = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/v1/crm/tags?search=${encodeURIComponent(term)}`, { signal: controller.signal })
        .then((r) => (r.ok ? r.json() : { data: [] }))
        .then((b) => setSuggestions(b.data ?? []))
        .catch(() => {});
    }, 200);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [text]);

  const add = (tag: CrmTagChip) => {
    if (!tag.name.trim() || has(tag.name)) return;
    onChange([...value, { ...tag, name: tag.name.trim().replace(/\s+/g, " ") }]);
    setText("");
  };
  const exact = suggestions.find((s) => norm(s.name) === norm(text));
  const visibleSuggestions = suggestions.filter((s) => !has(s.name)).slice(0, 8);

  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {value.map((t) => (
          <span key={t.id ?? t.name} className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
            {t.name}
            {!t.id && <span className="text-zinc-400">(new)</span>}
            <button type="button" aria-label={`Remove tag ${t.name}`} onClick={() => onChange(value.filter((x) => x !== t))} className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-100">
              ✕
            </button>
          </span>
        ))}
      </div>
      <input
        id={id}
        value={text}
        maxLength={40}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            if (exact) add(exact);
            else if (allowCreate && text.trim()) add({ name: text });
          }
        }}
        placeholder={allowCreate ? "Type a tag and press Enter…" : "Search tags…"}
        className={`${textInputClass()} mt-1.5`}
      />

      {visibleSuggestions.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1.5" aria-label="Suggested tags">
          {visibleSuggestions.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => add(s)}
              className="rounded-full border border-zinc-300 px-2 py-0.5 text-xs text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              + {s.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
