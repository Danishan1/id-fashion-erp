import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { buildXlsxBuffer } from "./xlsx";

describe("buildXlsxBuffer", () => {
  it("produces a workbook with the header row and every data row", async () => {
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

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as never);
    const sheet = workbook.getWorksheet("Sheet1")!;

    expect(sheet.getRow(1).getCell(1).value).toBe("Name");
    expect(sheet.getRow(1).getCell(2).value).toBe("Quantity");
    expect(sheet.getRow(2).getCell(1).value).toBe("Cotton Fabric");
    expect(sheet.getRow(2).getCell(2).value).toBe(100);
    expect(sheet.getRow(3).getCell(1).value).toBe("Metal Zipper");
    expect(sheet.rowCount).toBe(3);
  });

  it("stores a number cell as a real number, not a string", async () => {
    const buffer = await buildXlsxBuffer("Sheet1", [{ header: "Qty", key: "qty", type: "number" }], [{ qty: "42" }]);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as never);
    const value = workbook.getWorksheet("Sheet1")!.getRow(2).getCell(1).value;
    expect(typeof value).toBe("number");
    expect(value).toBe(42);
  });

  it("round-trips a date cell as a real date", async () => {
    const buffer = await buildXlsxBuffer("Sheet1", [{ header: "Date", key: "date", type: "date" }], [{ date: new Date("2026-08-24") }]);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as never);
    const value = workbook.getWorksheet("Sheet1")!.getRow(2).getCell(1).value;
    expect(value).toBeInstanceOf(Date);
    expect((value as Date).toISOString().slice(0, 10)).toBe("2026-08-24");
  });

  it("writes a blank cell for null/undefined rather than the string 'null'", async () => {
    const buffer = await buildXlsxBuffer("Sheet1", [{ header: "Notes", key: "notes" }], [{ notes: null }]);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as never);
    const value = workbook.getWorksheet("Sheet1")!.getRow(2).getCell(1).value;
    expect(value).toBeNull();
  });
});
