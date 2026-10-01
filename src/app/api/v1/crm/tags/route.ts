import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { createTag, listTags } from "@/modules/crm/tags/crm-tags.service";

export const GET = crmRoute("view", async ({ req, actor }) => NextResponse.json({ data: await listTags(actor.companyId, req.nextUrl.searchParams.get("search") ?? undefined) }));

/** Creates a tag, or returns the existing one with the same name. */
export const POST = crmRoute("edit", async ({ req, actor }) => NextResponse.json({ data: await createTag(actor, await req.json()) }, { status: 201 }));
