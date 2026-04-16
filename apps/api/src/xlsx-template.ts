import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync, inflateRawSync } from "node:zlib";

export interface TemplateWorkbook {
  buffer: Buffer;
  entries: ZipEntry[];
  sheets: Map<string, string>;
}

export type CellPatchValue = string | number | null | {
  value: string | number | null;
  styleRef?: { sheetName: string; cellRef: string };
};

interface ZipEntry {
  name: string;
  data: Buffer;
  isDirectory: boolean;
}

const TEMPLATE_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../templates/documentacao-template.xlsx");
const XML_ESCAPE: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "\"": "&quot;",
  "'": "&apos;"
};

const CRC_TABLE = new Uint32Array(256).map((_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

export async function loadTemplateWorkbook(templatePath = TEMPLATE_PATH): Promise<TemplateWorkbook> {
  const buffer = await readFile(templatePath);
  return loadWorkbookFromBuffer(buffer);
}

export function loadWorkbookFromBuffer(buffer: Buffer): TemplateWorkbook {
  const entries = readZip(buffer);
  const files = new Map(entries.map((entry) => [entry.name, entry.data]));
  const workbook = files.get("xl/workbook.xml");
  const workbookRels = files.get("xl/_rels/workbook.xml.rels");
  if (!workbook || !workbookRels) {
    throw new Error("Template XLSX inválido: workbook ou relações ausentes");
  }
  return {
    buffer,
    entries,
    sheets: parseSheetTargets(workbook.toString("utf8"), workbookRels.toString("utf8"))
  };
}

export function patchWorkbook(workbook: TemplateWorkbook, sheetPatches: Map<string, Record<string, CellPatchValue>>) {
  const replacements = new Map<string, Buffer>();
  const styleLookup = buildStyleLookup(workbook);
  for (const [sheetName, cells] of sheetPatches) {
    const target = workbook.sheets.get(sheetName);
    if (!target) continue;
    const entry = workbook.entries.find((item) => item.name === target);
    if (!entry) continue;
    replacements.set(target, Buffer.from(patchWorksheetXml(entry.data.toString("utf8"), cells, styleLookup), "utf8"));
  }

  const workbookXml = workbook.entries.find((item) => item.name === "xl/workbook.xml");
  if (workbookXml) {
    replacements.set("xl/workbook.xml", Buffer.from(markWorkbookForRecalculation(workbookXml.data.toString("utf8")), "utf8"));
  }

  return writeZip(workbook.entries.map((entry) => ({
    ...entry,
    data: replacements.get(entry.name) ?? entry.data
  })));
}

export function readSheetCells(workbook: TemplateWorkbook, sheetName: string) {
  const target = workbook.sheets.get(sheetName);
  const entry = target ? workbook.entries.find((item) => item.name === target) : undefined;
  if (!entry) return new Map<string, string>();
  const sharedStrings = readSharedStrings(workbook);
  const cells = new Map<string, string>();
  const xml = entry.data.toString("utf8");
  for (const cell of xml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
    const attributes = cell[1];
    const body = cell[2];
    const ref = attributes.match(/\br="([^"]+)"/)?.[1];
    if (!ref) continue;
    const type = attributes.match(/\bt="([^"]+)"/)?.[1];
    const formula = body.match(/<f\b[^>]*>([\s\S]*?)<\/f>/)?.[1];
    const rawValue = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
    const inlineValue = body.match(/<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>[\s\S]*?<\/is>/)?.[1];
    if (formula) {
      cells.set(ref, rawValue ? unescapeXml(rawValue) : "");
    } else if (type === "s" && rawValue !== undefined) {
      cells.set(ref, sharedStrings[Number(rawValue)] ?? rawValue);
    } else if (type === "inlineStr" && inlineValue !== undefined) {
      cells.set(ref, unescapeXml(inlineValue));
    } else if (rawValue !== undefined) {
      cells.set(ref, unescapeXml(rawValue));
    }
  }
  return cells;
}

function readSharedStrings(workbook: TemplateWorkbook) {
  const entry = workbook.entries.find((item) => item.name === "xl/sharedStrings.xml");
  if (!entry) return [];
  const xml = entry.data.toString("utf8");
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((match) => unescapeXml([...match[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((text) => text[1]).join("")));
}

export function patchWorksheetXml(xml: string, cells: Record<string, CellPatchValue>, styleLookup = new Map<string, string>()) {
  let output = xml;
  for (const [ref, value] of Object.entries(cells)) {
    output = patchExistingCell(output, ref, value, styleLookup);
  }
  return output;
}

function buildStyleLookup(workbook: TemplateWorkbook) {
  const lookup = new Map<string, string>();
  for (const [sheetName, target] of workbook.sheets) {
    const entry = workbook.entries.find((item) => item.name === target);
    if (!entry) continue;
    for (const cell of entry.data.toString("utf8").matchAll(/<c\b([^>]*)/g)) {
      const ref = cell[1].match(/\br="([^"]+)"/)?.[1];
      const style = cell[1].match(/\bs="([^"]+)"/)?.[1];
      if (ref && style) lookup.set(`${sheetName}!${ref}`, style);
    }
  }
  return lookup;
}

function parseSheetTargets(workbookXml: string, relsXml: string) {
  const rels = new Map<string, string>();
  for (const rel of relsXml.matchAll(/<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"[^>]*>/g)) {
    const target = rel[2].startsWith("/") ? rel[2].slice(1) : `xl/${rel[2]}`.replace("xl//", "xl/");
    rels.set(rel[1], target);
  }

  const sheets = new Map<string, string>();
  for (const sheet of workbookXml.matchAll(/<sheet\b[^>]*name="([^"]+)"[^>]*(?:r:id|id)="([^"]+)"[^>]*\/>/g)) {
    const target = rels.get(sheet[2]);
    if (target) sheets.set(unescapeXml(sheet[1]), target);
  }
  return sheets;
}

function patchExistingCell(xml: string, ref: string, patch: CellPatchValue, styleLookup: Map<string, string>) {
  const cellPattern = new RegExp(`<c\\b([^>]*\\br="${escapeRegExp(ref)}"[^>]*)>(?:[\\s\\S]*?)<\\/c>`);
  const selfClosingPattern = new RegExp(`<c\\b([^>]*\\br="${escapeRegExp(ref)}"[^>]*)\\/>`);
  const value = normalizePatchValue(patch);
  const style = normalizePatchStyle(patch, styleLookup);
  const replacement = (attributes: string) => buildCellXml(ref, value, style ?? readStyle(attributes));
  if (cellPattern.test(xml)) {
    return xml.replace(cellPattern, (_match, attributes: string) => replacement(attributes));
  }
  if (selfClosingPattern.test(xml)) {
    return xml.replace(selfClosingPattern, (_match, attributes: string) => replacement(attributes));
  }
  return xml;
}

function normalizePatchValue(patch: CellPatchValue) {
  return typeof patch === "object" && patch !== null && "value" in patch ? patch.value : patch;
}

function normalizePatchStyle(patch: CellPatchValue, styleLookup: Map<string, string>) {
  if (typeof patch !== "object" || patch === null || !("styleRef" in patch) || !patch.styleRef) return undefined;
  return styleLookup.get(`${patch.styleRef.sheetName}!${patch.styleRef.cellRef}`);
}

function buildCellXml(ref: string, value: string | number | null, style?: string) {
  const styleAttr = style ? ` s="${style}"` : "";
  if (value === null || value === undefined || value === "") {
    return `<c r="${ref}"${styleAttr}/>`;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return `<c r="${ref}"${styleAttr}><v>${value}</v></c>`;
  }
  return `<c r="${ref}" t="inlineStr"${styleAttr}><is><t>${escapeXml(String(value))}</t></is></c>`;
}

function readStyle(attributes: string) {
  return attributes.match(/\bs="([^"]+)"/)?.[1];
}

function markWorkbookForRecalculation(xml: string) {
  const calcPr = '<calcPr calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/>';
  if (/<calcPr\b[^>]*\/>/.test(xml)) {
    return xml.replace(/<calcPr\b[^>]*\/>/, calcPr);
  }
  if (/<calcPr\b[^>]*>[\s\S]*?<\/calcPr>/.test(xml)) {
    return xml.replace(/<calcPr\b[^>]*>[\s\S]*?<\/calcPr>/, calcPr);
  }
  return xml.replace("</workbook>", `${calcPr}</workbook>`);
}

function readZip(buffer: Buffer): ZipEntry[] {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const entries: ZipEntry[] = [];
  let offset = centralDirectoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("ZIP inválido: central directory corrompido");
    }
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + fileNameLength).toString(flags & 0x800 ? "utf8" : "latin1");
    const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    const data = method === 0 ? compressed : inflateRawSync(compressed);
    entries.push({ name, data, isDirectory: name.endsWith("/") });
    offset += 46 + fileNameLength + extraLength + commentLength;
  }
  return entries;
}

function writeZip(entries: ZipEntry[]) {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const method = entry.isDirectory ? 0 : 8;
    const compressed = method === 0 ? entry.data : deflateRawSync(entry.data);
    const crc = crc32(entry.data);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x800, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt32LE(0, 10);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(entry.data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localParts.push(localHeader, name, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x800, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt32LE(0, 12);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(entry.data.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, name);
    offset += localHeader.length + name.length + compressed.length;
  }
  const centralDirectoryOffset = offset;
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(centralDirectoryOffset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function findEndOfCentralDirectory(buffer: Buffer) {
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65557); offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error("ZIP inválido: fim do diretório central não encontrado");
}

function crc32(data: Buffer) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function escapeXml(value: string) {
  return value.replace(/[&<>"']/g, (char) => XML_ESCAPE[char]);
}

function unescapeXml(value: string) {
  return value
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
