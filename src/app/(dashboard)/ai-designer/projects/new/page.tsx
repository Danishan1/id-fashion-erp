"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { FormField, textInputClass } from "@/components/ui/FormField";

export default function NewAiDesignerProjectPage() {
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
        body: JSON.stringify({ projectName }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Failed to create project.");
      router.push(`/ai-designer/projects/${body.data.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-lg space-y-4">
      <Breadcrumb
        items={[{ label: "Dashboard", href: "/dashboard" }, { label: "AI Designer", href: "/ai-designer" }, { label: "New Project" }]}
      />
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">New AI Designer Project</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Give the project a name — the guided wizard (fabric, customer, product, design, model,
          environment, generate) starts on the next screen.
        </p>
      </div>

      <FormField label="Project Name" htmlFor="projectName" required>
        <input
          id="projectName"
          className={textInputClass()}
          value={projectName}
          onChange={(e) => setProjectName(e.target.value)}
          placeholder="e.g. Summer Floral Kurti Line"
        />
      </FormField>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={isSubmitting || !projectName.trim()}
        className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
      >
        {isSubmitting ? "Creating…" : "Create Project"}
      </button>
    </div>
  );
}
