"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { Button } from "@/components/ui/Button";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";
import { apiJson, Card, ErrorText, Pill, Tabs, WeekdayPicker, weekdayShort } from "../_shared/attendance-ui";

type TabId = "general" | "locations" | "employees" | "holidays";

interface Settings {
  defaultWeekends: string[];
  gpsAccuracyMeters: number;
  maxSessionHours: number;
  statusToleranceMinutes: number;
  faceMatchThreshold: number;
  faceMatchFrames: number;
  requireFace: boolean;
}

interface Location {
  id: string;
  name: string;
  code: string | null;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  address: string | null;
  branchId: string | null;
  isActive: boolean;
}

interface EmployeeProfile {
  id: string;
  employeeCode: string;
  fullName: string;
  hasLogin: boolean;
  shift: { name: string; startTime: string; endTime: string } | null;
  facePhotoCount: number;
  useCompanyWeekends: boolean;
  weekends: string[];
  effectiveWeekends: string[];
  overtimeRatePerHour: number | null;
}

export function AttendanceSettingsClient() {
  const [tab, setTab] = useState<TabId>("general");
  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Attendance", href: "/attendance" }, { label: "Settings" }]} />
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Attendance Settings</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Punch rules, office locations (GPS geofence), weekly offs and overtime rates.</p>
      </div>
      <Tabs<TabId>
        tabs={[
          { id: "general", label: "General" },
          { id: "locations", label: "Office Locations" },
          { id: "employees", label: "Employees" },
          { id: "holidays", label: "Holidays & Shifts" },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === "general" && <GeneralTab />}
      {tab === "locations" && <LocationsTab />}
      {tab === "employees" && <EmployeesTab />}
      {tab === "holidays" && (
        <Card title="Holidays and shift timings">
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            Company holidays and shift timings (Login / Logout time and grace minutes) are kept in{" "}
            <Link href="/masters/hr-config" className="font-medium text-indigo-600 hover:text-indigo-500">
              Masters → HR Configuration
            </Link>
            . Each employee&apos;s shift is set on the employee form. Holidays and weekly offs are never counted as absent, and shift hours are used for the day status and overtime.
          </p>
        </Card>
      )}
    </div>
  );
}

function GeneralTab() {
  const [form, setForm] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmApply, setConfirmApply] = useState(false);

  useEffect(() => {
    apiJson<Settings>("/api/v1/attendance/settings").then(setForm).catch((e) => setError(e.message));
  }, []);

  if (!form) return error ? <ErrorText message={error} /> : <p className="text-sm text-zinc-500">Loading…</p>;

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setForm({ ...form, [key]: value });
  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      setForm(await apiJson<Settings>("/api/v1/attendance/settings", { method: "PUT", body: JSON.stringify(form) }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const applyToAll = async () => {
    setConfirmApply(false);
    try {
      setForm(await apiJson<Settings>("/api/v1/attendance/settings/apply-weekends", { method: "POST", body: JSON.stringify({ weekends: form.defaultWeekends }) }));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="space-y-4">
      <ErrorText message={error} />
      <Card title="Weekly off (company default)">
        <WeekdayPicker value={form.defaultWeekends} onChange={(v) => set("defaultWeekends", v)} />
        <p className="mt-2 text-xs text-zinc-500">Used for every employee who has not been given their own weekly off in the Employees tab.</p>
        <div className="mt-3">
          <Button variant="secondary" size="xs" onClick={() => setConfirmApply(true)}>
            Apply to all employees
          </Button>
        </div>
      </Card>
      <Card title="Punch rules">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <FormField label="Required GPS accuracy (metres)" htmlFor="gps">
            <input id="gps" type="number" min={5} className={textInputClass()} value={form.gpsAccuracyMeters} onChange={(e) => set("gpsAccuracyMeters", Number(e.target.value))} />
          </FormField>
          <FormField label="Longest normal session (hours)" htmlFor="maxh">
            <input id="maxh" type="number" min={1} max={24} className={textInputClass()} value={form.maxSessionHours} onChange={(e) => set("maxSessionHours", Number(e.target.value))} />
          </FormField>
          <FormField label="Status tolerance (minutes)" htmlFor="tol">
            <input id="tol" type="number" min={0} className={textInputClass()} value={form.statusToleranceMinutes} onChange={(e) => set("statusToleranceMinutes", Number(e.target.value))} />
          </FormField>
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          Day status from hours worked against shift hours: full shift = Present, 75% = 0.75 day, 50% = Half day, less = Low hours. Each band is lowered by the tolerance.
        </p>
      </Card>
      <Card title="Face recognition">
        <div className="flex items-center gap-3">
          <ToggleSwitch checked={form.requireFace} onToggle={() => set("requireFace", !form.requireFace)} label="Require face match" />
          <span className="text-sm text-zinc-700 dark:text-zinc-200">Require a face match before a punch is accepted</span>
        </div>
        <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <FormField label="Match threshold (lower is stricter)" htmlFor="thr">
            <input id="thr" type="number" step="0.01" min={0.2} max={0.8} className={textInputClass()} value={form.faceMatchThreshold} onChange={(e) => set("faceMatchThreshold", Number(e.target.value))} />
          </FormField>
          <FormField label="Matching frames in a row" htmlFor="frames">
            <input id="frames" type="number" min={1} max={10} className={textInputClass()} value={form.faceMatchFrames} onChange={(e) => set("faceMatchFrames", Number(e.target.value))} />
          </FormField>
        </div>
      </Card>
      <div>
        <Button onClick={save} isLoading={saving} loadingLabel="Saving…">
          Save settings
        </Button>
      </div>
      <ConfirmModal
        open={confirmApply}
        title="Apply weekly off to everyone?"
        message={`Every employee will use the company weekly off (${form.defaultWeekends.map(weekdayShort).join(", ") || "none"}). Their own weekly-off settings will be switched off.`}
        confirmLabel="Apply"
        onConfirm={applyToAll}
        onCancel={() => setConfirmApply(false)}
      />
    </div>
  );
}

const EMPTY_LOCATION = { name: "", code: "", latitude: "", longitude: "", radiusMeters: "100", address: "" };

function LocationsTab() {
  const [rows, setRows] = useState<Location[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Location | "new" | null>(null);
  const [form, setForm] = useState(EMPTY_LOCATION);
  const [formError, setFormError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [toggle, setToggle] = useState<Location | null>(null);

  const load = useCallback(() => {
    apiJson<Location[]>("/api/v1/attendance/locations").then(setRows).catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const open = (loc: Location | "new") => {
    setEditing(loc);
    setFormError(null);
    setForm(
      loc === "new"
        ? EMPTY_LOCATION
        : { name: loc.name, code: loc.code ?? "", latitude: String(loc.latitude), longitude: String(loc.longitude), radiusMeters: String(loc.radiusMeters), address: loc.address ?? "" }
    );
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      setFormError("This browser can't share its location.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        setForm((f) => ({ ...f, latitude: pos.coords.latitude.toFixed(7), longitude: pos.coords.longitude.toFixed(7) }));
      },
      (err) => {
        setLocating(false);
        setFormError(`Could not read your location: ${err.message}`);
      },
      { enableHighAccuracy: true, timeout: 20000 }
    );
  };

  const save = async () => {
    setFormError(null);
    const body = JSON.stringify({ ...form, latitude: Number(form.latitude), longitude: Number(form.longitude), radiusMeters: Number(form.radiusMeters) });
    try {
      if (editing === "new") await apiJson("/api/v1/attendance/locations", { method: "POST", body });
      else if (editing) await apiJson(`/api/v1/attendance/locations/${editing.id}`, { method: "PATCH", body });
      setEditing(null);
      load();
    } catch (e) {
      setFormError((e as Error).message);
    }
  };

  const doToggle = async () => {
    if (!toggle) return;
    const loc = toggle;
    setToggle(null);
    try {
      await apiJson(`/api/v1/attendance/locations/${loc.id}`, { method: "PATCH", body: JSON.stringify({ isActive: !loc.isActive }) });
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Card
      title="Office / factory locations"
      actions={
        <Button size="xs" onClick={() => open("new")}>
          + Add location
        </Button>
      }
    >
      <ErrorText message={error} />
      <p className="mb-3 text-xs text-zinc-500">
        A punch inside the radius of any active location counts as &quot;from office&quot;; the nearest location wins. Outside every location, the punch is marked &quot;Outside&quot; for approval. At least one active location is needed before anyone can punch.
      </p>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
          <thead>
            <tr className="text-left text-xs font-medium uppercase text-zinc-500">
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Latitude, Longitude</th>
              <th className="px-3 py-2">Radius</th>
              <th className="px-3 py-2">Address</th>
              <th className="px-3 py-2">Active</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-zinc-500">
                  No office locations yet.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="px-3 py-2 font-medium text-zinc-900 dark:text-zinc-100">
                  {r.name} {r.code && <span className="text-xs text-zinc-500">({r.code})</span>}
                </td>
                <td className="px-3 py-2 font-mono text-xs">
                  <a className="text-indigo-600 hover:underline" target="_blank" rel="noreferrer" href={`https://www.google.com/maps?q=${r.latitude},${r.longitude}`}>
                    {r.latitude.toFixed(6)}, {r.longitude.toFixed(6)}
                  </a>
                </td>
                <td className="px-3 py-2">{r.radiusMeters} m</td>
                <td className="px-3 py-2 text-zinc-600 dark:text-zinc-300">{r.address ?? "—"}</td>
                <td className="px-3 py-2">
                  <ToggleSwitch checked={r.isActive} onToggle={() => setToggle(r)} />
                </td>
                <td className="px-3 py-2 text-right">
                  <button type="button" className="text-sm font-medium text-indigo-600 hover:text-indigo-500" onClick={() => open(r)}>
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "Add office location" : "Edit office location"}>
        <div className="space-y-3">
          <ErrorText message={formError} />
          <FormField label="Name" htmlFor="loc-name" required>
            <input id="loc-name" className={textInputClass()} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </FormField>
          <FormField label="Code" htmlFor="loc-code">
            <input id="loc-code" className={textInputClass()} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Latitude" htmlFor="loc-lat" required>
              <input id="loc-lat" className={textInputClass()} value={form.latitude} onChange={(e) => setForm({ ...form, latitude: e.target.value })} />
            </FormField>
            <FormField label="Longitude" htmlFor="loc-lng" required>
              <input id="loc-lng" className={textInputClass()} value={form.longitude} onChange={(e) => setForm({ ...form, longitude: e.target.value })} />
            </FormField>
          </div>
          <Button variant="secondary" size="xs" onClick={useMyLocation} isLoading={locating} loadingLabel="Reading location…">
            Use my current location
          </Button>
          <FormField label="Radius (metres, minimum 10)" htmlFor="loc-radius" required>
            <input id="loc-radius" type="number" min={10} className={textInputClass()} value={form.radiusMeters} onChange={(e) => setForm({ ...form, radiusMeters: e.target.value })} />
          </FormField>
          <FormField label="Address" htmlFor="loc-address">
            <textarea id="loc-address" rows={2} className={textInputClass()} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </FormField>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={save}>Save</Button>
          </div>
        </div>
      </Modal>
      <ConfirmModal
        open={toggle !== null}
        title={toggle?.isActive ? "Deactivate location?" : "Activate location?"}
        message={toggle?.isActive ? `Punches will no longer be matched to "${toggle?.name}".` : `Punches will be matched to "${toggle?.name}" again.`}
        confirmLabel={toggle?.isActive ? "Deactivate" : "Activate"}
        isDangerous={toggle?.isActive}
        onConfirm={doToggle}
        onCancel={() => setToggle(null)}
      />
    </Card>
  );
}

function EmployeesTab() {
  const [rows, setRows] = useState<EmployeeProfile[]>([]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<EmployeeProfile | null>(null);
  const [form, setForm] = useState({ useCompanyWeekends: true, weekends: [] as string[], overtimeRatePerHour: "" });
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(() => {
    apiJson<EmployeeProfile[]>(`/api/v1/attendance/profiles${search ? `?search=${encodeURIComponent(search)}` : ""}`)
      .then(setRows)
      .catch((e) => setError(e.message));
  }, [search]);
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const open = (row: EmployeeProfile) => {
    setEditing(row);
    setFormError(null);
    setForm({ useCompanyWeekends: row.useCompanyWeekends, weekends: row.weekends, overtimeRatePerHour: row.overtimeRatePerHour?.toString() ?? "" });
  };
  const save = async () => {
    if (!editing) return;
    try {
      await apiJson(`/api/v1/attendance/profiles/${editing.id}`, {
        method: "PUT",
        body: JSON.stringify({ useCompanyWeekends: form.useCompanyWeekends, weekends: form.weekends, overtimeRatePerHour: form.overtimeRatePerHour === "" ? null : Number(form.overtimeRatePerHour) }),
      });
      setEditing(null);
      load();
    } catch (e) {
      setFormError((e as Error).message);
    }
  };

  return (
    <Card title="Employees">
      <ErrorText message={error} />
      <input placeholder="Search name or code…" className={`${textInputClass()} mb-3 max-w-xs`} value={search} onChange={(e) => setSearch(e.target.value)} />
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
          <thead>
            <tr className="text-left text-xs font-medium uppercase text-zinc-500">
              <th className="px-3 py-2">Employee</th>
              <th className="px-3 py-2">Login</th>
              <th className="px-3 py-2">Shift</th>
              <th className="px-3 py-2">Weekly off</th>
              <th className="px-3 py-2">OT rate / hour</th>
              <th className="px-3 py-2">Face photos</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="px-3 py-2">
                  <div className="font-medium text-zinc-900 dark:text-zinc-100">{r.fullName}</div>
                  <div className="text-xs text-zinc-500">{r.employeeCode}</div>
                </td>
                <td className="px-3 py-2">{r.hasLogin ? <Pill tone="green">Yes</Pill> : <Pill>No</Pill>}</td>
                <td className="px-3 py-2">{r.shift ? `${r.shift.name} (${r.shift.startTime}–${r.shift.endTime})` : <span className="text-amber-700">No shift (8 h assumed)</span>}</td>
                <td className="px-3 py-2">
                  {r.effectiveWeekends.map(weekdayShort).join(", ") || "None"}
                  {r.useCompanyWeekends && <span className="ml-1 text-xs text-zinc-500">(company)</span>}
                </td>
                <td className="px-3 py-2">{r.overtimeRatePerHour !== null ? `₹${r.overtimeRatePerHour}` : <span className="text-zinc-500">Not set (no OT)</span>}</td>
                <td className="px-3 py-2">
                  <Link href={`/attendance/face-enrolment/${r.id}`} className="text-indigo-600 hover:text-indigo-500">
                    {r.facePhotoCount}/3 — Enrol
                  </Link>
                </td>
                <td className="px-3 py-2 text-right">
                  <button type="button" className="text-sm font-medium text-indigo-600 hover:text-indigo-500" onClick={() => open(r)}>
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Modal open={editing !== null} onClose={() => setEditing(null)} title={`Attendance settings — ${editing?.fullName ?? ""}`}>
        <div className="space-y-3">
          <ErrorText message={formError} />
          <div className="flex items-center gap-3">
            <ToggleSwitch checked={form.useCompanyWeekends} onToggle={() => setForm({ ...form, useCompanyWeekends: !form.useCompanyWeekends })} label="Use company weekly off" />
            <span className="text-sm">Use the company weekly off</span>
          </div>
          {!form.useCompanyWeekends && (
            <FormField label="Own weekly off" htmlFor="emp-weekends">
              <WeekdayPicker value={form.weekends} onChange={(weekends) => setForm({ ...form, weekends })} />
            </FormField>
          )}
          <FormField label="Overtime rate per hour (₹) — leave empty for no overtime" htmlFor="emp-ot">
            <input id="emp-ot" type="number" min={0} step="0.01" className={textInputClass()} value={form.overtimeRatePerHour} onChange={(e) => setForm({ ...form, overtimeRatePerHour: e.target.value })} />
          </FormField>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={save}>Save</Button>
          </div>
        </div>
      </Modal>
    </Card>
  );
}
