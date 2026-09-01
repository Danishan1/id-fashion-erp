"use client";

import { useRouter } from "next/navigation";
import { CustomerForm, type CustomerFormValues } from "../CustomerForm";

interface CustomerEditFormClientProps {
  id: string;
  initialValues: CustomerFormValues;
}

/** Thin router-navigation wrapper — CustomerForm itself is navigation-agnostic (onSuccess/onCancel callbacks) so it can be reused identically inside the Customers list's "Add Customer" modal. */
export function CustomerEditFormClient({ id, initialValues }: CustomerEditFormClientProps) {
  const router = useRouter();

  const goToList = () => {
    router.push("/masters/customers");
    router.refresh();
  };

  return (
    <CustomerForm
      initialValues={initialValues}
      submitUrl={`/api/v1/customers/${id}`}
      method="PATCH"
      onSuccess={goToList}
      onCancel={goToList}
    />
  );
}
