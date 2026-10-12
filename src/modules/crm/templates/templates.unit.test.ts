import { describe, expect, it } from "vitest";
import { extractVariables, insertVariable, parseTemplateText, renderTemplateContent, renderWithSampleData, smsInfo, validateTemplateContent } from "./template-engine";
import { TEMPLATE_CHANNEL_TYPES, TEMPLATE_VARIABLES, TEMPLATE_VARIABLE_MAP, canApplyTemplateAction } from "./template-registry";

const ctx = (values: Record<string, string | null>, entities: string[]) => ({ values, available: new Set(entities) as never });

describe("template parser", () => {
  it("finds variables with optional spaces and fallbacks, in order", () => {
    const p = parseTemplateText("Hi {{ contact.first_name | there }}, {{company.name}} {{contact.first_name}}");
    expect(p.issues).toEqual([]);
    expect(p.tokens.map((t) => [t.key, t.fallback])).toEqual([
      ["contact.first_name", "there"],
      ["company.name", null],
      ["contact.first_name", null],
    ]);
    expect(extractVariables("Re {{opportunity.name}}", "Hi {{contact.first_name}} {{opportunity.name}}")).toEqual(["opportunity.name", "contact.first_name"]);
  });

  it("reports unknown, malformed and unclosed variables as errors", () => {
    const p = parseTemplateText("{{customer.xyz}} {{Contact.First Name}} {{contact.first_name");
    expect(p.issues.map((i) => i.code)).toEqual(["UNKNOWN_VARIABLE", "MALFORMED_VARIABLE", "UNCLOSED_VARIABLE"]);
    expect(p.issues[0].message).toBe("Template contains unsupported variable: {{customer.xyz}}.");
    expect(p.issues.every((i) => i.severity === "error" && i.source === "template")).toBe(true);
  });

  it("explains quotation variables (no ERP quotation module)", () => {
    const [i] = parseTemplateText("Total {{quotation.total}}").issues;
    expect(i.code).toBe("UNKNOWN_VARIABLE");
    expect(i.message).toContain("no quotation module");
  });

  it("rejects fallbacks with braces or that are too long", () => {
    expect(parseTemplateText(`{{contact.first_name|${"x".repeat(101)}}}`).issues[0].code).toBe("INVALID_FALLBACK");
  });
});

describe("template renderer", () => {
  it("renders values and keeps the rest of the text untouched", () => {
    const r = renderTemplateContent({ subject: "Hello {{contact.first_name}}", body: "Hi {{contact.first_name}},\nYour opportunity {{opportunity.name}}\nis currently at {{opportunity.stage}}." }, ctx({ "contact.first_name": "Rahul", "opportunity.name": "Website Project", "opportunity.stage": "Demo" }, ["contact", "opportunity"]));
    expect(r.body).toBe("Hi Rahul,\nYour opportunity Website Project\nis currently at Demo.");
    expect(r.subject).toBe("Hello Rahul");
    expect(r.issues).toEqual([]);
    expect(r.parameters).toEqual([
      { key: "contact.first_name", value: "Rahul" },
      { key: "opportunity.name", value: "Website Project" },
      { key: "opportunity.stage", value: "Demo" },
    ]);
  });

  it("missing value → empty (with a warning); fallback → fallback text (no warning)", () => {
    const empty = renderTemplateContent({ body: "Hi {{contact.first_name}}," }, ctx({ "contact.first_name": null }, ["contact"]));
    expect(empty.body).toBe("Hi ,");
    expect(empty.issues.map((i) => [i.code, i.severity])).toEqual([["NO_VALUE", "warning"]]);
    expect(empty.missing).toEqual([{ key: "contact.first_name", reason: "NO_VALUE", usedFallback: false }]);
    const fb = renderTemplateContent({ body: "Hi {{contact.first_name|there}}," }, ctx({ "contact.first_name": "  " }, ["contact"]));
    expect(fb.body).toBe("Hi there,");
    expect(fb.issues).toEqual([]);
    expect(fb.missing[0]).toMatchObject({ usedFallback: true });
  });

  it("a record that isn't in the context gives one 'unavailable' warning", () => {
    const r = renderTemplateContent({ body: "{{opportunity.name}} / {{opportunity.stage|tbc}} for {{contact.first_name}}" }, ctx({ "contact.first_name": "Asha" }, ["contact"]));
    expect(r.body).toBe(" / tbc for Asha");
    expect(r.issues).toEqual([expect.objectContaining({ code: "NO_CONTEXT", severity: "warning", message: "Opportunity data is unavailable for this message." })]);
  });

  it("unknown variables render empty and are errors; values are never re-parsed", () => {
    const r = renderTemplateContent({ body: "A{{customer.xyz}}B {{contact.first_name}}" }, ctx({ "contact.first_name": "{{user.email}}" }, ["contact", "user"]));
    expect(r.body).toBe("AB {{user.email}}");
    expect(r.issues.map((i) => i.code)).toEqual(["UNKNOWN_VARIABLE"]);
  });

  it("flattens line breaks inside subject values", () => {
    const r = renderTemplateContent({ subject: "For {{company.address}}", body: "x" }, ctx({ "company.address": "Mumbai\nIndia" }, ["company"]));
    expect(r.subject).toBe("For Mumbai India");
  });

  it("renders every registered variable with sample data (deterministic)", () => {
    const body = TEMPLATE_VARIABLES.map((v) => `{{${v.key}}}`).join("|");
    const a = renderWithSampleData({ body });
    expect(a.issues).toEqual([]);
    expect(a.body.split("|")).toEqual(TEMPLATE_VARIABLES.map((v) => v.sample));
    expect(renderWithSampleData({ body }).body).toBe(a.body);
  });

  it("covers contact, company, opportunity, lead, user and appointment fields", () => {
    for (const k of ["contact.first_name", "contact.whatsapp", "company.address", "opportunity.value", "opportunity.expected_close_date", "opportunity.owner", "opportunity.probability", "lead.source", "lead.status", "lead.score", "user.name", "user.phone", "appointment.date", "appointment.time", "appointment.location", "appointment.meeting_link"]) {
      expect(TEMPLATE_VARIABLE_MAP.has(k)).toBe(true);
    }
  });
});

describe("template validation per channel", () => {
  it("email needs a subject; SMS / WhatsApp have none; body required", () => {
    expect(validateTemplateContent({ channelType: "EMAIL", subject: "", body: "Hi" }).errors.map((e) => e.code)).toEqual(["SUBJECT_REQUIRED"]);
    expect(validateTemplateContent({ channelType: "SMS", subject: "Hi", body: "x" }).errors.map((e) => e.code)).toEqual(["SUBJECT_NOT_ALLOWED"]);
    expect(validateTemplateContent({ channelType: "WHATSAPP", body: "   " }).errors.map((e) => e.code)).toEqual(["BODY_REQUIRED"]);
    expect(validateTemplateContent({ channelType: "INSTAGRAM", body: "x" }).errors.map((e) => e.code)).toEqual(["INVALID_CHANNEL"]);
    const ok = validateTemplateContent({ channelType: "EMAIL", subject: "Your quotation for {{company.name}}", body: "Hi {{contact.first_name|there}}" });
    expect(ok).toMatchObject({ valid: true, variables: ["company.name", "contact.first_name"] });
  });

  it("SMS: counts parts (GSM-7 vs Unicode) and refuses very long texts", () => {
    expect(smsInfo("Hello")).toEqual({ encoding: "GSM-7", units: 5, segments: 1 });
    expect(smsInfo("x".repeat(161)).segments).toBe(2);
    expect(smsInfo("€".repeat(80))).toMatchObject({ encoding: "GSM-7", units: 160, segments: 1 });
    expect(smsInfo("नमस्ते".repeat(12))).toMatchObject({ encoding: "Unicode", segments: 2 });
    const v = validateTemplateContent({ channelType: "SMS", body: "x".repeat(200) });
    expect(v.valid).toBe(true);
    expect(v.warnings.map((w) => w.code)).toEqual(["SMS_SEGMENTS"]);
    expect(v.sms).toMatchObject({ segments: 2 });
    expect(validateTemplateContent({ channelType: "SMS", body: "x".repeat(1601) }).errors.map((e) => e.code)).toEqual(["TOO_LONG"]);
  });

  it("WhatsApp: warns above the approved-template body limit; validates provider settings", () => {
    expect(validateTemplateContent({ channelType: "WHATSAPP", body: "x".repeat(1100) }).warnings.map((w) => w.code)).toEqual(["LONG_MESSAGE"]);
    expect(validateTemplateContent({ channelType: "WHATSAPP", body: "x", providerMetadata: { externalTemplateName: "order_update", language: "en_US" } }).valid).toBe(true);
    expect(validateTemplateContent({ channelType: "WHATSAPP", body: "x", providerMetadata: { language: "english please" } }).errors.map((e) => e.code)).toEqual(["INVALID_PROVIDER_FIELD"]);
    expect(validateTemplateContent({ channelType: "SMS", body: "x", providerMetadata: { foo: "bar" } }).errors.map((e) => e.code)).toEqual(["INVALID_PROVIDER_FIELD"]);
  });

  it("only Email, SMS and WhatsApp are enabled today; lifecycle actions", () => {
    expect(TEMPLATE_CHANNEL_TYPES).toEqual(["EMAIL", "SMS", "WHATSAPP"]);
    expect(canApplyTemplateAction("DRAFT", "activate")).toBe(true);
    expect(canApplyTemplateAction("ARCHIVED", "activate")).toBe(false);
    expect(canApplyTemplateAction("ARCHIVED", "restore")).toBe(true);
    expect(canApplyTemplateAction("ACTIVE", "deactivate")).toBe(true);
  });

  it("variable picker insertion keeps the caret after the variable", () => {
    expect(insertVariable("Hi ,", "contact.first_name", 3)).toEqual({ text: "Hi {{contact.first_name}},", caret: 25 });
    expect(insertVariable("Hi XX", "user.name", 3, 5)).toEqual({ text: "Hi {{user.name}}", caret: 16 });
  });
});
