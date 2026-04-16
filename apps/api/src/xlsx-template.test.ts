import { describe, expect, it } from "vitest";
import { loadTemplateWorkbook, loadWorkbookFromBuffer, patchWorkbook, readSheetCells } from "./xlsx-template.js";

describe("documentation xlsx template", () => {
  it("keeps the canonical workbook structure available", async () => {
    const workbook = await loadTemplateWorkbook();
    expect([...workbook.sheets.keys()]).toEqual(["PATCH-PANEL", "SWITCH", "Redes", "Telefonia", "Base"]);
    expect(workbook.entries.some((entry) => entry.name === "xl/styles.xml")).toBe(true);
    expect(workbook.entries.some((entry) => entry.name === "xl/worksheets/sheet3.xml")).toBe(true);
  });

  it("patches mapped cells without removing workbook sheets", async () => {
    const workbook = await loadTemplateWorkbook();
    const exported = patchWorkbook(workbook, new Map([["Redes", { C3: "10.23.160.0/24" }]]));
    const patched = loadWorkbookFromBuffer(exported);
    expect([...patched.sheets.keys()]).toEqual([...workbook.sheets.keys()]);
    expect(readSheetCells(patched, "Redes").get("C3")).toBe("10.23.160.0/24");
  });
});
