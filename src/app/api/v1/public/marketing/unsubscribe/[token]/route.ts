import { NextResponse, type NextRequest } from "next/server";
import { initRequestContext } from "@/core/logging/requestContext";
import { logger } from "@/core/logging/logger";
import { assertCaptureRateLimit } from "@/modules/crm/capture/capture-rate-limit";
import { describeUnsubscribe, unsubscribeByToken } from "@/modules/sales-marketing/delivery/delivery-events.service";

/**
 * Public unsubscribe link from campaign messages (no session).
 *  GET  — a confirmation page (mail scanners pre-fetch links, so GET never
 *         changes anything).
 *  POST — records the unsubscribe; also the RFC 8058 one-click target of the
 *         List-Unsubscribe header. Repeats are harmless.
 */
type Params = { params: Promise<{ token: string }> };

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function page(title: string, body: string, status = 200) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title>
<style>body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#f6f7f9;color:#1f2933;margin:0;padding:48px 16px}main{max-width:440px;margin:0 auto;background:#fff;border:1px solid #e3e6ea;border-radius:10px;padding:28px}h1{font-size:20px;margin:0 0 12px}p{line-height:1.5;margin:0 0 16px}button{background:#1f2933;color:#fff;border:0;border-radius:6px;padding:10px 18px;font-size:15px;cursor:pointer}</style></head><body><main><h1>${esc(title)}</h1>${body}</main></body></html>`;
  return new NextResponse(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
}

const invalid = () => page("Link not valid", "<p>This unsubscribe link isn't valid or has expired. If you keep getting messages, reply to one and ask to be removed.</p>", 404);

export async function GET(req: NextRequest, { params }: Params) {
  initRequestContext();
  const { token } = await params;
  try {
    assertCaptureRateLimit(`unsubscribe-ip:${req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown"}`, 60);
  } catch {
    return page("Please try again shortly", "<p>Too many requests. Please try again in a minute.</p>", 429);
  }
  const info = await describeUnsubscribe(token).catch(() => null);
  if (!info) return invalid();
  const what = info.channel === "EMAIL" ? "emails" : info.channel === "SMS" ? "SMS messages" : "WhatsApp messages";
  const who = info.maskedAddress ? ` to <strong>${esc(info.maskedAddress)}</strong>` : "";
  return page("Unsubscribe", `<p>Stop marketing ${what}${who}?</p><form method="post"><button type="submit">Unsubscribe</button></form>`);
}

export async function POST(req: NextRequest, { params }: Params) {
  initRequestContext();
  const { token } = await params;
  try {
    assertCaptureRateLimit(`unsubscribe-ip:${req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown"}`, 60);
  } catch {
    return page("Please try again shortly", "<p>Too many requests. Please try again in a minute.</p>", 429);
  }
  try {
    const ok = await unsubscribeByToken(token);
    if (!ok) return invalid();
  } catch (e) {
    logger.error("Unsubscribe failed", { error: (e as Error)?.message });
    return page("Something went wrong", "<p>We couldn't record that just now. Please try the link again in a few minutes.</p>", 500);
  }
  return page("You're unsubscribed", "<p>You won't receive these marketing messages any more. It can take a short while for messages already on their way to stop.</p>");
}
