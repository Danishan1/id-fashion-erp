import { NextResponse } from "next/server";
import { z } from "zod";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { availableSources, segmentFieldOptions, segmentOwnerOptions } from "@/modules/sales-marketing/segments/segment-options.service";
import { SEGMENT_SOURCE_KEYS } from "@/modules/sales-marketing/segments/segment-registry";

/** GET ?source=CONTACT: lookup values for that source's fields; without source: owners + sources the user may use. */
export const GET = salesMarketingRoute({ module: "marketing_segments", action: "view" }, async ({ req, actor }) => {
  const source = req.nextUrl.searchParams.get("source");
  if (source) return NextResponse.json({ data: await segmentFieldOptions(actor, z.enum(SEGMENT_SOURCE_KEYS).parse(source)) });
  const [owners, sources] = await Promise.all([segmentOwnerOptions(actor), availableSources(actor)]);
  return NextResponse.json({ data: { owners, sources } });
});
