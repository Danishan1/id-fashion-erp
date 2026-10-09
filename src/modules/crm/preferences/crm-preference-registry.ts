import { z } from "zod";
import { isValidTimeZone } from "../core/crm-timezone";

/**
 * Client-safe registry of per-user CRM screen preferences (Phase 08). Each
 * key has its own value schema; unknown keys are rejected, so preferences
 * can never become a dumping ground for business data. Add a screen's
 * preference here and it is immediately storable via the preferences API.
 */
const fieldKey = z.string().trim().min(1).max(60).regex(/^[a-zA-Z][a-zA-Z0-9_:.-]*$/);
const uuidOrNull = z.string().uuid().nullable();

export const CRM_PREFERENCES = {
  /** Opportunity list: visible columns (when no saved view is open). */
  "opportunities.list.columns": z.array(fieldKey).max(40),
  /** Opportunity list: saved view opened by default (null = "All opportunities"). */
  "opportunities.list.defaultViewId": uuidOrNull,
  /** Opportunity board: fields shown on cards, in order ("cf:<key>" = custom field). */
  "opportunities.board.cardFields": z.array(fieldKey).max(20),
  /** Opportunity board: last pipeline opened. */
  "opportunities.board.pipelineId": uuidOrNull,
  /** Opportunities page: last mode used. */
  "opportunities.mode": z.enum(["board", "list"]),
  /** Lead board: fields shown on cards, in order ("cf:<key>" = custom field). */
  "leads.board.cardFields": z.array(fieldKey).max(20),
  /** Leads page: last mode used. */
  "leads.mode": z.enum(["board", "list"]),
  /** Calendar (Phase 10): last view. */
  "calendar.view": z.enum(["day", "week", "month", "list"]),
  /** Calendar: time zone the calendar is shown in. */
  "calendar.timezone": z.string().max(64).refine(isValidTimeZone, "Unknown time zone"),
  /** Calendar: whose appointments ("mine", "all" or an employee id). */
  "calendar.employee": z.union([z.enum(["mine", "all"]), z.string().uuid()]),
} as const;
export type CrmPreferenceKey = keyof typeof CRM_PREFERENCES;
export type CrmPreferenceValue<K extends CrmPreferenceKey> = z.infer<(typeof CRM_PREFERENCES)[K]>;
export const CRM_PREFERENCE_KEYS = Object.keys(CRM_PREFERENCES) as CrmPreferenceKey[];
export const isCrmPreferenceKey = (k: unknown): k is CrmPreferenceKey => typeof k === "string" && Object.prototype.hasOwnProperty.call(CRM_PREFERENCES, k);
