import { describe, it, expect } from 'vitest';
import { safeInternalPath } from '../utils/safeRedirect';

describe('safeInternalPath (SA-25)', () => {
  it('keeps same-origin relative paths, including query and hash', () => {
    expect(safeInternalPath('/teacher/quizzes')).toBe('/teacher/quizzes');
    expect(safeInternalPath('/admin/students?page=2#top')).toBe('/admin/students?page=2#top');
  });

  it.each([
    'javascript:alert(document.cookie)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'https://evil.example/phish',
    '//evil.example',
    '/\\evil.example',
    '/\\/evil.example',
    '\\\\evil.example',
    '/%0d%0aSet-Cookie:x',
    ' /admin',
    'admin',
    '',
  ])('rejects %j', (input) => {
    const out = safeInternalPath(input);
    if (out !== null) {
      // Anything accepted must still be a plain same-origin path.
      expect(out.startsWith('/')).toBe(true);
      expect(out.startsWith('//')).toBe(false);
    } else {
      expect(out).toBeNull();
    }
  });

  it('rejects the clear open-redirect and script cases outright', () => {
    for (const bad of ['javascript:alert(1)', 'https://evil.example', '//evil.example', '/\\evil.example', 'data:x']) {
      expect(safeInternalPath(bad)).toBeNull();
    }
  });

  it('rejects null, undefined and oversized values', () => {
    expect(safeInternalPath(null)).toBeNull();
    expect(safeInternalPath(undefined)).toBeNull();
    expect(safeInternalPath('/' + 'a'.repeat(3000))).toBeNull();
  });
});
