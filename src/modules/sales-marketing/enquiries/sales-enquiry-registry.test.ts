import { describe, expect, it } from "vitest";
import { SalesEnquiryActivityType, SalesEnquiryPriority, SalesEnquiryStage } from "@prisma/client";
import {
  MANUAL_ACTIVITY_TYPES,
  MANUAL_STAGE_TARGETS,
  REOPENABLE_STAGES,
  SALES_ENQUIRY_ACTIVITY_TYPES,
  SALES_ENQUIRY_PRIORITIES,
  SALES_ENQUIRY_STAGES,
  SALES_ENQUIRY_TRANSITIONS,
  STAGES_REQUIRING_REASON,
  canMoveTo,
} from "./sales-enquiry-registry";

describe("sales enquiry registry", () => {
  it("mirrors the Prisma enums exactly", () => {
    expect(Object.keys(SALES_ENQUIRY_STAGES).sort()).toEqual(Object.values(SalesEnquiryStage).sort());
    expect(Object.keys(SALES_ENQUIRY_PRIORITIES).sort()).toEqual(Object.values(SalesEnquiryPriority).sort());
    expect(Object.keys(SALES_ENQUIRY_ACTIVITY_TYPES).sort()).toEqual(Object.values(SalesEnquiryActivityType).sort());
  });

  it("never lets a user pick a system stage (quoted / won come from real documents)", () => {
    for (const target of MANUAL_STAGE_TARGETS) expect(SALES_ENQUIRY_STAGES[target].system).toBe(false);
    for (const targets of Object.values(SALES_ENQUIRY_TRANSITIONS)) {
      for (const t of targets) expect(SALES_ENQUIRY_STAGES[t].system).toBe(false);
    }
  });

  it("has no manual moves out of closed stages; only lost / not qualified reopen", () => {
    for (const [stage, meta] of Object.entries(SALES_ENQUIRY_STAGES)) {
      if (meta.closed) expect(SALES_ENQUIRY_TRANSITIONS[stage as SalesEnquiryStage]).toEqual([]);
    }
    expect([...REOPENABLE_STAGES].sort()).toEqual(["LOST", "NOT_QUALIFIED"]);
    expect(REOPENABLE_STAGES).not.toContain("WON");
  });

  it("requires a reason for every closing manual move", () => {
    for (const t of MANUAL_STAGE_TARGETS) {
      if (SALES_ENQUIRY_STAGES[t].closed) expect(STAGES_REQUIRING_REASON).toContain(t);
    }
  });

  it("allows the main path and blocks skipping back from hold by hand", () => {
    expect(canMoveTo("NEW", "QUALIFIED")).toBe(true);
    expect(canMoveTo("QUALIFIED", "ON_HOLD")).toBe(true);
    expect(canMoveTo("ON_HOLD", "QUALIFIED")).toBe(false); // resume restores the held stage instead
    expect(canMoveTo("LOST", "UNDER_REVIEW")).toBe(false); // reopen action instead
  });

  it("only lets users log notes and interactions by hand", () => {
    for (const t of MANUAL_ACTIVITY_TYPES) expect(SALES_ENQUIRY_ACTIVITY_TYPES[t].manual).toBe(true);
    const manual = Object.entries(SALES_ENQUIRY_ACTIVITY_TYPES).filter(([, m]) => m.manual).map(([k]) => k);
    expect(manual.sort()).toEqual([...MANUAL_ACTIVITY_TYPES].sort());
  });
});
