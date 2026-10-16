import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mtimeOf, readDocument, recoveryPathFor, saveDocument } from '../../src/main/documents';

const dirs: string[] = [];
function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'te-docs-'));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('documents', () => {
  test('read returns content and mtime', async () => {
    const dir = tmp();
    const path = join(dir, 'a.md');
    writeFileSync(path, '# A\n');
    const doc = await readDocument(path);
    expect(doc).toEqual({
      path,
      markdown: '# A\n',
      mtime: (await mtimeOf(path)) as number,
    });
    expect(await mtimeOf(join(dir, 'missing.md'))).toBeNull();
  });

  test('save writes atomically, cleans the recovery copy, reports the new mtime', async () => {
    const dir = tmp();
    const recovery = join(dir, 'recovery');
    const path = join(dir, 'b.md');
    const result = await saveDocument(path, 'hello\n', undefined, recovery);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(readFileSync(path, 'utf8')).toBe('hello\n');
    expect(result.mtime).toBe((await mtimeOf(path)) as number);
    expect(existsSync(recoveryPathFor(recovery, path))).toBe(false);
    expect(readdirSync(dir).filter(f => f.endsWith('.te-tmp'))).toEqual([]);
  });

  test('refuses to overwrite a file that changed on disk, unless forced', async () => {
    const dir = tmp();
    const path = join(dir, 'c.md');
    writeFileSync(path, 'v1');
    const opened = (await mtimeOf(path)) as number;
    const later = new Date(opened + 5000);
    utimesSync(path, later, later);
    const conflict = await saveDocument(path, 'v2', opened, join(dir, 'rec'));
    expect(conflict.ok).toBe(false);
    if (conflict.ok) return;
    expect(conflict.reason).toBe('conflict');
    expect(conflict.message).toContain('c.md');
    expect(readFileSync(path, 'utf8')).toBe('v1');
    const forced = await saveDocument(path, 'v2', undefined, join(dir, 'rec'));
    expect(forced.ok).toBe(true);
    expect(readFileSync(path, 'utf8')).toBe('v2');
  });

  test('tolerates mtime jitter under one millisecond', async () => {
    const dir = tmp();
    const path = join(dir, 'd.md');
    writeFileSync(path, 'x');
    const m = (await mtimeOf(path)) as number;
    const result = await saveDocument(path, 'y', m + 0.5, join(dir, 'rec'));
    expect(result.ok).toBe(true);
  });

  test('write failures are reported, not thrown', async () => {
    const dir = tmp();
    const result = await saveDocument(join(dir, 'no-such-dir', 'e.md'), 'x', undefined, join(dir, 'rec'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('error');
  });

  test('recovery path is stable per document path', () => {
    const a = recoveryPathFor('/r', '/docs/book.md');
    expect(a).toBe(recoveryPathFor('/r', '/docs/book.md'));
    expect(a).toMatch(/\/r\/[0-9a-f]{8}-book\.md$/);
    expect(a).not.toBe(recoveryPathFor('/r', '/other/book.md'));
  });
});
