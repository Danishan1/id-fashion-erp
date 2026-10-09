import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/core/auth/auth";
import { getCustomer360 } from "@/modules/customers/customer-360.service";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { humanizeStatus } from "@/lib/humanize-status";
import { formatNumber } from "@/lib/currency";

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{title}</h2>
        {action}
      </div>
      {children}
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return <p className="text-sm text-zinc-500 dark:text-zinc-400">{label}</p>;
}

export default async function Customer360Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();

  const data = await getCustomer360(session!.user.companyId, id).catch(() => null);
  if (!data) notFound();

  const { customer, sampleRequests, salesOrders } = data;

  const orderTotal = salesOrders.reduce((sum, o) => sum + Number(o.totalAmount), 0);

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumb
          items={[
            { label: "Masters", href: "/masters" },
            { label: "Customers", href: "/masters/customers" },
            { label: customer.name, href: `/masters/customers/${id}` },
            { label: "360" },
          ]}
        />
        <div className="mt-2 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{customer.name} — Customer 360</h1>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              {customer.code} · {customer.type} {customer.country ? `· ${customer.country}` : ""}
            </p>
          </div>
          <Link href={`/masters/customers/${id}`} className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400">
            Edit Customer →
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {[
          ["Sales Orders Value", `₹${formatNumber(orderTotal)}`],
          ["Sample Requests", sampleRequests.length.toString()],
          ["Buyers", customer.buyers.length.toString()],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
            <div className="text-xs font-medium uppercase text-zinc-500">{label}</div>
            <div className="mt-1 text-xl font-semibold text-zinc-900 dark:text-zinc-50">{value}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Buyers">
          {customer.buyers.length === 0 ? (
            <Empty label="No buyers added." />
          ) : (
            <ul className="space-y-1 text-sm">
              {customer.buyers.map((b) => (
                <li key={b.id}>
                  {b.name} ({b.code}) {b.email ? `· ${b.email}` : ""}
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Sample Requests" action={<Link href="/sampling" className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400">All Samples →</Link>}>
          {sampleRequests.length === 0 ? (
            <Empty label="No sample requests yet." />
          ) : (
            <ul className="space-y-1 text-sm">
              {sampleRequests.map((s) => (
                <li key={s.id}>
                  <a href={`/sampling/${s.id}`} className="text-indigo-600 hover:underline dark:text-indigo-400">
                    {s.requestNumber}
                  </a>{" "}
                  — {s.styleName ?? "—"} · {humanizeStatus(s.status)}
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Sales Orders" action={<Link href="/sales-orders/new" className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400">+ New Order</Link>}>
          {salesOrders.length === 0 ? (
            <Empty label="No sales orders yet." />
          ) : (
            <ul className="space-y-1 text-sm">
              {salesOrders.map((o) => (
                <li key={o.id}>
                  <a href={`/sales-orders/${o.id}`} className="text-indigo-600 hover:underline dark:text-indigo-400">
                    {o.orderNumber}
                  </a>{" "}
                  — {o.currencyCode} {formatNumber(Number(o.totalAmount))} · {humanizeStatus(o.status)}
                </li>
              ))}
            </ul>
          )}
        </Section>

      </div>
    </div>
  );
}
