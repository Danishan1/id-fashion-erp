"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { crmRequest } from "@/components/crm/crm-api";
import { Button, buttonClasses } from "@/components/ui/Button";
import { ClientDateTime } from "@/components/ui/ClientDateTime";

const API = "/api/v1/sales-marketing/imports/enquiries";

interface Validation {
  totalRows: number;
  validCount: number;
  errors: { rowNumber: number; reason: string }[];
}
interface Batch {
  id: string;
  fileName: string;
  status: string;
  totalRows: number;
  importedCount: number;
  skippedCount: number;
  createdAt: string;
  createdBy: { fullName: string } | null;
  hasFailedRows: boolean;
}
interface BatchDetail {
  id: string;
  status: string;
  totalRows: number;
  importedCount: number;
  skippedCount: number;
  progress: { processed: number; total: number } | null;
  failures: { rowNumber: number; reason: string }[];
  failureCount: number;
}

async function postFile<T>(url: string, file: File): Promise<{ ok: true; data: T } | { ok: false; message: string }> {
  const form = new FormData();
  form.set("file", file);
  const res = await fetch(url, { method: "POST", body: form }).catch(() => null);
  if (!res) return { ok: false, message: "The server couldn't be reached." };
  const body = await res.json().catch(() => null);
  if (!res.ok) return { ok: false, message: body?.error?.message ?? "Something went wrong." };
  return { ok: true, data: body.data as T };
}

/**
 * Phase 14 (S&M) — enquiry import: template → upload → validation preview
 * (every row checked by the real enquiry rules, nothing created) → import in
 * the background → progress, results and the failed-rows report.
 */
export function EnquiryImportClient() {
  const [file, setFile] = useState<File | null>(null);
  const [inputKey, setInputKey] = useState(0);
  const [validation, setValidation] = useState<Validation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [detail, setDetail] = useState<BatchDetail | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadBatches = useCallback(async () => {
    const r = await crmRequest<Batch[]>(`${API}/batches?pageSize=10`, { toast: "off" });
    if (r.ok) setBatches(r.data);
  }, []);
  useEffect(() => {
    let live = true;
    void crmRequest<Batch[]>(`${API}/batches?pageSize=10`, { toast: "off" }).then((r) => live && r.ok && setBatches(r.data));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!running) return;
    timer.current = setInterval(async () => {
      const r = await crmRequest<BatchDetail>(`${API}/batches/${running}`, { toast: "off" });
      if (!r.ok) return;
      setDetail(r.data);
      if (r.data.status !== "QUEUED" && r.data.status !== "PROCESSING") {
        setRunning(null);
        void loadBatches();
      }
    }, 2000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [running, loadBatches]);

  const validate = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setValidation(null);
    const r = await postFile<Validation>(`${API}/validate`, file);
    setBusy(false);
    if (r.ok) setValidation(r.data);
    else setError(r.message);
  };
  const commit = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    const r = await postFile<{ batchId: string }>(`${API}/commit`, file);
    setBusy(false);
    if (!r.ok) {
      setError(r.message);
      return;
    }
    setRunning(r.data.batchId);
    setDetail(null);
    setValidation(null);
    setFile(null);
    setInputKey((k) => k + 1);
    void loadBatches();
  };

  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="text-base font-semibold">1. Get the template</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Columns match exactly what the import reads. Give either a <strong>customer code</strong> or a <strong>prospect name</strong>; style, size and owner are looked up by code / email and must already exist. Rows that look like an existing enquiry (same customer or prospect, date, subject and style) are refused.
        </p>
        <div className="flex gap-2">
          <a href={`${API}/template?format=xlsx`} className={buttonClasses("secondary", "sm")}>
            Excel template
          </a>
          <a href={`${API}/template?format=csv`} className={buttonClasses("secondary", "sm")}>
            CSV template
          </a>
        </div>
      </section>

      <section className="space-y-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="text-base font-semibold">2. Check the file</h2>
        <input
          key={inputKey}
          type="file"
          accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          aria-label="Enquiry file"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setValidation(null);
            setError(null);
          }}
          className="block text-sm"
        />
        <div className="flex gap-2">
          <Button onClick={validate} disabled={!file || busy}>
            {busy && !validation ? "Checking…" : "Check file"}
          </Button>
        </div>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        {validation && (
          <div className="space-y-2 text-sm">
            <p>
              <strong>{validation.validCount}</strong> of {validation.totalRows} row(s) are ready to import. Nothing has been created yet.
            </p>
            {validation.errors.length > 0 && (
              <div className="max-h-64 overflow-y-auto rounded-md border border-red-200 dark:border-red-500/30">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-zinc-500">
                      <th className="px-2 py-1 font-medium">Row</th>
                      <th className="px-2 py-1 font-medium">Problem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {validation.errors.map((e) => (
                      <tr key={e.rowNumber} className="border-t border-red-100 dark:border-red-500/20">
                        <td className="px-2 py-1 tabular-nums">{e.rowNumber}</td>
                        <td className="px-2 py-1">{e.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Button onClick={commit} disabled={busy || validation.validCount === 0}>
                {busy ? "Starting…" : validation.errors.length ? `Import the ${validation.validCount} valid row(s)` : `Import ${validation.validCount} row(s)`}
              </Button>
              {validation.errors.length > 0 && <span className="text-xs text-zinc-500">Rows with problems are skipped and listed in the result; fix them and upload them again.</span>}
            </div>
          </div>
        )}
      </section>

      {(running || detail) && (
        <section className="space-y-2 rounded-lg border border-zinc-200 p-4 text-sm dark:border-zinc-800" aria-live="polite">
          <h2 className="text-base font-semibold">Import {running ? "running" : "finished"}</h2>
          {detail ? (
            <>
              <p>
                {detail.progress && running ? `${detail.progress.processed} / ${detail.progress.total} rows processed. ` : null}
                {!running && (
                  <>
                    {detail.importedCount} created, {detail.skippedCount} failed.{" "}
                    <Link href="/sales-marketing/enquiries" className="text-indigo-600 hover:underline dark:text-indigo-400">
                      Open enquiries
                    </Link>
                  </>
                )}
              </p>
              {!running && detail.failureCount > 0 && (
                <a href={`${API}/batches/${detail.id}/errors`} className={buttonClasses("secondary", "xs")}>
                  Download failed rows
                </a>
              )}
            </>
          ) : (
            <p className="text-zinc-500">Waiting for the background worker…</p>
          )}
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-base font-semibold">Recent imports</h2>
        {batches.length === 0 ? (
          <p className="text-sm text-zinc-500">No imports yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800">
                  <th className="px-3 py-2 font-medium">File</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 text-right font-medium">Rows</th>
                  <th className="px-3 py-2 text-right font-medium">Created</th>
                  <th className="px-3 py-2 text-right font-medium">Failed</th>
                  <th className="px-3 py-2 font-medium">By</th>
                  <th className="px-3 py-2 font-medium">When</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => (
                  <tr key={b.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                    <td className="px-3 py-2">{b.fileName}</td>
                    <td className="px-3 py-2">{b.status}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{b.totalRows}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{b.importedCount}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {b.skippedCount}
                      {b.hasFailedRows && (
                        <a href={`${API}/batches/${b.id}/errors`} className="ml-2 text-xs text-indigo-600 hover:underline dark:text-indigo-400">
                          report
                        </a>
                      )}
                    </td>
                    <td className="px-3 py-2">{b.createdBy?.fullName ?? "—"}</td>
                    <td className="px-3 py-2">
                      <ClientDateTime value={b.createdAt} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
