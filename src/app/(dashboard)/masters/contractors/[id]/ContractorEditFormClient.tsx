"use client";

import { useRouter } from "next/navigation";
import { ContractorForm, type ContractorFormValues } from "../ContractorForm";

interface ContractorEditFormClientProps {
  id: string;
  initialValues: ContractorFormValues;
}

/** Thin router-navigation wrapper — ContractorForm itself is navigation-agnostic (onSuccess/onCancel callbacks) so it can be reused identically inside the Contractors list's "Add Contractor" modal. */
export function ContractorEditFormClient({ id, initialValues }: ContractorEditFormClientProps) {
  const router = useRouter();

  const goToList = () => {
    router.push("/masters/contractors");
    router.refresh();
  };

  return (
    <ContractorForm
      initialValues={initialValues}
      submitUrl={`/api/v1/contractors/${id}`}
      method="PATCH"
      onSuccess={goToList}
      onCancel={goToList}
    />
  );
}
