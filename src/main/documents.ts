// Reading and saving Markdown files. Saves are atomic (temp + rename), keep a
// recovery copy until the write succeeds, and refuse to clobber a file that
// changed on disk since it was read.
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fnv1a } from '../shared/hash';
import type { DocResult, SaveResult } from '../shared/rpc-schema';

export async function readDocument(path: string): Promise<DocResult> {
  const [markdown, info] = await Promise.all([readFile(path, 'utf8'), stat(path)]);
  return { path, markdown, mtime: info.mtimeMs };
}

export async function mtimeOf(path: string): Promise<number | null> {
  try {
    return (await stat(path)).mtimeMs;
  } catch {
    return null;
  }
}

export function recoveryPathFor(recoveryDir: string, path: string): string {
  return join(recoveryDir, `${fnv1a(path)}-${basename(path)}`);
}

export async function saveDocument(
  path: string,
  markdown: string,
  expectedMtime: number | undefined,
  recoveryDir: string
): Promise<SaveResult> {
  const current = await mtimeOf(path);
  if (expectedMtime !== undefined && current !== null && Math.abs(current - expectedMtime) > 1) {
    return {
      ok: false,
      reason: 'conflict',
      message: `${basename(path)} changed on disk since it was opened`,
      mtime: current,
    };
  }
  const recoveryPath = recoveryPathFor(recoveryDir, path);
  try {
    await mkdir(recoveryDir, { recursive: true });
    await writeFile(recoveryPath, markdown, 'utf8');
    const tmp = `${path}.te-tmp`;
    await writeFile(tmp, markdown, 'utf8');
    await rename(tmp, path);
    const mtime = (await mtimeOf(path)) ?? Date.now();
    await rm(recoveryPath, { force: true });
    return { ok: true, mtime };
  } catch (error) {
    return { ok: false, reason: 'error', message: String(error) };
  }
}
