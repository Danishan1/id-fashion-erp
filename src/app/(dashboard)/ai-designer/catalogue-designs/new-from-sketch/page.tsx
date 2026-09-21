"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { FormField, textInputClass } from "@/components/ui/FormField";

/** Forked from catalogue-designs/new/page.tsx — the only difference is the creationMode: "SKETCH" body field. The sketch upload itself happens as the wizard's own first step, exactly like fabric upload does today, not on this creation form. */
export default function NewAiDesignerSketchProjectPage() {
  const router = useRouter();
  const [projectName, setProjectName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/ai-designer/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectName, creationMode: "SKETCH" }),
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
        items={[{ label: "Dashboard", href: "/dashboard" }, { label: "AI Designer", href: "/ai-designer" }, { label: "New Design From Sketch" }]}
      />
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Create from Sketch / Drawing</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Give the design a name — the guided wizard (upload sketch, sketch analysis, fabric, customer,
          product, design, model, environment, generate) starts on the next screen. Your sketch becomes the
          garment&apos;s authoritative structural reference; the fabric you select only changes its material
          appearance.
        </p>
      </div>

      <FormField label="Design Name" htmlFor="projectName" required>
        <input
          id="projectName"
          className={textInputClass()}
          value={projectName}
          onChange={(e) => setProjectName(e.target.value)}
          placeholder="e.g. Girl's Frock From Sketch"
        />
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
