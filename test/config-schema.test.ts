import { describe, expect, test } from 'bun:test';
import { ConfigSchema, defaultConfig, defaultSession, SessionSchema } from '../src/shared/config-schema';

describe('ConfigSchema', () => {
  test('fills every default from an empty object', () => {
    const config = defaultConfig();
    expect(config.theme).toBe('gruvbox-dark');
    expect(config.font.family).toBe('iA Writer Mono S');
    expect(config.font.size).toBe(15);
    expect(config.network.online).toBe(false);
    expect(config.stats.wpm).toBe(240);
    expect(config.stats.fields).toContain('words');
    expect(config.window.chrome).toBe('native');
  });

  test('fills nested defaults when only some keys are present', () => {
    const config = ConfigSchema.parse({
      theme: 'nord-light',
      font: { size: 17 },
    });
    expect(config.theme).toBe('nord-light');
    expect(config.font.size).toBe(17);
    expect(config.font.leading).toBe(1.6);
  });

  test('rejects out-of-range values', () => {
    expect(() => ConfigSchema.parse({ font: { size: 2 } })).toThrow();
    expect(() => ConfigSchema.parse({ window: { chrome: 'frameless' } })).toThrow();
  });
});

describe('SessionSchema', () => {
  test('defaults and round-trips tabs', () => {
    const session = defaultSession();
    expect(session.tabs).toEqual([]);
    expect(session.window.width).toBe(1100);
    const parsed = SessionSchema.parse({
      tabs: [{ path: '/a.md', cursor: 3 }, { path: null }],
      active: 1,
    });
    expect(parsed.tabs).toHaveLength(2);
    expect(parsed.active).toBe(1);
  });
});
