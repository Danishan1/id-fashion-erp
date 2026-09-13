"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { PROVIDER_TYPE_VALUES, CAPABILITY_VALUES } from "@/modules/ai-providers/ai-provider.schema";

interface ProviderRow {
  id: string;
  name: string;
  providerType: (typeof PROVIDER_TYPE_VALUES)[number];
  model: string;
  baseUrl: string | null;
  isActive: boolean;
  priority: number;
  autoFailoverEnabled: boolean;
  dailyGenerationLimit: number | null;
  monthlyGenerationLimit: number | null;
  requestTimeoutMs: number;
  maxRetryCount: number;
  capabilities: (typeof CAPABILITY_VALUES)[number][];
  healthStatus: "HEALTHY" | "RATE_LIMITED" | "QUOTA_EXHAUSTED" | "UNAVAILABLE" | "AUTH_ERROR" | "DISABLED";
  cooldownUntil: string | null;
  hasApiKey: boolean;
  apiKeyMasked: string | null;
}

interface UsageRow {
  id: string;
  name: string;
  providerType: string;
  isActive: boolean;
  healthStatus: string;
  usedToday: number;
  usedThisMonth: number;
  dailyGenerationLimit: number | null;
  monthlyGenerationLimit: number | null;
  providerBalance: null;
}

interface FailoverLogRow {
  id: string;
  requestedProvider: { id: string; name: string } | null;
  fallbackProvider: { id: string; name: string } | null;
  reason: string;
  generationContext: string;
  result: "SUCCESS" | "FAILED";
  createdAt: string;
}

const HEALTH_BADGE_CLASS: Record<string, string> = {
  HEALTHY: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  RATE_LIMITED: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  QUOTA_EXHAUSTED: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  UNAVAILABLE: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  AUTH_ERROR: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  DISABLED: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
};

const EMPTY_FORM = {
  name: "",
  providerType: "OPENAI" as (typeof PROVIDER_TYPE_VALUES)[number],
  apiKey: "",
  model: "",
  baseUrl: "",
  isActive: true,
  priority: 100,
  autoFailoverEnabled: true,
  dailyGenerationLimit: "",
  monthlyGenerationLimit: "",
  requestTimeoutMs: 120000,
  maxRetryCount: 1,
  capabilities: [] as string[],
};

async function parseJson(res: Response) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.message ?? "Request failed.");
  return body;
}

function ProductDesignDisplayModeSetting({ canManage }: { canManage: boolean }) {
  const [mode, setMode] = useState<"CLIPART" | "TEXT" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/v1/ai-designer/settings")
      .then(parseJson)
      .then((body) => setMode(body.data.productDesignDisplayMode))
      .catch((e) => setError(e.message));
  }, []);

  const toggle = async () => {
    if (!mode) return;
    const next = mode === "CLIPART" ? "TEXT" : "CLIPART";
    setSaving(true);
    setError(null);
    try {
      const body = await parseJson(
        await fetch("/api/v1/ai-designer/settings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ productDesignDisplayMode: next }),
        })
      );
      setMode(body.data.productDesignDisplayMode);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">Product Design Attribute Display</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Choose how the Product Design step&apos;s attribute pickers (Neckline, Sleeve, Silhouette, …) are shown
            to every user in this company — clipart icons, or plain text.
          </p>
        </div>
        {mode && (
          <ToggleSwitch
            checked={mode === "CLIPART"}
            disabled={!canManage || saving}
            label={mode === "CLIPART" ? "Clipart icons — click for text" : "Plain text — click for clipart icons"}
            onToggle={toggle}
          />
        )}
      </div>
      {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

export function AdminAiProvidersPanel({ canManage }: { canManage: boolean }) {
  const [providers, setProviders] = useState<ProviderRow[] | null>(null);
  const [usage, setUsage] = useState<UsageRow[] | null>(null);
  const [failoverLogs, setFailoverLogs] = useState<FailoverLogRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [pendingDelete, setPendingDelete] = useState<ProviderRow | null>(null);
  const [testResult, setTestResult] = useState<{ providerName: string; success: boolean; message: string } | null>(null);
  const [showUsage, setShowUsage] = useState(false);
  const [showLogs, setShowLogs] = useState(false);

  const reload = async () => {
    const body = await parseJson(await fetch("/api/v1/administration/ai-providers"));
    setProviders(body.data);
  };

  useEffect(() => {
    fetch("/api/v1/administration/ai-providers")
      .then(parseJson)
      .then((body) => setProviders(body.data))
      .catch((e) => setError(e.message));
  }, []);

  const loadUsage = async () => {
    const body = await parseJson(await fetch("/api/v1/administration/ai-providers/usage"));
    setUsage(body.data);
  };
  const loadLogs = async () => {
    const body = await parseJson(await fetch("/api/v1/administration/ai-providers/failover-logs?limit=50"));
    setFailoverLogs(body.data);
  };

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  };

  const openEdit = (row: ProviderRow) => {
    setEditingId(row.id);
    setForm({
      name: row.name,
      providerType: row.providerType,
      apiKey: "", // never pre-filled — leaving blank means "keep existing key"
      model: row.model,
      baseUrl: row.baseUrl ?? "",
      isActive: row.isActive,
      priority: row.priority,
      autoFailoverEnabled: row.autoFailoverEnabled,
      dailyGenerationLimit: row.dailyGenerationLimit?.toString() ?? "",
      monthlyGenerationLimit: row.monthlyGenerationLimit?.toString() ?? "",
      requestTimeoutMs: row.requestTimeoutMs,
      maxRetryCount: row.maxRetryCount,
      capabilities: row.capabilities,
    });
    setModalOpen(true);
  };

  const submitForm = async () => {
    setBusy("save");
    setError(null);
    try {
      const payload = {
        name: form.name,
        providerType: form.providerType,
        ...(form.apiKey ? { apiKey: form.apiKey } : {}),
        model: form.model,
        baseUrl: form.baseUrl,
        isActive: form.isActive,
        priority: form.priority,
        autoFailoverEnabled: form.autoFailoverEnabled,
        dailyGenerationLimit: form.dailyGenerationLimit ? Number(form.dailyGenerationLimit) : undefined,
        monthlyGenerationLimit: form.monthlyGenerationLimit ? Number(form.monthlyGenerationLimit) : undefined,
        requestTimeoutMs: form.requestTimeoutMs,
        maxRetryCount: form.maxRetryCount,
        capabilities: form.capabilities,
      };
      if (editingId) {
        await parseJson(
          await fetch(`/api/v1/administration/ai-providers/${editingId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        );
      } else {
        await parseJson(
          await fetch("/api/v1/administration/ai-providers", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        );
      }
      setModalOpen(false);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const toggleActive = async (row: ProviderRow) => {
    setBusy(row.id);
    try {
      await parseJson(
        await fetch(`/api/v1/administration/ai-providers/${row.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isActive: !row.isActive }),
        })
      );
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const runTestConnection = async (row: ProviderRow) => {
    setBusy(`test-${row.id}`);
    try {
      const body = await parseJson(await fetch(`/api/v1/administration/ai-providers/${row.id}/test-connection`, { method: "POST" }));
      setTestResult({ providerName: row.name, success: body.data.success, message: body.data.message });
    } catch (e) {
      setTestResult({ providerName: row.name, success: false, message: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const resetHealth = async (row: ProviderRow) => {
    setBusy(`reset-${row.id}`);
    try {
      await parseJson(await fetch(`/api/v1/administration/ai-providers/${row.id}/reset-health`, { method: "POST" }));
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setBusy("delete");
    try {
      await parseJson(await fetch(`/api/v1/administration/ai-providers/${pendingDelete.id}`, { method: "DELETE" }));
      setPendingDelete(null);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const toggleCapability = (cap: string) => {
    setForm((f) => ({
      ...f,
      capabilities: f.capabilities.includes(cap) ? f.capabilities.filter((c) => c !== cap) : [...f.capabilities, cap],
    }));
  };

  if (!providers) return <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>;

  return (
    <div className="space-y-6">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Configure AI image-generation providers (OpenAI, Gemini, Cloudflare, or a self-hosted Qwen Image Edit
        server) for AI Designer. Requests are routed to the highest-priority provider that supports the
        required capability; a transient failure (rate limit, quota, timeout, provider outage) automatically
        falls over to the next eligible provider. A configuration or credential problem does not — it surfaces
        immediately instead of being silently retried elsewhere.
      </p>
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">{error}</p>}

      <ProductDesignDisplayModeSetting canManage={canManage} />

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Providers</h3>
        {canManage && (
          <button type="button" onClick={openCreate} className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500">
            New Provider
          </button>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              <th className="px-3 py-2 font-medium">Provider</th>
              <th className="px-3 py-2 font-medium">Model</th>
              <th className="px-3 py-2 font-medium">Priority</th>
              <th className="px-3 py-2 font-medium">Capabilities</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {providers.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-zinc-500">
                  No AI providers configured yet.
                </td>
              </tr>
            )}
            {providers.map((row) => (
              <tr key={row.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                <td className="px-3 py-2">
                  <div className="font-medium text-zinc-900 dark:text-zinc-50">{row.name}</div>
                  <div className="text-xs text-zinc-500">
                    {row.providerType}
                    {row.hasApiKey && ` · ${row.apiKeyMasked}`}
                  </div>
                </td>
                <td className="px-3 py-2 text-zinc-700 dark:text-zinc-200">{row.model}</td>
                <td className="px-3 py-2 text-zinc-700 dark:text-zinc-200">{row.priority}</td>
                <td className="px-3 py-2 text-xs text-zinc-500">{row.capabilities.join(", ") || "—"}</td>
                <td className="px-3 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${HEALTH_BADGE_CLASS[row.healthStatus]}`}>
                    {row.healthStatus.replace(/_/g, " ")}
                  </span>
                  {row.cooldownUntil && new Date(row.cooldownUntil) > new Date() && (
                    <div className="mt-0.5 text-[11px] text-zinc-500">until {new Date(row.cooldownUntil).toLocaleTimeString()}</div>
                  )}
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    {canManage && (
                      <>
                        <button type="button" className="text-indigo-600 hover:underline" onClick={() => openEdit(row)}>
                          Edit
                        </button>
                        <ToggleSwitch
                          checked={row.isActive}
                          disabled={busy === row.id}
                          onToggle={() => toggleActive(row)}
                          label={row.isActive ? "Active — click to disable" : "Disabled — click to enable"}
                        />
                      </>
                    )}
                    <button
                      type="button"
                      className="text-zinc-600 hover:underline disabled:opacity-50 dark:text-zinc-300"
                      disabled={busy === `test-${row.id}`}
                      onClick={() => runTestConnection(row)}
                    >
                      {busy === `test-${row.id}` ? "Testing…" : "Test Connection"}
                    </button>
                    {canManage && row.healthStatus !== "HEALTHY" && (
                      <button type="button" className="text-zinc-600 hover:underline dark:text-zinc-300" onClick={() => resetHealth(row)}>
                        Reset
                      </button>
                    )}
                    {canManage && (
                      <button type="button" className="text-red-600 hover:underline" onClick={() => setPendingDelete(row)}>
                        Delete
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <button
          type="button"
          className="text-sm font-medium text-indigo-600 hover:underline"
          onClick={() => {
            setShowUsage((s) => !s);
            if (!usage) loadUsage().catch((e) => setError(e.message));
          }}
        >
          {showUsage ? "Hide" : "Show"} AI Usage
        </button>
        {showUsage && usage && (
          <div className="mt-3 space-y-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
            {usage.map((u) => (
              <div key={u.id} className="flex items-center justify-between border-b border-zinc-100 py-2 text-sm last:border-0 dark:border-zinc-800">
                <div>
                  <span className="font-medium text-zinc-900 dark:text-zinc-50">{u.name}</span>
                  <span className="ml-2 text-xs text-zinc-500">
                    Used today: {u.usedToday}
                    {u.dailyGenerationLimit ? ` / ${u.dailyGenerationLimit}` : ""} · This month: {u.usedThisMonth}
                    {u.monthlyGenerationLimit ? ` / ${u.monthlyGenerationLimit}` : ""}
                  </span>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${HEALTH_BADGE_CLASS[u.healthStatus]}`}>{u.healthStatus.replace(/_/g, " ")}</span>
              </div>
            ))}
            <p className="pt-1 text-xs text-zinc-400">
              Provider balance: Not available — none of the configured providers expose a remaining-credit API. Usage above is tracked locally from real generation attempts.
            </p>
          </div>
        )}
      </div>

      <div>
        <button
          type="button"
          className="text-sm font-medium text-indigo-600 hover:underline"
          onClick={() => {
            setShowLogs((s) => !s);
            if (!failoverLogs) loadLogs().catch((e) => setError(e.message));
          }}
        >
          {showLogs ? "Hide" : "Show"} Failover Log
        </button>
        {showLogs && failoverLogs && (
          <div className="mt-3 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                  <th className="px-3 py-2 font-medium">When</th>
                  <th className="px-3 py-2 font-medium">Requested</th>
                  <th className="px-3 py-2 font-medium">Reason</th>
                  <th className="px-3 py-2 font-medium">Fallback</th>
                  <th className="px-3 py-2 font-medium">Context</th>
                  <th className="px-3 py-2 font-medium">Result</th>
                </tr>
              </thead>
              <tbody>
                {failoverLogs.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-zinc-500">
                      No automatic failovers recorded yet.
                    </td>
                  </tr>
                )}
                {failoverLogs.map((log) => (
                  <tr key={log.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                    <td className="px-3 py-2 text-xs text-zinc-500">{new Date(log.createdAt).toLocaleString()}</td>
                    <td className="px-3 py-2">{log.requestedProvider?.name ?? "—"}</td>
                    <td className="px-3 py-2 text-xs">{log.reason.replace(/_/g, " ")}</td>
                    <td className="px-3 py-2">{log.fallbackProvider?.name ?? "—"}</td>
                    <td className="px-3 py-2 text-xs text-zinc-500">{log.generationContext}</td>
                    <td className="px-3 py-2">
                      <span
                        className={
                          log.result === "SUCCESS"
                            ? "rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/40 dark:text-green-300"
                            : "rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/40 dark:text-red-300"
                        }
                      >
                        {log.result}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editingId ? "Edit AI Provider" : "New AI Provider"} maxWidthClass="max-w-lg">
        <div className="space-y-3">
          <FormField label="Provider Name" htmlFor="pName" required>
            <input id="pName" className={textInputClass()} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </FormField>
          <FormField label="Provider Type" htmlFor="pType" required>
            <select
              id="pType"
              className={textInputClass()}
              value={form.providerType}
              onChange={(e) => setForm({ ...form, providerType: e.target.value as (typeof PROVIDER_TYPE_VALUES)[number] })}
            >
              {PROVIDER_TYPE_VALUES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label={editingId ? "API Key / Credential (leave blank to keep existing)" : "API Key / Credential"} htmlFor="pKey">
            <input
              id="pKey"
              type="password"
              autoComplete="off"
              className={textInputClass()}
              value={form.apiKey}
              onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
              placeholder={form.providerType === "CLOUDFLARE" ? "API Token" : "sk-…"}
            />
          </FormField>
          <FormField label="Model" htmlFor="pModel" required>
            <input id="pModel" className={textInputClass()} value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
          </FormField>
          <FormField
            label={
              form.providerType === "CLOUDFLARE" ? "Cloudflare Account ID" : form.providerType === "QWEN_LOCAL" ? "Base URL" : "Base URL (optional)"
            }
            htmlFor="pBaseUrl"
          >
            <input id="pBaseUrl" className={textInputClass()} value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} />
          </FormField>
          <div>
            <p className="mb-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">Capabilities</p>
            <div className="flex flex-wrap gap-2">
              {CAPABILITY_VALUES.map((cap) => (
                <button
                  key={cap}
                  type="button"
                  onClick={() => toggleCapability(cap)}
                  className={`rounded-md border px-2 py-1 text-xs ${
                    form.capabilities.includes(cap)
                      ? "border-indigo-600 bg-indigo-600 text-white"
                      : "border-zinc-300 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200"
                  }`}
                >
                  {cap.replace(/_/g, " ")}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Priority (lower = tried first)" htmlFor="pPriority">
              <input
                id="pPriority"
                type="number"
                className={textInputClass()}
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })}
              />
            </FormField>
            <FormField label="Max Retry Count" htmlFor="pRetry">
              <input
                id="pRetry"
                type="number"
                className={textInputClass()}
                value={form.maxRetryCount}
                onChange={(e) => setForm({ ...form, maxRetryCount: Number(e.target.value) })}
              />
            </FormField>
            <FormField label="Request Timeout (ms)" htmlFor="pTimeout">
              <input
                id="pTimeout"
                type="number"
                className={textInputClass()}
                value={form.requestTimeoutMs}
                onChange={(e) => setForm({ ...form, requestTimeoutMs: Number(e.target.value) })}
              />
            </FormField>
            <FormField label="Daily Generation Limit" htmlFor="pDaily">
              <input
                id="pDaily"
                type="number"
                className={textInputClass()}
                value={form.dailyGenerationLimit}
                onChange={(e) => setForm({ ...form, dailyGenerationLimit: e.target.value })}
                placeholder="No limit"
              />
            </FormField>
            <FormField label="Monthly Generation Limit" htmlFor="pMonthly">
              <input
                id="pMonthly"
                type="number"
                className={textInputClass()}
                value={form.monthlyGenerationLimit}
                onChange={(e) => setForm({ ...form, monthlyGenerationLimit: e.target.value })}
                placeholder="No limit"
              />
            </FormField>
          </div>
          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
              <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
              Active
            </label>
            <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
              <input
                type="checkbox"
                checked={form.autoFailoverEnabled}
                onChange={(e) => setForm({ ...form, autoFailoverEnabled: e.target.checked })}
              />
              Auto Failover Enabled
            </label>
          </div>
          <button
            type="button"
            disabled={busy === "save" || !form.name || !form.model || form.capabilities.length === 0}
            onClick={submitForm}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {busy === "save" ? "Saving…" : "Save"}
          </button>
        </div>
      </Modal>

      <Modal open={testResult !== null} onClose={() => setTestResult(null)} title={`Test Connection — ${testResult?.providerName ?? ""}`}>
        {testResult && (
          <p className={testResult.success ? "text-sm text-green-700 dark:text-green-300" : "text-sm text-red-700 dark:text-red-300"}>
            {testResult.success ? "✓ " : "✕ "}
            {testResult.message}
          </p>
        )}
      </Modal>

      <ConfirmModal
        open={pendingDelete !== null}
        title={`Delete "${pendingDelete?.name ?? ""}"?`}
        message="This AI provider configuration will be permanently removed. Past usage and failover history referencing it are kept."
        confirmLabel="Delete"
        isDangerous
        isBusy={busy === "delete"}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
