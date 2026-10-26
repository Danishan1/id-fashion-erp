"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { FacePunchCamera, type PunchCapture } from "../_shared/FacePunchCamera";
import { apiJson, Card, ErrorText, fmtHours, fmtTime, Pill, Tabs } from "../_shared/attendance-ui";
import { MyMonthCalendar } from "./MyMonthCalendar";
import { MyOvertimeList } from "./MyOvertimeList";
import { MyOutdoorRejections } from "./MyOutdoorRejections";

interface Today {
  employee: { id: string; fullName: string; employeeCode: string; shift: { name: string; startTime: string; endTime: string } | null };
  dateKey: string;
  isPunchedIn: boolean;
  sessions: {
    id: string;
    checkInAt: string;
    checkOutAt: string | null;
    status: string;
    source: string;
    isLoginFromOffice: boolean;
    isLogoutFromOffice: boolean;
    inLocationName: string | null;
    outLocationName: string | null;
  }[];
  finalizedHours: number;
  liveHours: number;
  facePhotoIds: string[];
  hasLocations: boolean;
  rules: { requireFace: boolean; faceMatchThreshold: number; faceMatchFrames: number; gpsAccuracyMeters: number };
}

type TabId = "today" | "month" | "overtime" | "outdoor";

export function MyAttendanceClient({ canEnrolFaces = false }: { canEnrolFaces?: boolean }) {
  const [tab, setTab] = useState<TabId>("today");
  const [today, setToday] = useState<Today | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [punchType, setPunchType] = useState<"IN" | "OUT" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(() => {
    apiJson<Today>("/api/v1/attendance/me/today")
      .then((t) => {
        setToday(t);
        setError(null);
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  // Live hours while punched in.
  useEffect(() => {
    if (!today?.isPunchedIn) return;
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [today?.isPunchedIn]);

  const onCapture = async (c: PunchCapture) => {
    const form = new FormData();
    form.append("type", punchType!);
    form.append("latitude", String(c.latitude));
    form.append("longitude", String(c.longitude));
    form.append("accuracy", String(c.accuracy));
    form.append("address", `${c.latitude.toFixed(6)},${c.longitude.toFixed(6)}`);
    if (c.facePhotoId) form.append("facePhotoId", c.facePhotoId);
    form.append("selfie", new File([c.selfie], `attendance_${Date.now()}.jpg`, { type: "image/jpeg" }));
    const result = await apiJson<{ message: string; fromOffice: boolean; locationName: string | null; distanceMeters: number | null }>("/api/v1/attendance/punch", {
      method: "POST",
      body: form,
    });
    setPunchType(null);
    setMessage(
      `${result.message}. ${result.fromOffice ? `At ${result.locationName ?? "office"}.` : `Outside office (${result.distanceMeters ?? "?"} m from nearest location) — this punch needs approval.`}`
    );
    load();
  };

  // Recompute live hours locally between refreshes.
  const liveHours = (() => {
    if (!today) return 0;
    if (!today.isPunchedIn) return today.finalizedHours;
    const open = today.sessions.find((s) => !s.checkOutAt);
    if (!open) return today.liveHours;
    return today.finalizedHours + Math.max(0, (now - new Date(open.checkInAt).getTime()) / 3_600_000);
  })();

  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "My Attendance" }]} />
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">My Attendance</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Punch in and out with a live selfie and your location.</p>
        </div>
        <div className="flex gap-2 text-sm">
          <Link href="/attendance-corrections" className="font-medium text-indigo-600 hover:text-indigo-500">
            Regularization
          </Link>
          <span className="text-zinc-300">|</span>
          <Link href="/leave-requests" className="font-medium text-indigo-600 hover:text-indigo-500">
            My Leaves
          </Link>
        </div>
      </div>
      <Tabs<TabId>
        tabs={[
          { id: "today", label: "Today" },
          { id: "month", label: "My Month" },
          { id: "overtime", label: "My Overtime" },
          { id: "outdoor", label: "Outdoor Rejections" },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === "today" && (
        <>
          <ErrorText message={error} />
          {message && <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">{message}</p>}
          {today && (
            <>
              <Card>
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <div className="text-sm text-zinc-500">
                      {today.employee.fullName} · {today.employee.employeeCode}
                    </div>
                    <div className="mt-1 text-3xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">{fmtHours(liveHours)}</div>
                    <div className="mt-1 text-xs text-zinc-500">
                      Worked today{today.employee.shift ? ` · Shift ${today.employee.shift.name} ${today.employee.shift.startTime}–${today.employee.shift.endTime}` : " · No shift assigned"}
                    </div>
                  </div>
                  <div className="flex flex-col items-stretch gap-2 sm:items-end">
                    {today.isPunchedIn ? <Pill tone="green">Punched in</Pill> : <Pill>Not punched in</Pill>}
                    <Button size="lg" variant={today.isPunchedIn ? "danger" : "success"} disabled={!today.hasLocations} onClick={() => setPunchType(today.isPunchedIn ? "OUT" : "IN")}>
                      {today.isPunchedIn ? "Punch Out" : "Punch In"}
                    </Button>
                    {!today.hasLocations && <span className="text-xs text-amber-700">No office location set up yet — ask HR.</span>}
                  </div>
                </div>
              </Card>
              <Card title="Today's sessions">
                {today.sessions.length === 0 ? (
                  <p className="text-sm text-zinc-500">No punches yet today.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs uppercase text-zinc-500">
                          <th className="py-2 pr-3">In</th>
                          <th className="py-2 pr-3">Out</th>
                          <th className="py-2 pr-3">Place</th>
                          <th className="py-2 pr-3">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                        {today.sessions.map((s) => (
                          <tr key={s.id}>
                            <td className="py-2 pr-3 tabular-nums">{fmtTime(s.checkInAt)}</td>
                            <td className="py-2 pr-3 tabular-nums">{s.checkOutAt ? fmtTime(s.checkOutAt) : <span className="text-emerald-700">running</span>}</td>
                            <td className="py-2 pr-3">
                              {s.source !== "SELF_PUNCH" ? (s.source === "MANUAL" ? "Added by HR" : "Regularized") : s.isLoginFromOffice ? s.inLocationName ?? "Office" : "Outside office"}
                            </td>
                            <td className="py-2 pr-3">{s.status === "PRESENT_FROM_OUTSIDE" ? <Pill tone="purple">Outside</Pill> : <Pill tone="green">Present</Pill>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </>
          )}
        </>
      )}
      {tab === "month" && <MyMonthCalendar />}
      {tab === "overtime" && <MyOvertimeList />}
      {tab === "outdoor" && <MyOutdoorRejections />}
      <Modal open={punchType !== null && !!today} onClose={() => setPunchType(null)} title={punchType === "IN" ? "Punch In" : "Punch Out"} maxWidthClass="max-w-lg">
        {punchType && today && (
          <FacePunchCamera
            type={punchType}
            facePhotoIds={today.facePhotoIds}
            enrolHref={canEnrolFaces ? `/attendance/face-enrolment/${today.employee.id}` : null}
            requireFace={today.rules.requireFace}
            threshold={today.rules.faceMatchThreshold}
            frames={today.rules.faceMatchFrames}
            gpsAccuracyMeters={today.rules.gpsAccuracyMeters}
            onCapture={onCapture}
            onCancel={() => setPunchType(null)}
          />
        )}
      </Modal>
    </div>
  );
}
