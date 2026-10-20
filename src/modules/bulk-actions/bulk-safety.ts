import { ZodError } from "zod";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";

/**
 * Spreadsheet formula injection ("CSV injection"): a cell starting with
 * = + - @ (or a tab / carriage return, which some spreadsheet apps strip
 * before evaluating) can execute as a formula when the export is opened.
 * Such values are prefixed with a single quote, which spreadsheet apps show as
 * text. Applied to every string cell of CSV and XLSX exports.
 */
const FORMULA_START = /^[=+\-@\t\r]/;

export function sanitizeSpreadsheetCell(value: unknown): string | number | Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  const text = Array.isArray(value) ? value.map(String).join(", ") : String(value);
  return FORMULA_START.test(text) ? `'${text}` : text;
}

function csvField(value: string | number | Date | null): string {
  if (value === null) return "";
  const text = value instanceof Date ? value.toISOString() : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** RFC 4180 CSV (CRLF rows, quoted where needed) with a UTF-8 BOM so Excel opens Unicode correctly. Cells must already be sanitised. */
export function buildSafeCsv(header: string[], rows: (string | number | Date | null)[][]): Buffer {
  const lines = [header.map((h) => csvField(sanitizeSpreadsheetCell(h) as string)), ...rows.map((r) => r.map(csvField))].map((r) => r.join(","));
  return Buffer.from(`﻿${lines.join("\r\n")}\r\n`, "utf8");
}

export interface SafeItemError {
  code: string;
  message: string;
  /** Whether the raw error should be logged server-side (unexpected errors). */
  unexpected: boolean;
}

/**
 * Turns any error thrown by a per-record handler into a message that is safe to
 * show to an ordinary user: business-rule and validation messages are written
 * for users already; anything else (database, network, bugs) becomes a generic
 * message — stack traces, SQL and provider payloads are never stored on items.
 */
export function toSafeItemError(error: unknown): SafeItemError {
  if (error instanceof BulkItemError) return { code: error.code, message: error.message, unexpected: false };
  if (error instanceof BusinessRuleError) return { code: error.code, message: error.message.slice(0, 500), unexpected: false };
  if (error instanceof ZodError) {
    const first = error.issues[0];
    return { code: "VALIDATION_ERROR", message: first ? `${first.path.join(".") || "value"}: ${first.message}`.slice(0, 500) : "Invalid value.", unexpected: false };
  }
  // Workflow action errors (reused runners) carry user-safe messages and a code.
  // Their "UNEXPECTED" code wraps a raw error message, so it gets the generic message below.
  if (error instanceof Error && error.name === "WorkflowActionError" && typeof (error as { code?: unknown }).code === "string" && (error as { code?: unknown }).code !== "UNEXPECTED") {
    return { code: (error as unknown as { code: string }).code, message: error.message.slice(0, 500), unexpected: false };
  }
  return { code: "UNEXPECTED", message: "Unexpected error while processing this record. The administrator can find details in the server log.", unexpected: true };
}

/** Thrown by handlers for an expected, user-facing failure of one record. */
export class BulkItemError extends Error {
  constructor(
    message: string,
    readonly code: string = "VALIDATION_ERROR"
  ) {
    super(message);
    this.name = "BulkItemError";
  }
}
