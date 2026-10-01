import type { CrmEntityType } from "@prisma/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import type { CrmActor } from "../core/crm-actor";
import { runCrmMutation } from "../core/crm-mutation";
import { isCrmEventType, type CrmEventType } from "../core/crm-event-types";
import { getCrmRecordScope } from "../core/crm-visibility";
import { assertCrmEntityAccess } from "../crm-entity-access";
import { CrmNoteRepository, type CrmNoteRow } from "./crm-note.repository";
import { createNoteSchema, updateNoteSchema } from "./crm-note.schema";

/**
 * Notes on any CRM record. A note always belongs to exactly one record and is
 * only reachable by people who can see that record. Authors can edit their
 * own notes; authors and users with crm.view_all can delete (soft delete —
 * the note leaves the record but stays in the database and audit log).
 */
function noteEvent(entityType: CrmEntityType, verb: "added" | "updated" | "deleted"): CrmEventType {
  const name = `${entityType.toLowerCase()}.note_${verb}`;
  if (!isCrmEventType(name)) throw new Error(`Notes are not enabled for ${entityType} (missing event ${name}).`);
  return name;
}

const excerpt = (body: string) => (body.length > 140 ? `${body.slice(0, 137)}…` : body);

export function presentNote(note: CrmNoteRow, actor: CrmActor, canModerate: boolean) {
  const isAuthor = note.createdByUserId === actor.userId;
  return { ...note, canEdit: isAuthor, canDelete: isAuthor || canModerate };
}

export async function listNotes(actor: CrmActor, entityType: CrmEntityType, entityId: string) {
  await assertCrmEntityAccess(actor, entityType, entityId);
  const scope = await getCrmRecordScope(actor);
  const notes = await CrmNoteRepository.list(actor.companyId, entityType, entityId);
  return notes.map((n) => presentNote(n, actor, scope.mode === "ALL"));
}

export async function createNote(actor: CrmActor, entityType: CrmEntityType, entityId: string, raw: unknown) {
  const { body } = createNoteSchema.parse(raw);
  await assertCrmEntityAccess(actor, entityType, entityId);
  const note = await runCrmMutation(actor, async ({ tx, emit, audit }) => {
    const created = await CrmNoteRepository.create({ companyId: actor.companyId, entityType, entityId, body, createdByUserId: actor.userId }, tx);
    await audit({ tableName: "crm_notes", recordId: created.id, action: "CREATE", newValues: { entityType, entityId, body } });
    emit({ entityType, entityId, eventType: noteEvent(entityType, "added"), summary: excerpt(body), payload: { noteId: created.id } });
    return created;
  });
  return presentNote(note, actor, false);
}

async function loadOwnNoteOrThrow(actor: CrmActor, noteId: string) {
  const note = await CrmNoteRepository.findById(actor.companyId, noteId);
  if (!note) throw new BusinessRuleError("NOT_FOUND", "Note not found.", { id: noteId });
  await assertCrmEntityAccess(actor, note.entityType, note.entityId);
  return note;
}

export async function updateNote(actor: CrmActor, noteId: string, raw: unknown) {
  const { body } = updateNoteSchema.parse(raw);
  const before = await loadOwnNoteOrThrow(actor, noteId);
  if (before.createdByUserId !== actor.userId) throw new BusinessRuleError("PERMISSION_DENIED", "Only the author can edit a note.");
  const updated = await runCrmMutation(actor, async ({ tx, emit, audit }) => {
    const row = await CrmNoteRepository.update(actor.companyId, noteId, { body, editedAt: new Date(), updatedByUserId: actor.userId }, tx);
    await audit({ tableName: "crm_notes", recordId: noteId, action: "UPDATE", oldValues: { body: before.body }, newValues: { body } });
    emit({ entityType: before.entityType, entityId: before.entityId, eventType: noteEvent(before.entityType, "updated"), summary: excerpt(body), payload: { noteId } });
    return row;
  });
  return presentNote(updated, actor, false);
}

export async function deleteNote(actor: CrmActor, noteId: string) {
  const before = await loadOwnNoteOrThrow(actor, noteId);
  const scope = await getCrmRecordScope(actor);
  if (before.createdByUserId !== actor.userId && scope.mode !== "ALL") {
    throw new BusinessRuleError("PERMISSION_DENIED", "Only the author or a manager can delete a note.");
  }
  await runCrmMutation(actor, async ({ tx, emit, audit }) => {
    await CrmNoteRepository.update(actor.companyId, noteId, { deletedAt: new Date(), deletedByUserId: actor.userId }, tx);
    await audit({ tableName: "crm_notes", recordId: noteId, action: "DELETE", oldValues: { body: before.body } });
    emit({ entityType: before.entityType, entityId: before.entityId, eventType: noteEvent(before.entityType, "deleted"), summary: excerpt(before.body), payload: { noteId } });
  });
}
