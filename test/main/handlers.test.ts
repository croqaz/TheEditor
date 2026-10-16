import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHandlers, type MainDeps, normaliseDialogPath, OPEN_FILE_PATTERNS } from '../../src/main/handlers';
import { resolveProfile } from '../../src/main/profile';
import { JsonStore } from '../../src/main/store';
import { ConfigSchema, SessionSchema } from '../../src/shared/config-schema';
import type { AppInfo } from '../../src/shared/rpc-schema';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeDeps(overrides: Partial<MainDeps> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'te-handlers-'));
  dirs.push(root);
  const paths = resolveProfile(join(root, 'profile'), {
    config: root,
    data: root,
    cache: root,
    logs: root,
    home: root,
    cwd: root,
  });
  const calls: string[] = [];
  const info: AppInfo = {
    version: '0.0.0',
    channel: 'dev',
    platform: 'linux',
    online: false,
    smoke: false,
    headless: false,
    profile: {
      name: paths.name,
      kind: paths.kind,
      configDir: paths.configDir,
      dataDir: paths.dataDir,
    },
    paths: {
      config: paths.configDir,
      data: paths.dataDir,
      cache: paths.cacheDir,
      logs: paths.logsDir,
    },
  };
  let clip: string | null = null;
  const shots: MainDeps['shots'] = {
    newDir: async label => `${root}/shots/${label}`,
    writeArtifact: async (dir, name) => `${dir}/${name}`,
    screen: async (dir, name) => ({
      ok: true,
      path: `${dir}/${name ?? 'screen.png'}`,
      width: 10,
      height: 10,
      backend: 'fake',
    }),
    render: async (dir, _html, options) => ({
      ok: true,
      path: `${dir}/${options.name ?? 'page'}.png`,
      htmlPath: `${dir}/${options.name ?? 'page'}.html`,
      width: options.width,
      height: 100,
      metrics: {
        dpr: 1,
        innerWidth: options.width,
        innerHeight: 100,
        docWidth: options.width,
        docHeight: 100,
      },
    }),
    crop: async (_path, rect, out) => ({ ok: true, path: out, ...rect }),
    diff: async () => ({
      ok: true,
      width: 1,
      height: 1,
      sameSize: true,
      mismatch: 0,
      mismatchPct: 0,
      bbox: null,
      diffPath: null,
    }),
    marks: async (_path, out) => ({
      ok: true,
      path: out,
      frame: { x: 0, y: 0, width: 10, height: 10, thickness: 2 },
      inner: { x: 2, y: 2, width: 6, height: 6 },
    }),
  };
  const deps: MainDeps = {
    shots,
    paths,
    info: async () => info,
    config: new JsonStore(paths.configFile, ConfigSchema, 5),
    session: new JsonStore(paths.sessionFile, SessionSchema, 5),
    dialogs: {
      openFiles: async start => {
        calls.push(`openFiles:${start}`);
        return [`file://${root}/a%20b.md`, join(root, 'c.md'), ''];
      },
      openDirectory: async start => {
        calls.push(`openDirectory:${start}`);
        return `file://${root}/dir`;
      },
    },
    clipboard: { readText: () => clip, writeText: t => void (clip = t) },
    reveal: p => calls.push(`reveal:${p}`),
    window: {
      toggleDevTools: () => calls.push('devtools'),
      requestClose: () => calls.push('close'),
      minimize: () => calls.push('minimize'),
      toggleMaximize: () => calls.push('maximize'),
      toggleFullscreen: () => calls.push('fullscreen'),
    },
    quit: () => calls.push('quit'),
    onRendererReady: () => calls.push('ready'),
    log: m => calls.push(`log:${m}`),
    defaultFolder: '/home/u/Documents',
    ...overrides,
  };
  return { deps, calls, root, info };
}

// The handler maps are typed loosely here because the RPC types are generic proxies.
type AnyFn = (...args: never[]) => unknown;
function requests(h: ReturnType<typeof createHandlers>) {
  return h.requests as unknown as Record<string, (params: unknown) => Promise<unknown> | unknown>;
}
function messages(h: ReturnType<typeof createHandlers>) {
  return h.messages as unknown as Record<string, (payload: unknown) => unknown>;
}

describe('normaliseDialogPath', () => {
  test('strips file:// and decodes, leaves plain paths alone', () => {
    expect(normaliseDialogPath('file:///home/u/a%20b.md')).toBe('/home/u/a b.md');
    expect(normaliseDialogPath('  /plain/path.md ')).toBe('/plain/path.md');
    expect(normaliseDialogPath('file:///bad%zz')).toBe('/bad%zz');
  });
});

describe('createHandlers', () => {
  test('app info, dialogs, and normalised paths', async () => {
    const { deps, calls, root, info } = makeDeps();
    const h = createHandlers(deps);
    expect(await requests(h).getAppInfo!({})).toEqual(info);
    const picked = (await requests(h).pickOpenPaths!({})) as {
      paths: string[];
    };
    expect(picked.paths).toEqual([`${root}/a b.md`, join(root, 'c.md')]);
    expect(calls[0]).toBe('openFiles:/home/u/Documents');
    expect(calls.some(c => c.startsWith('log:open dialog returned 2'))).toBe(true);
    const dir = (await requests(h).pickDirectory!({ startingFolder: '/x' })) as {
      dir: string | null;
    };
    expect(dir.dir).toBe(`${root}/dir`);
    expect(calls).toContain('openDirectory:/x');
  });

  test("read and save documents through the profile's recovery dir", async () => {
    const { deps, root } = makeDeps();
    const h = createHandlers(deps);
    const path = join(root, 'doc.md');
    const saved = (await requests(h).saveDocument!({ path, markdown: '# Doc\n' })) as {
      ok: boolean;
    };
    expect(saved.ok).toBe(true);
    expect(readFileSync(path, 'utf8')).toBe('# Doc\n');
    const doc = (await requests(h).readDocument!({ path })) as {
      markdown: string;
      mtime: number;
    };
    expect(doc.markdown).toBe('# Doc\n');
    expect(doc.mtime).toBeGreaterThan(0);
  });

  test('config and session round-trip through the stores', async () => {
    const { deps } = makeDeps();
    const h = createHandlers(deps);
    const config = (await requests(h).getConfig!({})) as { theme: string };
    expect(config.theme).toBe('gruvbox-dark');
    await requests(h).saveConfig!({
      config: { ...config, theme: 'nord-dark' },
    });
    expect(deps.config.get().theme).toBe('nord-dark');
    const session = (await requests(h).getSession!({})) as { tabs: unknown[] };
    await requests(h).saveSession!({
      session: { ...session, tabs: [{ path: '/a.md' }] },
    });
    expect(deps.session.get().tabs).toEqual([{ path: '/a.md' }]);
    deps.config.flushSync();
    expect(JSON.parse(readFileSync(deps.paths.configFile, 'utf8')).theme).toBe('nord-dark');
  });

  test('clipboard and reveal', async () => {
    const { deps, calls } = makeDeps();
    const h = createHandlers(deps);
    expect(await requests(h).clipboardReadText!({})).toEqual({ text: null });
    await requests(h).clipboardWriteText!({ text: 'copied' });
    expect(await requests(h).clipboardReadText!({})).toEqual({
      text: 'copied',
    });
    await requests(h).revealPath!({ path: '/r.md' });
    expect(calls).toContain('reveal:/r.md');
  });

  test('shot requests delegate to the shots service', async () => {
    const { deps, root } = makeDeps();
    const h = createHandlers(deps);
    const r = requests(h);
    expect(await r.newShotDir!({ label: 'x' })).toEqual({
      dir: `${root}/shots/x`,
    });
    expect(await r.writeArtifact!({ dir: '/d', name: 'a.json', content: '{}' })).toEqual({ path: '/d/a.json' });
    expect(await r.shotScreen!({ dir: '/d' })).toMatchObject({
      ok: true,
      path: '/d/screen.png',
    });
    expect(await r.renderHtml!({ dir: '/d', html: '<p>', options: { width: 500 } })).toMatchObject({
      ok: true,
      path: '/d/page.png',
      width: 500,
    });
    expect(
      await r.cropImage!({
        path: '/d/p.png',
        rect: { x: 1, y: 2, width: 3, height: 4 },
        out: '/d/c.png',
      })
    ).toEqual({ ok: true, path: '/d/c.png', x: 1, y: 2, width: 3, height: 4 });
    expect(await r.diffImages!({ a: '/a', b: '/b' })).toMatchObject({
      ok: true,
      mismatch: 0,
    });
    expect(await r.locateMarks!({ path: '/d/s.png', out: '/d/i.png' })).toMatchObject({ ok: true, path: '/d/i.png' });
  });

  test('messages route to the window and app', () => {
    const { deps, calls } = makeDeps();
    const h = createHandlers(deps);
    const m = messages(h);
    m.rendererReady!({});
    m.toggleDevTools!({});
    for (const action of ['close', 'minimize', 'maximize', 'fullscreen', 'quit']) m.windowCommand!({ action });
    m.log!({ level: 'warn', message: 'hello' });
    expect(calls).toEqual([
      'ready',
      'devtools',
      'close',
      'minimize',
      'maximize',
      'fullscreen',
      'quit',
      'log:[view:warn] hello',
    ]);
  });

  test('session store survives a corrupt file written by hand', () => {
    const { deps } = makeDeps();
    mkdirSync(deps.paths.configDir, { recursive: true });
    writeFileSync(deps.paths.sessionFile, 'garbage', { flag: 'w' });
    const fresh = new JsonStore(deps.paths.sessionFile, SessionSchema, 5);
    expect(fresh.get().tabs).toEqual([]);
  });
});

export type { AnyFn };

describe('open dialog filter', () => {
  test('is a list of GTK glob patterns in both cases', () => {
    // Electrobun hands the string to gtk_file_filter_add_pattern, comma separated; bare extensions match nothing.
    expect(OPEN_FILE_PATTERNS).toBe('*.md,*.MD,*.markdown,*.MARKDOWN,*.txt,*.TXT');
    for (const pattern of OPEN_FILE_PATTERNS.split(',')) {
      expect(pattern).toMatch(/^\*\.[A-Za-z]+$/);
    }
  });
});
