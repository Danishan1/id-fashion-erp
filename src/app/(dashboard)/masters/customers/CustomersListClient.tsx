"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { ActionMenu } from "@/components/ui/ActionMenu";
import { DataTable } from "@/components/ui/DataTable";
import { Modal } from "@/components/ui/Modal";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { CustomerForm, type CustomerFormValues } from "./CustomerForm";
import { BuyersSection } from "./BuyersSection";

interface CustomerRow {
  id: string;
  code: string;
  name: string;
  type: string;
  country: string | null;
  isActive: boolean;
}

/** A raw /api/v1/customers/:id response — the shape CustomerForm's initialValues are built from. */
interface CustomerDetail {
  id: string;
  code: string;
  name: string;
  type: string;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  billingAddress: string | null;
  city: string | null;
  pinCode: string | null;
  country: string | null;
  taxRegistrationNo: string | null;
  paymentTermsDays: number | null;
  creditLimit: string | number | null;
  defaultCurrencyCode: string | null;
  isActive: boolean;
}

function toFormValues(customer: CustomerDetail): CustomerFormValues {
  return {
    code: customer.code,
    name: customer.name,
    type: customer.type as "CUSTOMER" | "AGENT",
    contactPerson: customer.contactPerson ?? "",
    phone: customer.phone ?? "",
    email: customer.email ?? "",
    billingAddress: customer.billingAddress ?? "",
    city: customer.city ?? "",
    pinCode: customer.pinCode ?? "",
    country: customer.country ?? "",
    taxRegistrationNo: customer.taxRegistrationNo ?? "",
    paymentTermsDays: customer.paymentTermsDays?.toString() ?? "",
    creditLimit: customer.creditLimit?.toString() ?? "",
    defaultCurrencyCode: customer.defaultCurrencyCode ?? "",
    isActive: customer.isActive,
  };
}

export function CustomersListClient() {
  return (
    <Suspense>
      <CustomersListContent />
    </Suspense>
  );
}

function CustomersListContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<{ id: string; name: string; values: CustomerFormValues } | null>(null);
  const [editLoadError, setEditLoadError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const openEdit = async (id: string) => {
    setEditLoadError(null);
    const res = await fetch(`/api/v1/customers/${id}`);
    const body = await res.json();
    if (!res.ok) {
      setEditLoadError(body?.error?.message ?? "Failed to load this customer.");
      return;
    }
    setEditTarget({ id, name: body.data.name, values: toFormValues(body.data) });
  };

  // Customer's own edit page was removed in favor of this modal, but
  // Deals/Reports/etc. still deep-link straight to /masters/customers/{id}
  // — that route now redirects here with ?edit={id}, and this effect
  // auto-opens the same Edit modal for it, then cleans the param off the URL.
  useEffect(() => {
    const id = searchParams.get("edit");
    if (!id) return;
    // Deferred a tick so openEdit's own setState calls don't run
    // synchronously within the effect body itself (react-hooks/set-state-
    // in-effect) — same idiom used by ManageChildrenModal's own load effect.
    const timeout = setTimeout(() => {
      openEdit(id).then(() => router.replace(pathname));
    }, 0);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const closeAdd = () => setAddOpen(false);

  const handleCreated = () => {
    closeAdd();
    setRefreshKey((k) => k + 1);
  };

  const handleEdited = () => {
    setEditTarget(null);
    setRefreshKey((k) => k + 1);
  };

  return (
    <div className="space-y-4">
      <div>
        <Breadcrumb items={[{ label: "Masters", href: "/masters" }, { label: "Customers" }]} />
        <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">Customers</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Customers and the buyers/brands under them.</p>
      </div>

      {editLoadError && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          {editLoadError}
        </div>
      )}

      <DataTable<CustomerRow>
        fetchUrl="/api/v1/customers"
        refreshKey={refreshKey}
        newAction={{ label: "New Customer", onClick: () => setAddOpen(true) }}
        searchPlaceholder="Search by name or code…"
        rowActions={(row) => (
          <>
            <BuyersSection customerId={row.id} />
            <ActionMenu
              items={[
                { label: "Edit", onClick: () => openEdit(row.id) },
                { label: "Customer 360", onClick: () => router.push(`/masters/customers/${row.id}/360`) },
              ]}
            />
          </>
        )}
        columns={[
          { key: "code", header: "Code", sortable: true },
          { key: "name", header: "Name", sortable: true },
          { key: "type", header: "Type", sortable: true },
          { key: "country", header: "Country", sortable: true, render: (row) => row.country ?? "—" },
          {
            key: "isActive",
            header: "Status",
            render: (row) => (
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  row.isActive
                    ? "bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-400"
                    : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                }`}
              >
                {row.isActive ? "Active" : "Inactive"}
              </span>
            ),
          },
        ]}
      />

      <Modal open={addOpen} onClose={closeAdd} title="Add Customer" maxWidthClass="max-w-xl">
        <CustomerForm submitUrl="/api/v1/customers" method="POST" onSuccess={handleCreated} onCancel={closeAdd} />
      </Modal>

      <Modal
        open={!!editTarget}
        onClose={() => setEditTarget(null)}
        title={`Edit Customer — ${editTarget?.name ?? ""}`}
        maxWidthClass="max-w-xl"
      >
        {editTarget && (
          <CustomerForm
            key={editTarget.id}
            initialValues={editTarget.values}
            submitUrl={`/api/v1/customers/${editTarget.id}`}
            method="PATCH"
            onSuccess={handleEdited}
            onCancel={() => setEditTarget(null)}
          />
        )}
      </Modal>
    </div>
  );
}
