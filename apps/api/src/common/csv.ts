// SA-21 (security audit 2026-11): student- and parent-controlled values
// (full_name, phone, notes) flow into staff CSV exports (attendance, class
// grades, NEMIS). A cell starting with a formula trigger (=, @, or +/- with
// an expression) is evaluated by Excel, LibreOffice and Sheets when the file
// is opened, which allows HYPERLINK exfiltration or DDE command prompts on a
// staff machine.
//
// Neutralization prefixes such a cell with an apostrophe, which spreadsheets
// treat as "text, not a formula" (OWASP CSV-injection guidance).
// Purely numeric values that start with + or - (phone numbers like
// +254700000000, negative numbers) are left untouched, so the NEMIS export
// format (docs/audits/nemis-format-verified.md) is unchanged.

const ALWAYS_TRIGGER = /^[=@\t\r]/;
const SIGNED_NUMERIC = /^[+-][\d\s().-]*$/;

/** True when a spreadsheet would treat this cell as a formula. */
export function isFormulaLike(v: string): boolean {
  if (!v) return false;
  if (ALWAYS_TRIGGER.test(v)) return true;
  if ((v.startsWith('+') || v.startsWith('-')) && !SIGNED_NUMERIC.test(v)) return true;
  return false;
}

/**
 * Escapes a value for a single CSV cell. Formula-like values are neutralized
 * with a leading apostrophe. The cell is quoted, with embedded quotes doubled,
 * when it contains a comma, quote, CR or LF.
 */
export function csvCell(v: string): string {
  const safe = isFormulaLike(v) ? `'${v}` : v;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
