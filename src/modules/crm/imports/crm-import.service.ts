import { Prisma, type CrmDuplicatePolicy, type CrmImportJobStatus } from "@prisma/client";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { deleteStoredFile, saveFile } from "@/core/file-storage/FileStorage";
import { toCsv } from "@/lib/csv";
import { buildXlsxBuffer } from "@/lib/xlsx";
import type { CrmActor } from "../core/crm-actor";
import { getCrmRecordScope } from "../core/crm-visibility";
import { CrmContactRepository } from "../contacts/crm-contact.repository";
import { listCustomFields } from "../custom-fields/crm-custom-fields.service";
import { suggestLeadMapping, validateLeadMapping, CUSTOM_FIELD_PREFIX, type LeadFieldMapping } from "../ingestion/lead-field-catalog";
import {
  ingestPreparedLead,
  loadIngestLookups,
  prepareLead,
  resolveFlaggedLead,
  type IngestContext,
  type IngestLookups,
  type IngestResult,
  type PreparedLead,
} from "../ingestion/lead-ingest.service";
import type { IngestMessage } from "../ingestion/lead-normalizer";
import { activeRules, findLeadDuplicatesBatch } from "../leads/lead-duplicates";
import { getLeadSourceForCompany } from "../settings/crm-settings.service";
import { CrmImportRepository, type ImportJobRow, type ImportRowRecord } from "./crm-import.repository";
import { enqueueCrmIngestJob } from "./crm-import.queue";
import { importRowsQuerySchema, importSetupSchema, reviewDecisionSchema, type ImportOptions } from "./crm-import.schema";
import { parseImportFile } from "./import-file";

/**
 * CSV / XLSX lead import. Lifecycle:
 *
 *   PENDING (uploaded, mapping) → VALIDATING → READY (preview) → PROCESSING
 *     → COMPLETED | PARTIALLY_COMPLETED | FAILED | CANCELLED
 *
 * Every file line becomes a crm_import_rows row at upload, so preview,
 * review of flagged rows, progress and the error file are all database
 * reads, and each line always ends with an outcome. Rows are written to
 * leads only through the Lead Ingestion Service (lead-ingest.service.ts).
 * Validation of small files runs inline; large files and every import run
 * in the background worker (crm-import.worker.ts).
 */

const TABLE = "crm_import_jobs";
export const INLINE_VALIDATION_LIMIT = 1000;
const VALIDATION_CHUNK = 500;
const PROCESS_CHUNK = 100;
const STALE_IMPORT_DAYS = 7;
const IMPORT_PROVIDER = "import";

interface StoredPrepared {
  input: Record<string, unknown>;
  externalId: string | null;
  keys: PreparedLead["keys"];
}
export interface StoredDuplicates {
  leads: { id: string; leadNumber: string; fullName: string; rules: string[]; archived: boolean; action: string }[];
  contacts: { id: string; fullName: string; email: string | null; phone: string | null }[];
  external: { leadId: string; leadNumber: string } | null;
}

// ── Access ───────────────────────────────────────────────────────

async function jobWhere(actor: CrmActor, id?: string): Promise<Prisma.CrmImportJobWhereInput> {
  const scope = await getCrmRecordScope(actor);
  return { companyId: actor.companyId, ...(id ? { id } : {}), ...(scope.mode === "OWN" ? { createdByUserId: actor.userId } : {}) };
}

async function loadJob(actor: CrmActor, id: string) {
  const job = await CrmImportRepository.findJob(await jobWhere(actor, id));
  if (!job) throw new BusinessRuleError("NOT_FOUND", "Import not found.", { id });
  return job;
}

function optionsOf(job: Pick<ImportJobRow, "options">): ImportOptions & { branchId?: string | null } {
  return (job.options as ImportOptions & { branchId?: string | null }) ?? {};
}

function contextFor(job: Pick<ImportJobRow, "id" | "fileName" | "fileType" | "duplicatePolicy" | "sourceId" | "options">): IngestContext {
  const o = optionsOf(job);
  return {
    channel: job.fileType === "XLSX" ? "XLSX" : "CSV",
    provider: IMPORT_PROVIDER,
    duplicatePolicy: job.duplicatePolicy,
    defaultSourceId: job.sourceId,
    defaultSourceKey: "import",
    defaultOwnerUserId: o.defaultOwnerUserId,
    importJobId: job.id,
    via: `import ${job.fileName}`,
    normalize: { emptyTokens: o.emptyTokens?.length ? [...o.emptyTokens, "n/a", "na", "null", "-"] : undefined, fixNameCase: o.fixNameCase, dateOrder: o.dateOrder },
  };
}

function actorOf(job: Pick<ImportJobRow, "companyId" | "createdByUserId" | "options">): CrmActor {
  return { companyId: job.companyId, userId: job.createdByUserId, branchId: optionsOf(job).branchId ?? null };
}

function present(job: ImportJobRow) {
  const percent = job.totalRows ? Math.min(100, Math.round((job.processedRows / job.totalRows) * 100)) : 0;
  return { ...job, percent };
}
export type ImportJobDto = ReturnType<typeof present>;

async function audit(actor: CrmActor, jobId: string, action: "CREATE" | "UPDATE", values: Record<string, unknown>) {
  await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: TABLE, recordId: jobId, action, newValues: values });
}

// ── Upload & setup ───────────────────────────────────────────────

export async function uploadImportFile(actor: CrmActor, file: { name: string; buffer: Buffer }) {
  const fileName = file.name.replace(/[\\/]/g, "_").slice(0, 200) || "import";
  const parsed = await parseImportFile(fileName, file.buffer);

  let fileKey: string | null = null;
  try {
    fileKey = (await saveFile(parsed.storageBuffer, fileName, parsed.mimeType)).storageKey;
  } catch {
    // The rows are already in hand and stored in the database; keeping the
    // temporary copy is best-effort (same choice as the Masters bulk import).
    fileKey = null;
  }

  const customFields = await listCustomFields(actor.companyId, "LEAD", { includeInactive: false });
  const mapping = suggestLeadMapping(parsed.headers, customFields);
  const job = await CrmImportRepository.createJob({
    companyId: actor.companyId,
    fileName,
    fileType: parsed.fileType,
    fileSizeBytes: file.buffer.length,
    fileKey,
    status: "PENDING",
    headers: parsed.headers,
    mapping,
    options: { branchId: actor.branchId, encoding: parsed.encoding, delimiter: parsed.delimiter },
    totalRows: parsed.rows.length,
    createdByUserId: actor.userId,
  });
  await CrmImportRepository.insertRows(
    job.id,
    parsed.rows.map((cells, i) => ({ rowNumber: i + 1, raw: Object.fromEntries(parsed.headers.map((h, c) => [h, cells[c] ?? ""])) }))
  );
  await audit(actor, job.id, "CREATE", { event: "import.uploaded", fileName, fileType: parsed.fileType, totalRows: parsed.rows.length, encoding: parsed.encoding });
  return present(job);
}

export async function getImportJob(actor: CrmActor, id: string) {
  const job = await loadJob(actor, id);
  // Never expose the storage key or the queue id.
  const rest: Partial<typeof job> = { ...job };
  delete rest.fileKey;
  delete rest.queueJobId;
  const customFields
 = await listCustomFields(actor.companyId, "LEAD", { includeInactive: false });
  const sample = (await CrmImportRepository.rowsChunk(id, 0, 5)).map((r) => r.raw as Record<string, string>);
  return { ...present(rest as ImportJobRow), customFields, sample, mappingIssues: validateLeadMapping(job.mapping as LeadFieldMapping, customFields) };
}

const EDITABLE: CrmImportJobStatus[] = ["PENDING", "READY"];

/** Order-insensitive JSON equality (Postgres jsonb does not keep key order). */
export function sameJson(a: unknown, b: unknown): boolean {
  const canon = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v as object).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined).map((k) => [k, canon((v as Record<string, unknown>)[k])])) : v;
  return JSON.stringify(canon(a)) === JSON.stringify(canon(b));
}


export async function updateImportSetup(actor: CrmActor, id: string, raw: unknown) {
  const input = importSetupSchema.parse(raw);
  const job = await loadJob(actor, id);
  if (!EDITABLE.includes(job.status)) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This import has already started and can't be changed.");
  const headers = job.headers as string[];
  const mapping: LeadFieldMapping = {};
  for (const h of headers) mapping[h] = input.mapping[h] ?? "";
  if (input.sourceId) {
    const source = await getLeadSourceForCompany(actor.companyId, input.sourceId);
    if (!source.isActive) throw new BusinessRuleError("VALIDATION_ERROR", `"${source.name}" is no longer in use.`, { fieldErrors: { sourceId: "Choose an active source." } });
  }
  if (input.options?.defaultOwnerUserId) {
    const user = await CrmImportRepository.activeUser(actor.companyId, input.options.defaultOwnerUserId);
    if (!user) throw new BusinessRuleError("VALIDATION_ERROR", "The default owner must be an active user.", { fieldErrors: { defaultOwnerUserId: "Choose an active user." } });
  }
  const options = { ...optionsOf(job), ...(input.options ?? {}) };
  // Only changes that affect how rows are read reset the preview; choosing
  // the duplicate policy after seeing the preview keeps it.
  const affectsRows = !sameJson(mapping, job.mapping) || (input.sourceId ?? null) !== job.sourceId || !sameJson(options, optionsOf(job));
  const updated = await CrmImportRepository.updateJob(id, {
    mapping,
    sourceId: input.sourceId ?? null,
    duplicatePolicy: input.duplicatePolicy,
    options: options as Prisma.InputJsonValue,
    ...(affectsRows || job.status !== "READY" ? { status: "PENDING", validatedAt: null, validRows: 0, warningRows: 0, errorRows: 0, duplicateRows: 0 } : {}),
  });
  if (job.status === "READY" && affectsRows) await CrmImportRepository.resetRows(id);

  const customFields = await listCustomFields(actor.companyId, "LEAD", { includeInactive: false });
  return { ...present(updated), mappingIssues: validateLeadMapping(mapping, customFields) };
}

// ── Validation (preview) ─────────────────────────────────────────

export async function validateImport(actor: CrmActor, id: string) {
  const job = await loadJob(actor, id);
  if (!EDITABLE.includes(job.status)) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This import has already started.");
  const customFields = await listCustomFields(actor.companyId, "LEAD", { includeInactive: false });
  const errors = validateLeadMapping(job.mapping as LeadFieldMapping, customFields).filter((i) => i.level === "error");
  if (errors.length) throw new BusinessRuleError("VALIDATION_ERROR", errors[0].message, { issues: errors });
  if (!(await CrmImportRepository.transition(id, { in: EDITABLE }, { status: "VALIDATING", validatedAt: null }))) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This import is already being validated.");
  }
  if (job.totalRows <= INLINE_VALIDATION_LIMIT) {
    await runImportValidation(id);
  } else {
    try {
      const queueJobId = await enqueueCrmIngestJob({ name: "import.validate", data: { importJobId: id } });
      await CrmImportRepository.updateJob(id, { queueJobId });
    } catch (e) {
      await CrmImportRepository.updateJob(id, { status: "PENDING" });
      throw e;
    }
  }
  return getImportJob(actor, id);
}

/** Maps a stored raw row (header → cell) to target fields, adding the import-wide tags. */
export function applyMapping(raw: Record<string, string>, mapping: LeadFieldMapping, options: Pick<ImportOptions, "tagNames">): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [header, target] of Object.entries(mapping)) {
    if (!target) continue;
    out[target] = raw[header] ?? "";
  }
  if (options.tagNames?.length) out.tags = [out.tags, ...options.tagNames].filter(Boolean).join(",");
  return out;
}

function summarizeDuplicates(r: Awaited<ReturnType<typeof findLeadDuplicatesBatch>>[number], contacts: StoredDuplicates["contacts"], external: StoredDuplicates["external"]): StoredDuplicates | null {
  if (!r.matches.length && !contacts.length && !external) return null;
  return {
    leads: r.matches.slice(0, 5).map((m) => ({ id: m.id, leadNumber: m.leadNumber, fullName: m.fullName, rules: m.rules, archived: m.archived, action: m.action })),
    contacts: contacts.slice(0, 3),
    external,
  };
}

/** Prepares every row (normalize, validate, duplicates in file / leads / contacts / external ids). Worker or inline. */
export async function runImportValidation(jobId: string) {
  const job = await CrmImportRepository.findJob({ id: jobId });
  if (!job || job.status !== "VALIDATING") return;
  const ctx = contextFor(job);
  const lookups = await loadIngestLookups(job.companyId);
  const active = activeRules(lookups.rules);
  const emailRule = active.some((r) => r.rule === "EMAIL");
  const phoneRule = active.some((r) => r.rule === "PHONE");
  const mapping = job.mapping as LeadFieldMapping;
  const options = optionsOf(job);
  const seen = new Map<string, number>();
  let after = 0;

  for (;;) {
    const rows = await CrmImportRepository.rowsChunk(jobId, after, VALIDATION_CHUNK);
    if (!rows.length) break;
    after = rows[rows.length - 1].rowNumber;
    const prepared = rows.map((r) => prepareLead(applyMapping(r.raw as Record<string, string>, mapping, options), ctx, lookups));

    const usable = prepared.map((p) => p.validation !== "ERROR");
    const leadDup = await findLeadDuplicatesBatch(job.companyId, prepared.map((p, i) => (usable[i] ? p.keys : { emailKeys: [], phoneKeys: [], companyNameKey: "" })), lookups.rules);
    const allEmail = emailRule ? [...new Set(prepared.flatMap((p) => p.keys.emailKeys))] : [];
    const allPhone = phoneRule ? [...new Set(prepared.flatMap((p) => p.keys.phoneKeys))] : [];
    const contacts = allEmail.length || allPhone.length ? await CrmContactRepository.findMatches(job.companyId, allEmail, allPhone, 5000) : [];
    const externalIds = prepared.map((p) => p.externalId).filter((v): v is string => Boolean(v));
    const refs = externalIds.length
      ? await CrmImportRepository.externalRefs(job.companyId, IMPORT_PROVIDER, externalIds)
      : [];
    const refMap = new Map(refs.map((r) => [r.externalId, { leadId: r.lead.id, leadNumber: r.lead.leadNumber }]));

    const updates = rows.map((row, i) => {
      const p = prepared[i];
      const messages: IngestMessage[] = [...p.messages];
      let inFileDuplicateOf: number | null = null;
      if (usable[i]) {
        const rowKeys = [...(emailRule ? p.keys.emailKeys.map((k) => `e:${k}`) : []), ...(phoneRule ? p.keys.phoneKeys.map((k) => `p:${k}`) : []), ...(p.externalId ? [`x:${p.externalId}`] : [])];
        for (const k of rowKeys) {
          const first = seen.get(k);
          if (first !== undefined && first !== row.rowNumber) {
            inFileDuplicateOf = first;
            break;
          }
        }
        for (const k of rowKeys) if (!seen.has(k)) seen.set(k, row.rowNumber);
        if (inFileDuplicateOf) messages.push({ level: "warning", message: `Same person as row ${inFileDuplicateOf} in this file.` });
      }
      const contactMatches = usable[i]
        ? contacts
            .filter((c) => c.emailKeys.some((k) => p.keys.emailKeys.includes(k) && emailRule) || c.phoneKeys.some((k) => p.keys.phoneKeys.includes(k) && phoneRule))
            .map((c) => ({ id: c.id, fullName: c.fullName, email: c.email, phone: c.phone ?? c.mobile ?? null }))
        : [];
      const duplicates = usable[i] ? summarizeDuplicates(leadDup[i], contactMatches, p.externalId ? (refMap.get(p.externalId) ?? null) : null) : null;
      if (duplicates?.leads.length) messages.push({ level: "warning", message: `Possible duplicate of ${duplicates.leads.map((l) => `${l.leadNumber} ${l.fullName}`).join(", ")}.` });
      else if (duplicates?.external) messages.push({ level: "warning", message: `Already imported as ${duplicates.external.leadNumber} (same external id).` });
      else if (duplicates?.contacts.length) messages.push({ level: "info", message: `Matches existing contact ${duplicates.contacts[0].fullName}.` });
      const validation = p.validation === "ERROR" ? "ERROR" : messages.some((m) => m.level === "warning") ? "WARNING" : "VALID";
      const stored: StoredPrepared = { input: p.input, externalId: p.externalId, keys: p.keys };
      return {
        id: row.id,
        data: {
          normalized: stored as unknown as Prisma.InputJsonValue,
          validation,
          messages: messages as unknown as Prisma.InputJsonValue,
          duplicateMatches: duplicates ? (duplicates as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
          inFileDuplicateOf,
        } satisfies Prisma.CrmImportRowUncheckedUpdateInput,
      };
    });
    await CrmImportRepository.updateRows(updates);

    const current = await CrmImportRepository.findJob({ id: jobId });
    if (current?.status !== "VALIDATING") return; // cancelled meanwhile
  }

  const { byValidation, duplicates } = await CrmImportRepository.validationCounts(jobId);
  await CrmImportRepository.transition(jobId, "VALIDATING", {
    status: "READY",
    validatedAt: new Date(),
    validRows: byValidation.VALID ?? 0,
    warningRows: byValidation.WARNING ?? 0,
    errorRows: byValidation.ERROR ?? 0,
    duplicateRows: duplicates,
  });
}

export async function listImportRows(actor: CrmActor, id: string, rawQuery: unknown) {
  await loadJob(actor, id);
  const q = importRowsQuerySchema.parse(rawQuery);
  const where: Prisma.CrmImportRowWhereInput = { jobId: id };
  if (q.validation) where.validation = q.validation;
  if (q.outcome) where.outcome = q.outcome;
  if (q.duplicates) where.OR = [{ inFileDuplicateOf: { not: null } }, { NOT: { duplicateMatches: { equals: Prisma.DbNull } } }];
  if (q.problems) where.OR = [{ validation: { in: ["ERROR", "WARNING"] } }, { outcome: { in: ["SKIPPED", "FLAGGED", "FAILED"] } }];
  const [rows, totalCount] = await CrmImportRepository.listRows(where, (q.page - 1) * q.pageSize, q.pageSize);
  return { data: rows.map(presentRow), totalCount, page: q.page, pageSize: q.pageSize };
}

function presentRow(r: ImportRowRecord) {
  const stored = r.normalized as StoredPrepared | null;
  return {
    id: r.id,
    rowNumber: r.rowNumber,
    raw: r.raw as Record<string, string>,
    mapped: stored?.input ?? null,
    externalId: stored?.externalId ?? null,
    validation: r.validation,
    messages: (r.messages as unknown as IngestMessage[]) ?? [],
    duplicates: r.duplicateMatches as StoredDuplicates | null,
    inFileDuplicateOf: r.inFileDuplicateOf,
    outcome: r.outcome,
    outcomeReason: r.outcomeReason,
    lead: r.lead,
    reviewedAt: r.reviewedAt,
  };
}
export type ImportRowDto = ReturnType<typeof presentRow>;

// ── Start / process / cancel ─────────────────────────────────────

export async function startImport(actor: CrmActor, id: string) {
  const job = await loadJob(actor, id);
  if (job.status !== "READY") throw new BusinessRuleError("INVALID_STATE_TRANSITION", job.status === "PENDING" ? "Check the file (preview) before importing." : "This import has already started.");
  if (!(await CrmImportRepository.transition(id, "READY", { status: "PROCESSING", startedAt: new Date(), processedRows: 0, errorSummary: null }))) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This import has already started.");
  }
  try {
    const queueJobId = await enqueueCrmIngestJob({ name: "import.process", data: { importJobId: id } });
    await CrmImportRepository.updateJob(id, { queueJobId });
  } catch (e) {
    await CrmImportRepository.updateJob(id, { status: "READY", startedAt: null });
    throw e;
  }
  await audit(actor, id, "UPDATE", { event: "import.started", duplicatePolicy: job.duplicatePolicy, totalRows: job.totalRows });
  return getImportJob(actor, id);
}

async function refreshCounters(jobId: string) {
  const c = await CrmImportRepository.outcomeCounts(jobId);
  const processed = (c.IMPORTED ?? 0) + (c.UPDATED ?? 0) + (c.SKIPPED ?? 0) + (c.FLAGGED ?? 0) + (c.FAILED ?? 0);
  return CrmImportRepository.updateJob(jobId, {
    processedRows: processed,
    importedRows: c.IMPORTED ?? 0,
    updatedRows: c.UPDATED ?? 0,
    skippedRows: c.SKIPPED ?? 0,
    flaggedRows: c.FLAGGED ?? 0,
    failedRows: c.FAILED ?? 0,
  });
}

function rowUpdate(result: Pick<IngestResult, "outcome" | "reason" | "leadId" | "duplicates">): Prisma.CrmImportRowUncheckedUpdateInput {
  return {
    outcome: result.outcome,
    outcomeReason: result.reason?.slice(0, 1000) ?? null,
    leadId: result.leadId,
    processedAt: new Date(),
  };
}

/**
 * Worker: processes PENDING rows in order, in chunks, re-checking duplicates
 * against the database for every row (so rows created earlier in the same
 * file are seen). Resumable — a retried job continues where it stopped.
 */
export async function processImportJob(jobId: string, { finalAttempt = true }: { finalAttempt?: boolean } = {}) {
  const job = await CrmImportRepository.findJob({ id: jobId });
  if (!job || job.status !== "PROCESSING") return;
  const actor = actorOf(job);
  const ctx = contextFor(job);
  try {
    const lookups: Pick<IngestLookups, "rules"> = await loadIngestLookups(job.companyId);
    let after = 0;
    for (;;) {
      const fresh = await CrmImportRepository.findJob({ id: jobId });
      if (fresh?.cancelRequestedAt) {
        await CrmImportRepository.markPending(jobId, "SKIPPED", "Import cancelled before this row was processed.");
        await refreshCounters(jobId);
        await finish(actor, job, "CANCELLED");
        return;
      }
      const rows = await CrmImportRepository.rowsChunk(jobId, after, PROCESS_CHUNK, { outcome: "PENDING" });
      if (!rows.length) break;
      after = rows[rows.length - 1].rowNumber;
      for (const row of rows) {
        let result: Pick<IngestResult, "outcome" | "reason" | "leadId" | "duplicates">;
        const stored = row.normalized as StoredPrepared | null;
        const messages = (row.messages as unknown as IngestMessage[]) ?? [];
        if (row.validation === "ERROR" || !stored) {
          result = { outcome: "FAILED", reason: messages.find((m) => m.level === "error")?.message ?? "This row wasn't validated.", leadId: null, duplicates: null };
        } else {
          result = await ingestPreparedLead(actor, { ...stored, messages, validation: row.validation === "WARNING" ? "WARNING" : "VALID" }, ctx, lookups);
          if (row.inFileDuplicateOf && result.reason && result.outcome !== "IMPORTED") result = { ...result, reason: `Same person as row ${row.inFileDuplicateOf}. ${result.reason}` };
        }
        await CrmImportRepository.updateRow(row.id, rowUpdate(result));
      }
      await refreshCounters(jobId);
    }
    const final = await refreshCounters(jobId);
    const ok = final.importedRows + final.updatedRows + final.skippedRows + final.flaggedRows;
    await finish(actor, job, final.failedRows === 0 ? "COMPLETED" : ok > 0 ? "PARTIALLY_COMPLETED" : "FAILED");
  } catch (e) {
    if (!finalAttempt) throw e;
    await refreshCounters(jobId).catch(() => undefined);
    await CrmImportRepository.markPending(jobId, "FAILED", `The import stopped unexpectedly: ${(e as Error).message}`).catch(() => undefined);
    await refreshCounters(jobId).catch(() => undefined);
    await finish(actor, job, "FAILED", (e as Error).message);
    throw e;
  }
}

async function finish(actor: CrmActor, job: { id: string; fileKey: string | null; fileName: string }, status: CrmImportJobStatus, errorSummary?: string) {
  const updated = await CrmImportRepository.updateJob(job.id, { status, completedAt: new Date(), ...(errorSummary ? { errorSummary: errorSummary.slice(0, 1000) } : {}) });
  await removeTempFile(job.id, job.fileKey);
  await audit(actor, job.id, "UPDATE", {
    event: status === "CANCELLED" ? "import.cancelled" : status === "FAILED" ? "import.failed" : "import.completed",
    status,
    imported: updated.importedRows,
    updated: updated.updatedRows,
    skipped: updated.skippedRows,
    flagged: updated.flaggedRows,
    failed: updated.failedRows,
  });
}

async function removeTempFile(jobId: string, fileKey: string | null) {
  if (!fileKey) return;
  await deleteStoredFile(fileKey).catch(() => undefined);
  await CrmImportRepository.updateJob(jobId, { fileKey: null });
}

export async function cancelImport(actor: CrmActor, id: string) {
  const job = await loadJob(actor, id);
  if (job.status === "PROCESSING") {
    await CrmImportRepository.updateJob(id, { cancelRequestedAt: new Date() });
  } else if (["PENDING", "READY", "VALIDATING"].includes(job.status)) {
    if (await CrmImportRepository.transition(id, { in: ["PENDING", "READY", "VALIDATING"] }, { status: "CANCELLED", cancelRequestedAt: new Date(), completedAt: new Date() })) {
      await CrmImportRepository.markPending(id, "SKIPPED", "Import cancelled before this row was processed.");
      await refreshCounters(id);
      await removeTempFile(id, job.fileKey);
      await audit(actor, id, "UPDATE", { event: "import.cancelled", status: "CANCELLED" });
    }
  } else {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This import has already finished.");
  }
  return getImportJob(actor, id);
}

// ── Review of flagged rows ───────────────────────────────────────

export async function reviewImportRows(actor: CrmActor, id: string, raw: unknown) {
  const decision = reviewDecisionSchema.parse(raw);
  const job = await loadJob(actor, id);
  if (!["COMPLETED", "PARTIALLY_COMPLETED", "FAILED", "CANCELLED"].includes(job.status)) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Flagged rows can be reviewed once the import has finished.");
  }
  const rows = await CrmImportRepository.rowsByIds(id, decision.rowIds);
  const ctx = contextFor(job);
  const results: { rowId: string; rowNumber: number; outcome: string; reason: string | null }[] = [];
  for (const row of rows) {
    if (row.outcome !== "FLAGGED") {
      results.push({ rowId: row.id, rowNumber: row.rowNumber, outcome: row.outcome, reason: "Not flagged — unchanged." });
      continue;
    }
    const stored = row.normalized as StoredPrepared | null;
    if (!stored) continue;
    let target: string | undefined;
    if (decision.action === "UPDATE") {
      const dups = row.duplicateMatches as StoredDuplicates | null;
      target = decision.leadId ?? (dups?.leads.length === 1 ? dups.leads[0].id : dups?.external?.leadId);
      if (!target) {
        results.push({ rowId: row.id, rowNumber: row.rowNumber, outcome: row.outcome, reason: "Choose which lead to update." });
        continue;
      }
    }
    const result = await resolveFlaggedLead(actor, stored, ctx, decision.action === "UPDATE" ? { action: "UPDATE", leadId: target! } : { action: decision.action });
    await CrmImportRepository.updateRow(row.id, { ...rowUpdate(result), reviewedAt: new Date(), reviewedByUserId: actor.userId });
    results.push({ rowId: row.id, rowNumber: row.rowNumber, outcome: result.outcome, reason: result.reason });
  }
  await refreshCounters(id);
  await audit(actor, id, "UPDATE", { event: "import.rows_reviewed", action: decision.action, rows: results.map((r) => ({ row: r.rowNumber, outcome: r.outcome })) });
  return { results, job: await getImportJob(actor, id) };
}

// ── History ──────────────────────────────────────────────────────

export async function listImportJobs(actor: CrmActor, query: { status?: CrmImportJobStatus; skip: number; take: number }) {
  const where = await jobWhere(actor);
  if (query.status) where.status = query.status;
  const [rows, totalCount] = await CrmImportRepository.listJobs(where, query.skip, query.take);
  return { data: rows.map(present), totalCount };
}

// ── Error file ───────────────────────────────────────────────────

/** Cells that start with = + - @ (or tab/CR) are prefixed with ' so spreadsheet apps never run them as formulas. */
export function neutralizeCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

function duplicateText(d: StoredDuplicates | null, inFile: number | null) {
  const parts: string[] = [];
  if (inFile) parts.push(`Same as row ${inFile}`);
  if (d?.external) parts.push(`Already imported as ${d.external.leadNumber}`);
  for (const l of d?.leads ?? []) parts.push(`${l.leadNumber} ${l.fullName} (${l.rules.join("+").toLowerCase()})`);
  for (const c of d?.contacts ?? []) parts.push(`Contact ${c.fullName}`);
  return parts.join("; ");
}

/**
 * The original columns of every problem row (or all rows) plus Row, Import
 * Status, Reason, Messages, Duplicate information and Lead. Re-uploading a
 * corrected copy works because the original headers are preserved.
 */
export async function buildImportErrorFile(actor: CrmActor, id: string, format: "csv" | "xlsx", which: "problems" | "all" = "problems") {
  const job = await loadJob(actor, id);
  const headers = job.headers as string[];
  const where: Prisma.CrmImportRowWhereInput =
    which === "all" ? {} : { OR: [{ validation: { in: ["ERROR", "WARNING"] } }, { outcome: { in: ["SKIPPED", "FLAGGED", "FAILED"] } }] };
  const lines: Record<string, string>[] = [];
  let after = 0;
  for (;;) {
    const rows = await CrmImportRepository.rowsChunk(id, after, 1000, where);
    if (!rows.length) break;
    after = rows[rows.length - 1].rowNumber;
    for (const r of rows) {
      const raw = r.raw as Record<string, string>;
      const messages = ((r.messages as unknown as IngestMessage[]) ?? []).map((m) => `${m.level}: ${m.message}`).join(" | ");
      const status = r.outcome !== "PENDING" ? r.outcome : r.validation;
      lines.push({
        __row: String(r.rowNumber),
        ...Object.fromEntries(headers.map((h, i) => [`c${i}`, neutralizeCell(raw[h])])),
        __status: status,
        __reason: neutralizeCell(r.outcomeReason ?? (r.validation === "ERROR" ? (messages.split(" | ")[0] ?? "").replace(/^error: /, "") : "")),
        __messages: neutralizeCell(messages),
        __dups: neutralizeCell(duplicateText(r.duplicateMatches as StoredDuplicates | null, r.inFileDuplicateOf)),
        __lead: r.lead?.leadNumber ?? "",
      });
    }
  }
  const columns = [
    { key: "__row", header: "Row" },
    ...headers.map((h, i) => ({ key: `c${i}`, header: h })),
    { key: "__status", header: "Import Status" },
    { key: "__reason", header: "Error Reason" },
    { key: "__messages", header: "Messages" },
    { key: "__dups", header: "Duplicate Information" },
    { key: "__lead", header: "Lead" },
  ];
  const base = job.fileName.replace(/\.(csv|xlsx|txt)$/i, "");
  const fileName = `${base}-${which === "all" ? "results" : "errors"}.${format}`;
  if (format === "csv") {
    const body = "﻿" + toCsv(columns.map((c) => neutralizeCell(c.header)), lines.map((l) => columns.map((c) => l[c.key] ?? "")));
    return { fileName, contentType: "text/csv; charset=utf-8", body: Buffer.from(body, "utf-8") };
  }
  const body = await buildXlsxBuffer("Import results", columns.map((c) => ({ ...c, header: neutralizeCell(c.header), width: c.key === "__reason" || c.key === "__messages" ? 50 : 18 })), lines);
  return { fileName, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", body };
}

// ── Housekeeping ─────────────────────────────────────────────────

/**
 * Daily (worker): imports abandoned before starting for STALE_IMPORT_DAYS
 * are cancelled (their rows marked skipped) and every finished import's
 * temporary file is removed. Rows stay for history and error files.
 */
export async function cleanupStaleImports(now = new Date()) {
  const before = new Date(now.getTime() - STALE_IMPORT_DAYS * 24 * 3600 * 1000);
  const jobs = await CrmImportRepository.staleJobs(before);
  let cancelled = 0;
  for (const j of jobs) {
    if (j.status === "PENDING" || j.status === "READY") {
      if (await CrmImportRepository.transition(j.id, { in: ["PENDING", "READY"] }, { status: "CANCELLED", completedAt: now, errorSummary: `Not started within ${STALE_IMPORT_DAYS} days.` })) {
        await CrmImportRepository.markPending(j.id, "SKIPPED", `Import was never started (cleaned up after ${STALE_IMPORT_DAYS} days).`);
        await refreshCounters(j.id);
        cancelled++;
      }
    }
    await removeTempFile(j.id, j.fileKey);
  }
  return { checked: jobs.length, cancelled };
}

export type { CrmDuplicatePolicy };
export { CUSTOM_FIELD_PREFIX };
