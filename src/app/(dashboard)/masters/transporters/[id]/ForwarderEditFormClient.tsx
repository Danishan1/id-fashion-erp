"use client";

import { useRouter } from "next/navigation";
import { ForwarderForm, type ForwarderFormValues } from "../ForwarderForm";

interface ForwarderEditFormClientProps {
  id: string;
  initialValues: ForwarderFormValues;
}

/** Thin router-navigation wrapper — ForwarderForm itself is navigation-agnostic (onSuccess/onCancel callbacks) so it can be reused identically inside the Forwarders list's "Add Forwarder" modal. */
export function ForwarderEditFormClient({ id, initialValues }: ForwarderEditFormClientProps) {
  const router = useRouter();

  const goToList = () => {
    router.push("/masters/transporters");
    router.refresh();
  };

  return (
    <ForwarderForm
      initialValues={initialValues}
      submitUrl={`/api/v1/forwarders/${id}`}
      method="PATCH"
      onSuccess={goToList}
      onCancel={goToList}
    />
  );
}
