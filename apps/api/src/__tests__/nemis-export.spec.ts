/**
 * NEMIS export (students.service.ts) — the pure row-building helpers only.
 * The full nemisExport() method (auth, RLS-scoped queries, audit log) is
 * covered by cross-tenant.e2e-spec.ts against the real database instead —
 * these are the parts worth unit-testing in isolation: the name-split
 * heuristic (the one genuinely lossy/approximate piece) and that the CSV/
 * XLSX builders produce valid, well-formed output for edge-case inputs.
 */

import { splitFullName, buildNemisCsv, buildNemisXlsx, NEMIS_COLUMNS, type NemisRow } from '../students/students.service';

describe('splitFullName', () => {
  it('splits a standard three-part name into given/middle/surname', () => {
    expect(splitFullName('John Peter Kamau')).toEqual({ given: 'John', middle: 'Peter', surname: 'Kamau' });
  });

  it('a two-part name has no middle name', () => {
    expect(splitFullName('Jane Wanjiku')).toEqual({ given: 'Jane', middle: '', surname: 'Wanjiku' });
  });

  it('a single-word name has no middle or surname', () => {
    expect(splitFullName('Cher')).toEqual({ given: 'Cher', middle: '', surname: '' });
  });

  it('a four-plus-part name joins everything between the first and last as the middle name', () => {
    expect(splitFullName('Mary Ann Wangari Njoroge')).toEqual({ given: 'Mary', middle: 'Ann Wangari', surname: 'Njoroge' });
  });

  it('collapses extra whitespace and handles an empty/blank name', () => {
    expect(splitFullName('  John   Kamau  ')).toEqual({ given: 'John', middle: '', surname: 'Kamau' });
    expect(splitFullName('')).toEqual({ given: '', middle: '', surname: '' });
    expect(splitFullName('   ')).toEqual({ given: '', middle: '', surname: '' });
  });
});

function makeRow(overrides: Partial<NemisRow> = {}): NemisRow {
  return {
    admissionNo: 'ADM001', givenName: 'John', middleName: '', surname: 'Kamau',
    gender: 'MALE', dateOfBirth: '2014-03-15', birthCertificateNo: '', upiNumber: '',
    nationality: '', county: '', subCounty: '', className: 'Grade 5 Blue',
    specialNeedsNotes: '', guardianName: '', guardianPhone: '', enrollmentDate: '2026-01-10',
    ...overrides,
  };
}

describe('buildNemisCsv', () => {
  it('produces a valid header-only file for an empty school (no rows)', () => {
    const csv = buildNemisCsv([]);
    const lines = csv.split('\n');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe(NEMIS_COLUMNS.map((c) => c.label).join(','));
  });

  it('includes every column in the declared order for a populated row', () => {
    const csv = buildNemisCsv([makeRow()]);
    const [header, dataLine] = csv.split('\n');
    expect(header).toBe(NEMIS_COLUMNS.map((c) => c.label).join(','));
    expect(dataLine).toContain('ADM001');
    expect(dataLine!.split(',')).toHaveLength(NEMIS_COLUMNS.length);
  });

  it('escapes commas and quotes in a value (e.g. a guardian name or notes field)', () => {
    const csv = buildNemisCsv([makeRow({ guardianName: 'Doe, "Jane"', specialNeedsNotes: 'Needs extra time, uses a wheelchair' })]);
    expect(csv).toContain('"Doe, ""Jane"""');
    expect(csv).toContain('"Needs extra time, uses a wheelchair"');
  });

  it('renders a missing/blank field (no guardian, no DOB) as an empty cell, not "undefined" or "null"', () => {
    const csv = buildNemisCsv([makeRow({ dateOfBirth: '', guardianName: '', guardianPhone: '' })]);
    expect(csv).not.toMatch(/undefined|null/i);
  });
});

describe('buildNemisXlsx', () => {
  it('produces a valid, non-empty XLSX (a zip archive — starts with the PK magic bytes) for an empty school', async () => {
    const base64 = await buildNemisXlsx([]);
    const buf = Buffer.from(base64, 'base64');
    expect(buf.length).toBeGreaterThan(0);
    expect(buf.subarray(0, 2).toString('utf8')).toBe('PK');
  });

  it('produces a valid XLSX for a populated row set', async () => {
    const base64 = await buildNemisXlsx([makeRow(), makeRow({ admissionNo: 'ADM002', givenName: 'Jane', surname: 'Wanjiku' })]);
    const buf = Buffer.from(base64, 'base64');
    expect(buf.subarray(0, 2).toString('utf8')).toBe('PK');
  });
});
