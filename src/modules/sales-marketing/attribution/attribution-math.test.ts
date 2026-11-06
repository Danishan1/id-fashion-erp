import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { allocateMoney, costPer, eligibleTouches, endOfBusinessDay, roas, roiPercent, weightsFor, type Rules, type Touch } from "./attribution-math";
import { attributeBatch } from "./attribution-run.service";
import { modelRulesSchema } from "./attribution-registry";

const D = (s: string) => new Date(s);
const conv = { at: D("2026-11-10T12:00:00Z"), identityKeys: ["CONTACT:c1", "CUSTOMER:k1"] };
const rules = (extra: Partial<Rules> = {}): Rules => ({ modelType: "LINEAR", windowDays: 30, touchpointTypes: ["MESSAGE_SENT", "MESSAGE_DELIVERED", "CAMPAIGN_RESPONSE"], channelTypes: [], collapseRepeats: false, firstTouchPercent: null, lastTouchPercent: null, halfLifeDays: null, ...extra });
let n = 0;
const touch = (at: string, extra: Partial<Touch> = {}): Touch => ({ id: `t${String(n++).padStart(3, "0")}`, campaignId: "camA", touchpointType: "MESSAGE_DELIVERED", channelType: "EMAIL", occurredAt: D(at), identityKeys: ["CONTACT:c1"], status: "VALID", ...extra });
const sum = (a: Prisma.Decimal[]) => a.reduce((s, x) => s.add(x), new Prisma.Decimal(0));
const strs = (a: Prisma.Decimal[]) => a.map((x) => x.toString());

describe("eligibility and window", () => {
  it("both window ends are included; touches after the conversion never count", () => {
    const start = touch("2026-10-11T12:00:00Z"); // exactly 30 days before
    const before = touch("2026-10-11T11:59:59Z");
    const atConv = touch("2026-11-10T12:00:00Z");
    const after = touch("2026-11-10T12:00:01Z");
    expect(eligibleTouches([after, atConv, before, start], conv, rules()).map((t) => t.id)).toEqual([start.id, atConv.id]);
  });

  it("needs a shared identity key; excluded touches, other types and other channels don't count", () => {
    const other = touch("2026-11-01T00:00:00Z", { identityKeys: ["CONTACT:someone-else"] });
    const viaCustomer = touch("2026-11-02T00:00:00Z", { identityKeys: ["CONTACT:c9", "CUSTOMER:k1"] });
    const bounced = touch("2026-11-03T00:00:00Z", { status: "EXCLUDED" });
    const sms = touch("2026-11-04T00:00:00Z", { channelType: "SMS" });
    const tag = touch("2026-11-05T00:00:00Z", { touchpointType: "CAMPAIGN_RESPONSE", channelType: null });
    const r = rules({ channelTypes: ["EMAIL"] });
    expect(eligibleTouches([other, viaCustomer, bounced, sms, tag], conv, r).map((t) => t.id)).toEqual([viaCustomer.id, tag.id]);
    expect(eligibleTouches([tag, viaCustomer], conv, rules({ touchpointTypes: ["CAMPAIGN_RESPONSE"] })).map((t) => t.id)).toEqual([tag.id]);
  });

  it('"message sent" includes messages later confirmed delivered, not the other way round', () => {
    const delivered = touch("2026-11-01T00:00:00Z");
    const sentOnly = touch("2026-11-02T00:00:00Z", { touchpointType: "MESSAGE_SENT" });
    expect(eligibleTouches([delivered, sentOnly], conv, rules({ touchpointTypes: ["MESSAGE_SENT"] }))).toHaveLength(2);
    expect(eligibleTouches([delivered, sentOnly], conv, rules({ touchpointTypes: ["MESSAGE_DELIVERED"] })).map((t) => t.id)).toEqual([delivered.id]);
  });

  it("orders by time then id; repeats collapse to the earliest for first-touch, the latest otherwise", () => {
    const a1 = touch("2026-11-01T00:00:00Z", { id: "b" });
    const a2 = touch("2026-11-01T00:00:00Z", { id: "a" });
    const a3 = touch("2026-11-05T00:00:00Z", { id: "c" });
    const b1 = touch("2026-11-03T00:00:00Z", { id: "d", campaignId: "camB" });
    expect(eligibleTouches([a1, a2, a3, b1], conv, rules()).map((t) => t.id)).toEqual(["a", "b", "d", "c"]);
    expect(eligibleTouches([a1, a2, a3, b1], conv, rules({ collapseRepeats: true })).map((t) => t.id)).toEqual(["d", "c"]);
    expect(eligibleTouches([a1, a2, a3, b1], conv, rules({ collapseRepeats: true, modelType: "FIRST_TOUCH" })).map((t) => t.id)).toEqual(["a", "d"]);
  });
});

describe("weights add up to exactly 1", () => {
  const t3 = [touch("2026-11-01T00:00:00Z"), touch("2026-11-02T00:00:00Z"), touch("2026-11-03T00:00:00Z")];
  it("first, last, linear (rounding difference to the largest, earliest on a tie)", () => {
    expect(strs(weightsFor(t3, conv.at, { modelType: "FIRST_TOUCH", firstTouchPercent: null, lastTouchPercent: null, halfLifeDays: null }))).toEqual(["1", "0", "0"]);
    expect(strs(weightsFor(t3, conv.at, { modelType: "LAST_TOUCH", firstTouchPercent: null, lastTouchPercent: null, halfLifeDays: null }))).toEqual(["0", "0", "1"]);
    const lin = weightsFor(t3, conv.at, { modelType: "LINEAR", firstTouchPercent: null, lastTouchPercent: null, halfLifeDays: null });
    expect(strs(lin)).toEqual(["0.3333333334", "0.3333333333", "0.3333333333"]);
    expect(sum(lin).toString()).toBe("1");
  });

  it("position-based: ends take their share, the middle splits the rest; 1 and 2 touches; 100% on the ends", () => {
    const four = [...t3, touch("2026-11-04T00:00:00Z")];
    const p = { modelType: "POSITION_BASED" as const, firstTouchPercent: 40, lastTouchPercent: 40, halfLifeDays: null };
    expect(strs(weightsFor(four, conv.at, p))).toEqual(["0.4", "0.1", "0.1", "0.4"]);
    expect(strs(weightsFor(four.slice(0, 2), conv.at, p))).toEqual(["0.5", "0.5"]);
    expect(strs(weightsFor(four.slice(0, 2), conv.at, { ...p, firstTouchPercent: 30, lastTouchPercent: 10 }))).toEqual(["0.75", "0.25"]);
    expect(strs(weightsFor(four.slice(0, 1), conv.at, p))).toEqual(["1"]);
    expect(strs(weightsFor(t3, conv.at, { ...p, firstTouchPercent: 50, lastTouchPercent: 50 }))).toEqual(["0.5", "0", "0.5"]);
  });

  it("time decay halves the credit per half-life of age", () => {
    const w = weightsFor([touch("2026-11-03T12:00:00Z"), touch("2026-11-10T12:00:00Z")], conv.at, { modelType: "TIME_DECAY", firstTouchPercent: null, lastTouchPercent: null, halfLifeDays: 7 });
    expect(strs(w)).toEqual(["0.3333333333", "0.6666666667"]);
    expect(sum(w).toString()).toBe("1");
  });
});

describe("money and KPIs", () => {
  it("allocates to the paisa and reconciles exactly (largest remainder, earlier touch on a tie)", () => {
    const w = weightsFor([touch("2026-11-01T00:00:00Z"), touch("2026-11-02T00:00:00Z"), touch("2026-11-03T00:00:00Z")], conv.at, { modelType: "LINEAR", firstTouchPercent: null, lastTouchPercent: null, halfLifeDays: null });
    const parts = allocateMoney("100", w);
    expect(strs(parts)).toEqual(["33.34", "33.33", "33.33"]);
    expect(sum(parts).toString()).toBe("100");
    expect(strs(allocateMoney("0.01", w))).toEqual(["0.01", "0", "0"]);
    expect(strs(allocateMoney("10", [new Prisma.Decimal(1), new Prisma.Decimal(0)]))).toEqual(["10", "0"]);
  });

  it("ROI is revenue-based and never a percentage without spend", () => {
    expect(roiPercent(15000, 10000)).toEqual({ value: 50, status: "OK" });
    expect(roiPercent(5000, 10000)).toEqual({ value: -50, status: "OK" });
    expect(roiPercent(5000, 0)).toEqual({ value: null, status: "NO_COST" });
    expect(roiPercent(5000, null)).toEqual({ value: null, status: "NO_COST" });
    expect(roiPercent(null, 100)).toEqual({ value: null, status: "NO_REVENUE_BASIS" });
    expect(roas(25000, 10000)).toEqual({ value: 2.5, status: "OK" });
    expect(roas(25000, 0).status).toBe("NO_COST");
    expect(costPer(1000, 2.5)).toBe(400);
    expect(costPer(1000, 0)).toBeNull();
    expect(costPer(0, 3)).toBeNull();
  });

  it("a date-only business event happens at the end of that day, India time", () => {
    expect(endOfBusinessDay("2026-11-05").toISOString()).toBe("2026-11-05T18:29:59.999Z");
  });
});

describe("a batch of conversions", () => {
  it("unattributed without touches, excluded when reversed, credits reconcile, zero-weight touches written as nothing", () => {
    const touches = [
      touch("2026-11-01T00:00:00Z", { id: "x1", campaignId: "camA" }),
      touch("2026-11-02T00:00:00Z", { id: "x2", campaignId: "camB" }),
      touch("2026-11-03T00:00:00Z", { id: "x3", campaignId: "camC" }),
    ];
    const base = { conversionType: "SALES_ORDER_BOOKED", statusReason: null, occurredAt: conv.at, quotedValue: null, invoicedValue: new Prisma.Decimal("0") };
    const out = attributeBatch(
      [
        { ...base, id: "c1", status: "ACTIVE", identityKeys: ["CONTACT:c1", "ORDER:o1"], orderValue: new Prisma.Decimal("1000.01") },
        { ...base, id: "c2", status: "ACTIVE", identityKeys: ["ORDER:o2"], orderValue: new Prisma.Decimal("500") },
        { ...base, id: "c3", status: "REVERSED", statusReason: "The Sales Order was cancelled.", identityKeys: ["CONTACT:c1"], orderValue: new Prisma.Decimal("10") },
      ],
      touches,
      rules({ modelType: "POSITION_BASED", firstTouchPercent: 50, lastTouchPercent: 50 })
    );
    expect(out.results.map((r) => [r.conversionId, r.status])).toEqual([
      ["c1", "ATTRIBUTED"],
      ["c2", "UNATTRIBUTED"],
      ["c3", "EXCLUDED"],
    ]);
    const credits = out.credits.filter((c) => c.resultKey === out.results[0].id);
    expect(credits.map((c) => [c.campaignId, String(c.weight), String(c.orderCredit)])).toEqual([
      ["camA", "0.5", "500.01"],
      ["camC", "0.5", "500"],
    ]);
    expect(out.quality).toMatchObject({ unreconciled: 0, noIdentity: 1 });
  });
});

describe("model rules validation", () => {
  const base = { modelType: "LINEAR", windowDays: 30, touchpointTypes: ["MESSAGE_SENT"], conversionTypes: ["SALES_ORDER_BOOKED"] };
  it("rejects invalid combinations", () => {
    expect(modelRulesSchema.safeParse({ ...base, modelType: "POSITION_BASED", firstTouchPercent: 70, lastTouchPercent: 40 }).success).toBe(false);
    expect(modelRulesSchema.safeParse({ ...base, modelType: "POSITION_BASED" }).success).toBe(false);
    expect(modelRulesSchema.safeParse({ ...base, modelType: "TIME_DECAY" }).success).toBe(false);
    expect(modelRulesSchema.safeParse({ ...base, windowDays: 0 }).success).toBe(false);
    expect(modelRulesSchema.safeParse({ ...base, windowDays: 731 }).success).toBe(false);
    expect(modelRulesSchema.safeParse({ ...base, touchpointTypes: [] }).success).toBe(false);
    expect(modelRulesSchema.safeParse({ ...base, touchpointTypes: ["CAMPAIGN_RESPONSE"], channelTypes: ["EMAIL"] }).success).toBe(false);
    expect(modelRulesSchema.safeParse({ ...base, modelType: "MAGIC" }).success).toBe(false);
    expect(modelRulesSchema.safeParse({ ...base, modelType: "TIME_DECAY", halfLifeDays: 7 }).success).toBe(true);
  });
});
