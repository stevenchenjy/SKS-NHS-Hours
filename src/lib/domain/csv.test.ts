import { describe, expect, it } from "vitest";

import {
  escapeCsvCell,
  isPotentialSpreadsheetFormula,
  neutralizeCsvFormula,
  serializeCsv,
  serializeCsvRow,
} from "./csv";

describe("CSV escaping", () => {
  it.each([
    ["plain", "plain"],
    ["with,comma", '"with,comma"'],
    ['with "quote"', '"with ""quote"""'],
    ["two\nlines", '"two\nlines"'],
    [null, ""],
    [undefined, ""],
    [true, "true"],
    [42, "42"],
  ])("escapes %p", (input, expected) => {
    expect(escapeCsvCell(input)).toBe(expected);
  });

  it.each([
    "=2+2",
    "+cmd|' /C calc'!A0",
    "-10",
    "@SUM(A1:A2)",
    '   =HYPERLINK("https://example.test")',
    "\tformula",
    "\rformula",
    "\nformula",
  ])("neutralizes dangerous spreadsheet input %p", (value) => {
    expect(isPotentialSpreadsheetFormula(value)).toBe(true);
    expect(neutralizeCsvFormula(value)).toBe(`'${value}`);
    expect(escapeCsvCell(value).replace(/^"|"$/g, "")).toContain("'");
  });

  it.each(["NHS", "1.25", "member@example.edu", "'=already-text"])(
    "does not alter safe text %p",
    (value) => {
      expect(isPotentialSpreadsheetFormula(value)).toBe(false);
      expect(neutralizeCsvFormula(value)).toBe(value);
    },
  );

  it("applies formula defense to numeric negatives too", () => {
    expect(escapeCsvCell(-2)).toBe("'-2");
  });

  it("rejects non-finite numeric cells", () => {
    expect(() => escapeCsvCell(Number.NaN)).toThrow();
    expect(() => escapeCsvCell(Number.POSITIVE_INFINITY)).toThrow();
  });
});

describe("CSV serialization", () => {
  it("serializes a row and rectangular table with CRLF separators", () => {
    expect(serializeCsvRow(["Name", "Hours"])).toBe("Name,Hours");
    expect(
      serializeCsv([
        ["Name", "Hours"],
        ["Alex, Jr.", "1.25"],
      ]),
    ).toBe('Name,Hours\r\n"Alex, Jr.",1.25');
  });

  it("returns an empty string for no rows", () => {
    expect(serializeCsv([])).toBe("");
  });

  it("rejects ragged data instead of emitting ambiguous CSV", () => {
    expect(() => serializeCsv([["a", "b"], ["c"]])).toThrow(/row 2/i);
  });
});
