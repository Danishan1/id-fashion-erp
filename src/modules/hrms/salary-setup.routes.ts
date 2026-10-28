import type { NextRequest } from "next/server";
import { hrmsRoute } from "./hrms-route";
import { statutorySettingSchema, type StatutoryKind } from "./salary-setup.schema";
import { createStatutorySetting, listStatutorySettings, updateStatutorySetting } from "./salary-setup.service";

/** Shared handlers for the PF and ESIC master routes (same shape, different kind). */
export function statutoryCollectionHandlers(kind: StatutoryKind) {
  return {
    GET: () => hrmsRoute("hrms_salary_setup", "view", (actor) => listStatutorySettings(actor.companyId, kind)),
    POST: async (req: NextRequest) => {
      const body = await req.json().catch(() => ({}));
      return hrmsRoute("hrms_salary_setup", "create", (actor) => createStatutorySetting(actor, kind, statutorySettingSchema.parse(body)), 201);
    },
  };
}

export function statutoryItemHandlers(kind: StatutoryKind) {
  return {
    PATCH: async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
      const { id } = await params;
      const body = await req.json().catch(() => ({}));
      return hrmsRoute("hrms_salary_setup", "edit", (actor) => updateStatutorySetting(actor, kind, id, statutorySettingSchema.parse(body)));
    },
  };
}
