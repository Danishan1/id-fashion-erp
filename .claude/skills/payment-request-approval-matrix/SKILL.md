---
name: payment-request-approval-matrix
description: Plan for the Payment Request Approval Matrix module — an admin screen deciding, per request type and amount slab, who approves (role or named users), how many approval levels, whether the request skips approval (e.g. Salary), and whether the approver may also pay. Use when building approval routing for any payment request.
---

# Approval Matrix (who approves what)

Part of `accounts-payment-requests-plan`. Depends on: foundation. Needed by: accountant-payout and every type.
User decision (2026-10-27): "ek module hona chahiye ki kisko kis ki permission hai, kon approval dega".

## Purpose
Replace a fixed "anyone with `payment_requests.approve` approves everything" with a company-configurable rule
per request type. Supersedes `PaymentRequestTypeSetting.routing` from the foundation skill (keep `isEnabled`
there; routing moves here).

## Schema
- `PaymentApprovalRule` (companyId, requestType, branchId nullable = all branches, `minAmount` (default 0),
  `maxAmount` nullable = no limit, `routing` APPROVAL_THEN_PAY | DIRECT_TO_ACCOUNTANT, `approvalLevels` 1–3,
  `approverMayPay` bool (default false), isActive, sortOrder)
- `PaymentApprovalRuleApprover` (ruleId, level 1..3, `roleId` OR `userId` — CHECK exactly one)
- `PaymentRequestApproval` (requestId, level, decision APPROVED/REJECTED, userId, decidedAt, remark,
  voice-note attachment optional) — full history, append-only
- `PaymentRequest` gets `approvalRuleId` (snapshot of the rule used), `currentApprovalLevel`, `requiredLevels`
- Overlap check: for the same (type, branch) the amount slabs must not overlap (half-open `[min, max)`, reuse
  `rangesOverlap()` idea from tax-config). No matching rule ⇒ default: APPROVAL_THEN_PAY, 1 level, any user
  holding `payment_requests.approve`.

## Rule resolution (at submit, frozen on the request)
1. active rules for requestType, branch-specific before "all branches", slab containing the amount
2. DIRECT_TO_ACCOUNTANT ⇒ request starts APPROVED (Salary default)
3. else status PENDING_APPROVAL, level 1; each level's approvers = listed users + users holding listed roles
   (live check at decision time, user must be ACTIVE, branch-scoped)
4. Editing the amount before approval re-resolves the rule.

## Decision flow
Approve at level N (must be an approver of level N, not the creator — self-approval guard, also not someone who
already approved an earlier level) → if N = required ⇒ APPROVED else level N+1. Reject at any level ⇒ REJECTED
(reason required). Payout guard: if `approverMayPay=false`, a user who approved any level can't pay it.

## UI
- Admin screen `/accounts/payment-requests/approval-matrix` (or Administration → "Payment Approvals"): table by
  request type, add/edit rule modal (type, branch, amount from/to, routing, levels, approvers per level with role
  + user multi-pickers, approver-may-pay switch).
- Request detail: approval timeline (level, who, when, remark); "To approve" tab lists only requests where the
  viewer is an approver of the current level.
- Notification to current-level approvers on submit/advance (NotificationService).

## RBAC
Matrix editing: new action on `payment_requests` → reuse `edit` + `approve`? Recommend a separate module
`payment_request_settings` (view/edit) granted to SUPER_ADMIN / ACCOUNTS_MANAGER. Approving still needs
`payment_requests.approve` AND being listed by the matrix.

## Tests
slab resolution incl. boundaries; branch rule beats all-branch rule; overlap refused; 2-level flow; creator
can't approve; same user can't approve two levels; approver-may-pay false blocks payout; deactivated approver
ignored; rule change doesn't affect already-submitted requests (snapshot).

## Done checklist (built 2026-10-27)
- [x] schema + migration `20261027140000_payment_approval_matrix` (+ CHECKs: role XOR user, level 1–3, amounts) + rollback
- [x] resolver + decision service (`approval-matrix.service.ts`; request plan frozen in `approvalPlanJson`, current level's
      approvers copied to `currentApprover*` columns for SQL filtering)
- [x] admin UI `/accounts/payment-requests/approval-matrix` + request timeline + "To Approve" filter
- [x] in-app notifications (named approvers of the next level; raiser on final approve/reject). A level with no
      rule ("any approver") notifies nobody — too many users.
- [x] tests (approval-matrix.service.test.ts + request multi-level tests), full suite 3635 green, live API check

As built (differences from the plan above):
- RBAC module `payment_request_settings` (view/edit): ACCOUNTS_MANAGER view+edit, MANAGEMENT view.
- SUPER_ADMIN role holders may decide any level (override); still never two levels of one request.
- Editing a request is blocked once any level is approved; before that, editing re-resolves the plan.
- `approverMayPay` is stored on the request; the payout skill must enforce it.
- Per-type enable/disable (old `PaymentRequestTypeSetting`) not built — not needed yet.
