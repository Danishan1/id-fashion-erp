"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { LOT_STATUS_LABELS, JOB_ORDER_STATUS_LABELS } from "./statusLabels";

type LotStatus = keyof typeof LOT_STATUS_LABELS;
type JobOrderStatus = keyof typeof JOB_ORDER_STATUS_LABELS;

interface Assignment {
  id: string;
  assignedQuantity: string;
  status: string;
  employee: { id: string; fullName: string; employeeCode: string };
}

interface JobOrderRow {
  id: string;
  jobNumber: string;
  plannedQuantity: string;
  completedQuantity: string;
  rejectedQuantity: string;
  damagedQuantity: string;
  forwardedQuantity: string;
  qcPassedQuantity: string;
  status: JobOrderStatus;
  productionStage: { id: string; name: string; code: string; sequence: number };
  assignments: Assignment[];
}

interface LotDetail {
  id: string;
  lotNumber: string;
  quantity: string;
  status: LotStatus;
  uom: { id: string; code: string };
  currentStage: { id: string; name: string } | null;
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

interface SupplierOption {
  id: string;
  name: string;
}

async function parseErrorMessage(res: Response, fallback: string) {
  const body = await res.json().catch(() => null);
  return body?.error?.message ?? fallback;
}

function remainingOf(jo: JobOrderRow) {
  return Number(jo.plannedQuantity) - Number(jo.completedQuantity) - Number(jo.rejectedQuantity) - Number(jo.damagedQuantity);
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
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);

  const [jobWorkTarget, setJobWorkTarget] = useState<JobOrderRow | null>(null);
  const [jobWorkSupplierId, setJobWorkSupplierId] = useState("");
  const [jobWorkQty, setJobWorkQty] = useState("");
  const [jobWorkIssueDate, setJobWorkIssueDate] = useState(new Date().toISOString().slice(0, 10));
  const [jobWorkExpectedDate, setJobWorkExpectedDate] = useState("");
  const [jobWorkRemarks, setJobWorkRemarks] = useState("");
  const [createdJobWorkOrderId, setCreatedJobWorkOrderId] = useState<string | null>(null);

  const [showStart, setShowStart] = useState(false);
  const [startStageId, setStartStageId] = useState("");

  const [assignTarget, setAssignTarget] = useState<JobOrderRow | null>(null);
  const [assignEmployeeId, setAssignEmployeeId] = useState("");
  const [assignQty, setAssignQty] = useState("");

  const [progressTarget, setProgressTarget] = useState<JobOrderRow | null>(null);
  const [progressEmployeeId, setProgressEmployeeId] = useState("");
  const [progressCompleted, setProgressCompleted] = useState("0");
  const [progressRejected, setProgressRejected] = useState("0");
  const [progressDamaged, setProgressDamaged] = useState("0");
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
    fetch("/api/v1/suppliers?pageSize=200")
      .then((res) => res.json())
      .then((body) => setSuppliers(body.data ?? []));
  }, []);

  const refresh = async () => {
    const res = await fetch(`/api/v1/lots/${lotId}`);
    const body = await res.json();
    if (res.ok) setLot(body.data);
  };

  const run = async (action: () => Promise<Response>, fallbackError: string) => {
    setIsBusy(true);
    setError(null);
    const res = await action();
    if (!res.ok) {
      setError(await parseErrorMessage(res, fallbackError));
      setIsBusy(false);
      return false;
    }
    await refresh();
    setIsBusy(false);
    return true;
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
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ employeeId: assignEmployeeId, assignedQuantity: Number(assignQty) }),
        }),
      "Failed to assign this worker."
    );
    if (ok) {
      setAssignTarget(null);
      setAssignEmployeeId("");
      setAssignQty("");
    }
  };

  const submitProgress = async () => {
    if (!progressTarget) return;
    const ok = await run(
      () =>
        fetch(`/api/v1/job-orders/${progressTarget.id}/progress-entries`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            employeeId: progressEmployeeId,
            completedQuantity: Number(progressCompleted),
            rejectedQuantity: Number(progressRejected),
            damagedQuantity: Number(progressDamaged),
            remarks: progressRemarks || undefined,
          }),
        }),
      "Failed to record progress."
    );
    if (ok) {
      setProgressTarget(null);
      setProgressEmployeeId("");
      setProgressCompleted("0");
      setProgressRejected("0");
      setProgressDamaged("0");
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
    const res = await fetch("/api/v1/job-work-orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jobOrderId: jobWorkTarget.id,
        supplierId: jobWorkSupplierId,
        issuedQuantity: Number(jobWorkQty),
        uomId: lot.uom.id,
        issueDate: jobWorkIssueDate,
        expectedCompletionDate: jobWorkExpectedDate || undefined,
        remarks: jobWorkRemarks || undefined,
      }),
    });
    if (!res.ok) {
      setError(await parseErrorMessage(res, "Failed to send this job order to job-work."));
      setIsBusy(false);
      return;
    }
    const body = await res.json();
    await refresh();
    setIsBusy(false);
    setJobWorkTarget(null);
    setJobWorkSupplierId("");
    setJobWorkQty("");
    setJobWorkExpectedDate("");
    setJobWorkRemarks("");
    setCreatedJobWorkOrderId(body.data.id);
  };

  const canAct = lot.status === "PLANNED" || lot.status === "IN_PROGRESS";

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
              </div>
              {jo.assignments.length > 0 && (
                <p className="mt-2 text-xs text-zinc-500">
                  Assigned: {jo.assignments.map((a) => `${a.employee.fullName} (${a.assignedQuantity})`).join(", ")}
                </p>
              )}
              {!isTerminal && (
                <div className="mt-3 flex flex-wrap gap-3 text-xs font-medium">
                  <button type="button" onClick={() => setAssignTarget(jo)} className="text-indigo-600 hover:text-indigo-500">
                    Assign Worker
                  </button>
                  {remaining > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setProgressTarget(jo);
                        setProgressEmployeeId(jo.assignments[0]?.employee.id ?? "");
                      }}
                      className="text-indigo-600 hover:text-indigo-500"
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
                    <button
                      type="button"
                      onClick={() => {
                        setJobWorkTarget(jo);
                        setJobWorkQty(String(remaining));
                        setCreatedJobWorkOrderId(null);
                      }}
                      className="text-purple-600 hover:text-purple-500"
                    >
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
            <FormField label="Employee" htmlFor="assignEmployeeId" required>
              <select id="assignEmployeeId" required value={assignEmployeeId} onChange={(e) => setAssignEmployeeId(e.target.value)} className={textInputClass()}>
                <option value="">— Select —</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.fullName} ({e.employeeCode})
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Assigned Quantity" htmlFor="assignQty" required>
              <input id="assignQty" type="number" min={0} step="0.0001" required value={assignQty} onChange={(e) => setAssignQty(e.target.value)} className={textInputClass()} />
            </FormField>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setAssignTarget(null)} className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">
                Cancel
              </button>
              <button type="button" onClick={submitAssign} disabled={isBusy || !assignEmployeeId || !assignQty} className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60">
                {isBusy ? "Saving…" : "Assign"}
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!progressTarget} onClose={() => setProgressTarget(null)} title="Log Progress">
        {progressTarget && (
          <div className="space-y-4">
            <FormField label="Worker" htmlFor="progressEmployeeId" required>
              <select id="progressEmployeeId" required value={progressEmployeeId} onChange={(e) => setProgressEmployeeId(e.target.value)} className={textInputClass()}>
                <option value="">— Select —</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.fullName} ({e.employeeCode})
                  </option>
                ))}
              </select>
            </FormField>
            <div className="grid grid-cols-3 gap-3">
              <FormField label="Completed" htmlFor="progressCompleted">
                <input id="progressCompleted" type="number" min={0} step="0.0001" value={progressCompleted} onChange={(e) => setProgressCompleted(e.target.value)} className={textInputClass()} />
              </FormField>
              <FormField label="Rejected" htmlFor="progressRejected">
                <input id="progressRejected" type="number" min={0} step="0.0001" value={progressRejected} onChange={(e) => setProgressRejected(e.target.value)} className={textInputClass()} />
              </FormField>
              <FormField label="Damaged" htmlFor="progressDamaged">
                <input id="progressDamaged" type="number" min={0} step="0.0001" value={progressDamaged} onChange={(e) => setProgressDamaged(e.target.value)} className={textInputClass()} />
              </FormField>
            </div>
            <p className="text-xs text-zinc-500">Remaining on this job order: {remainingOf(progressTarget)}</p>
            <FormField label="Remarks" htmlFor="progressRemarks">
              <input id="progressRemarks" value={progressRemarks} onChange={(e) => setProgressRemarks(e.target.value)} className={textInputClass()} />
            </FormField>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setProgressTarget(null)} className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">
                Cancel
              </button>
              <button type="button" onClick={submitProgress} disabled={isBusy || !progressEmployeeId} className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60">
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
                  <select id="forwardFgWarehouseId" required value={forwardFgWarehouseId} onChange={(e) => setForwardFgWarehouseId(e.target.value)} className={textInputClass()}>
                    <option value="">— Select —</option>
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </FormField>
              ) : null;
            })()}
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
                  <select id="qcFgWarehouseId" required value={qcFgWarehouseId} onChange={(e) => setQcFgWarehouseId(e.target.value)} className={textInputClass()}>
                    <option value="">— Select —</option>
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
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
                <select id="qcDamageWarehouseId" required value={qcDamageWarehouseId} onChange={(e) => setQcDamageWarehouseId(e.target.value)} className={textInputClass()}>
                  <option value="">— Select —</option>
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </FormField>
            )}
            {defectTypes.length > 0 && (
              <p className="text-xs text-zinc-400">Defect classification is not yet wired into this form — record the breakdown in Remarks for now.</p>
            )}
            <FormField label="Remarks" htmlFor="qcRemarks">
              <input id="qcRemarks" value={qcRemarks} onChange={(e) => setQcRemarks(e.target.value)} className={textInputClass()} />
            </FormField>
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

      <Modal open={!!jobWorkTarget} onClose={() => setJobWorkTarget(null)} title="Send to External Job-Work">
        {jobWorkTarget && (
          <div className="space-y-4">
            <p className="text-xs text-zinc-500">
              Sends part of &ldquo;{jobWorkTarget.productionStage.name}&rdquo;&apos;s remaining work to an outside contractor. Receiving it back later
              completes this quantity exactly like an internal progress entry would — QC and Forward remain available on it either way.
            </p>
            <FormField label="Contractor" htmlFor="jobWorkSupplierId" required>
              <select id="jobWorkSupplierId" required value={jobWorkSupplierId} onChange={(e) => setJobWorkSupplierId(e.target.value)} className={textInputClass()}>
                <option value="">— Select —</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label={`Quantity (${lot.uom.code})`} htmlFor="jobWorkQty" required>
              <input id="jobWorkQty" type="number" min={0} step="0.0001" required value={jobWorkQty} onChange={(e) => setJobWorkQty(e.target.value)} className={textInputClass()} />
            </FormField>
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
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setJobWorkTarget(null)} className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">
                Cancel
              </button>
              <button
                type="button"
                onClick={submitJobWork}
                disabled={isBusy || !jobWorkSupplierId || !jobWorkQty}
                className="rounded-md bg-purple-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-purple-500 disabled:opacity-60"
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
