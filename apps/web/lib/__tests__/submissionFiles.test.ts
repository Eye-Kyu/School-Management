import { describe, it, expect } from 'vitest';
import { toAssignmentStoragePath, submissionFileName, buildSubmissionPath } from '../assignments/submissionFiles';

describe('toAssignmentStoragePath (SA-02)', () => {
  it('accepts a bucket-relative submissions path', () => {
    expect(toAssignmentStoragePath('submissions/a1/u1/123_essay.pdf')).toBe('submissions/a1/u1/123_essay.pdf');
  });

  it('maps a legacy public URL back to its path', () => {
    const url = 'https://x.supabase.co/storage/v1/object/public/assignments/submissions/a1/u1/123_my%20essay.pdf';
    expect(toAssignmentStoragePath(url)).toBe('submissions/a1/u1/123_my essay.pdf');
  });

  it('rejects arbitrary URLs and javascript: URLs', () => {
    expect(toAssignmentStoragePath('https://evil.example/phish')).toBeNull();
    expect(toAssignmentStoragePath('javascript:alert(1)')).toBeNull();
  });

  it('rejects other buckets and traversal', () => {
    expect(toAssignmentStoragePath('https://x.supabase.co/storage/v1/object/public/avatars/u1/a.png')).toBeNull();
    expect(toAssignmentStoragePath('submissions/../documents/x')).toBeNull();
    expect(toAssignmentStoragePath('')).toBeNull();
    expect(toAssignmentStoragePath(null)).toBeNull();
  });
});

describe('submission path helpers', () => {
  it('builds a path whose third segment is the auth uid', () => {
    const p = buildSubmissionPath('a1', 'uid-9', 'dir/evil.pdf');
    const segs = p.split('/');
    expect(segs[0]).toBe('submissions');
    expect(segs[1]).toBe('a1');
    expect(segs[2]).toBe('uid-9');
    expect(segs).toHaveLength(4);
  });

  it('strips the timestamp prefix for display', () => {
    expect(submissionFileName('submissions/a1/u1/1700000000000_essay.pdf')).toBe('essay.pdf');
  });
});
