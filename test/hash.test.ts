import { describe, expect, test } from 'bun:test';
import { contentHash, fnv1a } from '../src/shared/hash';

describe('hashes', () => {
  test('fnv1a is stable and 8 hex chars', () => {
    expect(fnv1a('/home/cro/book.md')).toMatch(/^[0-9a-f]{8}$/);
    expect(fnv1a('a')).toBe(fnv1a('a'));
    expect(fnv1a('a')).not.toBe(fnv1a('b'));
  });

  test('contentHash distinguishes small edits', () => {
    const a = contentHash('# Title\n\nParagraph one.');
    const b = contentHash('# Title\n\nParagraph one!');
    expect(a).toHaveLength(16);
    expect(a).not.toBe(b);
  });
});
