"use client";

import { textInputClass } from "@/components/ui/FormField";
import {
  CHANNEL_TYPES,
  CONVERSION_TYPES,
  MODEL_TYPES,
  TOUCHPOINT_TYPES,
  type ChannelType,
  type ConversionType,
  type ModelType,
  type TouchpointType,
} from "@/modules/sales-marketing/attribution/attribution-registry";
import { FormField } from "../promotions/promotion-ui";

export { Badge, CARD, FormButtons, FormField, inr, send, useApi } from "../promotions/promotion-ui";

/** Shared bits of the attribution screens (Phase 13). */

export interface Rules {
  modelType: ModelType;
  windowDays: number;
  touchpointTypes: TouchpointType[];
  channelTypes: ChannelType[];
  conversionTypes: ConversionType[];
  collapseRepeats: boolean;
  firstTouchPercent: number | null;
  lastTouchPercent: number | null;
  halfLifeDays: number | null;
  changeNote: string | null;
}

export interface RulesDraft {
  modelType: ModelType;
  windowDays: string;
  touchpointTypes: TouchpointType[];
  channelTypes: ChannelType[];
  conversionTypes: ConversionType[];
  collapseRepeats: boolean;
  firstTouchPercent: string;
  lastTouchPercent: string;
  halfLifeDays: string;
  changeNote: string;
}

const s = (v: number | null) => (v === null ? "" : String(v));
export const defaultRules = (): RulesDraft => ({
  modelType: "LINEAR",
  windowDays: "90",
  touchpointTypes: ["MESSAGE_DELIVERED", "CAMPAIGN_RESPONSE"],
  channelTypes: [],
  conversionTypes: ["LEAD_CREATED", "ENQUIRY_CREATED", "QUOTATION_ACCEPTED", "SALES_ORDER_BOOKED"],
  collapseRepeats: true,
  firstTouchPercent: "40",
  lastTouchPercent: "40",
  halfLifeDays: "7",
  changeNote: "",
});
export const toRulesDraft = (r: Rules): RulesDraft => ({ ...r, windowDays: String(r.windowDays), firstTouchPercent: s(r.firstTouchPercent) || "40", lastTouchPercent: s(r.lastTouchPercent) || "40", halfLifeDays: s(r.halfLifeDays) || "7", changeNote: "" });
export const rulesPayload = (r: RulesDraft) => ({
  ...r,
  firstTouchPercent: r.modelType === "POSITION_BASED" ? r.firstTouchPercent : null,
  lastTouchPercent: r.modelType === "POSITION_BASED" ? r.lastTouchPercent : null,
  halfLifeDays: r.modelType === "TIME_DECAY" ? r.halfLifeDays : null,
  changeNote: r.changeNote || null,
});

function Checks<K extends string>({ legend, all, value, onChange }: { legend: string; all: Record<K, string | { label: string; help?: string }>; value: K[]; onChange: (v: K[]) => void }) {
  return (
    <fieldset>
      <legend className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{legend}</legend>
      <div className="mt-1 space-y-1">
        {(Object.keys(all) as K[]).map((k) => {
          const item = all[k];
          const label = typeof item === "string" ? item : item.label;
          const help = typeof item === "string" ? undefined : item.help;
          return (
            <label key={k} className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={value.includes(k)} onChange={(e) => onChange(e.target.checked ? [...value, k] : value.filter((x) => x !== k))} />
              <span>
                {label}
                {help && <span className="block text-xs text-zinc-500">{help}</span>}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function RulesEditor({ value, onChange, showChangeNote }: { value: RulesDraft; onChange: (r: RulesDraft) => void; showChangeNote?: boolean }) {
  const set = (p: Partial<RulesDraft>) => onChange({ ...value, ...p });
  const input = textInputClass();
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <FormField label="Model" htmlFor="r-type" required hint={MODEL_TYPES[value.modelType].help}>
          <select id="r-type" value={value.modelType} onChange={(e) => set({ modelType: e.target.value as ModelType })} className={input}>
            {(Object.keys(MODEL_TYPES) as ModelType[]).map((k) => (
              <option key={k} value={k}>
                {MODEL_TYPES[k].label}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Window (days before the conversion)" htmlFor="r-window" required hint="Touches up to this many days before the conversion, and not after it, count.">
          <input id="r-window" type="number" min={1} max={730} required value={value.windowDays} onChange={(e) => set({ windowDays: e.target.value })} className={input} />
        </FormField>
        {value.modelType === "POSITION_BASED" && (
          <div className="grid grid-cols-2 gap-2">
            <FormField label="First touch %" htmlFor="r-first" required>
              <input id="r-first" type="number" min={0} max={100} step="0.01" required value={value.firstTouchPercent} onChange={(e) => set({ firstTouchPercent: e.target.value })} className={input} />
            </FormField>
            <FormField label="Last touch %" htmlFor="r-last" required>
              <input id="r-last" type="number" min={0} max={100} step="0.01" required value={value.lastTouchPercent} onChange={(e) => set({ lastTouchPercent: e.target.value })} className={input} />
            </FormField>
          </div>
        )}
        {value.modelType === "TIME_DECAY" && (
          <FormField label="Half-life (days)" htmlFor="r-half" required hint="A touch this many days older than another gets half its credit.">
            <input id="r-half" type="number" min={0.01} max={365} step="0.01" required value={value.halfLifeDays} onChange={(e) => set({ halfLifeDays: e.target.value })} className={input} />
          </FormField>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Checks legend="Touches that count" all={TOUCHPOINT_TYPES} value={value.touchpointTypes} onChange={(touchpointTypes) => set({ touchpointTypes })} />
        <Checks legend="Message channels (none ticked = all)" all={CHANNEL_TYPES} value={value.channelTypes} onChange={(channelTypes) => set({ channelTypes })} />
        <Checks legend="Conversions" all={Object.fromEntries((Object.keys(CONVERSION_TYPES) as ConversionType[]).map((k) => [k, { label: CONVERSION_TYPES[k].label, help: `Date: ${CONVERSION_TYPES[k].date}` }])) as Record<ConversionType, { label: string; help: string }>} value={value.conversionTypes} onChange={(conversionTypes) => set({ conversionTypes })} />
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={value.collapseRepeats} onChange={(e) => set({ collapseRepeats: e.target.checked })} />
        <span>
          Count repeated touches of the same campaign and kind once
          <span className="block text-xs text-zinc-500">The earliest one for first touch, otherwise the latest. Stops one campaign from piling up credit with many messages.</span>
        </span>
      </label>
      {showChangeNote && (
        <FormField label="What changed in this version" htmlFor="r-note">
          <input id="r-note" maxLength={300} value={value.changeNote} onChange={(e) => set({ changeNote: e.target.value })} className={input} />
        </FormField>
      )}
    </div>
  );
}

export function rulesSummary(r: Rules) {
  const parts: string[] = [MODEL_TYPES[r.modelType].label];
  if (r.modelType === "POSITION_BASED") parts.push(`${r.firstTouchPercent}% first / ${r.lastTouchPercent}% last`);
  if (r.modelType === "TIME_DECAY") parts.push(`half-life ${r.halfLifeDays} days`);
  parts.push(`${r.windowDays}-day window`);
  parts.push(r.touchpointTypes.map((t) => TOUCHPOINT_TYPES[t].label.toLowerCase()).join(", "));
  if (r.channelTypes.length) parts.push(r.channelTypes.map((c) => CHANNEL_TYPES[c]).join(" / "));
  parts.push(r.conversionTypes.map((c) => CONVERSION_TYPES[c].label.toLowerCase()).join(", "));
  if (r.collapseRepeats) parts.push("repeats counted once");
  return parts.join(" · ");
}

/** "—" with a reason instead of a misleading number. */
export function RatioCell({ r, suffix = "" }: { r: { value: number | null; status: string }; suffix?: string }) {
  if (r.value !== null) return <span className={r.value < 0 && suffix === "%" ? "text-red-600 dark:text-red-400" : ""}>{`${r.value.toLocaleString("en-IN")}${suffix}`}</span>;
  const why = r.status === "NO_COST" ? "No actual spend in the period" : r.status === "NO_REVENUE_BASIS" ? "No revenue basis" : "No data";
  return (
    <span className="text-zinc-400" title={why}>
      n/a
    </span>
  );
}

export const fmtCredit = (v: number) => (v === 0 ? "0" : v.toLocaleString("en-IN", { maximumFractionDigits: 2 }));
