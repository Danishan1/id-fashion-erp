import { NextResponse, type NextRequest } from "next/server";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { initRequestContext } from "@/core/logging/requestContext";
import { handleApiError } from "@/lib/api-route";
import { assertCaptureRateLimit } from "@/modules/crm/capture/capture-rate-limit";
import { handleChannelWebhook } from "@/modules/crm/conversations/conversation-messaging.service";

const MAX_BODY_BYTES = 12 * 1024 * 1024;
const LIMIT_PER_MINUTE = 600;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Incoming messages and delivery receipts for a conversation channel (public
 * — no session). The channel's provider authenticates the request (signature
 * + timestamp) and normalises it; repeats of the same provider message id
 * are acknowledged without storing anything twice. Unknown channels get a
 * plain 404; a paused channel answers 503 so the provider retries later
 * rather than dropping the message.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ provider: string; channelId: string }> }) {
  try {
    initRequestContext();
    const { provider, channelId } = await params;
    if (!UUID_RE.test(channelId) || !/^[a-z0-9_-]{1,40}$/.test(provider)) throw new BusinessRuleError("NOT_FOUND", "Webhook not found.");
    assertCaptureRateLimit(`conversation-webhook:${channelId}`, LIMIT_PER_MINUTE);
    if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) throw new BusinessRuleError("PAYLOAD_TOO_LARGE", "The payload is larger than 12 MB.");
    const rawBody = await req.text();
    if (Buffer.byteLength(rawBody) > MAX_BODY_BYTES) throw new BusinessRuleError("PAYLOAD_TOO_LARGE", "The payload is larger than 12 MB.");
    const result = await handleChannelWebhook({ providerKey: provider, channelId, headers: req.headers, rawBody });
    if (result.paused) return NextResponse.json({ error: { code: "CHANNEL_PAUSED", message: "This channel is paused. Retry later." } }, { status: 503, headers: { "Retry-After": "300" } });
    return NextResponse.json({ data: { received: result.received, results: result.results } });
  } catch (error) {
    return handleApiError(error);
  }
}
