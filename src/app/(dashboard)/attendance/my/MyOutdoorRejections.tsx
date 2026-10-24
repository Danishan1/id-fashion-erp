"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { apiJson, Card, ErrorText, fmtDateTime, fmtTime } from "../_shared/attendance-ui";
import { OutdoorStatusPill } from "../_shared/OutdoorStatusPill";

export interface OutdoorRejectionRow {
  id: string;
  status: "PENDING" | "IN_PROCESS" | "APPROVED" | "REJECTED";
  originalCheckIn: string;
  originalCheckOut: string | null;
  trimmedCheckIn: string;
  trimmedCheckOut: string | null;
  rejectedReason: string | null;
  clarificationReason: string | null;
  hasProof: boolean;
  isRevoked: boolean;
  rejectedAt: string;
  employee: { fullName: string; employeeCode: string };
  rejectedBy: { fullName: string };
}

export function MyOutdoorRejections() {
  const [rows, setRows] = useState<OutdoorRejectionRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState<OutdoorRejectionRow | null>(null);
  const [clarifying, setClarifying] = useState<OutdoorRejectionRow | null>(null);
  const [reason, setReason] = useState("");
  const [proof, setProof] = useState<File | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    apiJson<OutdoorRejectionRow[]>("/api/v1/attendance/outdoor-rejections?mine=true")
      .then(setRows)
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const accept = async () => {
    if (!accepting) return;
    const r = accepting;
    setAccepting(null);
    try {
      await apiJson(`/api/v1/attendance/outdoor-rejections/${r.id}/accept`, { method: "POST" });
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const clarify = async () => {
    if (!clarifying) return;
    setSaving(true);
    setFormError(null);
    try {
      const form = new FormData();
      form.append("reason", reason);
      if (proof) form.append("proof", proof);
      await apiJson(`/api/v1/attendance/outdoor-rejections/${clarifying.id}/clarify`, { method: "POST", body: form });
      setClarifying(null);
      load();
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title="Outside punches the admin rejected">
      <ErrorText message={error} />
      <p className="mb-3 text-xs text-zinc-500">
        When a punch made outside the office is rejected, its times are cut to what the admin allowed. Accept it, or explain with proof (bill, visit pass…) — if the admin approves your explanation, your original times come back.
      </p>
      {rows.length === 0 ? (
        <p className="text-sm text-zinc-500">Nothing here.</p>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <div key={r.id} className="rounded-md border border-zinc-200 p-3 text-sm dark:border-zinc-800">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-medium">{fmtDateTime(r.originalCheckIn)}</div>
                <OutdoorStatusPill status={r.status} revoked={r.isRevoked} />
              </div>
              <div className="mt-1 text-zinc-600 dark:text-zinc-300">
                Your times: {fmtTime(r.originalCheckIn)}–{fmtTime(r.originalCheckOut)} · Allowed: {fmtTime(r.trimmedCheckIn)}–{fmtTime(r.trimmedCheckOut)}
              </div>
              {r.rejectedReason && <div className="mt-1 text-zinc-600 dark:text-zinc-300">Reason: {r.rejectedReason}</div>}
              {r.clarificationReason && <div className="mt-1 text-zinc-600 dark:text-zinc-300">Your explanation: {r.clarificationReason}</div>}
              {r.status === "PENDING" && (
                <div className="mt-2 flex gap-2">
                  <Button size="xs" variant="secondary" onClick={() => setAccepting(r)}>
                    Accept
                  </Button>
                  <Button
                    size="xs"
                    onClick={() => {
                      setClarifying(r);
                      setReason("");
                      setProof(null);
                      setFormError(null);
                    }}
                  >
                    Clarify
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <ConfirmModal
        open={accepting !== null}
        title="Accept the trimmed times?"
        message="Your punch will stay at the times the admin allowed."
        confirmLabel="Accept"
        onConfirm={accept}
        onCancel={() => setAccepting(null)}
      />
      <Modal open={clarifying !== null} onClose={() => setClarifying(null)} title="Explain this outside punch">
        <div className="space-y-3">
          <ErrorText message={formError} />
          <FormField label="Why were you outside the office?" htmlFor="clarify-reason" required>
            <textarea id="clarify-reason" rows={3} className={textInputClass()} value={reason} onChange={(e) => setReason(e.target.value)} />
          </FormField>
          <FormField label="Proof (photo or PDF, optional)" htmlFor="clarify-proof">
            <input id="clarify-proof" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => setProof(e.target.files?.[0] ?? null)} />
          </FormField>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setClarifying(null)}>
              Cancel
            </Button>
            <Button onClick={clarify} isLoading={saving} loadingLabel="Sending…" disabled={!reason.trim()}>
              Send
            </Button>
          </div>
        </div>
      </Modal>
    </Card>
  );
}
