import { describe, expect, it } from "vitest";
import { LEAD_TARGET_FIELDS, normalizeHeader, suggestLeadMapping, validateLeadMapping } from "./lead-field-catalog";
import { cleanText, normalizeLeadRecord, normalizePhone, parseDateValue, titleCaseIfUniform } from "./lead-normalizer";

describe("lead field catalog — automatic mapping", () => {
  it("maps common Indian trade-sheet headers", () => {
    expect(suggestLeadMapping(["Customer Name", "Company", "Mobile No", "Email ID", "Requirement", "City", "Lead Source", "Shoe size"])).toEqual({
      "Customer Name": "fullName",
      Company: "companyName",
      "Mobile No": "mobile",
      "Email ID": "email",
      Requirement: "requirement",
      City: "city",
      "Lead Source": "source",
      "Shoe size": "",
    });
  });

  it("is case/punctuation insensitive, matches custom fields, and never suggests one field twice", () => {
    expect(normalizeHeader("  E-Mail_ID ")).toBe("e mail id");
    const m = suggestLeadMapping(["EMAIL", "email address", "Fabric Preference", "utm_source"], [{ key: "fabric_preference", label: "Fabric preference", isActive: true }]);
    expect(m).toEqual({ EMAIL: "email", "email address": "", "Fabric Preference": "cf:fabric_preference", utm_source: "utmSource" });
  });

  it("requires a name or company and a contact column, and rejects double mapping", () => {
    expect(validateLeadMapping({ A: "requirement" }).filter((i) => i.level === "error").map((i) => i.message)).toEqual([
      expect.stringMatching(/name column/),
      expect.stringMatching(/contact column/),
    ]);
    expect(validateLeadMapping({ A: "email", B: "email", C: "fullName" }).some((i) => /mapped from 2 columns/.test(i.message))).toBe(true);
    expect(validateLeadMapping({ A: "companyName", B: "mobile" }).filter((i) => i.level === "error")).toEqual([]);
    expect(validateLeadMapping({ A: "fullName", B: "cf:nope" }).some((i) => /Unknown field/.test(i.message))).toBe(true);
  });

  it("every target field has a unique key", () => {
    expect(new Set(LEAD_TARGET_FIELDS.map((f) => f.key)).size).toBe(LEAD_TARGET_FIELDS.length);
  });
});

describe("lead normalizer", () => {
  it("normalizes phones without guessing a country code", () => {
    expect(normalizePhone("+91 98765 43210").value).toBe("+919876543210");
    expect(normalizePhone("09876543210").value).toBe("9876543210");
    expect(normalizePhone("9876543210").value).toBe("9876543210");
    expect(normalizePhone("0091-98765-43210").value).toBe("+919876543210");
    expect(normalizePhone("(044) 2345 6789").value).toBe("04423456789"); // landline keeps its STD code
    expect(normalizePhone("12345").problem).toMatch(/not a valid phone/);
    expect(normalizePhone("9.87654E+09").problem).toMatch(/spreadsheet shortened/);
  });

  it("treats configured tokens as empty and collapses whitespace", () => {
    const empty = ["n/a", "na", "null", "-"];
    expect(cleanText("  N/A ", empty)).toBe("");
    expect(cleanText("NULL", empty)).toBe("");
    expect(cleanText("  Ashish \t Kumar ", empty)).toBe("Ashish Kumar");
    expect(cleanText("line 1\n\n\n\nline 2", empty, { multiline: true })).toBe("line 1\n\nline 2");
  });

  it("re-cases names only when uniformly upper/lower case", () => {
    expect(titleCaseIfUniform("ASHISH KUMAR")).toBe("Ashish Kumar");
    expect(titleCaseIfUniform("priya d'souza")).toBe("Priya D'Souza");
    expect(titleCaseIfUniform("McDonald")).toBe("McDonald");
  });

  it("builds clean lead values and row messages", () => {
    const { values, messages } = normalizeLeadRecord({
      fullName: " ASHISH KUMAR SINGH ",
      companyName: "ABC INDUSTRIES",
      email: " Ashish@Example.COM ; other@example.com ",
      mobile: "+91 98765 43210 / 9123456789",
      estimatedValue: "₹ 1,50,000",
      temperature: "high",
      nextFollowUpAt: "15/10/2026",
      tags: "vip, fair ; vip",
      score: "abc",
      "cf:qty": " 500 ",
    });
    expect(values).toMatchObject({
      firstName: "Ashish",
      lastName: "Kumar Singh",
      companyName: "ABC INDUSTRIES",
      email: "ashish@example.com",
      alternateEmail: "other@example.com",
      mobile: "+919876543210",
      estimatedValue: 150000,
      temperature: "HOT",
      tags: ["vip", "fair"],
      customFields: { qty: "500" },
    });
    expect(values.nextFollowUpAt).toBe("2026-10-14T18:30:00.000Z");
    expect(messages.map((m) => m.field)).toEqual(expect.arrayContaining(["email", "mobile", "score"]));
    expect(messages.find((m) => m.field === "score")?.level).toBe("error");
  });

  it("uses the company as the lead name when no person name is given", () => {
    const { values, messages } = normalizeLeadRecord({ companyName: "Only Company Ltd", email: "a@b.co" });
    expect(values.firstName).toBe("Only Company Ltd");
    expect(messages[0].level).toBe("warning");
  });

  it("parses common date formats and honours the day/month order", () => {
    expect(parseDateValue("2026-10-05")).toBe("2026-10-04T18:30:00.000Z");
    expect(parseDateValue("05/10/2026", "DMY")).toBe("2026-10-04T18:30:00.000Z");
    expect(parseDateValue("10/05/2026", "MDY")).toBe("2026-10-04T18:30:00.000Z");
    expect(parseDateValue("5 Oct 2026")).toBe("2026-10-04T18:30:00.000Z");
    expect(parseDateValue("Oct 5, 2026")).toBe("2026-10-04T18:30:00.000Z");
    expect(parseDateValue("31/02/2026")).toBeNull();
    expect(parseDateValue("next week")).toBeNull();
  });
});
