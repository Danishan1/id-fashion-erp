"use client";

import { useEffect, useState } from "react";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";
import { invalidateActionDisplayCache, type ActionDisplayMode, type ActionTextStyle } from "@/lib/use-action-display";

async function parseJson(res: Response) {
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error?.message ?? "Request failed");
  return body;
}

/**
 * Company-wide row-action display: icon-only (default) or a text label —
 * and if text, a plain link or a bordered button. Read by the shared
 * RowAction component every list page in the app uses. Same self-contained
 * fetch-on-mount/toggle-and-PATCH shape as AI Configuration's own
 * ProductDesignDisplayModeSetting.
 */
function ActionDisplaySettingsSection({ canManage }: { canManage: boolean }) {
  const [settings, setSettings] = useState<{ displayMode: ActionDisplayMode; textStyle: ActionTextStyle } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/v1/action-display-settings")
      .then(parseJson)
      .then((body) => setSettings(body.data))
      .catch((e) => setError(e.message));
  }, []);

  async function update(patch: Partial<{ displayMode: ActionDisplayMode; textStyle: ActionTextStyle }>) {
    if (!settings) return;
    setSaving(true);
    setError(null);
    try {
      const body = await parseJson(
        await fetch("/api/v1/action-display-settings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        })
      );
      setSettings(body.data);
      invalidateActionDisplayCache(body.data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mb-4 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">Action Display</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            How row actions (Edit/View/BOM/Remove/...) render across every list in the app.
          </p>
        </div>
        {settings && (
          <ToggleSwitch
            checked={settings.displayMode === "ICON"}
            disabled={!canManage || saving}
            label={settings.displayMode === "ICON" ? "Icons — click for text" : "Text — click for icons"}
            onToggle={() => update({ displayMode: settings.displayMode === "ICON" ? "TEXT" : "ICON" })}
          />
        )}
      </div>
      {settings?.displayMode === "TEXT" && (
        <div className="mt-2 flex items-center justify-between border-t border-zinc-100 pt-2 dark:border-zinc-800">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Text actions show as</p>
          <ToggleSwitch
            checked={settings.textStyle === "LINK"}
            disabled={!canManage || saving}
            label={settings.textStyle === "LINK" ? "Link — click for button" : "Button — click for link"}
            onToggle={() => update({ textStyle: settings.textStyle === "LINK" ? "BUTTON" : "LINK" })}
          />
        </div>
      )}
      {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

interface ProductionSettingsValue {
  supervisorApprovalRequired: boolean;
  externalEntryBy: "EXTERNAL_UNIT_USER" | "INTERNAL_SUPERVISOR" | "BOTH";
  pieceRateTrackingEnabled: boolean;
  pieceRatePaymentQuantityRule: "GOOD_COMPLETED_QTY" | "QC_ACCEPTED_QTY";
  workersCanViewOwnRate: boolean;
}

/**
 * Production Module Advanced Upgrade (2026-09-18) — company-wide toggles for
 * the supervisor-approval-required integrity gate, the External Unit Job
 * Work entry source, and the Piece-Rate engine's own on/off + payment
 * quantity rule + worker-visibility settings. Same self-contained
 * fetch-on-mount/toggle-and-PUT shape as ActionDisplaySettingsSection above.
 */
function ProductionSettingsSection({ canManage }: { canManage: boolean }) {
  const [settings, setSettings] = useState<ProductionSettingsValue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/v1/production-settings")
      .then(parseJson)
      .then((body) => setSettings(body.data))
      .catch((e) => setError(e.message));
  }, []);

  async function update(patch: Partial<ProductionSettingsValue>) {
    if (!settings) return;
    setSaving(true);
    setError(null);
    try {
      const body = await parseJson(
        await fetch("/api/v1/production-settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        })
      );
      setSettings(body.data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (!settings) return null;

  return (
    <div className="mb-4 space-y-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">Production Settings</p>

      <div className="flex items-center justify-between border-t border-zinc-100 pt-2 dark:border-zinc-800">
        <div>
          <p className="text-xs text-zinc-700 dark:text-zinc-300">Require Supervisor approval for all progress entries</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            When on, even a Supervisor&apos;s own direct entries wait for a second person&apos;s approval before counting.
          </p>
        </div>
        <ToggleSwitch
          checked={settings.supervisorApprovalRequired}
          disabled={!canManage || saving}
          label={settings.supervisorApprovalRequired ? "Required" : "Not required"}
          onToggle={() => update({ supervisorApprovalRequired: !settings.supervisorApprovalRequired })}
        />
      </div>

      <div className="flex items-center justify-between border-t border-zinc-100 pt-2 dark:border-zinc-800">
        <div>
          <p className="text-xs text-zinc-700 dark:text-zinc-300">External Job-Work entry</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Who may submit a Job Work receipt for an external unit.</p>
        </div>
        <select
          className={textInputClass() + " w-56"}
          disabled={!canManage || saving}
          value={settings.externalEntryBy}
          onChange={(e) => update({ externalEntryBy: e.target.value as ProductionSettingsValue["externalEntryBy"] })}
        >
          <option value="INTERNAL_SUPERVISOR">Internal Supervisor only</option>
          <option value="EXTERNAL_UNIT_USER">External Unit User only</option>
          <option value="BOTH">Both</option>
        </select>
      </div>

      <div className="flex items-center justify-between border-t border-zinc-100 pt-2 dark:border-zinc-800">
        <div>
          <p className="text-xs text-zinc-700 dark:text-zinc-300">Piece-Rate tracking</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Resolves and snapshots a worker/unit&apos;s piece rate at assignment time, and generates an Earning Ledger.
          </p>
        </div>
        <ToggleSwitch
          checked={settings.pieceRateTrackingEnabled}
          disabled={!canManage || saving}
          label={settings.pieceRateTrackingEnabled ? "Enabled" : "Disabled"}
          onToggle={() => update({ pieceRateTrackingEnabled: !settings.pieceRateTrackingEnabled })}
        />
      </div>

      {settings.pieceRateTrackingEnabled && (
        <>
          <div className="flex items-center justify-between border-t border-zinc-100 pt-2 dark:border-zinc-800">
            <p className="text-xs text-zinc-700 dark:text-zinc-300">Payment quantity rule</p>
            <select
              className={textInputClass() + " w-56"}
              disabled={!canManage || saving}
              value={settings.pieceRatePaymentQuantityRule}
              onChange={(e) => update({ pieceRatePaymentQuantityRule: e.target.value as ProductionSettingsValue["pieceRatePaymentQuantityRule"] })}
            >
              <option value="QC_ACCEPTED_QTY">QC-accepted quantity (recommended)</option>
              <option value="GOOD_COMPLETED_QTY">Good-completed quantity</option>
            </select>
          </div>
          <div className="flex items-center justify-between border-t border-zinc-100 pt-2 dark:border-zinc-800">
            <p className="text-xs text-zinc-700 dark:text-zinc-300">Workers can view their own rate</p>
            <ToggleSwitch
              checked={settings.workersCanViewOwnRate}
              disabled={!canManage || saving}
              label={settings.workersCanViewOwnRate ? "Allowed" : "Not allowed"}
              onToggle={() => update({ workersCanViewOwnRate: !settings.workersCanViewOwnRate })}
            />
          </div>
        </>
      )}
      {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

interface DispatchSettingsValue {
  allowExtraDispatch: boolean;
  extraDispatchApprovalRequired: boolean;
  extraDispatchApprovalThresholdQty: number | null;
  extraDispatchApprovalThresholdPercent: number | null;
}

/**
 * Extra Dispatch Quantity (2026-09-30) — company-wide toggles for whether a
 * dispatch may ship more than a sales order's own remaining quantity at all,
 * and when that extra requires a distinct Management sign-off before the
 * dispatch can be confirmed (a blanket requirement, and/or either
 * threshold). Same self-contained fetch-on-mount/toggle-and-PUT shape as
 * ProductionSettingsSection above.
 */
function DispatchSettingsSection({ canManage }: { canManage: boolean }) {
  const [settings, setSettings] = useState<DispatchSettingsValue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [thresholdQtyInput, setThresholdQtyInput] = useState("");
  const [thresholdPercentInput, setThresholdPercentInput] = useState("");

  useEffect(() => {
    fetch("/api/v1/dispatch-settings")
      .then(parseJson)
      .then((body) => {
        setSettings(body.data);
        setThresholdQtyInput(body.data.extraDispatchApprovalThresholdQty?.toString() ?? "");
        setThresholdPercentInput(body.data.extraDispatchApprovalThresholdPercent?.toString() ?? "");
      })
      .catch((e) => setError(e.message));
  }, []);

  async function update(patch: Partial<DispatchSettingsValue>) {
    if (!settings) return;
    setSaving(true);
    setError(null);
    try {
      const body = await parseJson(
        await fetch("/api/v1/dispatch-settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        })
      );
      setSettings(body.data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (!settings) return null;

  return (
    <div className="mb-4 space-y-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">Extra Dispatch Quantity</p>

      <div className="flex items-center justify-between border-t border-zinc-100 pt-2 dark:border-zinc-800">
        <div>
          <p className="text-xs text-zinc-700 dark:text-zinc-300">Allow dispatching more than the sales order quantity</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            When off, a dispatch line is hard-capped at what remains against its sales order — no extra dispatch at all.
          </p>
        </div>
        <ToggleSwitch
          checked={settings.allowExtraDispatch}
          disabled={!canManage || saving}
          label={settings.allowExtraDispatch ? "Allowed" : "Not allowed"}
          onToggle={() => update({ allowExtraDispatch: !settings.allowExtraDispatch })}
        />
      </div>

      {settings.allowExtraDispatch && (
        <>
          <div className="flex items-center justify-between border-t border-zinc-100 pt-2 dark:border-zinc-800">
            <div>
              <p className="text-xs text-zinc-700 dark:text-zinc-300">Always require Management approval for any extra</p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                A distinct sign-off from Reason/Remarks — the dispatch&apos;s own creator can never approve their own extra
                quantity.
              </p>
            </div>
            <ToggleSwitch
              checked={settings.extraDispatchApprovalRequired}
              disabled={!canManage || saving}
              label={settings.extraDispatchApprovalRequired ? "Required" : "Not required"}
              onToggle={() => update({ extraDispatchApprovalRequired: !settings.extraDispatchApprovalRequired })}
            />
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-zinc-100 pt-2 dark:border-zinc-800">
            <p className="text-xs text-zinc-700 dark:text-zinc-300">Or require approval above this many extra pieces</p>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                placeholder="No limit"
                disabled={!canManage || saving}
                value={thresholdQtyInput}
                onChange={(e) => setThresholdQtyInput(e.target.value)}
                onBlur={() =>
                  update({ extraDispatchApprovalThresholdQty: thresholdQtyInput.trim() === "" ? null : Number(thresholdQtyInput) })
                }
                className={textInputClass() + " w-28"}
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-zinc-100 pt-2 dark:border-zinc-800">
            <p className="text-xs text-zinc-700 dark:text-zinc-300">Or require approval above this % of the dispatch</p>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={100}
                placeholder="No limit"
                disabled={!canManage || saving}
                value={thresholdPercentInput}
                onChange={(e) => setThresholdPercentInput(e.target.value)}
                onBlur={() =>
                  update({
                    extraDispatchApprovalThresholdPercent: thresholdPercentInput.trim() === "" ? null : Number(thresholdPercentInput),
                  })
                }
                className={textInputClass() + " w-28"}
              />
            </div>
          </div>
        </>
      )}
      {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

interface CompanyData {
  name: string;
  legalName: string | null;
  taxRegistrationNo: string | null;
  baseCurrencyCode: string;
  fiscalYearStartMonth: number;
  addressJson: { line1?: string } | null;
}

export function AdminCompanySettingsPanel({ canManage }: { canManage: boolean }) {
  const [form, setForm] = useState({ name: "", legalName: "", taxRegistrationNo: "", fiscalYearStartMonth: 1, addressLine: "" });
  const [baseCurrencyCode, setBaseCurrencyCode] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    fetch("/api/v1/administration/company")
      .then((res) => res.json())
      .then((body: { data: CompanyData }) => {
        const c = body.data;
        setForm({
          name: c.name,
          legalName: c.legalName ?? "",
          taxRegistrationNo: c.taxRegistrationNo ?? "",
          fiscalYearStartMonth: c.fiscalYearStartMonth,
          addressLine: c.addressJson?.line1 ?? "",
        });
        setBaseCurrencyCode(c.baseCurrencyCode);
      })
      .finally(() => setIsLoading(false));
  }, []);

  async function handleSave() {
    setIsSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/v1/administration/company", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message ?? "Failed to save company settings");
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save company settings");
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) return <p className="text-sm text-zinc-400">Loading…</p>;

  return (
    <div className="max-w-lg space-y-3">
      <ActionDisplaySettingsSection canManage={canManage} />
      <ProductionSettingsSection canManage={canManage} />
      <DispatchSettingsSection canManage={canManage} />
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {saved && <p className="text-sm text-emerald-600 dark:text-emerald-400">Saved.</p>}

      <FormField label="Company Name" htmlFor="companyName" required>
        <input
          id="companyName"
          disabled={!canManage}
          className={textInputClass()}
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
      </FormField>
      <FormField label="Legal Name" htmlFor="legalName">
        <input
          id="legalName"
          disabled={!canManage}
          className={textInputClass()}
          value={form.legalName}
          onChange={(e) => setForm({ ...form, legalName: e.target.value })}
        />
      </FormField>
      <FormField label="Tax Registration No." htmlFor="taxRegNo">
        <input
          id="taxRegNo"
          disabled={!canManage}
          className={textInputClass()}
          value={form.taxRegistrationNo}
          onChange={(e) => setForm({ ...form, taxRegistrationNo: e.target.value })}
        />
      </FormField>
      <FormField label="Base Currency" htmlFor="baseCurrency">
        <input id="baseCurrency" disabled className={textInputClass()} value={baseCurrencyCode} />
        <p className="mt-1 text-xs text-zinc-400">
          Not editable here — every posted financial document freezes its currency against this value; changing it after real
          transactions exist would misrepresent historical reports.
        </p>
      </FormField>
      <FormField label="Fiscal Year Start Month" htmlFor="fyStart" required>
        <select
          id="fyStart"
          disabled={!canManage}
          className={textInputClass()}
          value={form.fiscalYearStartMonth}
          onChange={(e) => setForm({ ...form, fiscalYearStartMonth: Number(e.target.value) })}
        >
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <option key={m} value={m}>
              {new Date(2000, m - 1, 1).toLocaleString("en-IN", { month: "long" })}
            </option>
          ))}
        </select>
      </FormField>
      <FormField label="Address" htmlFor="companyAddress">
        <input
          id="companyAddress"
          disabled={!canManage}
          className={textInputClass()}
          value={form.addressLine}
          onChange={(e) => setForm({ ...form, addressLine: e.target.value })}
        />
      </FormField>

      {canManage && (
        <div className="flex justify-end pt-2">
          <button
            type="button"
            disabled={isSaving || !form.name}
            onClick={handleSave}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
          >
            {isSaving ? "Saving…" : "Save"}
          </button>
        </div>
      )}
    </div>
  );
}
