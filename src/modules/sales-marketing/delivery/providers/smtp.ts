import nodemailer from "nodemailer";
import { MARKETING_PROVIDERS } from "../delivery-registry";
import { normalizeEmail, str } from "./http";
import type { ConnectionRuntime, MarketingProviderAdapter, ProviderDeps, SendOutcome, SmtpLikeTransport } from "./provider-contract";

/**
 * Email over SMTP (nodemailer). SMTP has no delivery receipts: an accepted
 * message is ACCEPTED and stays there. We set the Message-ID ourselves
 * (<delivery id@sender domain>), so the provider message id is known even if
 * the reply is lost — but SMTP can't be asked about it later, so a lost
 * reply stays UNKNOWN.
 */

const SMTP_TIMEOUTS = { connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000 };

function transportOptions(conn: ConnectionRuntime) {
  const security = str(conn.config.security) || "STARTTLS";
  const username = str(conn.config.username);
  return {
    host: str(conn.config.host),
    port: Number(conn.config.port) || 587,
    secure: security === "TLS",
    requireTLS: security === "STARTTLS",
    ignoreTLS: security === "NONE",
    auth: username ? { user: username, pass: conn.secrets.password ?? "" } : undefined,
    ...SMTP_TIMEOUTS,
  };
}

function makeTransport(conn: ConnectionRuntime, deps: ProviderDeps): SmtpLikeTransport {
  const opts = transportOptions(conn);
  return deps.smtpTransport ? deps.smtpTransport(opts) : (nodemailer.createTransport(opts) as unknown as SmtpLikeTransport);
}

/** nodemailer error → outcome. Errors before DATA was accepted are safe to retry; timeouts after are not. */
export function classifySmtpError(e: unknown): SendOutcome {
  const err = e as { code?: string; responseCode?: number; command?: string; message?: string };
  const code = err.code ?? "";
  const rc = err.responseCode ?? 0;
  if (code === "EAUTH") return { kind: "CONNECTION", code: "AUTH_FAILED", message: "The SMTP server rejected the login." };
  if (code === "EENVELOPE" || (rc >= 550 && rc < 560)) return { kind: "PERMANENT", code: "RECIPIENT_REJECTED", message: "The mail server refused this recipient.", providerStatus: rc ? String(rc) : undefined };
  if (rc >= 500) return { kind: "PERMANENT", code: "MESSAGE_REJECTED", message: "The mail server refused the message.", providerStatus: String(rc) };
  if (rc === 421 || rc === 450 || rc === 451 || rc === 452) return { kind: "RETRYABLE", code: "TEMPORARY_FAILURE", message: "The mail server asked to try again later.", providerStatus: String(rc) };
  if (code === "ECONNECTION" || code === "EDNS" || code === "ETLS") return { kind: "RETRYABLE", code: "PROVIDER_UNREACHABLE", message: "The mail server could not be reached." };
  // ETIMEDOUT / ESOCKET / anything after the message started: may have been accepted.
  return { kind: "UNKNOWN", code: code || "SMTP_ERROR", message: "The connection ended before the server confirmed — the message may or may not have been accepted." };
}

export const smtpAdapter: MarketingProviderAdapter = {
  key: "SMTP",
  capabilities: MARKETING_PROVIDERS.SMTP.capabilities,
  validateConfig(config, secrets) {
    const errors: Record<string, string> = {};
    if (!str(config.host) || !/^[A-Za-z0-9.-]+$/.test(str(config.host))) errors.host = "Enter the SMTP host name.";
    const port = Number(config.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) errors.port = "Enter a port between 1 and 65535.";
    if (!["STARTTLS", "TLS", "NONE"].includes(str(config.security))) errors.security = "Choose the security mode.";
    if (!normalizeEmail(str(config.fromEmail))) errors.fromEmail = "Enter a valid sender email.";
    if (str(config.replyTo) && !normalizeEmail(str(config.replyTo))) errors.replyTo = "Enter a valid email.";
    if (str(config.username) && !secrets.password) errors.password = "Enter the password for this username.";
    return errors;
  },
  normalizeDestination: (raw) => normalizeEmail(raw),
  validateMessage(msg) {
    const out: string[] = [];
    if (!msg.subject?.trim()) out.push("An email needs a subject.");
    if (!msg.body.trim()) out.push("The message body is empty.");
    return out;
  },
  async testConnection(conn, deps) {
    const t = makeTransport(conn, deps);
    try {
      await t.verify();
      return { ok: true, message: "Connected and logged in to the SMTP server." };
    } catch (e) {
      const o = classifySmtpError(e);
      return { ok: false, message: "message" in o ? o.message : "Connection test failed." };
    } finally {
      t.close?.();
    }
  },
  async send(conn, msg, deps) {
    const from = str(conn.config.fromEmail);
    const domain = from.split("@")[1] ?? "localhost";
    const messageId = `<${msg.deliveryId}@${domain}>`;
    const headers: Record<string, string> = { "X-Delivery-Ref": msg.deliveryId };
    if (msg.unsubscribeUrl) {
      headers["List-Unsubscribe"] = `<${msg.unsubscribeUrl}>`;
      headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
    }
    const t = makeTransport(conn, deps);
    try {
      const info = await t.sendMail({
        from: str(conn.config.fromName) ? { name: str(conn.config.fromName), address: from } : from,
        to: msg.toName ? { name: msg.toName, address: msg.to } : msg.to,
        replyTo: str(conn.config.replyTo) || undefined,
        subject: msg.subject ?? "",
        text: msg.body,
        messageId,
        headers,
      });
      if (Array.isArray(info.rejected) && info.rejected.length > 0) return { kind: "PERMANENT", code: "RECIPIENT_REJECTED", message: "The mail server refused this recipient." };
      return { kind: "ACCEPTED", providerMessageId: messageId, providerStatus: (info.response ?? "").slice(0, 60) || undefined };
    } catch (e) {
      return classifySmtpError(e);
    } finally {
      t.close?.();
    }
  },
};
