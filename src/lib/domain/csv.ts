import { z } from "zod";

export const csvCellSchema = z.union([
  z.string(),
  z.number().finite(),
  z.bigint(),
  z.boolean(),
  z.null(),
  z.undefined(),
]);

export type CsvCell = z.infer<typeof csvCellSchema>;

const FORMULA_PREFIX_PATTERN = /^\s*[=+\-@]/u;
const CONTROL_PREFIX_PATTERN = /^[\t\r\n]/u;
const CSV_QUOTING_PATTERN = /[",\r\n]/u;

export function isPotentialSpreadsheetFormula(value: string): boolean {
  return FORMULA_PREFIX_PATTERN.test(value) || CONTROL_PREFIX_PATTERN.test(value);
}

/**
 * Prefixes dangerous spreadsheet-leading characters with an apostrophe. The
 * original whitespace/content is retained so an export never silently changes
 * the represented value.
 */
export function neutralizeCsvFormula(value: string): string {
  return isPotentialSpreadsheetFormula(value) ? `'${value}` : value;
}

function csvCellToString(value: CsvCell): string {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value);
}

/** Formula-neutralizes, doubles quotes, and conditionally quotes one CSV cell. */
export function escapeCsvCell(valueInput: CsvCell): string {
  const value = csvCellSchema.parse(valueInput);
  const neutralized = neutralizeCsvFormula(csvCellToString(value));

  if (!CSV_QUOTING_PATTERN.test(neutralized)) {
    return neutralized;
  }

  return `"${neutralized.replaceAll('"', '""')}"`;
}

export function serializeCsvRow(row: readonly CsvCell[]): string {
  return row.map(escapeCsvCell).join(",");
}

/**
 * Serializes a rectangular set of rows with RFC 4180-style CRLF separators.
 * Formula neutralization is applied to every cell, including headers.
 */
export function serializeCsv(rows: readonly (readonly CsvCell[])[]): string {
  const firstRow = rows[0];
  if (!firstRow) {
    return "";
  }

  const columnCount = firstRow.length;
  for (const [index, row] of rows.entries()) {
    if (row.length !== columnCount) {
      throw new RangeError(
        `CSV row ${index + 1} has ${row.length} cells; expected ${columnCount}.`,
      );
    }
  }

  return rows.map(serializeCsvRow).join("\r\n");
}
