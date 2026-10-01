import { describe, expect, it, vi } from "vitest";
import { buildXlsxBuffer } from "@/lib/xlsx";

vi.mock("@/core/db/client", () => ({ prisma: {} }));
vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("./crm-import.queue", () => ({ enqueueCrmIngestJob: vi.fn() }));

const { cleanHeaders, decodeCsvText, detectDelimiter, parseImportFile } = await import("./import-file");
const { applyMapping, neutralizeCell, sameJson } = await import("./crm-import.service");

describe("import file reader", () => {
  it("decodes UTF-8 with BOM, UTF-16 and Windows-1252", () => {
    expect(decodeCsvText(Buffer.from("﻿Name\nJosé", "utf-8"))).toEqual({ text: "Name\nJosé", encoding: "utf-8" });
    expect(decodeCsvText(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("Name\nZoë", "utf16le")])).text).toBe("Name\nZoë");
    expect(decodeCsvText(Buffer.from("Name\nMüller", "latin1"))).toEqual({ text: "Name\nMüller", encoding: "windows-1252" });
  });

  it("detects the delimiter from the header row (outside quotes)", () => {
    expect(detectDelimiter("Name;Email;City\nA;b;c")).toBe(";");
    expect(detectDelimiter("Name\tEmail\nA\tb")).toBe("\t");
    expect(detectDelimiter('"Last, First",Email\n')).toBe(",");
  });

  it("names blank headers and disambiguates repeated ones", () => {
    expect(cleanHeaders(["Name", "", "Phone", "phone", "Phone"])).toEqual(["Name", "Column 2", "Phone", "phone (2)", "Phone (3)"]);
  });

  it("parses CSV, keeps extra cells under generated headers and pads short rows", async () => {
    const parsed = await parseImportFile("x.csv", Buffer.from('Name,Email\r\n"Rao, Asha",a@b.co,extra\r\nOnly Name\r\n\r\n'));
    expect(parsed.fileType).toBe("CSV");
    expect(parsed.headers).toEqual(["Name", "Email", "Column 3"]);
    expect(parsed.rows).toEqual([
      ["Rao, Asha", "a@b.co", "extra"],
      ["Only Name", "", ""],
    ]);
  });

  it("parses XLSX", async () => {
    const buf = await buildXlsxBuffer("S", [{ header: "Name", key: "n" }, { header: "Mobile", key: "m" }], [{ n: "Asha", m: "9876543210" }]);
    const parsed = await parseImportFile("leads.xlsx", buf);
    expect(parsed).toMatchObject({ fileType: "XLSX", headers: ["Name", "Mobile"], rows: [["Asha", "9876543210"]] });
  });

  it("rejects bad files with actionable messages", async () => {
    await expect(parseImportFile("e.csv", Buffer.alloc(0))).rejects.toThrow(/empty/);
    await expect(parseImportFile("x.xlsx", Buffer.from("PK\u0003\u0004garbage"))).rejects.toThrow(/couldn't be read/);
    await expect(parseImportFile("x.csv", Buffer.from("PK\u0003\u0004zip"))).rejects.toThrow(/ZIP/);
    await expect(parseImportFile("x.docx", Buffer.from("x"))).rejects.toThrow(/\.csv or \.xlsx/);
    await expect(parseImportFile("x.csv", Buffer.from("a@b.co,9876543210\n"))).rejects.toThrow(/looks like data/);
  });
});

describe("import helpers", () => {
  it("applies a mapping and adds import-wide tags", () => {
    expect(applyMapping({ A: "Asha", B: "a@b.co", C: "ignored", T: "vip" }, { A: "fullName", B: "email", C: "", T: "tags" }, { tagNames: ["fair"] })).toEqual({ fullName: "Asha", email: "a@b.co", tags: "vip,fair" });
  });

  it("neutralizes spreadsheet formulas in exported cells", () => {
    expect(neutralizeCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(neutralizeCell("+91 98765")).toBe("'+91 98765");
    expect(neutralizeCell("@cmd")).toBe("'@cmd");
    expect(neutralizeCell("Asha")).toBe("Asha");
    expect(neutralizeCell(null)).toBe("");
  });

  it("compares stored JSON regardless of key order", () => {
    expect(sameJson({ b: 1, a: { d: [1, 2], c: 2 } }, { a: { c: 2, d: [1, 2] }, b: 1 })).toBe(true);
    expect(sameJson({ a: 1, x: undefined }, { a: 1 })).toBe(true);
    expect(sameJson({ a: [1, 2] }, { a: [2, 1] })).toBe(false);
  });
});
