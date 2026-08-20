import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import ExcelJS from "exceljs";
import { sha256 } from "../../application/import/hash";
import type { ImportSource } from "../../application/import/types";

export type ExcelCell =
  | { kind: "blank" }
  | { kind: "string"; value: string }
  | { kind: "number"; value: number }
  | { kind: "boolean"; value: boolean }
  | { kind: "date"; value: Date }
  | { kind: "formula"; formula: string; result?: ExcelCell }
  | { kind: "error"; value: string }
  | { kind: "unsupported"; value: string };

export interface ExcelWorksheetSnapshot {
  index: number;
  name: string;
  rowCount: number;
  columnCount: number;
  rows: readonly (readonly ExcelCell[])[];
}

export interface ExcelWorkbookSnapshot {
  source: ImportSource;
  date1904: boolean;
  worksheets: readonly ExcelWorksheetSnapshot[];
}

export interface ExcelWorkbookReader {
  read(filePath: string): Promise<ExcelWorkbookSnapshot>;
}

function formatUnsupported(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function cellFromValue(value: unknown): ExcelCell {
  if (value === null || value === undefined || value === "") return { kind: "blank" };
  if (value instanceof Date) return { kind: "date", value: new Date(value.getTime()) };
  if (typeof value === "string") return { kind: "string", value };
  if (typeof value === "number") return { kind: "number", value };
  if (typeof value === "boolean") return { kind: "boolean", value };

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.error === "string") return { kind: "error", value: record.error };
    if (typeof record.formula === "string") {
      return {
        kind: "formula",
        formula: record.formula,
        result: record.result === undefined ? undefined : cellFromValue(record.result),
      };
    }
    if (Array.isArray(record.richText)) {
      const text = record.richText
        .map((part) => (part && typeof part === "object" ? String((part as { text?: unknown }).text ?? "") : ""))
        .join("");
      return text ? { kind: "string", value: text } : { kind: "blank" };
    }
    if (typeof record.text === "string") return { kind: "string", value: record.text };
  }
  return { kind: "unsupported", value: formatUnsupported(value) };
}

function worksheetSnapshot(worksheet: ExcelJS.Worksheet, index: number): ExcelWorksheetSnapshot {
  const rowCount = worksheet.rowCount;
  const columnCount = worksheet.columnCount;
  const rows: ExcelCell[][] = [];
  for (let rowNumber = 1; rowNumber <= rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const cells: ExcelCell[] = [];
    for (let columnNumber = 1; columnNumber <= columnCount; columnNumber += 1) {
      cells.push(cellFromValue(row.getCell(columnNumber).value));
    }
    rows.push(cells);
  }
  return { index, name: worksheet.name, rowCount, columnCount, rows };
}

export class ExcelJsWorkbookReader implements ExcelWorkbookReader {
  async read(filePath: string): Promise<ExcelWorkbookSnapshot> {
    const [buffer, fileStats] = await Promise.all([readFile(filePath), stat(filePath)]);
    const workbook = new ExcelJS.Workbook();
    // ExcelJS currently references an older Node Buffer declaration. The bytes
    // are unchanged; this cast only bridges the Node 22 type mismatch.
    await workbook.xlsx.load(buffer as never);
    return {
      source: {
        filePath,
        fileName: basename(filePath),
        sourceHash: sha256(new Uint8Array(buffer)),
        byteLength: buffer.byteLength,
        modifiedAt: fileStats.mtime.toISOString(),
      },
      date1904: Boolean(workbook.properties.date1904),
      worksheets: workbook.worksheets.map((worksheet, index) => worksheetSnapshot(worksheet, index)),
    };
  }
}

export function cellText(cell: ExcelCell | undefined): string | undefined {
  if (!cell || cell.kind === "blank") return undefined;
  if (cell.kind === "string") return cell.value.trim();
  if (cell.kind === "number" || cell.kind === "boolean") return String(cell.value);
  if (cell.kind === "date") return formatDate(cell.value);
  return undefined;
}

export function formatDate(value: Date): string {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function cellAddress(row: number, column: number): string {
  let n = column;
  let letters = "";
  while (n > 0) {
    const remainder = (n - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return `${letters}${row}`;
}
