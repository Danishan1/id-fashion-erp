import { describe, expect, it } from "vitest";
import { buildXlsxBuffer } from "./xlsx";
import { parseXlsxBuffer } from "./xlsx-read";

describe("parseXlsxBuffer", () => {
  it("reads header + data rows back as string[][], matching parseCsv's own shape", async () => {
    const buffer = await buildXlsxBuffer(
      "Sheet1",
      [
        { header: "Name", key: "name" },
        { header: "Quantity", key: "quantity", type: "number" },
      ],
      [
        { name: "Cotton Fabric", quantity: 100 },
        { name: "Metal Zipper", quantity: 250 },
      ]
    );

    const rows = await parseXlsxBuffer(buffer);

    expect(rows).toEqual([
      ["Name", "Quantity"],
      ["Cotton Fabric", "100"],
      ["Metal Zipper", "250"],
    ]);
  });

  it("reads only the first worksheet", async () => {
    const buffer = await buildXlsxBuffer("Sheet1", [{ header: "A", key: "a" }], [{ a: "1" }]);
    const rows = await parseXlsxBuffer(buffer);
    expect(rows).toEqual([["A"], ["1"]]);
  });

  it("drops a fully-blank trailing row", async () => {
    const buffer = await buildXlsxBuffer("Sheet1", [{ header: "A", key: "a" }, { header: "B", key: "b" }], [{ a: "1", b: "2" }, { a: null, b: null }]);
    const rows = await parseXlsxBuffer(buffer);
    expect(rows).toEqual([
      ["A", "B"],
      ["1", "2"],
    ]);
  });

  it("returns an empty array for a workbook with no worksheets to read from", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const workbook = new ExcelJS.Workbook();
    const arrayBuffer = await workbook.xlsx.writeBuffer();
    const rows = await parseXlsxBuffer(Buffer.from(arrayBuffer));
    expect(rows).toEqual([]);
  });
});
