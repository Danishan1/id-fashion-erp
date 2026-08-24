import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/core/auth/auth";
import { getCustomer360 } from "@/modules/customers/customer-360.service";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { humanizeStatus } from "@/lib/humanize-status";

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

  const { customer, deals, leads, sampleRequests, salesOrders, activities, followups, campaignTouchpoints } = data;

  const openPipeline = deals.filter((d) => d.stage !== "WON" && d.stage !== "LOST").reduce((sum, d) => sum + Number(d.value), 0);
  const wonValue = deals.filter((d) => d.stage === "WON").reduce((sum, d) => sum + Number(d.value), 0);
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

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          ["Open Pipeline", `₹${openPipeline.toLocaleString()}`],
          ["Won Value", `₹${wonValue.toLocaleString()}`],
          ["Sales Orders Value", `₹${orderTotal.toLocaleString()}`],
          ["Sample Requests", sampleRequests.length.toString()],
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

        <Section title="Leads" action={<Link href="/leads" className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400">All Leads →</Link>}>
          {leads.length === 0 ? (
            <Empty label="No leads on record — this customer's own deals weren't created from a lead." />
          ) : (
            <ul className="space-y-1 text-sm">
              {leads.map((l) => (
                <li key={l.id}>
                  <a href={`/leads/${l.id}`} className="text-indigo-600 hover:underline dark:text-indigo-400">
                    {l.name} ({l.leadNumber})
                  </a>{" "}
                  · {humanizeStatus(l.source)}
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Deals" action={<Link href="/deals/new" className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400">+ New Deal</Link>}>
          {deals.length === 0 ? (
            <Empty label="No deals yet." />
          ) : (
            <ul className="space-y-2 text-sm">
              {deals.map((d) => (
                <li key={d.id} className="rounded-md border border-zinc-100 p-2 dark:border-zinc-800">
                  <a href={`/deals/${d.id}`} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                    {d.dealNumber} — {d.title}
                  </a>
                  <div className="mt-0.5 text-xs text-zinc-500">
                    {humanizeStatus(d.stage)} · ₹{Number(d.value).toLocaleString()} · {d.assignedTo?.fullName ?? "Unassigned"}
                    {d.salesAgent ? ` · Agent: ${d.salesAgent.name}` : ""}
                  </div>
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
                  — {o.currencyCode} {Number(o.totalAmount).toLocaleString()} · {humanizeStatus(o.status)}
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Campaigns that touched this customer">
          {campaignTouchpoints.length === 0 ? (
            <Empty label="No campaign attribution recorded for this customer's leads." />
          ) : (
            <ul className="space-y-1 text-sm">
              {campaignTouchpoints.map((t) => (
                <li key={t.id}>
                  {t.campaign ? (
                    <a href={`/campaigns/${t.campaign.id}`} className="text-indigo-600 hover:underline dark:text-indigo-400">
                      {t.campaign.name}
                    </a>
                  ) : (
                    "—"
                  )}{" "}
                  {t.campaign ? `(${humanizeStatus(t.campaign.channel)})` : ""} {t.isFirstTouch ? "· First touch" : ""}
                  {t.isLastTouch ? "· Last touch" : ""}
                  {Number(t.attributedRevenue) > 0 ? ` · ₹${Number(t.attributedRevenue).toLocaleString()} attributed` : ""}
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Follow-ups">
          {followups.length === 0 ? (
            <Empty label="No follow-ups logged directly against this customer." />
          ) : (
            <ul className="space-y-1 text-sm">
              {followups.map((f) => (
                <li key={f.id}>
                  {new Date(f.followupDate).toLocaleDateString()} · {f.type} · {humanizeStatus(f.status)}
                  {f.notes ? ` — ${f.notes}` : ""}
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Activity Timeline">
          {activities.length === 0 ? (
            <Empty label="No activity logged directly against this customer." />
          ) : (
            <ul className="space-y-1 text-sm">
              {activities.map((a) => (
                <li key={a.id}>
                  {new Date(a.activityAt).toLocaleDateString()} · {a.activityType} · {a.performedBy.fullName}
                  {a.subject ? ` — ${a.subject}` : ""}
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}
