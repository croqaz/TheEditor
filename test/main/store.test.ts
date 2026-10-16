import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { JsonStore } from '../../src/main/store';

const Schema = z.object({
  __version: z.literal(1).default(1),
  theme: z.string().default('gruvbox-dark'),
  count: z.number().int().default(0),
});

const dirs: string[] = [];
function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'te-store-'));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('JsonStore', () => {
  test('missing file yields defaults and nothing is written until a change', () => {
    const path = join(tmp(), 'nested', 'config.json');
    const store = new JsonStore(path, Schema, 10);
    expect(store.get()).toEqual({
      __version: 1,
      theme: 'gruvbox-dark',
      count: 0,
    });
    store.flushSync();
    expect(existsSync(path)).toBe(false);
  });

  test('patch validates, debounces, and flushSync writes atomically', async () => {
    const path = join(tmp(), 'config.json');
    const store = new JsonStore(path, Schema, 20);
    store.patch({ theme: 'nord-light' });
    expect(existsSync(path)).toBe(false);
    await new Promise(r => setTimeout(r, 60));
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({
      __version: 1,
      theme: 'nord-light',
      count: 0,
    });
    store.patch({ count: 5 });
    store.flushSync();
    expect(JSON.parse(readFileSync(path, 'utf8')).count).toBe(5);
    expect(readdirSync(join(path, '..'))).toEqual(['config.json']);
    expect(() => store.set({ count: 'nope' })).toThrow();
  });

  test('reloads what it wrote', () => {
    const path = join(tmp(), 'session.json');
    const a = new JsonStore(path, Schema, 10);
    a.set({ theme: 'x', count: 2 });
    a.flushSync();
    const b = new JsonStore(path, Schema, 10);
    expect(b.get()).toEqual({ __version: 1, theme: 'x', count: 2 });
  });

  test('corrupt file is moved aside, never deleted, and defaults are used', () => {
    const dir = tmp();
    const path = join(dir, 'config.json');
    writeFileSync(path, '{ not json');
    const store = new JsonStore(path, Schema, 10);
    expect(store.get().theme).toBe('gruvbox-dark');
    const files = readdirSync(dir);
    expect(files.some(f => f.startsWith('config.json.corrupt-'))).toBe(true);
    expect(files).not.toContain('config.json');
    writeFileSync(path, JSON.stringify({ theme: 42 }));
    const invalid = new JsonStore(path, Schema, 10);
    expect(invalid.get().theme).toBe('gruvbox-dark');
  });
});
