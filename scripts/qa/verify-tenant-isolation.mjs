// Cross-tenant isolation check (Platform SaaS Phase 6, PLAT-032).
//
//   node --env-file=.env scripts/qa/verify-tenant-isolation.mjs
//
// Env: BASE_URL (default http://localhost:3000), DATABASE_URL,
//      PLATFORM_EMAIL / PLATFORM_PASSWORD, TENANT_A_EMAIL / TENANT_A_PASSWORD
//      (default: the dev seed logins). Run against dev or staging only.
//
// It creates (or reuses) a QA tenant "B" through the platform API, signs in as
// B's Super Admin and tries to read and change tenant A's real records through
// every company-scoped /api/v1/<resource>/[id] route. Every attempt must fail,
// and a hash of each probed A row must be identical before and after. It also
// checks list endpoints, attachment downloads, support access and the
// platform/customer session split. Tenant B is suspended again at the end.
import pg from "pg";
import bcrypt from "bcryptjs";
import fs from "fs";
import path from "path";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const PLATFORM_EMAIL = process.env.PLATFORM_EMAIL ?? "admin@indradhar.com";
const PLATFORM_PASSWORD = process.env.PLATFORM_PASSWORD ?? "ChangeMe123!";
const A_EMAIL = process.env.TENANT_A_EMAIL ?? "admin@indradhar.com";
const A_PASSWORD = process.env.TENANT_A_PASSWORD ?? "ChangeMe123!";
const B_TAX_ID = "QA-ISOLATION-TENANT";
const B_EMAIL = "qa-isolation-admin@tenant-b.test";
const B_PASSWORD = "QaIsolation#2026";

if (!/localhost|127\.0\.0\.1|staging/i.test(BASE) && !process.argv.includes("--i-know-this-is-not-production")) {
  console.error(`Refusing to run against ${BASE}. This script creates a QA tenant. Pass --i-know-this-is-not-production to override.`);
  process.exit(1);
}

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

let pass = 0;
let fail = 0;
const failures = [];
const check = (name, ok, extra = "") => {
  if (ok) pass++;
  else {
    fail++;
    failures.push(`${name}${extra ? " — " + extra : ""}`);
  }
  if (!ok || process.argv.includes("--verbose")) console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`);
};

class Jar {
  cookies = new Map();
  absorb(res) {
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(";");
      const i = kv.indexOf("=");
      this.cookies.set(kv.slice(0, i), kv.slice(i + 1));
    }
  }
  header() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  async fetch(p, init = {}) {
    const res = await fetch(BASE + p, { redirect: "manual", ...init, headers: { ...(init.headers ?? {}), cookie: this.header() } });
    this.absorb(res);
    return res;
  }
}
async function login(provider, email, password) {
  const jar = new Jar();
  const csrf = await (await jar.fetch("/api/auth/csrf")).json();
  await jar.fetch(`/api/auth/callback/${provider}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrfToken: csrf.csrfToken, email, password, callbackUrl: BASE }),
  });
  if (![...jar.cookies.keys()].some((k) => k.includes("session-token"))) throw new Error(`login failed ${provider}/${email}`);
  return jar;
}
const json = { "content-type": "application/json" };
const body = async (r) => r.json().catch(() => ({}));

// ---- Routes to probe: every /api/v1/<resource>/[id]/route.ts except platform/* ----
const API_ROOT = path.join("src", "app", "api", "v1");
function findIdRoutes(dir, prefix = "") {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.name === "[id]" && fs.existsSync(path.join(dir, entry.name, "route.ts"))) out.push(prefix);
    else if (!entry.name.startsWith("[")) out.push(...findIdRoutes(path.join(dir, entry.name), rel));
  }
  return out;
}
const TABLE_OVERRIDES = {
  "ai-designer/projects": "ai_projects",
  "ai-designer/replicate-projects": "replicate_design_projects",
  "ai-designer/product-design-attributes": "ai_product_design_attributes",
  "administration/ai-providers": "ai_providers",
  "administration/branches": "branches",
  "administration/roles": "roles",
  "administration/users": "users",
  "attendance-corrections": "hrms_attendance_correction_requests",
  "leave-requests": "hrms_leave_requests",
  "leave-types": "hrms_leave_types",
  campaigns: "mkt_campaigns",
  "campaign-alerts": "mkt_campaign_alerts",
  sampling: "sample_requests",
  imports: "import_batches",
  "crm/imports": "crm_import_jobs",
  "support-access/requests": "support_access_requests",
  "support-access/sessions": "support_access_sessions",
};
const tableFor = (route) => TABLE_OVERRIDES[route] ?? route.replace(/\//g, "_").replace(/-/g, "_");

const { rows: scopedTables } = await db.query(
  `select table_name from information_schema.columns where column_name='company_id' and table_schema='public'`
);
const scoped = new Set(scopedTables.map((r) => r.table_name));
const rowHash = async (table, id) =>
  (await db.query(`select md5(row_to_json(t)::text) h from "${table}" t where id=$1`, [id])).rows[0]?.h ?? null;

const { rows: [companyA] } = await db.query(`select company_id id from users where email=$1`, [A_EMAIL]);
let companyB = null;

try {
  const platform = await login("platform-credentials", PLATFORM_EMAIL, PLATFORM_PASSWORD);
  const tenantA = await login("credentials", A_EMAIL, A_PASSWORD);

  // ---- Tenant B: create once, reuse afterwards ----
  const existing = await db.query(`select id from companies where tax_registration_no=$1`, [B_TAX_ID]);
  if (existing.rowCount) {
    companyB = existing.rows[0].id;
    await db.query(`update companies set is_active=true, suspended_at=null, suspension_reason=null where id=$1`, [companyB]);
    await db.query(`update users set password_hash=$2, status='ACTIVE', password_changed_at=null where email=$1`, [B_EMAIL, await bcrypt.hash(B_PASSWORD, 12)]);
  } else {
    const r = await platform.fetch("/api/v1/platform/companies", {
      method: "POST",
      headers: json,
      body: JSON.stringify({
        companyName: "QA Isolation Tenant B",
        taxRegistrationNo: B_TAX_ID,
        baseCurrencyCode: "INR",
        fiscalYearStartMonth: 4,
        branchCode: "HO",
        branchName: "Head Office",
        branchType: "OFFICE",
        adminEmail: B_EMAIL,
        adminPassword: B_PASSWORD,
        adminFullName: "QA Isolation Admin",
      }),
    });
    const b = await body(r);
    check("platform creates tenant B", r.status === 201, `${r.status} ${b.error?.message ?? ""}`);
    companyB = b.data?.company?.id;
    if (!companyB) throw new Error("tenant B was not created");
  }
  const tenantB = await login("credentials", B_EMAIL, B_PASSWORD);
  check("tenant B signs in", true);

  // ---- Sweep every [id] route ----
  const routes = findIdRoutes(API_ROOT).filter((r) => !r.startsWith("platform"));
  let probed = 0;
  const skipped = [];
  for (const route of routes) {
    const table = tableFor(route);
    if (!scoped.has(table)) {
      skipped.push(route);
      continue;
    }
    const { rows } = await db.query(`select id from "${table}" where company_id=$1 limit 1`, [companyA.id]);
    if (!rows.length) {
      skipped.push(`${route} (no tenant A rows)`);
      continue;
    }
    const id = rows[0].id;
    const before = await rowHash(table, id);
    const get = await tenantB.fetch(`/api/v1/${route}/${id}`);
    const getBody = await get.text();
    // A refusal may echo the id the caller sent (in error.details) - that is not a leak.
    // It must be a 4xx error envelope with no record payload.
    let getJson = null;
    try { getJson = JSON.parse(getBody); } catch {}
    check(
      `GET ${route}/:A-id refused for tenant B`,
      // 405 = the route has no GET handler at all (lookup masters are PATCH-only), so nothing can be read.
      get.status === 405 || (get.status >= 400 && get.status < 500 && getJson?.error && getJson.data === undefined),
      `${get.status}`
    );
    const patch = await tenantB.fetch(`/api/v1/${route}/${id}`, {
      method: "PATCH",
      headers: json,
      body: JSON.stringify({ name: "HACKED", code: "HACKED", isActive: false }),
    });
    check(`PATCH ${route}/:A-id refused for tenant B`, patch.status !== 200 && patch.status !== 201, `${patch.status}`);
    check(`${route}: tenant A row unchanged`, (await rowHash(table, id)) === before);
    probed++;
  }
  console.log(`Probed ${probed} resource routes; ${skipped.length} skipped (global table or no data).`);

  // ---- List endpoints don't leak ----
  for (const [route, table] of [
    ["customers", "customers"],
    ["suppliers", "suppliers"],
    ["sales-orders", "sales_orders"],
    ["sampling", "sample_requests"],
    ["products", "products"],
    ["purchase-orders", "purchase_orders"],
    ["production-orders", "production_orders"],
    ["crm/leads", "crm_leads"],
    ["crm/contacts", "crm_contacts"],
    ["employees", "employees"],
  ]) {
    const { rows } = await db.query(`select id from "${table}" where company_id=$1`, [companyA.id]);
    if (!rows.length) continue;
    const r = await tenantB.fetch(`/api/v1/${route}?pageSize=200`);
    const text = await r.text();
    check(`list ${route} as tenant B shows none of tenant A's rows`, !rows.some((x) => text.includes(x.id)), `${r.status}`);
  }

  // ---- Attachments ----
  const { rows: att } = await db.query(
    `select id from attachments where company_id=$1 and related_module='SAMPLE_REQUEST' limit 1`,
    [companyA.id]
  );
  if (att.length) {
    const r = await tenantB.fetch(`/api/v1/sampling/attachments/${att[0].id}/download`);
    check("tenant B can't download tenant A's attachment", r.status !== 200, `${r.status}`);
  }

  // ---- Support tickets both ways ----
  const fd = new FormData();
  fd.set("subject", "QA isolation ticket B");
  fd.set("body", "Tenant B ticket for the isolation check.");
  let r = await tenantB.fetch("/api/v1/support-tickets", { method: "POST", body: fd });
  const ticketB = (await body(r)).data;
  check("tenant B raises a ticket", r.status === 201);
  r = await tenantA.fetch(`/api/v1/support-tickets/${ticketB?.id}`);
  check("tenant A can't open tenant B's ticket", r.status === 404, `${r.status}`);
  const listA = await (await tenantA.fetch("/api/v1/support-tickets")).text();
  check("tenant A's ticket list doesn't include tenant B's ticket", !listA.includes(ticketB?.id ?? "none"));

  // ---- Support access: tenant B can't decide on tenant A's request ----
  r = await platform.fetch("/api/v1/platform/support-requests", {
    method: "POST",
    headers: json,
    body: JSON.stringify({ companyId: companyA.id, reason: "QA isolation check — please ignore", durationMinutes: 15 }),
  });
  const requestA = (await body(r)).data;
  const reqId = requestA?.request?.id ?? requestA?.id;
  if (reqId) {
    r = await tenantB.fetch(`/api/v1/support-access/requests/${reqId}/approve`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ code: requestA?.code ?? "000000" }),
    });
    check("tenant B can't approve tenant A's support request", r.status === 404 || r.status === 403, `${r.status}`);
    const { rows: [req] } = await db.query(`select status from support_access_requests where id=$1`, [reqId]);
    check("tenant A's support request still pending", req?.status === "PENDING", req?.status);
    await platform.fetch(`/api/v1/platform/support-requests/${reqId}/cancel`, { method: "POST" });
  } else {
    check("platform creates a support request for tenant A", false, `${r.status}`);
  }

  // ---- Session-type separation ----
  r = await platform.fetch("/api/v1/customers");
  check("platform session refused on customer API", r.status === 403, `${r.status}`);
  r = await tenantB.fetch("/api/v1/platform/companies");
  check("tenant session refused on platform API", r.status === 403, `${r.status}`);

  // ---- Suspension cuts tenant B off immediately ----
  r = await platform.fetch(`/api/v1/platform/companies/${companyB}/suspend`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ reason: "QA isolation tenant — idle between runs" }),
  });
  check("platform suspends tenant B", r.status === 200, `${r.status}`);
  r = await tenantB.fetch("/api/v1/customers");
  const sb = await body(r);
  check("suspended tenant B's live session is refused", r.status === 403 && sb.error?.code === "ACCOUNT_SUSPENDED", `${r.status} ${sb.error?.code}`);
} catch (e) {
  fail++;
  failures.push(String(e));
  console.log("ERROR", e);
} finally {
  if (companyB) {
    await db.query(`delete from support_tickets where company_id=$1`, [companyB]);
    await db.query(
      `update companies set is_active=false, suspended_at=coalesce(suspended_at, now()), suspension_reason=coalesce(suspension_reason, 'QA isolation tenant') where id=$1`,
      [companyB]
    );
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  if (failures.length) console.log("Failures:\n- " + failures.join("\n- "));
  await db.end();
  process.exit(fail ? 1 : 0);
}
