"use client";

import { useState, type FormEvent } from "react";
import { textInputClass } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";
import { RowAction } from "@/components/ui/RowAction";
import { PeopleIcon, EditIcon } from "@/components/ui/icons";

interface Buyer {
  id: string;
  code: string;
  name: string;
  contactPerson: string | null;
  email: string | null;
  phone: string | null;
  isActive: boolean;
}

interface BuyersSectionProps {
  customerId: string;
}

const EMPTY_FORM = { code: "", name: "", contactPerson: "", email: "", phone: "" };

/**
 * Rendered as a small row-action button on the Customers list (between Edit
 * and the Active/Inactive toggle), mirroring Suppliers' "Categories"/
 * "Materials" row-action pattern — moved off the Customer edit page per the
 * 2026-09-01 task ("Add Buyers" no longer lives inline on Edit). Self-fetches
 * on open rather than taking a server-preloaded prop, since a list row has no
 * per-row detail fetch to piggyback on.
 */
export function BuyersSection({ customerId }: BuyersSectionProps) {
  const [open, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [buyers, setBuyers] = useState<Buyer[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingBuyer, setEditingBuyer] = useState<Buyer | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingToggle, setPendingToggle] = useState<Buyer | null>(null);

  async function openModal() {
    setOpen(true);
    setError(null);
    setIsLoading(true);
    const res = await fetch(`/api/v1/customers/${customerId}`);
    const body = await res.json();
    setIsLoading(false);
    if (res.ok) {
      setBuyers(body.data.buyers ?? []);
    } else {
      setError(body?.error?.message ?? "Failed to load buyers.");
    }
  }

  const openAddForm = () => {
    setEditingBuyer(null);
    setForm(EMPTY_FORM);
    setError(null);
    setShowForm(true);
  };

  const openEditForm = (buyer: Buyer) => {
    setEditingBuyer(buyer);
    setForm({
      code: buyer.code,
      name: buyer.name,
      contactPerson: buyer.contactPerson ?? "",
      email: buyer.email ?? "",
      phone: buyer.phone ?? "",
    });
    setError(null);
    setShowForm(true);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);

    const url = editingBuyer ? `/api/v1/customers/${customerId}/buyers/${editingBuyer.id}` : `/api/v1/customers/${customerId}/buyers`;
    const res = await fetch(url, {
      method: editingBuyer ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });

    setIsSubmitting(false);

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? "Failed to save buyer.");
      return;
    }

    const { data } = await res.json();
    setBuyers((prev) => (editingBuyer ? prev.map((b) => (b.id === data.id ? data : b)) : [...prev, data]));
    setShowForm(false);
    setEditingBuyer(null);
  };

  const confirmToggle = async () => {
    if (!pendingToggle) return;
    const res = await fetch(`/api/v1/customers/${customerId}/buyers/${pendingToggle.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: pendingToggle.code,
        name: pendingToggle.name,
        contactPerson: pendingToggle.contactPerson ?? "",
        email: pendingToggle.email ?? "",
        phone: pendingToggle.phone ?? "",
        isActive: !pendingToggle.isActive,
      }),
    });
    if (res.ok) {
      const { data } = await res.json();
      setBuyers((prev) => prev.map((b) => (b.id === data.id ? data : b)));
    }
    setPendingToggle(null);
  };

  return (
    <>
      <RowAction icon={<PeopleIcon />} label="Buyers" onClick={openModal} />

      <Modal open={open} onClose={() => setOpen(false)} title="Buyers" maxWidthClass="max-w-xl">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-zinc-500 dark:text-zinc-400">Contacts/brands under this customer.</p>
            <button onClick={openAddForm} className="text-sm font-medium text-indigo-600 hover:text-indigo-500">
              + Add buyer
            </button>
          </div>

          {error && !showForm && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

          {isLoading ? (
            <p className="text-sm text-zinc-500">Loading…</p>
          ) : buyers.length === 0 ? (
            <p className="text-sm text-zinc-500">No buyers yet.</p>
          ) : (
            <ul className="divide-y divide-zinc-100 rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
              {buyers.map((buyer) => (
                <li key={buyer.id} className="flex items-center justify-between px-3 py-2 text-sm">
                  <div>
                    <span className="font-medium text-zinc-800 dark:text-zinc-100">
                      {buyer.name} <span className="text-zinc-400">({buyer.code})</span>
                    </span>
                    <span className="ml-2 text-zinc-500">{buyer.email ?? buyer.contactPerson ?? ""}</span>
                    {!buyer.isActive && <span className="ml-2 text-xs text-zinc-400">(inactive)</span>}
                  </div>
                  <div className="flex items-center gap-3">
                    <RowAction icon={<EditIcon />} label="Edit" onClick={() => openEditForm(buyer)} />
                    <ToggleSwitch checked={buyer.isActive} onToggle={() => setPendingToggle(buyer)} />
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              Close
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={showForm} onClose={() => setShowForm(false)} title={editingBuyer ? "Edit Buyer" : "Add Buyer"}>
        <form onSubmit={handleSubmit} className="space-y-3">
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <div>
            <label htmlFor="buyerCode" className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Code
            </label>
            <input
              id="buyerCode"
              required
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              className={textInputClass()}
            />
          </div>
          <div>
            <label htmlFor="buyerName" className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Name
            </label>
            <input
              id="buyerName"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className={textInputClass()}
            />
          </div>
          <div>
            <label htmlFor="buyerContactPerson" className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Contact Person <span className="text-red-500">*</span>
            </label>
            <input
              id="buyerContactPerson"
              required
              value={form.contactPerson}
              onChange={(e) => setForm({ ...form, contactPerson: e.target.value })}
              className={textInputClass()}
            />
          </div>
          <div>
            <label htmlFor="buyerEmail" className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Email <span className="text-red-500">*</span>
            </label>
            <input
              id="buyerEmail"
              type="email"
              required
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className={textInputClass()}
            />
          </div>
          <div>
            <label htmlFor="buyerPhone" className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Phone <span className="text-red-500">*</span>
            </label>
            <input
              id="buyerPhone"
              type="tel"
              required
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              className={textInputClass()}
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
            >
              {isSubmitting ? "Saving…" : editingBuyer ? "Save Changes" : "Add"}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmModal
        open={pendingToggle !== null}
        title={pendingToggle?.isActive ? "Deactivate buyer?" : "Activate buyer?"}
        message={
          pendingToggle?.isActive
            ? `"${pendingToggle?.name}" will be deactivated and hidden from active selection lists. You can reactivate it later.`
            : `"${pendingToggle?.name}" will be marked active again.`
        }
        confirmLabel={pendingToggle?.isActive ? "Deactivate" : "Activate"}
        isDangerous={Boolean(pendingToggle?.isActive)}
        onConfirm={confirmToggle}
        onCancel={() => setPendingToggle(null)}
      />
    </>
  );
}
