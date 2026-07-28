/** Escapes a value for a single CSV cell — quotes and doubles embedded quotes when the value contains a comma, quote, or newline. */
export function csvCell(v: string): string {
  return v.includes(',') || v.includes('"') || v.includes('\n')
    ? `"${v.replace(/"/g, '""')}"` : v;
}
