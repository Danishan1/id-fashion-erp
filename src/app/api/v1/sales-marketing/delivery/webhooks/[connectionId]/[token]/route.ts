import { NextResponse, type NextRequest } from "next/server";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { initRequestContext } from "@/core/logging/requestContext";
import { handleApiError } from "@/lib/api-route";
import { assertCaptureRateLimit } from "@/modules/crm/capture/capture-rate-limit";
import { kickEventProcessing } from "@/modules/sales-marketing/delivery/delivery-dispatch";
import { MAX_WEBHOOK_BYTES, receiveWebhook, webhookHandshake } from "@/modules/sales-marketing/delivery/delivery-events.service";

/**
 * Provider callbacks for one marketing channel connection (public — no
 * session). The secret token in the URL identifies the connection; the
 * provider's own signature is checked too where it has one. Events are
 * stored (deduplicated) before we answer, then processed after the response.
 */
const LIMIT_PER_MINUTE = 1200;
type Params = { params: Promise<{ connectionId: string; token: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  try {
    initRequestContext();
    const { connectionId, token } = await params;
    assertCaptureRateLimit(`delivery-webhook:${connectionId}`, LIMIT_PER_MINUTE);
    const answer = await webhookHandshake(connectionId, token, { method: "GET", headers: req.headers, rawBody: "", query: req.nextUrl.searchParams });
    return new NextResponse(answer, { status: 200, headers: { "Content-Type": "text/plain" } });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    initRequestContext();
    const { connectionId, token } = await params;
    assertCaptureRateLimit(`delivery-webhook:${connectionId}`, LIMIT_PER_MINUTE);
    if (Number(req.headers.get("content-length") ?? 0) > MAX_WEBHOOK_BYTES) throw new BusinessRuleError("PAYLOAD_TOO_LARGE", "The payload is larger than 512 KB.");
    const rawBody = await req.text();
    if (Buffer.byteLength(rawBody) > MAX_WEBHOOK_BYTES) throw new BusinessRuleError("PAYLOAD_TOO_LARGE", "The payload is larger than 512 KB.");
    const result = await receiveWebhook(connectionId, token, { method: "POST", headers: req.headers, rawBody, query: req.nextUrl.searchParams });
    if (result.stored > 0) await kickEventProcessing();
    return NextResponse.json({ data: result });
  } catch (error) {
    return handleApiError(error);
  }
}
