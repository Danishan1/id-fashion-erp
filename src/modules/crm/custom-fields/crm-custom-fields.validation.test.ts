import { describe, expect, it, vi } from "vitest";
import type { CrmCustomFieldDefinitionDto } from "./crm-custom-field-types";

vi.mock("@/core/db/client", () => ({ prisma: {} }));
vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));

const { validateCustomFieldValues } = await import("./crm-custom-fields.service");

let n = 0;
const def = (key: string, fieldType: CrmCustomFieldDefinitionDto["fieldType"], extra: Partial<CrmCustomFieldDefinitionDto> = {}): CrmCustomFieldDefinitionDto => ({
  id: `d-${n++}`,
  key,
  label: key.toUpperCase(),
  fieldType,
  description: null,
  options: null,
  isRequired: false,
  isActive: true,
  sortOrder: 0,
  ...extra,
});
const opts = [
  { value: "cotton", label: "Cotton" },
  { value: "linen", label: "Linen" },
];

const fieldErrors = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as { details?: { fieldErrors?: Record<string, string> } }).details?.fieldErrors;
  }
  throw new Error("expected a validation error");
};

describe("validateCustomFieldValues", () => {
  it("coerces each field type", () => {
    const defs = [
      def("qty", "NUMBER"),
      def("price", "CURRENCY"),
      def("ok", "BOOLEAN"),
      def("due", "DATE"),
      def("mail", "EMAIL"),
      def("fabric", "DROPDOWN", { options: opts }),
      def("mix", "MULTI_SELECT", { options: opts }),
      def("site", "URL"),
    ];
    expect(
      validateCustomFieldValues(defs, { qty: "12", price: "10.456", ok: "true", due: "2026-10-01", mail: "A@B.CO", fabric: "linen", mix: ["cotton", "cotton", "linen"], site: "https://x.test" })
    ).toEqual({ qty: 12, price: 10.46, ok: true, due: "2026-10-01", mail: "a@b.co", fabric: "linen", mix: ["cotton", "linen"], site: "https://x.test/" });
  });

  it("reports every bad value keyed by customFields.<key>", () => {
    const defs = [def("qty", "NUMBER"), def("fabric", "DROPDOWN", { options: opts }), def("site", "URL")];
    expect(fieldErrors(() => validateCustomFieldValues(defs, { qty: "1.5", fabric: "silk", site: "ftp://x" }))).toEqual({
      "customFields.qty": "QTY must be a whole number.",
      "customFields.fabric": "FABRIC must be one of the listed options.",
      "customFields.site": "SITE must start with http:// or https://.",
    });
  });

  it("rejects unknown keys and enforces required fields", () => {
    expect(fieldErrors(() => validateCustomFieldValues([def("a", "TEXT")], { zzz: "x" }))).toEqual({ "customFields.zzz": "Unknown custom field." });
    expect(fieldErrors(() => validateCustomFieldValues([def("must", "TEXT", { isRequired: true })], {}))).toEqual({ "customFields.must": "MUST is required." });
  });

  it("keeps stored values of archived fields and clears blank ones", () => {
    const defs = [def("old", "TEXT", { isActive: false, isRequired: true }), def("note", "TEXT")];
    expect(validateCustomFieldValues(defs, { old: "changed", note: "" }, { old: "kept", note: "was here" })).toEqual({ old: "kept" });
  });
});
