"use client";

import { useEffect, useState } from "react";
import type { UserOptionDto } from "../activities/activity-types";
import { APPOINTMENTS_API, type AppointmentMetaDto } from "./appointment-types";

/** Appointment meta (statuses, actions, reminders, option lists, default zone) + active ERP users, once per screen. */
export function useAppointmentLookups() {
  const [state, setState] = useState<{ meta: AppointmentMetaDto | null; users: UserOptionDto[]; error: string | null }>({ meta: null, users: [], error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    Promise.all([fetch(`${APPOINTMENTS_API}/meta`).then((r) => (r.ok ? r.json() : Promise.reject(r))), fetch("/api/v1/users").then((r) => (r.ok ? r.json() : { data: [] }))])
      .then(([m, u]) => {
        if (!cancelled) setState({ meta: m.data, users: (u.data ?? []).filter((x: { status?: string }) => !x.status || x.status === "ACTIVE"), error: null });
      })
      .catch(() => !cancelled && setState((s) => ({ ...s, error: "Could not load appointment settings." })));
    return () => {
      cancelled = true;
    };
  }, [tick]);
  return { ...state, reload: () => setTick((t) => t + 1) };
}
