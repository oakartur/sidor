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

  it("can copy the visual style from a VLAN row to another sheet cell", async () => {
    const workbook = await loadTemplateWorkbook();
    const sourceStyle = cellStyle(workbook, "Redes", "A3");
    const exported = patchWorkbook(workbook, new Map([["SWITCH", { C4: { value: "PDV", styleRef: { sheetName: "Redes", cellRef: "A3" } } }]]));
    const patched = loadWorkbookFromBuffer(exported);
    expect(readSheetCells(patched, "SWITCH").get("C4")).toBe("PDV");
    expect(cellStyle(patched, "SWITCH", "C4")).toBe(sourceStyle);
  });
});

function cellStyle(workbook: ReturnType<typeof loadWorkbookFromBuffer>, sheetName: string, cellRef: string) {
  const target = workbook.sheets.get(sheetName);
  const entry = workbook.entries.find((item) => item.name === target);
  const attributes = entry?.data.toString("utf8").match(new RegExp(`<c\\b([^>]*\\br="${cellRef}"[^>]*)`))?.[1];
  return attributes?.match(/\bs="([^"]+)"/)?.[1];
}
