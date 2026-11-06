// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));

const { SmIntegrationsClient } = await import("./SmIntegrationsClient");
const { ApiKeysPanel } = await import("./ApiKeysPanel");
const { ConflictsPanel } = await import("./ConflictsPanel");
const { ApiGuidePanel } = await import("./ApiGuidePanel");

type Call = { url: string; init?: RequestInit };
function stub(routes: (c: Call) => unknown) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: routes({ url, init }) }) } as Response);
    })
  );
  return calls;
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const metrics = { api: { requests: 40, errorRatePercent: 5, errors: 1, refused: 1, rateLimited: 0, keys: 2 }, webhooks: { delivered: 9, failed: 1, successRatePercent: 90, pending: 0, retried: 1, queueLatencySeconds: 0 }, inbound: { accepted: 3, rejected: 2 }, sync: { openConflicts: 4, lastRunAt: "2026-11-06T09:00:00Z" }, events: { lastPublishedAt: null }, registry: { CONNECTED: 3, DEGRADED: 1 } };
const row = (over: Record<string, unknown>) => ({ id: "i1", kind: "DELIVERY_PROVIDER", kindLabel: "Marketing delivery provider", managedIn: "SALES_MARKETING", manageHref: null, provider: "BREVO", providerLabel: "Brevo", liveVerified: false, name: "Brevo main", status: "CONFIGURED", statusLabel: "Configured", statusTone: "zinc", statusReason: "Not tested or used yet.", statusChangedAt: "2026-11-06T09:00:00Z", capabilities: [{ key: "send.email", label: "Send email" }], authMethod: "x", credentialRef: "marketing_channel_connections:abc", credentialRotatedAt: null, resourceType: "marketing_channel_connections", resourceId: "abc", lastSuccessAt: null, lastErrorAt: null, lastError: null, lastCheckedAt: null, version: 1, ...over });

describe("Integrations page", () => {
  it("shows metrics and the registry with honest statuses (not live-verified, CRM read-only)", async () => {
    stub(({ url }) => (url.endsWith("/metrics") ? metrics : [row({}), row({ id: "i2", kind: "CRM_CAPTURE_KEY", kindLabel: "CRM lead capture API key", managedIn: "CRM", provider: "crm-lead-ingest", providerLabel: "crm-lead-ingest", liveVerified: null, name: "Website leads", status: "CONNECTED", statusLabel: "Connected", statusTone: "green", statusReason: null })]));
    render(<SmIntegrationsClient canEdit canApprove origin="https://erp.example.com" />);
    await waitFor(() => expect(screen.getByText("Brevo main")).toBeTruthy());
    expect(screen.getByText("Not live-verified")).toBeTruthy();
    expect(screen.getByText(/lead capture API key · crm-lead-ingest · managed in CRM/)).toBeTruthy();
    expect(screen.getByText("2 failed verification")).toBeTruthy();
    expect(screen.getByText("Open sync conflicts")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Brevo main" }).getAttribute("href")).toBe("/sales-marketing/integrations/i1");
  });
});

describe("API keys", () => {
  it("creates a key with chosen scopes and shows it once; read-only users get no buttons", async () => {
    const calls = stub(({ init }) => (init?.method === "POST" ? { id: "k1", name: "Website", keyOnce: "crmk_0123456789ab_SECRETSECRETSECRETSECRETSECRET12" } : []));
    render(<ApiKeysPanel canEdit canApprove={false} />);
    fireEvent.click(await screen.findByRole("button", { name: "New API key" }));
    fireEvent.change(screen.getByPlaceholderText("e.g. Website enquiry form"), { target: { value: "Website" } });
    fireEvent.click(screen.getByLabelText(/Submit \/ update enquiries/));
    fireEvent.click(screen.getByRole("button", { name: "Create key" }));
    await waitFor(() => expect(screen.getByText(/shown once/)).toBeTruthy());
    const body = JSON.parse(String(calls.find((c) => c.init?.method === "POST")!.init!.body));
    expect(body).toMatchObject({ name: "Website", scopes: ["sm.campaigns:read", "sm.enquiries:write"] });
    expect(screen.getAllByText(/crmk_0123456789ab_SECRET/).length).toBeGreaterThan(0);
    cleanup();
    stub(() => [{ id: "k2", name: "Read only", description: null, keyPreview: "crmk_abc_••••••••", scopes: ["sm.campaigns:read"], rateLimitPerMinute: 120, lastUsedAt: null, expiresAt: null, revokedAt: null, rotatedFromId: null, createdAt: "2026-11-06T09:00:00Z", actsAs: { id: "u", name: "Asha" }, state: "ACTIVE" }]);
    render(<ApiKeysPanel canEdit={false} canApprove={false} />);
    await waitFor(() => expect(screen.getByText("Read only")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "New API key" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Revoke" })).toBeNull();
  });
});

describe("Sync conflicts", () => {
  it("lists both values and resolves through a confirmation; apply is offered only where allowed", async () => {
    const conflict = (id: string, field: string, canApply: boolean) => ({ id, status: "OPEN", field, reason: "ERP_CHANGED", reasonLabel: "Changed in the ERP since the last sync", erpValue: "ERP text", externalValue: "Website text", canApply, record: { type: "ENQUIRY", id: "e1", number: "ENQ-1", href: "/sales-marketing/enquiries/e1" }, external: { system: "website", id: "123" }, sourceUpdatedAt: null, detectedAt: "2026-11-06T09:00:00Z", resolvedAt: null, resolvedBy: null, resolutionNote: null });
    const calls = stub(({ init }) => (init?.method === "POST" ? { id: "c1", status: "KEPT_ERP" } : { rows: [conflict("c1", "remarks", true), conflict("c2", "prospectEmail", false)], totalCount: 2 }));
    render(<ConflictsPanel canApprove />);
    await waitFor(() => expect(screen.getAllByText("ERP text").length).toBe(2));
    expect(screen.getAllByRole("button", { name: "Apply external" })).toHaveLength(1);
    fireEvent.click(screen.getAllByRole("button", { name: "Keep ERP" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Keep the ERP value" }));
    await waitFor(() => expect(calls.some((c) => c.init?.method === "POST")).toBe(true));
    expect(JSON.parse(String(calls.find((c) => c.init?.method === "POST")!.init!.body))).toMatchObject({ action: "keep_erp" });
  });
});

describe("Developer guide", () => {
  it("documents base URL, scopes, signature and every event type from the registry", () => {
    render(<ApiGuidePanel origin="https://erp.example.com" />);
    expect(screen.getAllByText(/https:\/\/erp\.example\.com\/api\/v1\/integrations\/sales-marketing/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("sm.quotation.accepted").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/at-least-once/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("sm.webhooks:manage").length).toBeGreaterThan(0);
  });
});
