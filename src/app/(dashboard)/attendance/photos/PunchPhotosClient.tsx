"use client";

import { useCallback, useEffect, useState } from "react";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { textInputClass } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { apiJson, Card, ErrorText, fmtDbDate, fmtTime, Pill, todayIst } from "../_shared/attendance-ui";
import { useScopedEmployees } from "../_shared/useScopedEmployees";
import { CorrectSessionModal, type CorrectableSession } from "../_shared/CorrectSessionModal";

export interface SessionRow extends CorrectableSession {
  attendanceDate: string;
  status: string;
  source: string;
  isLoginFromOffice: boolean;
  isLogoutFromOffice: boolean;
  inLocation: { name: string } | null;
  outLocation: { name: string } | null;
  inDistanceMeters: number | null;
  outDistanceMeters: number | null;
  inLatitude: number | null;
  inLongitude: number | null;
  outLatitude: number | null;
  outLongitude: number | null;
  hasInSelfie: boolean;
  hasOutSelfie: boolean;
  faceVerifiedIn: boolean;
  faceVerifiedOut: boolean;
  latestRejection: { status: string } | null;
}

export function SessionStatusPill({ status }: { status: string }) {
  if (status === "PRESENT_FROM_OUTSIDE") return <Pill tone="purple">Outside</Pill>;
  if (status === "REMOTE") return <Pill tone="blue">Approved outside</Pill>;
  return <Pill tone="green">Office</Pill>;
}

function Place({ name, distance, lat, lng, fromOffice }: { name?: string | null; distance: number | null; lat: number | null; lng: number | null; fromOffice: boolean }) {
  if (lat === null || lng === null) return <span className="text-zinc-400">—</span>;
  return (
    <div className="text-xs">
      <div className={fromOffice ? "text-emerald-700 dark:text-emerald-400" : "text-violet-700 dark:text-violet-300"}>
        {fromOffice ? name ?? "Office" : "Outside"} {distance !== null && `· ${distance} m from ${fromOffice ? "centre" : name ?? "nearest office"}`}
      </div>
      <a href={`https://www.google.com/maps?q=${lat},${lng}`} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">
        {lat.toFixed(5)}, {lng.toFixed(5)}
      </a>
    </div>
  );
}

export function PunchPhotosClient({ canOverride }: { canOverride: boolean }) {
  const { options } = useScopedEmployees();
  const [employeeId, setEmployeeId] = useState("");
  const [month, setMonth] = useState(() => todayIst().slice(0, 7));
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [correcting, setCorrecting] = useState<SessionRow | null>(null);

  const load = useCallback(() => {
    const qs = new URLSearchParams({ month });
    if (employeeId) qs.set("employeeId", employeeId);
    apiJson<SessionRow[]>(`/api/v1/attendance/sessions?${qs}`)
      .then((r) => {
        setRows(r);
        setError(null);
      })
      .catch((e) => setError(e.message));
  }, [employeeId, month]);
  useEffect(() => {
    load();
  }, [load]);

  const thumb = (id: string, side: "in" | "out") => (
    <button type="button" onClick={() => setPreview(`/api/v1/attendance/sessions/${id}/selfie/${side}`)} className="shrink-0">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/api/v1/attendance/sessions/${id}/selfie/${side}`} alt={`Punch ${side} selfie`} className="h-12 w-12 rounded object-cover ring-1 ring-zinc-200" />
    </button>
  );

  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Attendance", href: "/attendance" }, { label: "Punch Photos" }]} />
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Punch Photos</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Selfies taken at punch in / out, where each punch was made and how far it was from the office.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <div className="w-64">
          <SearchableSelect options={options} value={employeeId} onChange={setEmployeeId} placeholder="All employees" emptyOptionLabel="All employees" />
        </div>
        <input type="month" className={`${textInputClass()} max-w-[12rem]`} value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
      </div>
      <ErrorText message={error} />
      <Card>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
            <thead>
              <tr className="text-left text-xs font-medium uppercase text-zinc-500">
                <th className="px-2 py-2">Employee / Date</th>
                <th className="px-2 py-2">Punch in</th>
                <th className="px-2 py-2">Punch out</th>
                <th className="px-2 py-2">Status</th>
                {canOverride && <th className="px-2 py-2" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-2 py-6 text-center text-zinc-500">
                    No punches found.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.id} className="align-top">
                  <td className="px-2 py-2">
                    <div className="font-medium text-zinc-900 dark:text-zinc-100">{r.employee.fullName}</div>
                    <div className="text-xs text-zinc-500">
                      {r.employee.employeeCode} · {fmtDbDate(r.attendanceDate)}
                    </div>
                    {r.source !== "SELF_PUNCH" && <div className="text-xs text-zinc-500">{r.source === "MANUAL" ? "Added by HR" : "Regularized"}</div>}
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex gap-2">
                      {r.hasInSelfie && thumb(r.id, "in")}
                      <div>
                        <div className="font-medium tabular-nums">{fmtTime(r.checkInAt)}</div>
                        <Place name={r.inLocation?.name} distance={r.inDistanceMeters} lat={r.inLatitude} lng={r.inLongitude} fromOffice={r.isLoginFromOffice} />
                        {r.faceVerifiedIn && <div className="text-xs text-emerald-700">Face matched</div>}
                      </div>
                    </div>
                  </td>
                  <td className="px-2 py-2">
                    {r.checkOutAt ? (
                      <div className="flex gap-2">
                        {r.hasOutSelfie && thumb(r.id, "out")}
                        <div>
                          <div className="font-medium tabular-nums">{fmtTime(r.checkOutAt)}</div>
                          <Place name={r.outLocation?.name} distance={r.outDistanceMeters} lat={r.outLatitude} lng={r.outLongitude} fromOffice={r.isLogoutFromOffice} />
                          {r.faceVerifiedOut && <div className="text-xs text-emerald-700">Face matched</div>}
                        </div>
                      </div>
                    ) : (
                      <span className="text-emerald-700">Still punched in</span>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    <SessionStatusPill status={r.status} />
                    {r.latestRejection && <div className="mt-1 text-xs text-zinc-500">Rejection: {r.latestRejection.status.replace("_", " ").toLowerCase()}</div>}
                  </td>
                  {canOverride && (
                    <td className="px-2 py-2 text-right">
                      <button type="button" className="text-sm font-medium text-indigo-600 hover:text-indigo-500" onClick={() => setCorrecting(r)}>
                        Correct times
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Modal open={preview !== null} onClose={() => setPreview(null)} title="Punch selfie" maxWidthClass="max-w-lg">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {preview && <img src={preview} alt="Punch selfie" className="w-full rounded-md" />}
      </Modal>
      <CorrectSessionModal
        session={correcting}
        onClose={() => setCorrecting(null)}
        onSaved={() => {
          setCorrecting(null);
          load();
        }}
      />
    </div>
  );
}
