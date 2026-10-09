import { NextResponse } from "next/server";
import { deleteContactAddress, updateContactAddress } from "@/modules/crm/contacts/crm-contacts.service";
import { crmRoute } from "@/modules/crm/core/crm-route";

export const PATCH = crmRoute<{ id: string; addressId: string }>("edit", async ({ req, params, actor }) =>
  NextResponse.json({ data: await updateContactAddress(actor, params.id, params.addressId, await req.json()) })
);

export const DELETE = crmRoute<{ id: string; addressId: string }>("edit", async ({ params, actor }) => {
  await deleteContactAddress(actor, params.id, params.addressId);
  return NextResponse.json({ data: { id: params.addressId } });
});
