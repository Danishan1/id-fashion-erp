"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { textInputClass } from "@/components/ui/FormField";
import { REVIEW_STATUSES, type ReviewStatus, type ReviewSubject } from "@/modules/sales-marketing/content/content-registry";
import { Badge, send } from "../delivery/delivery-ui";

/** Shared bits of the Phase 11 content screens. */

export { Badge, CARD, fmtDateTime, send, useApi } from "../delivery/delivery-ui";

type Tone = "zinc" | "green" | "amber" | "indigo" | "red";

export function ReviewBadge({ status }: { status: string }) {
  const s = REVIEW_STATUSES[status as ReviewStatus] ?? REVIEW_STATUSES.DRAFT;
  return (
    <span title={s.help}>
      <Badge tone={s.tone as Tone}>{s.label}</Badge>
    </span>
  );
}

export function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

export const fileUrl = (assetVersionId: string, inline = false) => `/api/v1/sales-marketing/content/assets/versions/${assetVersionId}/file${inline ? "?disposition=inline" : ""}`;

/**
 * Review buttons for one immutable version. The server decides who may do
 * what (an author can't approve their own version); the flags here only
 * hide buttons that would certainly be refused.
 */
export function ReviewActions({
  subjectType,
  subjectId,
  status,
  canEdit,
  canApprove,
  canReject,
  isAuthor,
  onDone,
}: {
  subjectType: ReviewSubject;
  subjectId: string;
  status: string;
  canEdit: boolean;
  canApprove: boolean;
  canReject: boolean;
  isAuthor: boolean;
  onDone: (msg: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<null | "request_changes" | "reject">(null);
  const [comment, setComment] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const act = async (action: string, body: Record<string, unknown> = {}, msg = "Done.") => {
    setBusy(true);
    setErr(null);
    try {
      await send(`/api/v1/sales-marketing/content/reviews/${subjectType}/${subjectId}/${action}`, "POST", body);
      setDialog(null);
      setComment("");
      onDone(msg);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const pending = status === "PENDING";
  const decidable = pending && !isAuthor;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {canEdit && (status === "DRAFT" || status === "WITHDRAWN") && (
          <Button size="xs" disabled={busy} onClick={() => act("submit", {}, "Submitted for review.")}>
            Submit for review
          </Button>
        )}
        {canEdit && pending && isAuthor && (
          <Button size="xs" variant="secondary" disabled={busy} onClick={() => act("withdraw", {}, "Withdrawn.")}>
            Withdraw
          </Button>
        )}
        {canApprove && decidable && (
          <Button size="xs" variant="success" disabled={busy} onClick={() => act("approve", {}, "Approved.")}>
            Approve
          </Button>
        )}
        {canReject && decidable && (
          <>
            <Button size="xs" variant="secondary" disabled={busy} onClick={() => setDialog("request_changes")}>
              Request changes
            </Button>
            <Button size="xs" variant="danger" disabled={busy} onClick={() => setDialog("reject")}>
              Reject
            </Button>
          </>
        )}
        {pending && isAuthor && (canApprove || canReject) && <span className="text-xs text-zinc-500">You wrote or submitted this version, so someone else must decide it.</span>}
      </div>
      {dialog && (
        <div className="flex flex-wrap items-center gap-2">
          <input className={`${textInputClass()} !w-80`} placeholder={dialog === "reject" ? "Why is it rejected?" : "What should change?"} value={comment} onChange={(e) => setComment(e.target.value)} />
          <Button size="xs" variant={dialog === "reject" ? "danger" : "primary"} disabled={busy || comment.trim().length < 3} onClick={() => act(dialog, { comment }, dialog === "reject" ? "Rejected." : "Changes requested.")}>
            Confirm
          </Button>
          <Button size="xs" variant="secondary" onClick={() => setDialog(null)}>
            Cancel
          </Button>
        </div>
      )}
      {err && <p className="text-sm text-red-700 dark:text-red-400">{err}</p>}
    </div>
  );
}
