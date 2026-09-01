"use client";

import { useRouter } from "next/navigation";
import { SupplierForm, type SupplierFormValues } from "../SupplierForm";

interface SupplierEditFormClientProps {
  id: string;
  initialValues: SupplierFormValues;
}

/** Thin router-navigation wrapper — SupplierForm itself is navigation-agnostic (onSuccess/onCancel callbacks) so it can be reused identically inside the Suppliers list's "Add Supplier" modal. */
export function SupplierEditFormClient({ id, initialValues }: SupplierEditFormClientProps) {
  const router = useRouter();

  const goToList = () => {
    router.push("/masters/suppliers");
    router.refresh();
  };

  return (
    <SupplierForm
      initialValues={initialValues}
      submitUrl={`/api/v1/suppliers/${id}`}
      method="PATCH"
      onSuccess={goToList}
      onCancel={goToList}
    />
  );
}
