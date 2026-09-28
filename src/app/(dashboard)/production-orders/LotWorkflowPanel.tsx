"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { todayIsoDate } from "@/lib/date";
import { getApiErrorMessage } from "@/lib/api-client";
import { LOT_STATUS_LABELS, JOB_ORDER_STATUS_LABELS } from "./statusLabels";

type LotStatus = keyof typeof LOT_STATUS_LABELS;
type JobOrderStatus = keyof typeof JOB_ORDER_STATUS_LABELS;

interface Assignment {
  id: string;
  assignedQuantity: string;
  status: string;
  assignedAt?: string;
  expectedStartAt?: string | null;
  expectedEndAt?: string | null;
  /** completed + rejected + damaged − extra across this worker's entries (incl. pending). */
  loggedQuantity?: number;
  remainingQuantity?: number;
  employee: { id: string; fullName: string; employeeCode: string };
}

interface JobOrderRow {
  id: string;
  jobNumber: string;
  plannedQuantity: string;
  completedQuantity: string;
  rejectedQuantity: string;
  damagedQuantity: string;
  extraQuantity?: string;
  forwardedQuantity: string;
  qcPassedQuantity: string;
  status: JobOrderStatus;
  productionStage: { id: string; name: string; code: string; sequence: number; isFinal?: boolean; allowsExtraQuantity?: boolean };
  assignments: Assignment[];
  /** Pieces still free to hand to a worker or a contractor (server-computed). */
  availableToAssign?: number;
}

interface LotVariantBreakdownRow {
  id: string;
  quantity: string;
  productVariant: { id: string; skuCode: string; color: { name: string }; size: { name: string } };
}

interface LotDetail {
  id: string;
  lotNumber: string;
  quantity: string;
  status: LotStatus;
  uom: { id: string; code: string };
  currentStage: { id: string; name: string } | null;
  variantBreakdown: LotVariantBreakdownRow[];
  jobOrders: JobOrderRow[];
}

interface StageOption {
  id: string;
  name: string;
  code: string;
  sequence: number;
  isActive: boolean;
  isFinal: boolean;
  allowRework: boolean;
}

interface EmployeeOption {
  id: string;
  fullName: string;
  employeeCode: string;
}

interface WarehouseOption {
  id: string;
  name: string;
}

interface DefectTypeOption {
  id: string;
  name: string;
}

interface ContractorOption {
  id: string;
  name: string;
  isActive?: boolean;
  stages?: { productionStageId: string }[];
}

interface JobWorkStageOption {
  id: string;
  code: string;
  name: string;
  sequence: number;
  isFinal: boolean;
  defaultRate: number | null;
  defaultSource: "STYLE_DEFAULT" | "DESIGN_OVERRIDE" | "NOT_CONFIGURED";
}

interface JobWorkOptions {
  availableToIssue: number;
  style: { id: string; name: string; code: string };
  design: { id: string; label: string | null } | null;
  stages: JobWorkStageOption[];
}

interface ExtraChargeDraft {
  costType: string;
  description: string;
  amount: string;
}

const COST_SOURCE_LABELS: Record<JobWorkStageOption["defaultSource"], string> = {
  STYLE_DEFAULT: "Style default",
  DESIGN_OVERRIDE: "Design cost",
  NOT_CONFIGURED: "Not configured",
};

const ACTIVE_ASSIGNMENT = new Set(["ASSIGNED", "IN_PROGRESS"]);

function activeAssignmentsOf(jo: JobOrderRow) {
  return jo.assignments.filter((a) => ACTIVE_ASSIGNMENT.has(a.status));
}

function remainingOf(jo: JobOrderRow) {
  return (
    Number(jo.plannedQuantity) +
    Number(jo.extraQuantity ?? 0) -
    Number(jo.completedQuantity) -
    Number(jo.rejectedQuantity) -
    Number(jo.damagedQuantity)
  );
}

/** "yyyy-MM-ddTHH:mm" in LOCAL time for <input type="datetime-local">. */
function toLocalDateTimeInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDateTime(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** Whole, non-negative piece count, or null when the field isn't a valid one. */
function parsePieces(value: string): number | null {
  if (value.trim() === "") return 0;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

function formatMoney(n: number) {
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function ModalError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
      {message}
    </p>
  );
}

export function LotWorkflowPanel({
  lotId,
  productionOrderId,
  initialLot,
}: {
  lotId: string;
  productionOrderId: string;
  initialLot: LotDetail;
}) {
  const [lot, setLot] = useState(initialLot);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const [stages, setStages] = useState<StageOption[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [defectTypes, setDefectTypes] = useState<DefectTypeOption[]>([]);
  const [contractors, setContractors] = useState<ContractorOption[]>([]);

  const [jobWorkTarget, setJobWorkTarget] = useState<JobOrderRow | null>(null);
  const [jobWorkContractorId, setJobWorkContractorId] = useState("");
  const [jobWorkQty, setJobWorkQty] = useState("");
  const [jobWorkIssueDate, setJobWorkIssueDate] = useState(todayIsoDate());
  const [jobWorkExpectedDate, setJobWorkExpectedDate] = useState("");
  const [jobWorkRemarks, setJobWorkRemarks] = useState("");
  const [jobWorkOptions, setJobWorkOptions] = useState<JobWorkOptions | null>(null);
  const [jobWorkOptionsError, setJobWorkOptionsError] = useState<string | null>(null);
  const [jobWorkThroughStageId, setJobWorkThroughStageId] = useState("");
  const [jobWorkRates, setJobWorkRates] = useState<Record<string, string>>({});
  const [jobWorkExtras, setJobWorkExtras] = useState<ExtraChargeDraft[]>([]);
  const [jobWorkFgWarehouseId, setJobWorkFgWarehouseId] = useState("");
  const [createdJobWorkOrderId, setCreatedJobWorkOrderId] = useState<string | null>(null);

  const [showStart, setShowStart] = useState(false);
  const [startStageId, setStartStageId] = useState("");

  const [assignTarget, setAssignTarget] = useState<JobOrderRow | null>(null);
  const [assignEmployeeId, setAssignEmployeeId] = useState("");
  const [assignQty, setAssignQty] = useState("");
  const [assignExpectedStart, setAssignExpectedStart] = useState("");
  const [assignExpectedEnd, setAssignExpectedEnd] = useState("");
  // Piece-Rate (2026-09-18) — optional; only meaningful once the company has
  // enabled piece-rate tracking (Admin -> Production Settings). Left blank,
  // assignWorker() behaves exactly as before.
  const [productionOperations, setProductionOperations] = useState<{ id: string; name: string; code: string }[]>([]);
  const [assignOperationId, setAssignOperationId] = useState("");
  const [assignResolution, setAssignResolution] = useState<
    { resolved: true; rate: number; source: string } | { resolved: false } | null
  >(null);
  const [assignOverrideRate, setAssignOverrideRate] = useState("");
  const [assignOverrideReason, setAssignOverrideReason] = useState("");

  const [progressTarget, setProgressTarget] = useState<JobOrderRow | null>(null);
  const [progressAssignmentId, setProgressAssignmentId] = useState("");
  const [progressCompleted, setProgressCompleted] = useState("0");
  const [progressRejected, setProgressRejected] = useState("0");
  const [progressDamaged, setProgressDamaged] = useState("0");
  const [progressExtra, setProgressExtra] = useState("0");
  const [progressRemarks, setProgressRemarks] = useState("");

  const [forwardTarget, setForwardTarget] = useState<JobOrderRow | null>(null);
  const [forwardQty, setForwardQty] = useState("");
  const [forwardTargetStageId, setForwardTargetStageId] = useState("");
  const [forwardFgWarehouseId, setForwardFgWarehouseId] = useState("");

  const [revertTarget, setRevertTarget] = useState<JobOrderRow | null>(null);
  const [revertQty, setRevertQty] = useState("");
  const [revertStageId, setRevertStageId] = useState("");
  const [revertReason, setRevertReason] = useState("");

  const [qcTarget, setQcTarget] = useState<JobOrderRow | null>(null);
  const [qcInspected, setQcInspected] = useState("0");
  const [qcAccepted, setQcAccepted] = useState("0");
  const [qcRejected, setQcRejected] = useState("0");
  const [qcDamaged, setQcDamaged] = useState("0");
  const [qcResult, setQcResult] = useState<"PASS" | "PARTIAL_PASS" | "FAIL">("PASS");
  const [qcReworkStageId, setQcReworkStageId] = useState("");
  const [qcDamageWarehouseId, setQcDamageWarehouseId] = useState("");
  const [qcFgWarehouseId, setQcFgWarehouseId] = useState("");
  const [qcRemarks, setQcRemarks] = useState("");

  useEffect(() => {
    fetch("/api/v1/production-stages")
      .then((res) => res.json())
      .then((body) => setStages(body.data ?? []));
    fetch("/api/v1/employees?pageSize=200")
      .then((res) => res.json())
      .then((body) => setEmployees(body.data ?? []));
    fetch("/api/v1/warehouses?pageSize=200")
      .then((res) => res.json())
      .then((body) => setWarehouses(body.data ?? []));
    fetch("/api/v1/defect-types")
      .then((res) => res.json())
      .then((body) => setDefectTypes(body.data ?? []));
    // The real Contractor master (Masters -> Contractors) — promoted out of
    // Supplier's own former "Job-Work Contractor" flag (2026-09-25), which
    // used to list every active Supplier undifferentiated (fabric/trims/
    // packaging/machinery vendors included); now scoped to genuine external
    // job-work contractors, a wholly separate entity from Supplier.
    fetch("/api/v1/contractors?pageSize=200")
      .then((res) => res.json())
      .then((body) => setContractors(body.data ?? []));
    fetch("/api/v1/production-operations")
      .then((res) => res.json())
      .then((body) => setProductionOperations(body.data ?? []))
      .catch(() => {});
  }, []);

  // Piece-Rate (2026-09-18) — live preview in the Assign Worker modal;
  // never mutates anything, assignWorker() re-resolves for real.
  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(async () => {
      if (!assignTarget || !assignEmployeeId || !assignOperationId) {
        if (!cancelled) setAssignResolution(null);
        return;
      }
      try {
        const res = await fetch("/api/v1/piece-rate-cards/resolve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobOrderId: assignTarget.id, employeeId: assignEmployeeId, productionOperationId: assignOperationId }),
        });
        const body = await res.json();
        if (!cancelled) setAssignResolution(res.ok ? (body.data ?? null) : null);
      } catch {
        if (!cancelled) setAssignResolution(null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [assignTarget, assignEmployeeId, assignOperationId]);

  const refresh = async () => {
    const res = await fetch(`/api/v1/lots/${lotId}`);
    const body = await res.json();
    if (res.ok) setLot(body.data);
  };

  // Errors are shown INSIDE the open modal (previously they rendered behind
  // the modal overlay, so a failed Assign Worker looked like a silent no-op)
  // and also raised as a toast by the global API interceptor.
  const run = async (action: () => Promise<Response>, fallbackError: string) => {
    setIsBusy(true);
    setError(null);
    try {
      const res = await action();
      if (!res.ok) {
        setError(await getApiErrorMessage(res, fallbackError));
        return false;
      }
      await refresh();
      return true;
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
      return false;
    } finally {
      setIsBusy(false);
    }
  };

  const openModal = (open: () => void) => {
    setError(null);
    open();
  };

  // ── Send to External Job-Work: planning options (stages + default costs) ──
  const openJobWork = (jo: JobOrderRow) => {
    openModal(() => {
      setJobWorkTarget(jo);
      setJobWorkQty(String(Math.max(0, jo.availableToAssign ?? remainingOf(jo))));
      setCreatedJobWorkOrderId(null);
      setJobWorkOptions(null);
      setJobWorkOptionsError(null);
      setJobWorkThroughStageId(jo.productionStage.id);
      setJobWorkRates({});
      setJobWorkExtras([]);
      setJobWorkFgWarehouseId("");
      setJobWorkContractorId("");
    });
    fetch(`/api/v1/job-orders/${jo.id}/job-work-options`)
      .then(async (res) => {
        if (!res.ok) throw new Error(await getApiErrorMessage(res, "Could not load job-work options."));
        return res.json();
      })
      .then((body) => {
        const options: JobWorkOptions = body.data;
        setJobWorkOptions(options);
        setJobWorkRates(
          Object.fromEntries(options.stages.map((st) => [st.id, st.defaultRate === null ? "" : String(st.defaultRate)])),
        );
      })
      .catch((err: Error) => setJobWorkOptionsError(err.message));
  };

  const nextStageAfter = (sequence: number) =>
    stages.filter((s) => s.isActive && s.sequence > sequence).sort((a, b) => a.sequence - b.sequence)[0];

  const submitStart = async () => {
    const ok = await run(
      () =>
        fetch(`/api/v1/lots/${lotId}/start`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stageId: startStageId || undefined }),
        }),
      "Failed to start this lot."
    );
    if (ok) setShowStart(false);
  };

  const submitAssign = async () => {
    if (!assignTarget) return;
    const ok = await run(
      () =>
        fetch(`/api/v1/job-orders/${assignTarget.id}/assignments`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-toast-success": "Worker assigned successfully." },
          body: JSON.stringify({
            employeeId: assignEmployeeId,
            assignedQuantity: Number(assignQty),
            expectedStartAt: assignExpectedStart ? new Date(assignExpectedStart).toISOString() : undefined,
            expectedEndAt: assignExpectedEnd ? new Date(assignExpectedEnd).toISOString() : "",
            productionOperationId: assignOperationId || undefined,
            overriddenRate: assignOverrideRate ? Number(assignOverrideRate) : undefined,
            overrideReason: assignOverrideReason || undefined,
          }),
        }),
      "Failed to assign this worker."
    );
    if (ok) {
      setAssignTarget(null);
      setAssignEmployeeId("");
      setAssignQty("");
      setAssignExpectedStart("");
      setAssignExpectedEnd("");
      setAssignOperationId("");
      setAssignResolution(null);
      setAssignOverrideRate("");
      setAssignOverrideReason("");
    }
  };

  const submitProgress = async () => {
    if (!progressTarget) return;
    const ok = await run(
      () =>
        fetch(`/api/v1/job-orders/${progressTarget.id}/progress-entries`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-toast-success": "Production logged successfully." },
          body: JSON.stringify({
            jobOrderAssignmentId: progressAssignmentId,
            completedQuantity: Number(progressCompleted || 0),
            rejectedQuantity: Number(progressRejected || 0),
            damagedQuantity: Number(progressDamaged || 0),
            extraQuantity: Number(progressExtra || 0),
            remarks: progressRemarks || undefined,
          }),
        }),
      "Failed to record progress."
    );
    if (ok) {
      setProgressTarget(null);
      setProgressAssignmentId("");
      setProgressCompleted("0");
      setProgressRejected("0");
      setProgressDamaged("0");
      setProgressExtra("0");
      setProgressRemarks("");
    }
  };

  const submitForward = async () => {
    if (!forwardTarget) return;
    const ok = await run(
      () =>
        fetch(`/api/v1/job-orders/${forwardTarget.id}/forward`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            quantity: Number(forwardQty),
            targetStageId: forwardTargetStageId || undefined,
            finishedGoodsWarehouseId: forwardFgWarehouseId || undefined,
          }),
        }),
      "Failed to forward this job order."
    );
    if (ok) {
      setForwardTarget(null);
      setForwardQty("");
      setForwardTargetStageId("");
      setForwardFgWarehouseId("");
    }
  };

  const submitRevert = async () => {
    if (!revertTarget) return;
    const ok = await run(
      () =>
        fetch(`/api/v1/job-orders/${revertTarget.id}/revert`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ quantity: Number(revertQty), targetStageId: revertStageId, reason: revertReason }),
        }),
      "Failed to revert this job order."
    );
    if (ok) {
      setRevertTarget(null);
      setRevertQty("");
      setRevertStageId("");
      setRevertReason("");
    }
  };

  const submitQc = async () => {
    if (!qcTarget) return;
    const ok = await run(
      () =>
        fetch(`/api/v1/job-orders/${qcTarget.id}/qc-inspections`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            inspectedQuantity: Number(qcInspected),
            acceptedQuantity: Number(qcAccepted),
            rejectedQuantity: Number(qcRejected),
            damagedQuantity: Number(qcDamaged),
            result: qcResult,
            reworkTargetStageId: qcReworkStageId || undefined,
            damageWarehouseId: qcDamageWarehouseId || undefined,
            finishedGoodsWarehouseId: qcFgWarehouseId || undefined,
            remarks: qcRemarks || undefined,
          }),
        }),
      "Failed to record this QC inspection."
    );
    if (ok) {
      setQcTarget(null);
      setQcInspected("0");
      setQcAccepted("0");
      setQcRejected("0");
      setQcDamaged("0");
      setQcResult("PASS");
      setQcReworkStageId("");
      setQcDamageWarehouseId("");
      setQcFgWarehouseId("");
      setQcRemarks("");
    }
  };

  const submitJobWork = async () => {
    if (!jobWorkTarget) return;
    setIsBusy(true);
    setError(null);
    let res: Response;
    try {
      res = await fetch("/api/v1/job-work-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-toast-success": "Sent to external job-work successfully." },
        body: JSON.stringify({
          jobOrderId: jobWorkTarget.id,
          contractorId: jobWorkContractorId,
          issuedQuantity: Number(jobWorkQty),
          uomId: lot.uom.id,
          issueDate: jobWorkIssueDate,
          expectedCompletionDate: jobWorkExpectedDate || undefined,
          remarks: jobWorkRemarks || undefined,
          throughStageId: jobWorkThroughStageId || undefined,
          stageCosts: (() => {
            const all = jobWorkOptions?.stages ?? [];
            const end = all.findIndex((st) => st.id === jobWorkThroughStageId);
            return all
              .slice(0, end === -1 ? 1 : end + 1)
              .map((st) => ({ productionStageId: st.id, rate: Number(jobWorkRates[st.id]) }));
          })(),
          extraCharges: jobWorkExtras
            .filter((x) => x.costType.trim() || x.amount)
            .map((x) => ({ costType: x.costType.trim(), description: x.description || undefined, amount: Number(x.amount || 0) })),
          finishedGoodsWarehouseId: jobWorkFgWarehouseId || undefined,
        }),
      });
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
      setIsBusy(false);
      return;
    }
    if (!res.ok) {
      setError(await getApiErrorMessage(res, "Failed to send this job order to job-work."));
      setIsBusy(false);
      return;
    }
    const body = await res.json();
    await refresh();
    setIsBusy(false);
    setJobWorkTarget(null);
    setJobWorkContractorId("");
    setJobWorkQty("");
    setJobWorkExpectedDate("");
    setJobWorkRemarks("");
    setCreatedJobWorkOrderId(body.data.id);
  };

  const canAct = lot.status === "PLANNED" || lot.status === "IN_PROGRESS";

  // ── Derived job-work cost sheet ──
  const jobWorkCoveredStages: JobWorkStageOption[] = (() => {
    if (!jobWorkOptions) return [];
    const end = jobWorkOptions.stages.findIndex((st) => st.id === jobWorkThroughStageId);
    return jobWorkOptions.stages.slice(0, end === -1 ? 1 : end + 1);
  })();
  const jobWorkQtyNumber = Number(jobWorkQty) || 0;
  const jobWorkStageAmounts = jobWorkCoveredStages.map((st) => {
    const rate = jobWorkRates[st.id] === "" || jobWorkRates[st.id] === undefined ? null : Number(jobWorkRates[st.id]);
    return { stage: st, rate, amount: rate === null || Number.isNaN(rate) ? 0 : Math.round(rate * jobWorkQtyNumber * 100) / 100 };
  });
  const jobWorkStageTotal = jobWorkStageAmounts.reduce((sum, r) => sum + r.amount, 0);
  const jobWorkExtraTotal = jobWorkExtras.reduce((sum, x) => sum + (Number(x.amount) || 0), 0);
  const jobWorkMissingRate = jobWorkStageAmounts.find((r) => r.rate === null || Number.isNaN(r.rate) || r.rate < 0);
  const jobWorkEndsAtFinal = jobWorkCoveredStages.length > 1 && !!jobWorkCoveredStages[jobWorkCoveredStages.length - 1]?.isFinal;
  const jobWorkContractorOptions = contractors.filter((c) => {
    if (c.isActive === false) return false;
    const ids = new Set((c.stages ?? []).map((s) => s.productionStageId));
    return ids.size === 0 || jobWorkCoveredStages.every((st) => ids.has(st.id));
  });
  const jobWorkQtyError = (() => {
    const n = Number(jobWorkQty);
    if (!jobWorkQty) return "Quantity is required.";
    if (!Number.isInteger(n) || n <= 0) return "Quantity must be a whole number greater than 0.";
    if (jobWorkOptions && n > jobWorkOptions.availableToIssue) return `Only ${jobWorkOptions.availableToIssue} pieces are free to send.`;
    return null;
  })();

  // ── Assign Worker client-side validation (the API re-checks everything) ──
  const assignAvailable = assignTarget ? Math.max(0, assignTarget.availableToAssign ?? remainingOf(assignTarget)) : 0;
  const assignQtyError = (() => {
    if (!assignQty) return "Assigned quantity is required.";
    const n = Number(assignQty);
    if (!Number.isInteger(n)) return "Assigned quantity must be a whole number of pieces.";
    if (n <= 0) return "Assigned quantity must be greater than 0.";
    if (n > assignAvailable) return `Assigned quantity cannot be greater than available quantity (${assignAvailable}).`;
    return null;
  })();
  const assignTimeError = (() => {
    if (!assignExpectedEnd) return "Expected completion time is required.";
    const end = new Date(assignExpectedEnd).getTime();
    if (Number.isNaN(end)) return "Expected completion time is not valid.";
    // Start is pre-filled with "now" when the modal opens; the server also
    // rejects a completion time in the past.
    if (assignExpectedStart) {
      const start = new Date(assignExpectedStart).getTime();
      if (Number.isNaN(start)) return "Expected start time is not valid.";
      if (end <= start) return "Expected completion must be after the expected start.";
    }
    return null;
  })();

  // ── Log Progress client-side validation ──
  const progressAssignment = progressTarget
    ? activeAssignmentsOf(progressTarget).find((a) => a.id === progressAssignmentId) ?? null
    : null;
  const progressAllowsExtra = !!progressTarget?.productionStage.allowsExtraQuantity;
  const progressValidation = (() => {
    const completed = parsePieces(progressCompleted);
    const rejected = parsePieces(progressRejected);
    const damaged = parsePieces(progressDamaged);
    const extra = progressAllowsExtra ? parsePieces(progressExtra) : 0;
    if (!progressAssignment) return { error: "Select an assigned worker.", consumed: 0 };
    if (completed === null || rejected === null || damaged === null || extra === null) {
      return { error: "Quantities must be whole numbers of pieces (0 or more).", consumed: 0 };
    }
    if (completed + rejected + damaged <= 0) return { error: "Enter at least one completed, rejected or damaged piece.", consumed: 0 };
    if (extra > completed) return { error: "Extra pieces are part of Completed and cannot exceed it.", consumed: 0 };
    const consumed = completed + rejected + damaged - extra;
    const remaining = progressAssignment.remainingQuantity ?? Number(progressAssignment.assignedQuantity);
    if (consumed > remaining) {
      return {
        error: `Completed + Rejected + Damage (${completed + rejected + damaged}${extra ? ` − ${extra} extra` : ""} = ${consumed}) cannot exceed ${progressAssignment.employee.fullName}'s remaining ${remaining} assigned pieces.${
          progressAllowsExtra ? " Record genuinely extra cut pieces in \"Extra\"." : ""
        }`,
        consumed,
      };
    }
    return { error: null, consumed };
  })();

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-3">
        <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
          {LOT_STATUS_LABELS[lot.status]}
        </span>
        <span className="text-sm text-zinc-600 dark:text-zinc-300">
          {lot.quantity} {lot.uom.code}
        </span>
        {lot.currentStage && (
          <span className="text-sm text-zinc-500" title="A lot's quantity can be split across more than one stage at once (e.g. after a partial forward or rework) — this reflects only the most recent stage transition, not necessarily every stage the lot's quantity currently sits at. See the job orders below for the full picture.">
            Last stage transition: {lot.currentStage.name}
          </span>
        )}
        {isBusy && <span className="text-xs text-zinc-400">Saving…</span>}
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {lot.variantBreakdown.length > 0 && (
        <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Size / Color Breakdown</h2>
          <p className="mb-2 text-xs text-zinc-500">
            What this lot&apos;s {lot.quantity} {lot.uom.code} is actually made of — same at every stage below.
          </p>
          <div className="overflow-x-auto">
            <table className="text-sm">
              <thead>
                <tr className="text-left text-xs text-zinc-500">
                  <th className="py-1 pr-6 font-medium">Color</th>
                  <th className="py-1 pr-6 font-medium">Size</th>
                  <th className="py-1 font-medium">Quantity</th>
                </tr>
              </thead>
              <tbody>
                {lot.variantBreakdown.map((row) => (
                  <tr key={row.id} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className="py-1.5 pr-6 text-zinc-700 dark:text-zinc-200">{row.productVariant.color.name}</td>
                    <td className="py-1.5 pr-6 text-zinc-700 dark:text-zinc-200">{row.productVariant.size.name}</td>
                    <td className="py-1.5 font-medium text-zinc-900 dark:text-zinc-50">{row.quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {createdJobWorkOrderId && (
        <p className="text-sm text-emerald-600 dark:text-emerald-400">
          Sent to job-work —{" "}
          <Link href={`/production/job-work/${createdJobWorkOrderId}`} className="underline">
            view the job-work order →
          </Link>
        </p>
      )}

      {lot.status === "PLANNED" && (
        <button
          type="button"
          onClick={() => setShowStart(true)}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
        >
          Start Lot
        </button>
      )}

      <div className="space-y-4">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Job Orders</h2>
        {lot.jobOrders.length === 0 && <p className="text-sm text-zinc-500">This lot hasn&apos;t entered any stage yet.</p>}
        {lot.jobOrders.map((jo) => {
          const remaining = remainingOf(jo);
          const notYetForwarded = Number(jo.completedQuantity) - Number(jo.forwardedQuantity);
          const notYetInspected = Number(jo.completedQuantity) - Number(jo.qcPassedQuantity);
          const isTerminal = jo.status === "CANCELLED" || !canAct;
          return (
            <div key={jo.id} className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                  {jo.productionStage.name} <span className="text-xs text-zinc-400">({jo.jobNumber})</span>
                </div>
                <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                  {JOB_ORDER_STATUS_LABELS[jo.status] ?? jo.status}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-zinc-600 dark:text-zinc-300 sm:grid-cols-4">
                <div>Planned: {jo.plannedQuantity}</div>
                <div>Completed: {jo.completedQuantity}</div>
                <div>Rejected: {jo.rejectedQuantity}</div>
                <div>Damaged: {jo.damagedQuantity}</div>
                <div>Remaining: {remaining}</div>
                <div>Forwarded: {jo.forwardedQuantity}</div>
                <div>QC&apos;d: {jo.qcPassedQuantity}</div>
                {Number(jo.extraQuantity ?? 0) > 0 && <div className="text-emerald-700 dark:text-emerald-400">Extra pieces: {jo.extraQuantity}</div>}
                {jo.availableToAssign !== undefined && !isTerminal && <div>Free to assign: {jo.availableToAssign}</div>}
              </div>
              {jo.assignments.length > 0 && (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-zinc-500">
                        <th className="py-1 pr-3 font-medium">Worker</th>
                        <th className="py-1 pr-3 font-medium">Assigned</th>
                        <th className="py-1 pr-3 font-medium">Logged</th>
                        <th className="py-1 pr-3 font-medium">Remaining</th>
                        <th className="py-1 pr-3 font-medium">Expected</th>
                        <th className="py-1 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {jo.assignments.map((a) => (
                        <tr key={a.id} className="border-t border-zinc-100 text-zinc-700 dark:border-zinc-800 dark:text-zinc-300">
                          <td className="py-1 pr-3">{a.employee.fullName}</td>
                          <td className="py-1 pr-3">{a.assignedQuantity}</td>
                          <td className="py-1 pr-3">{a.loggedQuantity ?? "—"}</td>
                          <td className="py-1 pr-3">{a.remainingQuantity ?? "—"}</td>
                          <td className="py-1 pr-3" title={a.expectedStartAt ? `From ${formatDateTime(a.expectedStartAt)}` : undefined}>
                            {formatDateTime(a.expectedEndAt)}
                          </td>
                          <td className="py-1">{a.status.replaceAll("_", " ").toLowerCase()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <a
                href={`/api/v1/lots/${lot.id}/job-orders/${jo.id}/stage-slip`}
                className="mt-2 inline-block text-xs font-medium text-indigo-600 hover:text-indigo-500"
              >
                Download Stage Transfer Slip
              </a>
              {!isTerminal && (
                <div className="mt-3 flex flex-wrap gap-3 text-xs font-medium">
                  <button
                    type="button"
                    onClick={() =>
                      openModal(() => {
                        setAssignTarget(jo);
                        setAssignQty("");
                        setAssignExpectedStart(toLocalDateTimeInput(new Date()));
                        setAssignExpectedEnd("");
                      })
                    }
                    className="text-indigo-600 hover:text-indigo-500"
                  >
                    Assign Worker
                  </button>
                  {remaining > 0 && (
                    <button
                      type="button"
                      disabled={activeAssignmentsOf(jo).length === 0}
                      title={activeAssignmentsOf(jo).length === 0 ? "Please assign a worker before logging the production process." : undefined}
                      onClick={() =>
                        openModal(() => {
                          setProgressTarget(jo);
                          setProgressAssignmentId(activeAssignmentsOf(jo)[0]?.id ?? "");
                          setProgressCompleted("0");
                          setProgressRejected("0");
                          setProgressDamaged("0");
                          setProgressExtra("0");
                        })
                      }
                      className="text-indigo-600 hover:text-indigo-500 disabled:cursor-not-allowed disabled:text-zinc-400"
                    >
                      Log Progress
                    </button>
                  )}
                  {notYetForwarded > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setForwardTarget(jo);
                        setForwardQty(String(notYetForwarded));
                        setForwardTargetStageId(nextStageAfter(jo.productionStage.sequence)?.id ?? "");
                      }}
                      className="text-indigo-600 hover:text-indigo-500"
                    >
                      Forward
                    </button>
                  )}
                  {remaining > 0 && (
                    <button type="button" onClick={() => setRevertTarget(jo)} className="text-amber-600 hover:text-amber-500">
                      Revert
                    </button>
                  )}
                  {remaining > 0 && (
                    <button type="button" onClick={() => openJobWork(jo)} className="text-purple-600 hover:text-purple-500">
                      Send to Job-Work
                    </button>
                  )}
                  {notYetInspected > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setQcTarget(jo);
                        setQcInspected(String(notYetInspected));
                        setQcAccepted(String(notYetInspected));
                        setQcRejected("0");
                        setQcDamaged("0");
                      }}
                      className="text-indigo-600 hover:text-indigo-500"
                    >
                      QC
                    </button>
                  )}
                </div>
              )}
              {!isTerminal && remaining > 0 && activeAssignmentsOf(jo).length === 0 && (
                <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                  {jo.assignments.some((a) => a.status === "COMPLETED")
                    ? "All assigned workers have logged their pieces — assign a worker for the remaining quantity before logging more."
                    : "Please assign a worker before logging the production process."}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <Modal open={showStart} onClose={() => setShowStart(false)} title="Start Lot">
        <div className="space-y-4">
          <FormField label="Starting Stage (optional — defaults to the first configured stage)" htmlFor="startStageId">
            <select id="startStageId" value={startStageId} onChange={(e) => setStartStageId(e.target.value)} className={textInputClass()}>
              <option value="">— Default —</option>
              {stages
                .filter((s) => s.isActive)
                .sort((a, b) => a.sequence - b.sequence)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
          </FormField>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowStart(false)} className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">
              Cancel
            </button>
            <button type="button" onClick={submitStart} disabled={isBusy} className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60">
              {isBusy ? "Saving…" : "Start"}
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={!!assignTarget} onClose={() => setAssignTarget(null)} title="Assign Worker">
        {assignTarget && (
          <div className="space-y-4">
            <p className="text-xs text-zinc-500">
              {assignTarget.productionStage.name} ({assignTarget.jobNumber}) — <strong>{assignAvailable}</strong> pieces available to assign.
            </p>
            <FormField label="Worker" htmlFor="assignEmployeeId" required>
              <SearchableSelect
                id="assignEmployeeId"
                required
                value={assignEmployeeId}
                onChange={setAssignEmployeeId}
                options={employees.map((e) => ({ id: e.id, label: e.fullName, sublabel: e.employeeCode }))}
                placeholder="Search worker…"
              />
              {!assignEmployeeId && <p className="mt-1 text-xs text-zinc-400">Worker is required.</p>}
            </FormField>
            <FormField label="Assigned Quantity (pieces)" htmlFor="assignQty" required>
              <input
                id="assignQty"
                type="number"
                inputMode="numeric"
                min={1}
                max={assignAvailable || undefined}
                step={1}
                required
                value={assignQty}
                onChange={(e) => setAssignQty(e.target.value)}
                className={textInputClass()}
              />
              {assignQty && assignQtyError && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{assignQtyError}</p>}
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Expected Start" htmlFor="assignExpectedStart">
                <input
                  id="assignExpectedStart"
                  type="datetime-local"
                  value={assignExpectedStart}
                  onChange={(e) => setAssignExpectedStart(e.target.value)}
                  className={textInputClass()}
                />
              </FormField>
              <FormField label="Expected Completion" htmlFor="assignExpectedEnd" required>
                <input
                  id="assignExpectedEnd"
                  type="datetime-local"
                  required
                  value={assignExpectedEnd}
                  min={assignExpectedStart || undefined}
                  onChange={(e) => setAssignExpectedEnd(e.target.value)}
                  className={textInputClass()}
                />
              </FormField>
            </div>
            {assignExpectedEnd && assignTimeError && <p className="text-xs text-red-600 dark:text-red-400">{assignTimeError}</p>}
            {productionOperations.length > 0 && (
              <>
                <FormField label="Operation (Piece-Rate, optional)" htmlFor="assignOperationId">
                  <select id="assignOperationId" value={assignOperationId} onChange={(e) => setAssignOperationId(e.target.value)} className={textInputClass()}>
                    <option value="">— None —</option>
                    {productionOperations.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                </FormField>
                {assignOperationId && (
                  <div className="rounded-md border border-zinc-200 bg-zinc-50 p-2 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                    {assignResolution?.resolved ? (
                      <>
                        Resolved Rate: <strong>₹{assignResolution.rate}</strong> (source: {assignResolution.source})
                        {assignQty && <> — Estimated Earning: ₹{(Number(assignQty) * assignResolution.rate).toFixed(2)}</>}
                      </>
                    ) : (
                      <span className="text-amber-700 dark:text-amber-400">
                        No rate configured for this worker/style/operation — set up a Rate Card, or supply an authorized override rate below.
                      </span>
                    )}
                  </div>
                )}
                {assignOperationId && !assignResolution?.resolved && (
                  <div className="grid grid-cols-2 gap-3">
                    <FormField label="Override Rate" htmlFor="assignOverrideRate">
                      <input id="assignOverrideRate" type="number" min={0} step="0.0001" value={assignOverrideRate} onChange={(e) => setAssignOverrideRate(e.target.value)} className={textInputClass()} />
                    </FormField>
                    <FormField label="Override Reason" htmlFor="assignOverrideReason">
                      <input id="assignOverrideReason" value={assignOverrideReason} onChange={(e) => setAssignOverrideReason(e.target.value)} className={textInputClass()} />
                    </FormField>
                  </div>
                )}
              </>
            )}
            <ModalError message={error} />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setAssignTarget(null)} className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">
                Cancel
              </button>
              <button
                type="button"
                onClick={submitAssign}
                disabled={
                  isBusy ||
                  !assignEmployeeId ||
                  !!assignQtyError ||
                  !!assignTimeError ||
                  (!!assignOperationId && !assignResolution?.resolved && !assignOverrideRate)
                }
                className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
              >
                {isBusy ? "Saving…" : "Assign"}
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!progressTarget} onClose={() => setProgressTarget(null)} title="Log Progress">
        {progressTarget && (
          <div className="space-y-4">
            {activeAssignmentsOf(progressTarget).length === 0 ? (
              <p className="text-sm text-amber-700 dark:text-amber-400">Please assign a worker before logging the production process.</p>
            ) : (
              <FormField label="Assigned Worker" htmlFor="progressAssignmentId" required>
                <select
                  id="progressAssignmentId"
                  required
                  value={progressAssignmentId}
                  onChange={(e) => setProgressAssignmentId(e.target.value)}
                  className={textInputClass()}
                >
                  {activeAssignmentsOf(progressTarget).map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.employee.fullName} — assigned {a.assignedQuantity}, remaining {a.remainingQuantity ?? a.assignedQuantity}
                    </option>
                  ))}
                </select>
              </FormField>
            )}
            {progressAssignment && (
              <div className="grid grid-cols-3 gap-2 rounded-md bg-zinc-50 p-2 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
                <div>Assigned: <strong>{progressAssignment.assignedQuantity}</strong></div>
                <div>Already logged: <strong>{progressAssignment.loggedQuantity ?? 0}</strong></div>
                <div>Remaining: <strong>{progressAssignment.remainingQuantity ?? progressAssignment.assignedQuantity}</strong></div>
              </div>
            )}
            <div className={`grid gap-3 ${progressAllowsExtra ? "grid-cols-4" : "grid-cols-3"}`}>
              <FormField label="Completed" htmlFor="progressCompleted">
                <input id="progressCompleted" type="number" inputMode="numeric" min={0} step={1} value={progressCompleted} onChange={(e) => setProgressCompleted(e.target.value)} className={textInputClass()} />
              </FormField>
              <FormField label="Rejected" htmlFor="progressRejected">
                <input id="progressRejected" type="number" inputMode="numeric" min={0} step={1} value={progressRejected} onChange={(e) => setProgressRejected(e.target.value)} className={textInputClass()} />
              </FormField>
              <FormField label="Damage" htmlFor="progressDamaged">
                <input id="progressDamaged" type="number" inputMode="numeric" min={0} step={1} value={progressDamaged} onChange={(e) => setProgressDamaged(e.target.value)} className={textInputClass()} />
              </FormField>
              {progressAllowsExtra && (
                <FormField label="Extra (of Completed)" htmlFor="progressExtra">
                  <input id="progressExtra" type="number" inputMode="numeric" min={0} step={1} value={progressExtra} onChange={(e) => setProgressExtra(e.target.value)} className={textInputClass()} />
                </FormField>
              )}
            </div>
            <p className="text-xs text-zinc-500">
              Completed + Rejected + Damage must not exceed the worker&apos;s remaining assigned pieces
              {progressAllowsExtra ? " — extra pieces cut beyond the assignment are recorded separately in Extra." : "."}
            </p>
            {progressValidation.error && progressAssignment && (
              <p className="text-xs text-red-600 dark:text-red-400">{progressValidation.error}</p>
            )}
            <FormField label="Remarks" htmlFor="progressRemarks">
              <input id="progressRemarks" value={progressRemarks} onChange={(e) => setProgressRemarks(e.target.value)} className={textInputClass()} />
            </FormField>
            <ModalError message={error} />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setProgressTarget(null)} className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">
                Cancel
              </button>
              <button type="button" onClick={submitProgress} disabled={isBusy || !!progressValidation.error} className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60">
                {isBusy ? "Saving…" : "Log Progress"}
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!forwardTarget} onClose={() => setForwardTarget(null)} title="Forward to Next Stage">
        {forwardTarget && (
          <div className="space-y-4">
            <FormField label="Quantity" htmlFor="forwardQty" required>
              <input id="forwardQty" type="number" min={0} step="0.0001" required value={forwardQty} onChange={(e) => setForwardQty(e.target.value)} className={textInputClass()} />
            </FormField>
            <FormField label="Target Stage" htmlFor="forwardTargetStageId">
              <select id="forwardTargetStageId" value={forwardTargetStageId} onChange={(e) => setForwardTargetStageId(e.target.value)} className={textInputClass()}>
                <option value="">— Immediate next stage —</option>
                {stages
                  .filter((s) => s.isActive && s.sequence > forwardTarget.productionStage.sequence)
                  .sort((a, b) => a.sequence - b.sequence)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                      {s.isFinal ? " (Final)" : ""}
                    </option>
                  ))}
              </select>
            </FormField>
            {(() => {
              const target = forwardTargetStageId
                ? stages.find((s) => s.id === forwardTargetStageId)
                : nextStageAfter(forwardTarget.productionStage.sequence);
              return target?.isFinal ? (
                <FormField label="Finished Goods Warehouse" htmlFor="forwardFgWarehouseId" required>
                  <SearchableSelect
                    id="forwardFgWarehouseId"
                    required
                    value={forwardFgWarehouseId}
                    onChange={setForwardFgWarehouseId}
                    options={warehouses.map((w) => ({ id: w.id, label: w.name }))}
                    placeholder="Search warehouse…"
                  />
                </FormField>
              ) : null;
            })()}
            <ModalError message={error} />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setForwardTarget(null)} className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">
                Cancel
              </button>
              <button type="button" onClick={submitForward} disabled={isBusy || !forwardQty} className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60">
                {isBusy ? "Saving…" : "Forward"}
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!revertTarget} onClose={() => setRevertTarget(null)} title="Revert to Earlier Stage">
        {revertTarget && (
          <div className="space-y-4">
            <FormField label="Target Stage" htmlFor="revertStageId" required>
              <select id="revertStageId" required value={revertStageId} onChange={(e) => setRevertStageId(e.target.value)} className={textInputClass()}>
                <option value="">— Select —</option>
                {stages
                  .filter((s) => s.isActive && s.allowRework && s.sequence < revertTarget.productionStage.sequence)
                  .sort((a, b) => b.sequence - a.sequence)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </FormField>
            <FormField label="Quantity" htmlFor="revertQty" required>
              <input id="revertQty" type="number" min={0} step="0.0001" required value={revertQty} onChange={(e) => setRevertQty(e.target.value)} className={textInputClass()} />
            </FormField>
            <FormField label="Reason" htmlFor="revertReason" required>
              <input id="revertReason" required value={revertReason} onChange={(e) => setRevertReason(e.target.value)} className={textInputClass()} />
            </FormField>
            <ModalError message={error} />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setRevertTarget(null)} className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">
                Cancel
              </button>
              <button
                type="button"
                onClick={submitRevert}
                disabled={isBusy || !revertQty || !revertStageId || !revertReason}
                className="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-500 disabled:opacity-60"
              >
                {isBusy ? "Saving…" : "Revert"}
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!qcTarget} onClose={() => setQcTarget(null)} title="Record QC Inspection" maxWidthClass="max-w-xl">
        {qcTarget && (
          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-3">
              <FormField label="Inspected" htmlFor="qcInspected">
                <input id="qcInspected" type="number" min={0} step="0.0001" value={qcInspected} onChange={(e) => setQcInspected(e.target.value)} className={textInputClass()} />
              </FormField>
              <FormField label="Accepted" htmlFor="qcAccepted">
                <input id="qcAccepted" type="number" min={0} step="0.0001" value={qcAccepted} onChange={(e) => setQcAccepted(e.target.value)} className={textInputClass()} />
              </FormField>
              <FormField label="Rejected" htmlFor="qcRejected">
                <input id="qcRejected" type="number" min={0} step="0.0001" value={qcRejected} onChange={(e) => setQcRejected(e.target.value)} className={textInputClass()} />
              </FormField>
              <FormField label="Damaged" htmlFor="qcDamaged">
                <input id="qcDamaged" type="number" min={0} step="0.0001" value={qcDamaged} onChange={(e) => setQcDamaged(e.target.value)} className={textInputClass()} />
              </FormField>
            </div>
            <p className="text-xs text-zinc-500">Accepted + Rejected + Damaged must equal Inspected.</p>
            <FormField label="Result" htmlFor="qcResult">
              <select id="qcResult" value={qcResult} onChange={(e) => setQcResult(e.target.value as typeof qcResult)} className={textInputClass()}>
                <option value="PASS">Pass</option>
                <option value="PARTIAL_PASS">Partial Pass</option>
                <option value="FAIL">Fail</option>
              </select>
            </FormField>
            {Number(qcAccepted) > 0 && (() => {
              const next = nextStageAfter(qcTarget.productionStage.sequence);
              return next?.isFinal ? (
                <FormField label="Finished Goods Warehouse (accepted quantity completes the lot)" htmlFor="qcFgWarehouseId" required>
                  <SearchableSelect
                    id="qcFgWarehouseId"
                    required
                    value={qcFgWarehouseId}
                    onChange={setQcFgWarehouseId}
                    options={warehouses.map((w) => ({ id: w.id, label: w.name }))}
                    placeholder="Search warehouse…"
                  />
                </FormField>
              ) : null;
            })()}
            {Number(qcRejected) > 0 && (
              <FormField label="Rework Target Stage (for the rejected quantity)" htmlFor="qcReworkStageId" required>
                <select id="qcReworkStageId" required value={qcReworkStageId} onChange={(e) => setQcReworkStageId(e.target.value)} className={textInputClass()}>
                  <option value="">— Select —</option>
                  {stages
                    .filter((s) => s.isActive && s.allowRework && s.sequence < qcTarget.productionStage.sequence)
                    .sort((a, b) => b.sequence - a.sequence)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                </select>
              </FormField>
            )}
            {Number(qcDamaged) > 0 && (
              <FormField label="Damage Warehouse (write-off, fully damaged)" htmlFor="qcDamageWarehouseId" required>
                <SearchableSelect
                  id="qcDamageWarehouseId"
                  required
                  value={qcDamageWarehouseId}
                  onChange={setQcDamageWarehouseId}
                  options={warehouses.map((w) => ({ id: w.id, label: w.name }))}
                  placeholder="Search warehouse…"
                />
              </FormField>
            )}
            {defectTypes.length > 0 && (
              <p className="text-xs text-zinc-400">Defect classification is not yet wired into this form — record the breakdown in Remarks for now.</p>
            )}
            <FormField label="Remarks" htmlFor="qcRemarks">
              <input id="qcRemarks" value={qcRemarks} onChange={(e) => setQcRemarks(e.target.value)} className={textInputClass()} />
            </FormField>
            <ModalError message={error} />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setQcTarget(null)} className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">
                Cancel
              </button>
              <button type="button" onClick={submitQc} disabled={isBusy} className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60">
                {isBusy ? "Saving…" : "Record Inspection"}
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!jobWorkTarget} onClose={() => setJobWorkTarget(null)} title="Send to External Job-Work" maxWidthClass="max-w-2xl">
        {jobWorkTarget && (
          <div className="space-y-4">
            <p className="text-xs text-zinc-500">
              Sends work from &ldquo;{jobWorkTarget.productionStage.name}&rdquo; to an outside contractor. The contractor can perform several consecutive
              stages — pieces received back are moved through every covered stage automatically.
            </p>
            {jobWorkOptionsError && <ModalError message={jobWorkOptionsError} />}
            {!jobWorkOptions && !jobWorkOptionsError && <p className="text-xs text-zinc-400">Loading stages and costs…</p>}
            {jobWorkOptions && (
              <>
                <p className="text-xs text-zinc-500">
                  Style: <strong>{jobWorkOptions.style.name}</strong>
                  {jobWorkOptions.design?.label ? <> · Design: <strong>{jobWorkOptions.design.label}</strong></> : null} ·{" "}
                  <strong>{jobWorkOptions.availableToIssue}</strong> pieces free to send.
                </p>
                <FormField label="Stages performed by the contractor" htmlFor="jobWorkThroughStageId" required>
                  <select
                    id="jobWorkThroughStageId"
                    value={jobWorkThroughStageId}
                    onChange={(e) => {
                      setJobWorkThroughStageId(e.target.value);
                      setJobWorkContractorId("");
                    }}
                    className={textInputClass()}
                  >
                    {jobWorkOptions.stages.map((st, i) => (
                      <option key={st.id} value={st.id}>
                        {jobWorkOptions.stages
                          .slice(0, i + 1)
                          .map((x) => x.name)
                          .join(" → ")}
                        {st.isFinal ? " (Finished Goods)" : ""}
                      </option>
                    ))}
                  </select>
                </FormField>
                <FormField label="Contractor" htmlFor="jobWorkContractorId" required>
                  <SearchableSelect
                    id="jobWorkContractorId"
                    required
                    value={jobWorkContractorId}
                    onChange={setJobWorkContractorId}
                    options={jobWorkContractorOptions.map((c) => ({
                      id: c.id,
                      label: c.name,
                      sublabel: (c.stages ?? []).length === 0 ? "Any stage" : undefined,
                    }))}
                    placeholder="Search contractor…"
                  />
                  {jobWorkContractorOptions.length === 0 && (
                    <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                      No active contractor performs all of these stages — update a contractor&apos;s stages in Masters → Contractors.
                    </p>
                  )}
                </FormField>
                <FormField label={`Quantity (${lot.uom.code})`} htmlFor="jobWorkQty" required>
                  <input
                    id="jobWorkQty"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={jobWorkOptions.availableToIssue || undefined}
                    step={1}
                    required
                    value={jobWorkQty}
                    onChange={(e) => setJobWorkQty(e.target.value)}
                    className={textInputClass()}
                  />
                  {jobWorkQtyError && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{jobWorkQtyError}</p>}
                </FormField>

                <div className="rounded-md border border-zinc-200 dark:border-zinc-800">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-zinc-200 text-left text-zinc-500 dark:border-zinc-800">
                        <th className="px-2 py-1.5 font-medium">Stage</th>
                        <th className="px-2 py-1.5 font-medium">Source</th>
                        <th className="px-2 py-1.5 font-medium">Rate / pc</th>
                        <th className="px-2 py-1.5 text-right font-medium">Qty</th>
                        <th className="px-2 py-1.5 text-right font-medium">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {jobWorkStageAmounts.map(({ stage, amount }) => {
                        const overridden =
                          stage.defaultRate !== null && jobWorkRates[stage.id] !== "" && Number(jobWorkRates[stage.id]) !== stage.defaultRate;
                        return (
                          <tr key={stage.id} className="border-b border-zinc-100 dark:border-zinc-800">
                            <td className="px-2 py-1.5 text-zinc-800 dark:text-zinc-200">{stage.name}</td>
                            <td className="px-2 py-1.5 text-zinc-500">
                              {COST_SOURCE_LABELS[stage.defaultSource]}
                              {stage.defaultRate !== null && <> (₹{stage.defaultRate})</>}
                              {overridden && <span className="ml-1 text-amber-600">· overridden</span>}
                            </td>
                            <td className="px-2 py-1.5">
                              <input
                                aria-label={`Rate for ${stage.name}`}
                                type="number"
                                min={0}
                                step="0.01"
                                value={jobWorkRates[stage.id] ?? ""}
                                placeholder="Enter rate"
                                onChange={(e) => setJobWorkRates((prev) => ({ ...prev, [stage.id]: e.target.value }))}
                                className={`${textInputClass()} w-24 py-1 text-xs`}
                              />
                            </td>
                            <td className="px-2 py-1.5 text-right">{jobWorkQtyNumber}</td>
                            <td className="px-2 py-1.5 text-right">{formatMoney(amount)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">Extra Cost</span>
                    <button
                      type="button"
                      onClick={() => setJobWorkExtras((prev) => [...prev, { costType: "", description: "", amount: "" }])}
                      className="text-xs font-medium text-indigo-600 hover:text-indigo-500"
                    >
                      + Add Extra Cost
                    </button>
                  </div>
                  {jobWorkExtras.map((x, i) => (
                    <div key={i} className="grid grid-cols-[1fr_1fr_7rem_auto] gap-2">
                      <input
                        aria-label="Extra cost type"
                        placeholder="Type (e.g. Transportation)"
                        value={x.costType}
                        onChange={(e) => setJobWorkExtras((prev) => prev.map((row, j) => (j === i ? { ...row, costType: e.target.value } : row)))}
                        className={`${textInputClass()} py-1 text-xs`}
                      />
                      <input
                        aria-label="Extra cost description"
                        placeholder="Description (optional)"
                        value={x.description}
                        onChange={(e) => setJobWorkExtras((prev) => prev.map((row, j) => (j === i ? { ...row, description: e.target.value } : row)))}
                        className={`${textInputClass()} py-1 text-xs`}
                      />
                      <input
                        aria-label="Extra cost amount"
                        type="number"
                        min={0}
                        step="0.01"
                        placeholder="Amount"
                        value={x.amount}
                        onChange={(e) => setJobWorkExtras((prev) => prev.map((row, j) => (j === i ? { ...row, amount: e.target.value } : row)))}
                        className={`${textInputClass()} py-1 text-xs`}
                      />
                      <button
                        type="button"
                        aria-label="Remove extra cost"
                        onClick={() => setJobWorkExtras((prev) => prev.filter((_, j) => j !== i))}
                        className="px-2 text-red-500 hover:text-red-400"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>

                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-md bg-zinc-50 p-3 text-xs dark:bg-zinc-900">
                  <dt className="text-zinc-500">Stage-wise Job Work Cost</dt>
                  <dd className="text-right font-medium text-zinc-800 dark:text-zinc-200">{formatMoney(jobWorkStageTotal)}</dd>
                  <dt className="text-zinc-500">Extra Cost</dt>
                  <dd className="text-right font-medium text-zinc-800 dark:text-zinc-200">{formatMoney(jobWorkExtraTotal)}</dd>
                  <dt className="font-semibold text-zinc-700 dark:text-zinc-200">Total Job Work Cost</dt>
                  <dd className="text-right font-semibold text-zinc-900 dark:text-zinc-50">{formatMoney(jobWorkStageTotal + jobWorkExtraTotal)}</dd>
                </dl>
                {jobWorkMissingRate && (
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    Enter a rate for {jobWorkMissingRate.stage.name} — no cost is configured for it on this style/design.
                  </p>
                )}
                {jobWorkEndsAtFinal && (
                  <FormField label="Finished Goods Warehouse" htmlFor="jobWorkFgWarehouseId" required>
                    <select
                      id="jobWorkFgWarehouseId"
                      required
                      value={jobWorkFgWarehouseId}
                      onChange={(e) => setJobWorkFgWarehouseId(e.target.value)}
                      className={textInputClass()}
                    >
                      <option value="">— Select warehouse —</option>
                      {warehouses.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                        </option>
                      ))}
                    </select>
                  </FormField>
                )}
              </>
            )}
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Issue Date" htmlFor="jobWorkIssueDate" required>
                <input id="jobWorkIssueDate" type="date" required value={jobWorkIssueDate} onChange={(e) => setJobWorkIssueDate(e.target.value)} className={textInputClass()} />
              </FormField>
              <FormField label="Expected Completion" htmlFor="jobWorkExpectedDate">
                <input id="jobWorkExpectedDate" type="date" value={jobWorkExpectedDate} onChange={(e) => setJobWorkExpectedDate(e.target.value)} className={textInputClass()} />
              </FormField>
            </div>
            <FormField label="Remarks" htmlFor="jobWorkRemarks">
              <input id="jobWorkRemarks" value={jobWorkRemarks} onChange={(e) => setJobWorkRemarks(e.target.value)} className={textInputClass()} />
            </FormField>
            <ModalError message={error} />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setJobWorkTarget(null)} className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">
                Cancel
              </button>
              <button
                type="button"
                onClick={submitJobWork}
                disabled={
                  isBusy ||
                  !jobWorkOptions ||
                  !jobWorkContractorId ||
                  !!jobWorkQtyError ||
                  !!jobWorkMissingRate ||
                  (jobWorkEndsAtFinal && !jobWorkFgWarehouseId) ||
                  jobWorkExtras.some((x) => (x.amount || x.description) && !x.costType.trim())
                }
                className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
              >
                {isBusy ? "Saving…" : "Send to Job-Work"}
              </button>
            </div>
          </div>
        )}
      </Modal>

      <p className="text-xs text-zinc-400">
        <Link href={`/production-orders/${productionOrderId}`} className="hover:underline">
          ← Back to {lot.lotNumber.split("-L")[0]}
        </Link>
      </p>
    </div>
  );
}
