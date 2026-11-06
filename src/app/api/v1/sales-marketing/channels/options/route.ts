import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { listAgentOptions, listChannelOptions } from "@/modules/sales-marketing/channels/sales-channel.service";

/** Active channels and sales agents for pickers. */
export const GET = salesMarketingRoute(
  [{ module: "sales_marketing", action: "view" }, { module: "sales_quotations", action: "view" }, { module: "sales_commissions", action: "view" }],
  async ({ actor }) => {
    const [channels, agents] = await Promise.all([listChannelOptions(actor), listAgentOptions(actor)]);
    return NextResponse.json({ data: { channels, agents: agents.map((a) => ({ id: a.id, code: a.code, name: a.name })) } });
  }
);
