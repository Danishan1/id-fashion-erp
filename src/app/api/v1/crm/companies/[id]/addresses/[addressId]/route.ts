import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { deleteCompanyAddress, updateCompanyAddress } from "@/modules/crm/companies/crm-companies.service";

export const PATCH = crmRoute<{ id: string; addressId: string }>("edit", async ({ req, params, actor }) =>
  NextResponse.json({ data: await updateCompanyAddress(actor, params.id, params.addressId, await req.json()) })
);

export const DELETE = crmRoute<{ id: string; addressId: string }>("edit", async ({ params, actor }) => {
  await deleteCompanyAddress(actor, params.id, params.addressId);
  return NextResponse.json({ data: { id: params.addressId } });
});
