import { z } from "zod";

/**
 * The one shared phone-number rule for the whole app — every phone field across
 * Customers/Buyers, Suppliers, Employees, Sales Agents, Buyer Enquiries, User
 * administration, and CRM Leads previously enforced its own inconsistent
 * `.max(N)` length only, with N differing per module and no format check at all.
 * Loosely E.164-shaped: an optional leading "+", 7-15 real digits, with spaces,
 * hyphens, and parentheses allowed as separators (not counted toward the digit
 * range) so a formatted number like "+91 98765-43210" or "(022) 4567 8901"
 * still validates.
 */
export const PHONE_ERROR_MESSAGE =
  "Enter a valid phone number (7-15 digits, may include +, spaces, hyphens, or parentheses).";

const PHONE_CHARS_REGEX = /^[+]?[\d\s()-]+$/;

export function isValidPhone(value: string): boolean {
  if (!PHONE_CHARS_REGEX.test(value)) return false;
  const digitCount = value.replace(/\D/g, "").length;
  return digitCount >= 7 && digitCount <= 15;
}

/** For a phone field that must be filled in (e.g. Buyer, per Item 3's analysis). */
export const requiredPhoneSchema = z
  .string()
  .trim()
  .min(1, "Phone number is required.")
  .refine(isValidPhone, PHONE_ERROR_MESSAGE);

/** For a phone field that may be left blank, but must be well-formed if provided. */
export const optionalPhoneSchema = z
  .string()
  .trim()
  .refine(isValidPhone, PHONE_ERROR_MESSAGE)
  .optional()
  .or(z.literal(""));
