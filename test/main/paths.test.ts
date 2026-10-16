import { describe, expect, mock, test } from 'bun:test';

mock.module('electrobun/main', () => ({
  Utils: {
    paths: {
      config: '/home/u/.config',
      appData: '/home/u/.local/share',
      cache: '/home/u/.cache',
      logs: '/home/u/.local/state',
      home: '/home/u',
      documents: '/home/u/Documents',
    },
  },
}));

const { createPaths } = await import('../../src/main/paths');

describe('createPaths', () => {
  test("default profile maps onto Electrobun's platform directories", () => {
    const p = createPaths(undefined, '/work');
    expect(p.configDir).toBe('/home/u/.config/TheEditor');
    expect(p.dataDir).toBe('/home/u/.local/share/TheEditor');
    expect(p.cacheDir).toBe('/home/u/.cache/TheEditor');
    expect(p.logsDir).toBe('/home/u/.local/state/TheEditor');
  });

  test('named and relative path profiles', () => {
    expect(createPaths('test', '/work').configDir).toBe('/home/u/.config/TheEditor/profiles/test');
    expect(createPaths('./prof', '/work').configDir).toBe('/work/prof');
    expect(createPaths('~/p', '/work').configDir).toBe('/home/u/p');
  });
});
