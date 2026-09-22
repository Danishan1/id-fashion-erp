"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { FormField, textInputClass } from "@/components/ui/FormField";

export default function NewAiDesignerProjectPage() {
  const router = useRouter();
  const [projectName, setProjectName] = useState("");
  const [projectMode, setProjectMode] = useState<"SINGLE" | "SET">("SINGLE");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/ai-designer/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectName, projectMode }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Failed to create design.");
      router.push(`/ai-designer/catalogue-designs/${body.data.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-lg space-y-4">
      <Breadcrumb
        items={[{ label: "Dashboard", href: "/dashboard" }, { label: "AI Designer", href: "/ai-designer" }, { label: "New Design" }]}
      />
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">New Catalogue Design</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Give the design a name — the guided wizard (fabric, customer, product, design, model,
          environment, generate) starts on the next screen.
        </p>
      </div>

      <FormField label="Design Name" htmlFor="projectName" required>
        <input
          id="projectName"
          className={textInputClass()}
          value={projectName}
          onChange={(e) => setProjectName(e.target.value)}
          placeholder="e.g. Summer Floral Kurti Line"
        />
      </FormField>

      <FormField label="Design Type" htmlFor="projectMode">
        <div className="flex gap-2">
          {(
            [
              { value: "SINGLE" as const, label: "Single Garment", hint: "One garment (e.g. a kurti, dress, or top)" },
              { value: "SET" as const, label: "Multi-Piece Set", hint: "A coordinated outfit of several pieces (e.g. Kurta + Pant + Dupatta)" },
            ]
          ).map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setProjectMode(opt.value)}
              className={`flex-1 rounded-md border px-3 py-2 text-left text-sm ${
                projectMode === opt.value
                  ? "border-indigo-600 bg-indigo-50 text-indigo-900 dark:bg-indigo-900/30 dark:text-indigo-100"
                  : "border-zinc-300 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200"
              }`}
            >
              <span className="block font-medium">{opt.label}</span>
              <span className="block text-xs text-zinc-500 dark:text-zinc-400">{opt.hint}</span>
            </button>
          ))}
        </div>
      </FormField>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={isSubmitting || !projectName.trim()}
        className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
      >
        {isSubmitting ? "Creating…" : "Create Design"}
      </button>
    </div>
  );
}
