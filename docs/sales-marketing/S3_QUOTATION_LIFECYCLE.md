# Sales & Marketing — Release 1 / S3 Approve, issue, revise, PDF, send, accept (2026-10-29)

Spec: `ref/02.md` §6.4–6.10, §7.6. Plan: `RELEASE_PLAN.md` (S3). Decision D2 (approval rule).

## 1. Lifecycle

```
DRAFT ──submit (over a limit)──▶ PENDING_APPROVAL ──approve──▶ APPROVED ──issue──▶ ISSUED
  │   ◀── decline (reason) / return to draft ──┘                  │
  └──────────── issue (within limits) ─────────────────────────────┘
ISSUED ──▶ ACCEPTED | REJECTED   (customer decision, recorded against that exact revision)
ISSUED | REJECTED ──new revision (reason)──▶ next revision as DRAFT; an ISSUED one becomes SUPERSEDED
DRAFT | PENDING_APPROVAL | APPROVED | ISSUED ──cancel / withdraw (reason)──▶ CANCELLED
```

- **Approval (D2)** — needed when any line discount is above the limit or the grand total is above the limit (defaults 10 % and ₹5,00,000, editable in Sales & Marketing → Settings). `quotation-approval.ts` gives the reasons in plain words; they are stored on the revision when it is submitted. The approver needs `sales_quotations.approve` and must not be the revision's creator, last editor or submitter (SUPER_ADMIN excepted, like every other approval in the ERP). Approvers are notified; approvers without view_all still see quotations while they await approval. Decline needs a reason and sends it back to draft.
- **Issue** freezes the revision: a non-draft revision is never edited (the save API only accepts drafts). Before submit/issue the draft is re-validated and recomputed with the same code as a save (GST rates must still be effective, valid-until not in the past). The printed letterhead and party block are snapshotted on the revision, so its PDF reproduces exactly later. A linked enquiry moves to **Quoted**.
- **Sending** is recorded by hand ("Mark as sent": to whom, how, when) — no e-mail provider is connected and nothing claims delivery. Repeatable; each one is in the history.
- **Customer decision** — accept (date, method, customer reference such as the PO number, comment; attach evidence under Attachments) or reject (date, reason). Recorded by an internal user, never implied by approval. Acceptance is refused when the decision date is after the valid-until date.
- **Expiry** is derived when read (issued + valid-until before today) — no background job. It shows as "Expired", blocks acceptance only, and is resolved by a new revision.
- **Revisions** — stable quotation number; each revision keeps its own content, reason, predecessor link and status. Earlier revisions open read-only (`?revision=n`) with their own PDF.
- **Cancel / withdraw** clears the enquiry back to Qualified when it was its last open quotation.
- Every step: guarded write on both quotation and revision status (a second click or a concurrent approver fails cleanly), audit row, timeline event (`quotation_events`), notifications where useful.

## 2. PDF

`GET /api/v1/sales-marketing/quotations/:id/pdf?revision=n` (`sales_quotations.print`), built on the shared business-document template (`src/core/documents/document-pdf.tsx`, which gained optional column widths and text sections — existing documents unchanged). Shows number/revision, dates, place of supply, lines with discount and GST, CGST+SGST or IGST totals, introduction, delivery terms, notes, terms and shipping address. Drafts print as "Draft Quotation — not valid for acceptance". Internal notes are never printed.

## 3. Settings

`/sales-marketing/settings` (new permission module `sales_marketing_settings`, granted like `crm_settings`: MANAGEMENT view/edit, VIEWER view): approval limits, default validity days, default terms & conditions (pre-filled into new quotations).

## 4. Database

Migration `20261028280000_sales_quotations_s3`: 22 columns on `quotation_revisions` (revision reason/predecessor, approval, issue + snapshot, sent, customer decision), `quotation_events`, `sales_marketing_settings` (CHECKed limits), the `sales_marketing_settings` permissions; existing quotations get CREATED/CANCELLED history rows. Rollback `prisma/rollback/20261028280000_sales_quotations_s3.down.sql` (run before S2's): rehearsed — schema identical to before.

## 5. Verification (cloud sandbox, Postgres 16)

- `quotation-lifecycle.integration.test.ts` (real DB, 9 tests): direct issue within limits + snapshot + frozen + PDF renders (`%PDF`) without internal notes; approval routing incl. decline/resubmit, approver notification and visibility; self-approval refused for creator / last editor / submitter; two concurrent approvals → one wins; limits from settings; mark sent / accept with PO / no revise-cancel-reject after acceptance; expiry (accept refused, late-recorded in-time acceptance allowed, revise works); revise → superseded rev 1 unchanged, rev 2 edited/issued, rejected → revise again; enquiry Quoted on issue and back to Qualified on withdraw. S1/S2 suites re-run: all pass.
- Unit / route / component tests: approval rule; action routes use the right permission and unknown actions are 404; detail screen offers exactly the allowed actions per status/role, disables acceptance when expired, read-only earlier revisions, acceptance payload.
- Full suite 3749 passed / 246 skipped; `tsc` 0; `eslint` 0 errors (22 existing warnings); `next build` OK.
- Browser, two users: a Merchandiser creates a 15 % discount quotation → sees Submit (no Approve) → submits; Super Admin approves → issues → marks sent → PDF downloads → new revision (600 pcs, 5 %) → issues → records acceptance with PO; rev 1 opens as Superseded; Settings page works, Merchandiser gets /no-access. No page errors. Fixed in the run: discount shown as "₹-9,000.00" on the totals card (now "− ₹9,000.00").
- Not run against the user's own database.

## 6. Known limits

- No e-mail sending; "Mark as sent" is a manual record (spec allows this when no provider is configured).
- One approval level (Release 1 scope); no margin-based rule (the ERP has no reliable costing per quote).
- Expiry isn't stored as a status — it's computed. Reports (S6) must use the same rule (`isQuotationExpired`).
- Enquiry numbering known issue (per-branch counters vs company-unique numbers, CLAUDE.md) also affects S&M enquiries when users with different default branches create them; the integration tests align the counter first. Not fixed here (shared numbering service).
