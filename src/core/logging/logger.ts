/**
 * Minimal structured logger — every call site's console.error/warn/log calls
 * were previously bare, unparseable text (confirmed by the readiness audit:
 * the entire backend's observability was one `console.error("Unhandled
 * error:", error)` call). This doesn't pick an observability vendor (Sentry/
 * Datadog/etc — a real infrastructure decision this file deliberately
 * doesn't make) — it just gives every log line a consistent, greppable JSON
 * shape (level/timestamp/message/context) so a log aggregator can be pointed
 * at stdout later with zero further code changes, and so a human reading raw
 * logs today can already filter by level/module.
 */

import { getRequestContext } from "@/core/logging/requestContext";

type LogLevel = "info" | "warn" | "error";

interface LogContext {
  [key: string]: unknown;
}

function write(level: LogLevel, message: string, context?: LogContext) {
  const requestCtx = getRequestContext();
  const entry = {
    level,
    timestamp: new Date().toISOString(),
    message,
    ...(requestCtx
      ? { requestId: requestCtx.requestId, userId: requestCtx.userId, companyId: requestCtx.companyId }
      : {}),
    ...(context ? { context: serializeContext(context) } : {}),
  };
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

/** Errors don't serialize their own message/stack via plain JSON.stringify
 * (Error's own properties are non-enumerable) — unwrap them explicitly so
 * they actually show up in the log line instead of becoming `{}`. */
function serializeContext(context: LogContext): LogContext {
  const serialized: LogContext = {};
  for (const [key, value] of Object.entries(context)) {
    serialized[key] =
      value instanceof Error ? { name: value.name, message: value.message, stack: value.stack } : value;
  }
  return serialized;
}

export const logger = {
  info: (message: string, context?: LogContext) => write("info", message, context),
  warn: (message: string, context?: LogContext) => write("warn", message, context),
  error: (message: string, context?: LogContext) => write("error", message, context),
};
