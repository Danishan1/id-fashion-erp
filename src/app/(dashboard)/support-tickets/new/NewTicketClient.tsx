"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { FilePicker } from "@/components/support/TicketThread";
import {
  MAX_TICKET_ATTACHMENTS,
  TICKET_CATEGORIES,
  TICKET_CATEGORY_LABELS,
  TICKET_PRIORITIES,
  TICKET_PRIORITY_LABELS,
} from "@/modules/support-tickets/support-ticket.schema";

const inputClass = "mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";

export function NewTicketClient() {
  const router = useRouter();
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState<string>("GENERAL");
  const [priority, setPriority] = useState<string>("NORMAL");
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("subject", subject);
      form.set("category", category);
      form.set("priority", priority);
      form.set("body", body);
      files.forEach((f) => form.append("files", f));
      const res = await fetch("/api/v1/support-tickets", { method: "POST", body: form });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.error?.message ?? "Couldn't raise the ticket.");
        return;
      }
      router.push(`/support-tickets/${json.data.id}`);
      router.refresh();
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="max-w-3xl space-y-4 rounded-lg border border-zinc-200 bg-white p-5 text-sm dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">New support ticket</h1>
        <p className="mt-1 text-zinc-500">Tell us what&apos;s wrong. Screenshots help us fix things faster.</p>
      </div>
      <label className="block">
        <span className="text-zinc-600 dark:text-zinc-300">Subject</span>
        <input required value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} className={inputClass} />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-zinc-600 dark:text-zinc-300">Category</span>
          <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputClass}>
            {TICKET_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {TICKET_CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-zinc-600 dark:text-zinc-300">Priority</span>
          <select value={priority} onChange={(e) => setPriority(e.target.value)} className={inputClass}>
            {TICKET_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {TICKET_PRIORITY_LABELS[p]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="block">
        <span className="text-zinc-600 dark:text-zinc-300">Describe the problem</span>
        <textarea
          required
          rows={7}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="What were you doing, what did you expect, and what happened instead?"
          className={inputClass}
        />
      </label>
      <FilePicker files={files} onChange={setFiles} max={MAX_TICKET_ATTACHMENTS} />
      {error && <p className="text-red-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => router.push("/support-tickets")} className="rounded-md border border-zinc-300 px-4 py-2">
          Cancel
        </button>
        <button
          type="submit"
          disabled={busy || subject.trim().length < 5 || body.trim().length < 10}
          className="rounded-md bg-indigo-600 px-4 py-2 font-medium text-white disabled:opacity-60"
        >
          {busy ? "Sending…" : "Raise ticket"}
        </button>
      </div>
    </form>
  );
}
