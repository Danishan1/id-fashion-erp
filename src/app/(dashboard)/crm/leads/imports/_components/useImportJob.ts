"use client";

import { useCallback, useEffect, useState } from "react";
import { crmRequest } from "@/components/crm/crm-api";
import { ACTIVE_STATUSES, type ImportJobDetailDto } from "./import-types";

/** Loads an import job and polls it every 1.5 s while it is validating or importing. */
export function useImportJob(jobId: string | null) {
  const [job, setJob] = useState<ImportJobDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    crmRequest<ImportJobDetailDto>(`/api/v1/crm/imports/${jobId}`).then((res) => {
      if (cancelled) return;
      if (res.ok) {
        setJob(res.data);
        setError(null);
      } else setError(res.error.message);
    });
    return () => {
      cancelled = true;
    };
  }, [jobId, tick]);

  const active = job ? ACTIVE_STATUSES.includes(job.status) : false;
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setTick((n) => n + 1), 1500);
    return () => clearInterval(t);
  }, [active]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { job, setJob, error, reload };
}
