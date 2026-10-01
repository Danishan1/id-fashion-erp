import { NextResponse } from "next/server";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { getCrmEventById } from "@/modules/crm/core/crm-events.service";
import { getCrmRecordScope } from "@/modules/crm/core/crm-visibility";
import { assertCrmEntityAccess } from "@/modules/crm/crm-entity-access";

export const GET = crmRoute<{ id: string }>("view", async ({ params, actor }) => {
  const data = await getCrmEventById(actor.companyId, params.id);
  if ((await getCrmRecordScope(actor)).mode === "OWN" && data.actor?.id !== actor.userId) {
    await assertCrmEntityAccess(actor, data.entityType, data.entityId).catch(() => {
      throw new BusinessRuleError("NOT_FOUND", "CRM event not found.", { id: params.id });
    });
  }
  return NextResponse.json({ data });
});
