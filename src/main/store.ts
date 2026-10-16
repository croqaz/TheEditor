// JsonStore: schema-validated JSON file with debounced, atomic writes.
// Corrupt files are renamed aside (never deleted) and defaults are used.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { z } from 'zod';

export class JsonStore<S extends z.ZodType> {
  private value: z.infer<S>;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;

  constructor(
    readonly path: string,
    private readonly schema: S,
    private readonly debounceMs = 500
  ) {
    this.value = this.load();
  }

  private load(): z.infer<S> {
    let raw: string | null = null;
    try {
      raw = readFileSync(this.path, 'utf8');
    } catch {
      raw = null;
    }
    if (raw === null) return this.schema.parse({});
    try {
      return this.schema.parse(JSON.parse(raw));
    } catch (error) {
      const aside = `${this.path}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      try {
        renameSync(this.path, aside);
        console.warn(`[store] ${this.path} was unreadable (${String(error)}); moved to ${aside}`);
      } catch {
        console.warn(`[store] ${this.path} was unreadable and could not be moved aside: ${String(error)}`);
      }
      return this.schema.parse({});
    }
  }

  get(): z.infer<S> {
    return this.value;
  }

  /** Replace the whole value (validated) and schedule a write. */
  set(next: unknown): z.infer<S> {
    this.value = this.schema.parse(next);
    this.schedule();
    return this.value;
  }

  /** Shallow-merge top-level keys (validated) and schedule a write. */
  patch(partial: Record<string, unknown>): z.infer<S> {
    return this.set({ ...(this.value as Record<string, unknown>), ...partial });
  }

  private schedule() {
    this.dirty = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flushSync(), this.debounceMs);
  }

  /** Write now if dirty. Synchronous so it can run inside before-quit. */
  flushSync() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.dirty) return;
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(this.value, null, '\t')}\n`, 'utf8');
    renameSync(tmp, this.path);
    this.dirty = false;
  }
}
