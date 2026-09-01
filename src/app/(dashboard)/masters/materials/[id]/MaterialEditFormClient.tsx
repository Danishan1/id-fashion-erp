"use client";

import { useRouter } from "next/navigation";
import { MaterialForm, type MaterialFormValues } from "../MaterialForm";

interface MaterialEditFormClientProps {
  id: string;
  initialValues: MaterialFormValues;
}

/** Thin router-navigation wrapper — MaterialForm itself is navigation-agnostic (onSuccess/onCancel callbacks) so it can be reused identically inside the Materials list's "Add Material" modal. */
export function MaterialEditFormClient({ id, initialValues }: MaterialEditFormClientProps) {
  const router = useRouter();

  const goToList = () => {
    router.push("/masters/materials");
    router.refresh();
  };

  return (
    <MaterialForm
      initialValues={initialValues}
      submitUrl={`/api/v1/materials/${id}`}
      method="PATCH"
      onSuccess={goToList}
      onCancel={goToList}
    />
  );
}
