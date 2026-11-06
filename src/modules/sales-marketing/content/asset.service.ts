import { createHash } from "crypto";
import { Prisma } from "@prisma/client";
import sharp from "sharp";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { deleteStoredFile, FileTooLargeError, normalizeMimeType, readStoredFile, saveFile, UnsupportedFileTypeError } from "@/core/file-storage/FileStorage";
import { logger } from "@/core/logging/logger";
import { PermissionService } from "@/core/rbac/PermissionService";
import type { SalesActor } from "@/modules/sales-marketing/enquiries/sales-enquiry.service";
import { ASSET_VERSIONS_TABLE, ASSETS_TABLE, auditContent, searchTextOf, userNames } from "./content-common";
import { ASSET_MIME, ASSET_TYPES, assetMaxBytes, assetMetadataSchema, assetUpdateSchema, isAssetMime, type AssetType } from "./content-registry";
import { reviewStates, statusOf } from "./content-review.service";

/**
 * Marketing asset library (Phase 11). Files go through the shared private
 * file storage (src/core/file-storage — outside public/, content-sniffed);
 * every upload is an immutable version, so content that pinned a version
 * keeps exactly that file. No malware scanner is configured: versions are
 * recorded NOT_SCANNED and never reported as scanned.
 */

export interface UploadedFile {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
}

const OPEN_CAMPAIGN = { notIn: ["COMPLETED", "CANCELLED"] as ("COMPLETED" | "CANCELLED")[] };

/** The original name, reduced to something safe to show and to put in a download header. */
export function safeFileName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "";
  const clean = base
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f"<>|:*?]/g, "")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 150);
  return clean || "file";
}

interface Inspected {
  storageKey: string;
  mimeType: string;
  fileSizeBytes: number;
  sha256: string;
  width: number | null;
  height: number | null;
  originalFileName: string;
}

/** Checks type (declared and sniffed), size, then stores under a random key. */
async function storeAssetFile(file: UploadedFile, assetType: AssetType): Promise<Inspected> {
  const mimeType = normalizeMimeType(file.mimeType || "");
  const def = ASSET_TYPES[assetType];
  if (!isAssetMime(mimeType) || !def.mimes.includes(mimeType)) {
    throw new BusinessRuleError("VALIDATION_ERROR", `A ${def.label.toLowerCase()} must be ${def.mimes.map((m) => ASSET_MIME[m].label).join(", ")}.`, { fieldErrors: { file: "Unsupported file type." } });
  }
  let stored;
  try {
    // Storage key is random; the extension comes from the checked type, never from the user's name.
    stored = await saveFile(file.buffer, `asset.${ASSET_MIME[mimeType].ext}`, mimeType, { allowedMimeTypes: new Set(def.mimes), maxBytes: assetMaxBytes() });
  } catch (e) {
    if (e instanceof UnsupportedFileTypeError || e instanceof FileTooLargeError) throw new BusinessRuleError("VALIDATION_ERROR", e.message, { fieldErrors: { file: e.message } });
    throw e;
  }
  let width: number | null = null;
  let height: number | null = null;
  if (mimeType.startsWith("image/")) {
    try {
      const meta = await sharp(file.buffer, { animated: false, limitInputPixels: 100_000_000 }).metadata();
      width = meta.width ?? null;
      height = meta.height ?? null;
    } catch {
      await deleteStoredFile(stored.storageKey).catch(() => undefined);
      throw new BusinessRuleError("VALIDATION_ERROR", "The image couldn't be read — it may be damaged.", { fieldErrors: { file: "Unreadable image." } });
    }
  }
  return { storageKey: stored.storageKey, mimeType, fileSizeBytes: stored.fileSizeBytes, sha256: createHash("sha256").update(file.buffer).digest("hex"), width, height, originalFileName: safeFileName(file.fileName) };
}

/** Runs `write`; if it fails, the stored file is removed again (no orphan files). */
async function withStoredFile<T>(f: Inspected, write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (e) {
    await deleteStoredFile(f.storageKey).catch((err: Error) => logger.warn("Could not remove an orphaned asset file", { error: err.message }));
    throw e;
  }
}

async function nextAssetCode(tx: Prisma.TransactionClient, companyId: string) {
  const rows = await tx.$queryRaw<{ n: number | null }[]>`SELECT MAX(CAST(SUBSTRING(code FROM 5) AS INTEGER)) AS n FROM marketing_assets WHERE company_id = ${companyId}::uuid AND code ~ '^AST-[0-9]+$'`;
  return `AST-${String((rows[0]?.n ?? 0) + 1).padStart(5, "0")}`;
}

async function loadAsset(actor: SalesActor, id: string, db: Prisma.TransactionClient | typeof prisma = prisma) {
  const a = await db.marketingAsset.findFirst({ where: { id, companyId: actor.companyId } });
  if (!a) throw new BusinessRuleError("NOT_FOUND", "Asset not found.", { id });
  return a;
}

async function assertOwner(actor: SalesActor, ownerUserId: string | undefined) {
  if (!ownerUserId) return actor.userId;
  const u = await prisma.user.findFirst({ where: { id: ownerUserId, companyId: actor.companyId }, select: { id: true } });
  if (!u) throw new BusinessRuleError("VALIDATION_ERROR", "Choose an owner from your company.", { fieldErrors: { ownerUserId: "Unknown user." } });
  return u.id;
}

async function duplicatesOf(companyId: string, sha256: string, exceptAssetId?: string) {
  const rows = await prisma.marketingAssetVersion.findMany({ where: { companyId, sha256, ...(exceptAssetId ? { assetId: { not: exceptAssetId } } : {}) }, select: { asset: { select: { id: true, code: true, name: true } } }, take: 5 });
  return [...new Map(rows.map((r) => [r.asset.id, r.asset])).values()];
}

/** New asset with its first file (version 1). */
export async function createAsset(actor: SalesActor, rawMeta: unknown, file: UploadedFile) {
  await PermissionService.assert(actor.userId, "marketing_content", "create");
  const meta = assetMetadataSchema.parse(rawMeta);
  const ownerUserId = await assertOwner(actor, meta.ownerUserId);
  const f = await storeAssetFile(file, meta.assetType);
  const duplicates = await duplicatesOf(actor.companyId, f.sha256);
  const asset = await withStoredFile(f, async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await prisma.$transaction(async (tx) => {
          const code = await nextAssetCode(tx, actor.companyId);
          const a = await tx.marketingAsset.create({
            data: {
              companyId: actor.companyId,
              code,
              name: meta.name,
              description: meta.description || null,
              assetType: meta.assetType,
              tags: meta.tags,
              altText: meta.altText || null,
              usageNotes: meta.usageNotes || null,
              expiresOn: meta.expiresOn ? new Date(`${meta.expiresOn}T00:00:00Z`) : null,
              ownerUserId,
              searchText: searchTextOf(code, meta.name, meta.description, meta.tags),
              createdByUserId: actor.userId,
            },
          });
          const v = await tx.marketingAssetVersion.create({ data: { companyId: actor.companyId, assetId: a.id, versionNumber: 1, ...f, createdByUserId: actor.userId } });
          const updated = await tx.marketingAsset.update({ where: { id: a.id }, data: { currentVersionId: v.id, currentVersionNumber: 1 } });
          await auditContent(tx, actor, ASSETS_TABLE, a.id, "CREATE", null, { code, name: a.name, assetType: a.assetType, version: 1, mimeType: f.mimeType, size: f.fileSizeBytes, sha256: f.sha256 });
          return updated;
        });
      } catch (e) {
        if (attempt < 3 && e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue; // two uploads took the same code
        throw e;
      }
    }
  });
  return { asset: await getAsset(actor, asset.id), duplicates };
}

/** Replace the file: a new version. Content that pinned an older version keeps it. */
export async function addAssetVersion(actor: SalesActor, id: string, file: UploadedFile, changeNote: string | null) {
  await PermissionService.assert(actor.userId, "marketing_content", "edit");
  const a = await loadAsset(actor, id);
  if (a.status !== "ACTIVE") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Restore the asset before adding a version.");
  const f = await storeAssetFile(file, a.assetType as AssetType);
  const duplicates = await duplicatesOf(actor.companyId, f.sha256, a.id);
  const same = await prisma.marketingAssetVersion.findFirst({ where: { assetId: a.id, sha256: f.sha256 }, select: { versionNumber: true } });
  if (same) {
    await deleteStoredFile(f.storageKey).catch(() => undefined);
    throw new BusinessRuleError("VALIDATION_ERROR", `This file is identical to version ${same.versionNumber}.`, { fieldErrors: { file: "No change." } });
  }
  await withStoredFile(f, () =>
    prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM marketing_assets WHERE id = ${a.id}::uuid FOR UPDATE`;
      const fresh = await tx.marketingAsset.findUniqueOrThrow({ where: { id: a.id } });
      if (fresh.status !== "ACTIVE") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "The asset was archived just now.");
      const n = fresh.currentVersionNumber + 1;
      const v = await tx.marketingAssetVersion.create({ data: { companyId: actor.companyId, assetId: a.id, versionNumber: n, ...f, changeNote: changeNote?.trim().slice(0, 200) || null, createdByUserId: actor.userId } });
      await tx.marketingAsset.update({ where: { id: a.id }, data: { currentVersionId: v.id, currentVersionNumber: n, updatedByUserId: actor.userId, version: { increment: 1 } } });
      await auditContent(tx, actor, ASSET_VERSIONS_TABLE, v.id, "CREATE", null, { assetId: a.id, version: n, mimeType: f.mimeType, size: f.fileSizeBytes, sha256: f.sha256 });
    })
  );
  return { asset: await getAsset(actor, a.id), duplicates };
}

export async function updateAsset(actor: SalesActor, id: string, raw: unknown) {
  await PermissionService.assert(actor.userId, "marketing_content", "edit");
  const input = assetUpdateSchema.parse(raw);
  const a = await loadAsset(actor, id);
  if (a.status !== "ACTIVE") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Restore the asset before editing it.");
  const ownerUserId = await assertOwner(actor, input.ownerUserId ?? a.ownerUserId);
  const data = {
    name: input.name,
    description: input.description || null,
    tags: input.tags,
    altText: input.altText || null,
    usageNotes: input.usageNotes || null,
    expiresOn: input.expiresOn ? new Date(`${input.expiresOn}T00:00:00Z`) : null,
    ownerUserId,
  };
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.marketingAsset.updateMany({ where: { id, companyId: actor.companyId, version: input.version, status: "ACTIVE" }, data: { ...data, searchText: searchTextOf(a.code, data.name, data.description, data.tags), updatedByUserId: actor.userId, version: { increment: 1 } } });
    if (count === 0) throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "Someone changed this asset just now. Reload and try again.");
    await auditContent(tx, actor, ASSETS_TABLE, id, "UPDATE", { name: a.name, tags: a.tags, expiresOn: a.expiresOn, ownerUserId: a.ownerUserId }, data);
  });
  return getAsset(actor, id);
}

/** Where an asset is used: content versions that attach one of its versions. */
async function assetUsage(assetId: string) {
  const links = await prisma.marketingContentVersionAsset.findMany({
    where: { assetVersion: { assetId } },
    include: { assetVersion: { select: { versionNumber: true } }, contentVersion: { select: { id: true, versionNumber: true, runs: { where: { status: { in: ["PREPARING", "SCHEDULED", "QUEUED", "RUNNING"] } }, select: { id: true } }, content: { select: { id: true, name: true, status: true, currentVersionId: true, approvedVersionId: true, campaign: { select: { id: true, code: true, status: true } } } } } } },
    take: 200,
  });
  return links.map((l) => {
    const c = l.contentVersion.content;
    return {
      contentId: c.id,
      contentName: c.name,
      contentVersion: l.contentVersion.versionNumber,
      assetVersion: l.assetVersion.versionNumber,
      campaign: c.campaign,
      // In use: the version being sent or edited in an open campaign, or frozen by a run that is still going.
      live: l.contentVersion.runs.length > 0 || (c.status === "ACTIVE" && !["COMPLETED", "CANCELLED"].includes(c.campaign.status) && (c.approvedVersionId === l.contentVersion.id || c.currentVersionId === l.contentVersion.id)),
    };
  });
}

/** Archive: hidden from pickers, files kept. Refused while live campaign content uses it. */
export async function setAssetArchived(actor: SalesActor, id: string, archived: boolean, version: number) {
  await PermissionService.assert(actor.userId, "marketing_content", archived ? "delete" : "edit");
  const a = await loadAsset(actor, id);
  if (archived === (a.status === "ARCHIVED")) throw new BusinessRuleError("INVALID_STATE_TRANSITION", archived ? "Already archived." : "Not archived.");
  if (archived) {
    const linked = await prisma.marketingContentVersionAsset.count({
      where: { assetVersion: { assetId: id }, contentVersion: { OR: [{ runs: { some: { status: { in: ["PREPARING", "SCHEDULED", "QUEUED", "RUNNING"] } } } }, { content: { status: "ACTIVE", campaign: { status: OPEN_CAMPAIGN } } }] } },
    });
    if (linked) {
      const usage = (await assetUsage(id)).filter((u) => u.live);
      if (usage.length) throw new BusinessRuleError("REFERENCED_RECORD_IN_USE", `Used by content of open campaigns: ${[...new Set(usage.map((u) => `${u.campaign.code} "${u.contentName}"`))].slice(0, 5).join(", ")}. Remove it there first.`);
    }
  }
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.marketingAsset.updateMany({
      where: { id, companyId: actor.companyId, version },
      data: archived ? { status: "ARCHIVED", archivedAt: now, archivedByUserId: actor.userId, version: { increment: 1 } } : { status: "ACTIVE", archivedAt: null, archivedByUserId: null, version: { increment: 1 } },
    });
    if (count === 0) throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "Someone changed this asset just now. Reload and try again.");
    await auditContent(tx, actor, ASSETS_TABLE, id, archived ? "DELETE" : "UPDATE", { status: a.status }, { status: archived ? "ARCHIVED" : "ACTIVE" });
  });
  return getAsset(actor, id);
}

export async function getAsset(actor: SalesActor, id: string) {
  await PermissionService.assert(actor.userId, "marketing_content", "view");
  const a = await loadAsset(actor, id);
  const versions = await prisma.marketingAssetVersion.findMany({ where: { assetId: a.id }, orderBy: { versionNumber: "desc" } });
  const states = await reviewStates(versions.map((v) => v.id), "ASSET_VERSION");
  const names = await userNames([a.ownerUserId, a.createdByUserId, ...versions.map((v) => v.createdByUserId), ...[...states.values()].flatMap((s) => [s.submittedBy, s.decidedBy])]);
  const current = versions.find((v) => v.id === a.currentVersionId) ?? null;
  return {
    id: a.id,
    code: a.code,
    name: a.name,
    description: a.description,
    assetType: a.assetType as AssetType,
    tags: a.tags,
    altText: a.altText,
    usageNotes: a.usageNotes,
    expiresOn: a.expiresOn?.toISOString().slice(0, 10) ?? null,
    expired: Boolean(a.expiresOn && a.expiresOn.getTime() < Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate())),
    ownerUserId: a.ownerUserId,
    owner: names.get(a.ownerUserId) ?? "—",
    status: a.status,
    currentVersionId: a.currentVersionId,
    approvedVersionId: a.approvedVersionId,
    version: a.version,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
    versions: versions.map((v) => {
      const s = states.get(v.id);
      return {
        id: v.id,
        versionNumber: v.versionNumber,
        fileName: v.originalFileName,
        mimeType: v.mimeType,
        preview: isAssetMime(v.mimeType) ? ASSET_MIME[v.mimeType].preview : null,
        attachable: isAssetMime(v.mimeType) && ASSET_MIME[v.mimeType].attachable,
        fileSizeBytes: v.fileSizeBytes,
        sha256: v.sha256,
        width: v.width,
        height: v.height,
        scanStatus: v.scanStatus,
        changeNote: v.changeNote,
        createdBy: names.get(v.createdByUserId) ?? "—",
        createdByMe: v.createdByUserId === actor.userId,
        createdAt: v.createdAt.toISOString(),
        review: statusOf(states, v.id),
        decidedBy: s?.decidedBy ? (names.get(s.decidedBy) ?? "—") : null,
        decisionComment: s?.comment ?? null,
      };
    }),
    current: current ? { id: current.id, versionNumber: current.versionNumber } : null,
    usage: await assetUsage(a.id),
    duplicates: current ? await duplicatesOf(actor.companyId, current.sha256, a.id) : [],
  };
}

export async function listAssets(actor: SalesActor, filter: { search?: string; assetType?: string; status?: string; tag?: string; ownerUserId?: string; review?: string }, page = 1, pageSize = 24) {
  await PermissionService.assert(actor.userId, "marketing_content", "view");
  const and: Prisma.MarketingAssetWhereInput[] = [{ companyId: actor.companyId }];
  and.push(filter.status === "ARCHIVED" ? { status: "ARCHIVED" } : filter.status === "ANY" ? {} : { status: "ACTIVE" });
  if (filter.assetType && filter.assetType in ASSET_TYPES) and.push({ assetType: filter.assetType });
  if (filter.tag) and.push({ tags: { has: filter.tag.trim().toLowerCase() } });
  if (filter.ownerUserId && /^[0-9a-f-]{36}$/i.test(filter.ownerUserId)) and.push({ ownerUserId: filter.ownerUserId });
  if (filter.review === "approved") and.push({ approvedVersionId: { not: null } });
  if (filter.review === "unapproved") and.push({ approvedVersionId: null });
  const term = filter.search?.trim().toLowerCase();
  if (term) and.push({ searchText: { contains: term } });
  const where: Prisma.MarketingAssetWhereInput = { AND: and };
  const [total, rows] = await Promise.all([
    prisma.marketingAsset.count({ where }),
    prisma.marketingAsset.findMany({ where, orderBy: [{ updatedAt: "desc" }, { id: "asc" }], skip: (page - 1) * pageSize, take: pageSize, include: { currentVersion: true, approvedVersion: { select: { versionNumber: true } } } }),
  ]);
  const states = await reviewStates(rows.map((r) => r.currentVersionId).filter((x): x is string => Boolean(x)), "ASSET_VERSION");
  const names = await userNames(rows.map((r) => r.ownerUserId));
  return {
    data: rows.map((a) => ({
      id: a.id,
      code: a.code,
      name: a.name,
      assetType: a.assetType,
      tags: a.tags,
      status: a.status,
      owner: names.get(a.ownerUserId) ?? "—",
      currentVersion: a.currentVersion ? { id: a.currentVersion.id, versionNumber: a.currentVersion.versionNumber, mimeType: a.currentVersion.mimeType, fileSizeBytes: a.currentVersion.fileSizeBytes, width: a.currentVersion.width, height: a.currentVersion.height, review: statusOf(states, a.currentVersion.id) } : null,
      approvedVersionNumber: a.approvedVersion?.versionNumber ?? null,
      expiresOn: a.expiresOn?.toISOString().slice(0, 10) ?? null,
      updatedAt: a.updatedAt.toISOString(),
    })),
    meta: { page, pageSize, totalCount: total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  };
}

/** Approved, active, unexpired, attachable asset versions — for the content editor. */
export async function attachableAssets(actor: SalesActor) {
  await PermissionService.assert(actor.userId, "marketing_content", "view");
  const today = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
  const rows = await prisma.marketingAsset.findMany({
    where: { companyId: actor.companyId, status: "ACTIVE", approvedVersionId: { not: null }, OR: [{ expiresOn: null }, { expiresOn: { gte: today } }] },
    include: { approvedVersion: true },
    orderBy: { name: "asc" },
    take: 500,
  });
  return rows
    .filter((a) => a.approvedVersion && isAssetMime(a.approvedVersion.mimeType) && ASSET_MIME[a.approvedVersion.mimeType].attachable)
    .map((a) => ({ assetId: a.id, code: a.code, name: a.name, assetVersionId: a.approvedVersion!.id, versionNumber: a.approvedVersion!.versionNumber, fileName: a.approvedVersion!.originalFileName, mimeType: a.approvedVersion!.mimeType, fileSizeBytes: a.approvedVersion!.fileSizeBytes }));
}

/** The bytes of one version, for an authorised preview or download. */
export async function readAssetVersionFile(actor: SalesActor, versionId: string) {
  await PermissionService.assert(actor.userId, "marketing_content", "view");
  const v = await prisma.marketingAssetVersion.findFirst({ where: { id: versionId, companyId: actor.companyId } });
  if (!v) throw new BusinessRuleError("NOT_FOUND", "File not found.");
  let buffer: Buffer;
  try {
    buffer = await readStoredFile(v.storageKey);
  } catch {
    logger.error("Marketing asset file missing from storage", { assetVersionId: v.id });
    throw new BusinessRuleError("NOT_FOUND", "The file is missing from storage. Upload it again as a new version.");
  }
  return { buffer, mimeType: v.mimeType, fileName: v.originalFileName, sha256: v.sha256 };
}
