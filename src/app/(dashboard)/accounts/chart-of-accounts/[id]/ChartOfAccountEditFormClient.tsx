"use client";

import { useRouter } from "next/navigation";
import { ChartOfAccountForm, type ChartOfAccountFormValues } from "../ChartOfAccountForm";

interface ChartOfAccountEditFormClientProps {
  id: string;
  initialValues: ChartOfAccountFormValues;
}

/** Thin router-navigation wrapper — ChartOfAccountForm itself is navigation-agnostic (onSuccess/onCancel callbacks) so it can be reused identically inside the Chart of Accounts list's "New Account" modal. */
export function ChartOfAccountEditFormClient({ id, initialValues }: ChartOfAccountEditFormClientProps) {
  const router = useRouter();

  const goToList = () => {
    router.push("/accounts/chart-of-accounts");
    router.refresh();
  };

  return (
    <ChartOfAccountForm
      initialValues={initialValues}
      currentId={id}
      submitUrl={`/api/v1/chart-of-accounts/${id}`}
      method="PATCH"
      onSuccess={goToList}
      onCancel={goToList}
    />
  );
}
