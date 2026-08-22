import type { ExcelWorkbookSnapshot } from "../../adapters/excel/excelWorkbookReader";
import type {
  ImportKind,
  RawCell,
  RawRow,
  SourceArtifact,
  SourceLocation,
} from "../../domain/import/contracts";
import { fingerprint } from "./hash";

export interface StagedSourceArtifact {
  artifact: SourceArtifact;
  kind: ImportKind;
  fingerprint: string;
  rows: readonly RawRow[];
}

function rawValue(cell: ExcelWorkbookSnapshot["worksheets"][number]["rows"][number][number]): RawCell["rawValue"] {
  if (!cell || cell.kind === "blank") return null;
  if (cell.kind === "string" || cell.kind === "number" || cell.kind === "boolean") return cell.value;
  if (cell.kind === "date") return cell.value.toISOString();
  if (cell.kind === "formula") return cell.result ? rawValue(cell.result) : cell.formula;
  if (cell.kind === "error" || cell.kind === "unsupported") return cell.value;
  return null;
}

function cellKind(cell: ExcelWorkbookSnapshot["worksheets"][number]["rows"][number][number]): RawCell["kind"] {
  return cell?.kind ?? "blank";
}

export function stageSourceArtifact(
  snapshot: ExcelWorkbookSnapshot,
  kind: ImportKind,
  importedAt = new Date().toISOString(),
): StagedSourceArtifact {
  const artifactId = `${snapshot.source.sourceHash}:${kind}`;
  const worksheets = snapshot.worksheets.map((sheet) => ({
    sheetIndex: sheet.index,
    name: sheet.name,
    rowCount: sheet.rowCount,
    columnCount: sheet.columnCount,
    mergedRanges: [...(sheet.mergedRanges ?? [])],
  }));
  const artifact: SourceArtifact = {
    artifactId,
    path: snapshot.source.filePath ?? snapshot.source.fileName ?? "",
    filename: snapshot.source.fileName ?? "",
    sha256: snapshot.source.sourceHash,
    fileSize: snapshot.source.byteLength,
    importedAt,
    readerVersion: "exceljs-snapshot-v2",
    worksheets,
  };
  const rows: RawRow[] = [];
  for (const sheet of snapshot.worksheets) {
    for (let rowIndex = 0; rowIndex < sheet.rows.length; rowIndex += 1) {
      const rowNumber = rowIndex + 1;
      const rowSource: SourceLocation = {
        artifactId,
        sheetIndex: sheet.index,
        sheetName: sheet.name,
        row: rowNumber,
      };
      rows.push({
        source: rowSource,
        rowNumber,
        cells: sheet.rows[rowIndex].map((cell, columnIndex) => {
          const column = columnIndex + 1;
          return {
            source: { ...rowSource, column, address: `${columnToLetters(column)}${rowNumber}` },
            kind: cellKind(cell),
            rawValue: rawValue(cell),
            displayValue: rawValue(cell) === null ? undefined : String(rawValue(cell)),
            formula: cell?.kind === "formula" ? cell.formula : undefined,
          } satisfies RawCell;
        }),
      });
    }
  }
  return { artifact, kind, fingerprint: fingerprint({ artifact, rows }), rows };
}

export function columnToLetters(column: number): string {
  let value = column;
  let output = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    output = String.fromCharCode(65 + remainder) + output;
    value = Math.floor((value - 1) / 26);
  }
  return output;
}

export function assertSourceUnchanged(expected: StagedSourceArtifact, current: StagedSourceArtifact): void {
  if (expected.artifact.sha256 !== current.artifact.sha256 || expected.fingerprint !== current.fingerprint) {
    throw new Error("SOURCE_CHANGED");
  }
}
