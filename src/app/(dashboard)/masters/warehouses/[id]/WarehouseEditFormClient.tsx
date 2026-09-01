"use client";

import { useRouter } from "next/navigation";
import { WarehouseForm, type WarehouseFormValues } from "../WarehouseForm";

interface WarehouseEditFormClientProps {
  id: string;
  initialValues: WarehouseFormValues;
}

/** Thin router-navigation wrapper — WarehouseForm itself is navigation-agnostic (onSuccess/onCancel callbacks) so it can be reused identically inside the Warehouses list's "Add Warehouse" modal. */
export function WarehouseEditFormClient({ id, initialValues }: WarehouseEditFormClientProps) {
  const router = useRouter();

  const goToList = () => {
    router.push("/masters/warehouses");
    router.refresh();
  };

  return (
    <WarehouseForm
      initialValues={initialValues}
      submitUrl={`/api/v1/warehouses/${id}`}
      method="PATCH"
      onSuccess={goToList}
      onCancel={goToList}
    />
  );
}
