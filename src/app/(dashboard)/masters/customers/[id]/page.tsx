import { notFound, redirect } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { getCustomerById } from "@/modules/customers/customer.service";

/**
 * Customer editing now happens via a modal on the Customers list — there is
 * no dedicated edit page anymore (see CustomersListClient.tsx). This route
 * is kept only because Deals/Reports/etc. already deep-link straight to
 * /masters/customers/{id} expecting to land on that customer's edit view;
 * redirecting into the list with ?edit={id} preserves that contract without
 * requiring any change in the linking modules. Customer 360 (a separate,
 * genuinely complex report page) is unaffected — see [id]/360/page.tsx.
 */
export default async function CustomerEditRedirectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();

  const customer = await getCustomerById(session!.user.companyId, id).catch(() => null);
  if (!customer) notFound();

  redirect(`/masters/customers?edit=${id}`);
}
