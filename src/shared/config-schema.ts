// Schemas for ~/.config/TheEditor/config.json and session.json.
// Zod 4: `.prefault()` supplies an input-side default that is still parsed,
// so nested objects get their own defaults filled in.
import { z } from 'zod';

export const DEFAULT_STATUS_FIELDS = [
  'chars',
  'words',
  'lines',
  'paragraphs',
  'readtime',
  'cursor',
  'autosave',
  'net',
] as const;

/** Configs written before 2026-10-16 carry `words, chars`; the owner reads them better the other way round. */
export function statusFieldsInCurrentOrder(fields: string[]): string[] {
  const out = [...fields];
  for (let i = 0; i + 1 < out.length; i++) {
    if (out[i] === 'words' && out[i + 1] === 'chars') {
      out[i] = 'chars';
      out[i + 1] = 'words';
    }
  }
  return out;
}

/** Text width in characters; the column is this wide plus 1ch of padding on each side. */
export const DEFAULT_MEASURE = 80;

export const ConfigSchema = z.object({
  __version: z.literal(1).default(1),
  theme: z.string().default('gruvbox-dark'),
  /** "block": a cell-wide caret drawn by the view; "bar": WebKit's 1 px caret. */
  caret: z.enum(['block', 'bar']).default('block'),
  font: z
    .object({
      family: z.string().default('iA Writer Mono S'),
      size: z.number().min(8).max(48).default(15),
      leading: z.number().min(1).max(3).default(1.6),
      // Line length in characters. Configs written before 2026-10-16 carry the old default, 72.
      measure: z
        .number()
        .min(40)
        .max(140)
        .default(DEFAULT_MEASURE)
        .transform(measure => (measure === 72 ? DEFAULT_MEASURE : measure)),
    })
    .prefault({}),
  window: z
    .object({
      chrome: z.enum(['native', 'tabs']).default('native'),
    })
    .prefault({}),
  network: z
    .object({
      online: z.boolean().default(false),
    })
    .prefault({}),
  autosave: z
    .object({
      enabled: z.boolean().default(true),
      debounceMs: z.number().min(100).default(1000),
      maxWaitMs: z.number().min(1000).default(10000),
    })
    .prefault({}),
  stats: z
    .object({
      wpm: z.number().min(50).max(1000).default(240),
      fields: z.array(z.string()).default([...DEFAULT_STATUS_FIELDS]).transform(statusFieldsInCurrentOrder),
    })
    .prefault({}),
  spell: z
    .object({
      lang: z.string().default('en-GB'),
    })
    .prefault({}),
});

export type Config = z.infer<typeof ConfigSchema>;

export const SessionTabSchema = z.object({
  path: z.string().nullable(),
  cursor: z.number().int().nonnegative().optional(),
  scroll: z.number().nonnegative().optional(),
});

export const SessionSchema = z.object({
  __version: z.literal(1).default(1),
  tabs: z.array(SessionTabSchema).default([]),
  active: z.number().int().nonnegative().default(0),
  window: z
    .object({
      width: z.number().int().positive().default(1100),
      height: z.number().int().positive().default(800),
    })
    .prefault({}),
  promptHistory: z.array(z.string()).default([]),
  recent: z.array(z.string()).default([]),
});

export type Session = z.infer<typeof SessionSchema>;
export type SessionTab = z.infer<typeof SessionTabSchema>;

export function defaultConfig(): Config {
  return ConfigSchema.parse({});
}

export function defaultSession(): Session {
  return SessionSchema.parse({});
}
