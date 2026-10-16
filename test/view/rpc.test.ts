import { beforeEach, describe, expect, test } from 'bun:test';
import { setFakeMain, viewMockState } from '../helpers/electrobun-view-mock';
import { createFakeMain } from '../helpers/fake-main';

// The real module, running on the fake `electrobun/view` installed by tests/setup.ts.
const rpc = await import('../../src/view/rpc');

describe('view rpc', () => {
  beforeEach(() => setFakeMain(createFakeMain()));

  test('creates one Electroview with the defined RPC', () => {
    expect(viewMockState.instances.length).toBeGreaterThanOrEqual(1);
    expect(viewMockState.config?.maxRequestTime).toBe(30_000);
    expect(rpc.electroview).toBeInstanceOf(Object);
  });

  test('request handlers throw until handlers are installed, then delegate', async () => {
    const config = viewMockState.config!;
    expect(() => config.handlers.requests.getStats!({})).toThrow(/not installed/);
    expect(() => config.handlers.requests.requestClose!({})).toThrow(/not installed/);
    // defaults are no-ops until installed
    config.handlers.messages.openPaths!({ paths: ['/x.md'] });
    config.handlers.messages.fileChangedOnDisk!({ path: '/x.md', mtime: 1 });
    config.handlers.messages.configChanged!({ config: {} });
    const calls: unknown[] = [];
    rpc.installHandlers({
      getStats: () => {
        calls.push('stats');
        return { words: 1 } as never;
      },
      requestClose: () => ({ allow: false }),
      runCommand: async (id, args) => ({ ok: true, result: [id, args] }),
      openPaths: paths => calls.push(paths),
      fileChangedOnDisk: (path, mtime) => calls.push([path, mtime]),
      configChanged: config => calls.push(config.theme),
    });
    expect(config.handlers.requests.getStats!({})).toEqual({ words: 1 });
    expect(config.handlers.requests.requestClose!({})).toEqual({
      allow: false,
    });
    expect(await config.handlers.requests.runCommand!({ id: 'x', args: [1] })).toEqual({
      ok: true,
      result: ['x', [1]],
    });
    expect(await config.handlers.requests.runCommand!({ id: 'y' })).toEqual({
      ok: true,
      result: ['y', []],
    });
    config.handlers.messages.openPaths!({ paths: ['/a.md'] });
    config.handlers.messages.fileChangedOnDisk!({ path: '/a.md', mtime: 7 });
    config.handlers.messages.configChanged!({ config: { theme: 'nord-dark' } });
    expect(calls).toEqual(['stats', ['/a.md'], ['/a.md', 7], 'nord-dark']);
  });

  test('main.request and main.send reach the fake main; log forwards', async () => {
    const fake = viewMockState.fake!;
    expect((await rpc.main.request.getConfig({})).theme).toBe('gruvbox-dark');
    rpc.main.send.toggleDevTools({});
    rpc.log('warn', 'careful');
    expect(fake.sent.map(s => s.name)).toEqual(['toggleDevTools', 'log']);
    expect(fake.logs).toEqual(['warn:careful']);
  });
});
