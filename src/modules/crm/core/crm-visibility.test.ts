import { describe, expect, it } from "vitest";
import { crmOwnerWhere, getCrmRecordScope } from "./crm-visibility";

describe("CRM record visibility", () => {
  it("defaults to ALL until decision D5 is made", async () => {
    expect(await getCrmRecordScope({ companyId: "co-1", userId: "u-1", branchId: null })).toEqual({ mode: "ALL" });
  });

  it("builds an owner filter only for OWN scope", () => {
    expect(crmOwnerWhere({ mode: "ALL" })).toEqual({});
    expect(crmOwnerWhere({ mode: "OWN", userId: "u-1" })).toEqual({ ownerUserId: "u-1" });
    expect(crmOwnerWhere({ mode: "OWN", userId: "u-1" }, "assignedToUserId")).toEqual({ assignedToUserId: "u-1" });
  });
});
