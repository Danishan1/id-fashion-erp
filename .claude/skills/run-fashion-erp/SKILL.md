---
name: run-fashion-erp
description: Build, run, launch, and drive the Fashion ERP app (Next.js 16 + Prisma 7 + Postgres). Use when asked to start the ERP, run the dev server, log in, screenshot a page, or verify a change works end-to-end in the browser.
---

Next.js 16 app driven via the Browser pane's `mcp__Claude_Browser__*` tools — no custom driver script needed, since this is the same tool every prior phase of this project was manually verified with. There is no `chromium-cli` in this environment; `mcp__Claude_Browser__*` is the equivalent off-the-shelf harness. All paths below are relative to the repo root (`D:\erp project`).

## Prerequisites

- Local PostgreSQL running as a Windows service (dev DB name `fashion_erp`, user/password `postgres`/`postgres`, port 5432). Check with:
  ```powershell
  Get-Service -Name "postgresql*" | Select-Object Name, Status
  ```
  If it's `Stopped`, start it (`Start-Service postgresql-x64-16` or whatever the exact service name is).
- `.env` already exists at repo root with `DATABASE_URL`, `AUTH_SECRET`, `NEXTAUTH_URL=http://localhost:3000`, `FILE_STORAGE_ROOT`. `.env.example` is the template for a fresh clone.
- `.claude/launch.json` already configures the dev server (name `fashion-erp-dev`, port 3000) — don't recreate it.

## Setup / Build

```bash
npx prisma generate
```
No `postinstall` hook exists in `package.json`, so this must be run explicitly (also needed once after any `schema.prisma` change).

**Only on a genuinely empty/fresh database** — the real dev DB already has 20+ phases of seeded/demo data (customers, sample requests, sales orders, purchase orders, etc.); re-running seed against it will hit unique-constraint errors:
```bash
npx prisma migrate deploy
npx prisma db seed
```
Seeded Super Admin login (from `prisma/seed.ts`): **`admin@indradhar.com` / `ChangeMe123!`**.

## Run (agent path)

1. Launch the dev server (reuses the running one if already up):
   ```
   mcp__Claude_Browser__preview_start({ name: "fashion-erp-dev" })
   ```
   Confirm it's healthy: `mcp__Claude_Browser__preview_logs({ serverId })` should show `▲ Next.js 16.3.1 (Turbopack)` / `✓ Ready`.
2. Navigate to `http://localhost:3000/login`. If a session cookie already exists in the tab, this redirects straight to `/dashboard` — sign out first (see step 4) if you specifically need to exercise the login form.
3. **Log in** — the form is `next-auth/react`'s client `signIn()` (no CSRF field in the DOM, no raw form POST):
   - `read_page({filter:"interactive"})` → confirms `textbox "Email"`, `textbox "Password"`, `button "Sign in" type="submit"`.
   - **Known issue in this environment**: when the Browser pane isn't actively displayed to a human (e.g. this skill running unattended), `computer{action:"left_click"}` on a plain `<input>` does not set native browser focus, and click on a `<button type="submit">` inside a `<form>` does not trigger native form submission — even though the exact same click mechanism works fine for plain `onClick` buttons (e.g. "Sign out", tab switches). The working sequence:
     ```
     javascript_tool: document.querySelector('#email').focus()
     computer{action:"type", text:"admin@indradhar.com"}
     javascript_tool: document.querySelector('#password').focus()
     computer{action:"type", text:"ChangeMe123!"}
     javascript_tool: document.querySelector('button[type=submit]').click()
     ```
     Real keystrokes go in via the real `type` action; `.focus()`/`.click()` are only used to work around the missing native focus/submit behavior in this unattended state — not to fake input. If a human has the Browser pane open and visible, plain `left_click`+`type`+`left_click submit` should work normally; try that first.
   - Confirm success via `get_page_text()` — should show "Dashboard" and real DB-backed stat tiles (Active Customers/Suppliers/Employees/Warehouses/Active Users), not the login form.
4. **Sign out** (if needed to re-test login): `read_page` → click the `button "Sign out"` ref directly (plain `onClick`, works fine with a normal `left_click`).
5. **Golden-path pages to verify a change didn't break anything**, all via `navigate` + `get_page_text`/`read_page`:
   - `/dashboard` — 5 DB-backed stat tiles.
   - `/masters/customers` — `DataTable` list (search/pagination pattern used by ~15 masters modules).
   - `/masters/lookups` — tabbed `SimpleLookupManager` (Colors/Sizes/Units); click the `button "Sizes"`/`"Units"` tab refs to switch (plain `onClick`, works with a normal `left_click`).
6. Check for regressions with `read_console_messages({onlyErrors:true})` and `read_network_requests()` after each navigation — a broken import or failed API call shows up immediately.
7. Screenshot (`computer{action:"screenshot"}`) only works when the Browser pane is actively displayed to a human viewer — see Gotchas.

## Run (human path)

```bash
npm run dev
```
Open `http://localhost:3000/login` manually, sign in with the credentials above. Ctrl-C to stop.

## Test

```bash
npm test
```
Runs the Vitest unit suite (`vitest run`) — no e2e/browser suite exists yet (Phase 10 not started).

## Gotchas

- **Screenshot fails with "the Browser pane is not displayed, so the page is not compositing frames"** when running unattended (no human has the Browser pane open in their Claude Code UI). Text-based verification (`get_page_text`, `read_page`, `read_console_messages`, `read_network_requests`) works fine without the pane being displayed — rely on those instead of a screenshot in that state.
- **Same unattended-pane state breaks native click-driven focus and form submission**, but not plain `onClick` buttons — see the login workaround above. This is specific to this tool/session state, not a bug in the app.
- **After any Prisma schema change or a source file edit that a running dev server "should" have picked up but didn't** (stale Turbopack module cache — CLAUDE.md documents this exact class of gotcha repeatedly), fully stop and restart the dev server (`preview_stop` then `preview_start`) rather than just re-running `prisma generate`. Hit live during this skill's own verification: a route importing `customerUpdateSchema` threw `Error: Export customerUpdateSchema doesn't exist in target module` even though the export was already present on disk — a full server restart is the fix, not a code change.
- **Do not run `npx prisma db seed` against the existing dev DB** — it uses `create`, not `upsert`, for most demo rows and will fail on unique-constraint conflicts against the real seeded/demo data already there.
- **A session cookie persists across a dev-server restart** (NextAuth JWT session, independent of the Next.js process) — navigating to `/login` while already authenticated redirects straight to `/dashboard`; sign out first if you need to test the login form itself.
- Right after a fresh `preview_start`, the very first `navigate` can return `"navigation ... was denied or failed"` while Turbopack finishes its initial compile — wait ~2s and retry.

## Troubleshooting

- **`ECONNREFUSED` from Prisma / the app can't reach the DB**: the local Postgres Windows service stopped. `Get-Service postgresql-x64-16` (or similar) and start it if not `Running`.
- **`Error: Export <X> doesn't exist in target module` in the browser console for a route you didn't just edit**: stale Turbopack cache from a dev server that predates a schema/source change — restart the dev server (see Gotchas).
- **`screenshot failed: Screenshot timed out after 5s: the Browser pane is not displayed`**: expected in an unattended run — use `get_page_text`/`read_page` instead, or ask the user to open the Browser pane if a visual screenshot is actually required.
