"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { Button } from "@/components/ui/Button";

interface Option {
  id: string;
  name?: string;
}

interface CopyDesignSource {
  id: string;
  requestNumber: string;
  styleName: string;
  customer: { id: string; name: string } | null;
  buyer: { id: string; name: string } | null;
}

/**
 * "Copy Design" — clones one Sample Request's header + its current
 * version's tech pack notes and materials into a brand-new one (see
 * duplicateSampleRequest() in sample.service.ts for exactly what's copied
 * and what deliberately isn't). Customer/Buyer are pre-filled from the
 * source but editable — same cascade fetch as SampleRequestForm's own
 * Customer -> Buyer picker, reused here rather than re-invented.
 */
export function CopyDesignModal({ source, onClose, onCreated }: { source: CopyDesignSource; onClose: () => void; onCreated: (newId: string) => void }) {
  const router = useRouter();
  const [styleName, setStyleName] = useState(`Copy of ${source.styleName}`);
  const [customerId, setCustomerId] = useState(source.customer?.id ?? "");
  const [buyerId, setBuyerId] = useState(source.buyer?.id ?? "");
  const [customers, setCustomers] = useState<Option[]>([]);
  const [buyers, setBuyers] = useState<Option[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/v1/customers?pageSize=200")
      .then((res) => res.json())
      .then((body) => setCustomers(body.data ?? []));
  }, []);

  // Buyers are scoped to the selected customer — fires on mount too (for the
  // pre-filled source customer) and again on every later change. Resetting
  // buyerId on a *manual* customer change happens in the select's own
  // onChange below, not here, to avoid a synchronous setState in the effect
  // body.
  useEffect(() => {
    if (!customerId) return;
    fetch(`/api/v1/customers/${customerId}`)
      .then((res) => res.json())
      .then((body) => setBuyers(body.data?.buyers ?? []));
  }, [customerId]);

  async function handleSubmit() {
    if (isSubmitting || !styleName.trim() || !customerId) return;
    setIsSubmitting(true);
    setError(null);

    const res = await fetch(`/api/v1/sampling/${source.id}/duplicate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ styleName: styleName.trim(), customerId, buyerId: buyerId || undefined }),
    });

    setIsSubmitting(false);

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? "Failed to copy this design.");
      return;
    }

    const { data } = await res.json();
    onCreated(data.id);
    router.push(`/sampling/${data.id}`);
  }

  return (
    <Modal open onClose={onClose} title={`Copy Design — ${source.requestNumber}`}>
      <div className="space-y-4">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Creates a new Sample Request pre-filled with this design&apos;s tech pack notes and materials — it
          starts its own fresh approval workflow. Images are not copied.
        </p>

        <FormField label="Design Name" htmlFor="copyStyleName" required>
          <input
            id="copyStyleName"
            value={styleName}
            onChange={(e) => setStyleName(e.target.value)}
            autoFocus
            className={textInputClass()}
          />
        </FormField>

        <FormField label="Customer" htmlFor="copyCustomerId" required>
          <SearchableSelect
            id="copyCustomerId"
            required
            value={customerId}
            onChange={(next) => {
              setCustomerId(next);
              setBuyerId("");
              setBuyers([]);
            }}
            options={customers.map((c) => ({ id: c.id, label: c.name ?? "" }))}
            placeholder="Search customer…"
          />
        </FormField>

        <FormField label="Buyer" htmlFor="copyBuyerId">
          <SearchableSelect
            id="copyBuyerId"
            value={buyerId}
            onChange={setBuyerId}
            disabled={!customerId}
            options={buyers.map((b) => ({ id: b.id, label: b.name ?? "" }))}
            placeholder="Search buyer…"
          />
        </FormField>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!styleName.trim() || !customerId}
            isLoading={isSubmitting}
            loadingLabel="Creating Copy…"
          >
            Create Copy
          </Button>
        </div>
      </div>
    </Modal>
  );
}
