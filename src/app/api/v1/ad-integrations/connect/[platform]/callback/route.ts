import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/api-route";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { AD_PLATFORMS } from "@/modules/marketing/ad-integrations/ad-integration.schema";
import { handleAdIntegrationCallback } from "@/modules/marketing/ad-integrations/ad-integration.service";

interface RouteContext {
  params: Promise<{ platform: string }>;
}

/**
 * The browser lands here via a top-level navigation FROM Meta/Google, so
 * this is never called via `fetch()` — every outcome is a redirect back
 * into the app's own UI (never raw JSON), with the result communicated via
 * a query param the connections page reads and displays.
 */
export async function GET(req: NextRequest, { params }: RouteContext) {
  const redirectTo = new URL("/marketing/ad-integrations", req.url);

  try {
    await requireSession();
    const { platform } = await params;
    const upper = platform.toUpperCase();
    if (!AD_PLATFORMS.includes(upper as (typeof AD_PLATFORMS)[number])) {
      throw new BusinessRuleError("VALIDATION_ERROR", `Unknown ad platform "${platform}".`);
    }

    const code = req.nextUrl.searchParams.get("code");
    const state = req.nextUrl.searchParams.get("state");
    const oauthError = req.nextUrl.searchParams.get("error");
    if (oauthError) throw new BusinessRuleError("VALIDATION_ERROR", `The platform declined the connection request: ${oauthError}.`);
    if (!code || !state) throw new BusinessRuleError("VALIDATION_ERROR", "Missing code/state on the OAuth callback.");

    const connections = await handleAdIntegrationCallback(upper as (typeof AD_PLATFORMS)[number], code, state);

    redirectTo.searchParams.set("connected", String(connections.length));
    redirectTo.searchParams.set("platform", upper);
  } catch (error) {
    const message = error instanceof BusinessRuleError ? error.message : "Something went wrong connecting this account.";
    redirectTo.searchParams.set("error", message);
  }

  return NextResponse.redirect(redirectTo);
}
