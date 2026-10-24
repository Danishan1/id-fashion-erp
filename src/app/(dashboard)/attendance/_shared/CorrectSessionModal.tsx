"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { apiJson, ErrorText } from "./attendance-ui";

export interface CorrectableSession {
  id: string;
  checkInAt: string;
  checkOutAt: string | null;
  employee: { fullName: string; employeeCode: string };
}

/** "YYYY-MM-DDTHH:mm" in IST for a datetime-local input. */
export function toIstLocalInput(iso: string | null): string {
  if (!iso) return "";
  return new Date(new Date(iso).getTime() + 330 * 60 * 1000).toISOString().slice(0, 16);
}

/** A datetime-local value entered as IST → ISO string. */
export function fromIstLocalInput(v: string): string | null {
  if (!v) return null;
  return new Date(`${v}:00+05:30`).toISOString();
}

export function CorrectSessionModal({ session, onClose, onSaved }: { session: CorrectableSession | null; onClose: () => void; onSaved: () => void }) {
  return (
    <Modal open={session !== null} onClose={onClose} title={`Correct punch times — ${session?.employee.fullName ?? ""}`}>
      {session && <CorrectSessionForm key={session.id} session={session} onClose={onClose} onSaved={onSaved} />}
    </Modal>
  );
}

function CorrectSessionForm({ session, onClose, onSaved }: { session: CorrectableSession; onClose: () => void; onSaved: () => void }) {
  const [checkIn, setCheckIn] = useState(() => toIstLocalInput(session.checkInAt));
  const [checkOut, setCheckOut] = useState(() => toIstLocalInput(session.checkOutAt));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await apiJson(`/api/v1/attendance/sessions/${session.id}`, {
        method: "PATCH",
        body: JSON.stringify({ checkInAt: fromIstLocalInput(checkIn), checkOutAt: fromIstLocalInput(checkOut) }),
      });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <ErrorText message={error} />
      <FormField label="Check-in (IST)" htmlFor="corr-in" required>
        <input id="corr-in" type="datetime-local" className={textInputClass()} value={checkIn} onChange={(e) => setCheckIn(e.target.value)} />
      </FormField>
      <FormField label="Check-out (IST) — leave empty if still open" htmlFor="corr-out">
        <input id="corr-out" type="datetime-local" className={textInputClass()} value={checkOut} onChange={(e) => setCheckOut(e.target.value)} />
      </FormField>
      <p className="text-xs text-zinc-500">Times can&apos;t overlap the employee&apos;s other punches, and one session can&apos;t be longer than the set limit (18 h by default).</p>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={save} isLoading={saving} loadingLabel="Saving…" disabled={!checkIn}>
          Save
        </Button>
      </div>
    </div>
  );
}
