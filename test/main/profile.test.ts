import { describe, expect, test } from 'bun:test';
import { isPathSpec, type ProfileBase, resolveProfile } from '../../src/main/profile';

const base: ProfileBase = {
  config: '/home/u/.config',
  data: '/home/u/.local/share',
  cache: '/home/u/.cache',
  logs: '/home/u/.local/state',
  home: '/home/u',
  cwd: '/work/project',
};

describe('resolveProfile', () => {
  test('default profile uses the plain app directories', () => {
    for (const spec of [undefined, '', '  ', 'default']) {
      const p = resolveProfile(spec, base);
      expect(p.kind).toBe('default');
      expect(p.name).toBe('default');
      expect(p.configDir).toBe('/home/u/.config/TheEditor');
      expect(p.dataDir).toBe('/home/u/.local/share/TheEditor');
      expect(p.cacheDir).toBe('/home/u/.cache/TheEditor');
      expect(p.logsDir).toBe('/home/u/.local/state/TheEditor');
      expect(p.configFile).toBe('/home/u/.config/TheEditor/config.json');
      expect(p.sessionFile).toBe('/home/u/.config/TheEditor/session.json');
      expect(p.recoveryDir).toBe('/home/u/.local/share/TheEditor/recovery');
      expect(p.backupsDir).toBe('/home/u/.local/share/TheEditor/backups');
    }
  });

  test('named profile nests under profiles/<name> in every root', () => {
    const p = resolveProfile('test', base);
    expect(p.kind).toBe('named');
    expect(p.configDir).toBe('/home/u/.config/TheEditor/profiles/test');
    expect(p.dataDir).toBe('/home/u/.local/share/TheEditor/profiles/test');
    expect(p.cacheDir).toBe('/home/u/.cache/TheEditor/profiles/test');
    expect(p.logsDir).toBe('/home/u/.local/state/TheEditor/profiles/test');
    expect(p.sessionFile).toBe('/home/u/.config/TheEditor/profiles/test/session.json');
  });

  test('path profile keeps everything under the given directory', () => {
    const abs = resolveProfile('/secret/place', base);
    expect(abs.kind).toBe('path');
    expect(abs.name).toBe('place');
    expect(abs.configDir).toBe('/secret/place');
    expect(abs.dataDir).toBe('/secret/place/data');
    expect(abs.cacheDir).toBe('/secret/place/cache');
    expect(abs.logsDir).toBe('/secret/place/logs');
    expect(abs.recoveryDir).toBe('/secret/place/data/recovery');

    const rel = resolveProfile('./profiles/alpha', base);
    expect(rel.configDir).toBe('/work/project/profiles/alpha');
    expect(rel.name).toBe('alpha');

    const home = resolveProfile('~/Private/te', base);
    expect(home.configDir).toBe('/home/u/Private/te');
  });

  test('refuses dangerous roots and bad names', () => {
    expect(() => resolveProfile('/', base)).toThrow(/Refusing/);
    expect(() => resolveProfile('~', base)).toThrow(/Refusing/);
    expect(() => resolveProfile('bad name', base)).toThrow(/Invalid profile/);
    expect(() => resolveProfile('-leading', base)).toThrow(/Invalid profile/);
  });

  test('isPathSpec distinguishes names from paths', () => {
    expect(isPathSpec('test')).toBe(false);
    expect(isPathSpec('./x')).toBe(true);
    expect(isPathSpec('~/x')).toBe(true);
    expect(isPathSpec('a/b')).toBe(true);
  });
});
