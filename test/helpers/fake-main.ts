// In-memory stand-in for the main process, used to mock `src/view/rpc`.
import { type Config, defaultConfig, defaultSession, type Session } from '../../src/shared/config-schema';
import type { AppInfo, DocResult, SaveResult } from '../../src/shared/rpc-schema';

export interface FakeMain {
  main: {
    request: Record<string, (params: never) => Promise<unknown>>;
    send: Record<string, (payload: unknown) => void>;
  };
  files: Map<string, { markdown: string; mtime: number }>;
  sent: { name: string; payload: unknown }[];
  logs: string[];
  revealed: string[];
  handlers: Record<string, unknown>;
  info: AppInfo;
  config: Config;
  session: Session;
  clipboard: string | null;
  pick: string[];
  /** Parameters of the last pickOpenPaths request. */
  lastPick: { startingFolder?: string } | null;
  pickDir: string | null;
  failSave: boolean;
  /** Shot plumbing: recorded artifacts, renders and crops; overridable results. */
  artifacts: Map<string, string>;
  renders: { dir: string; html: string; options: Record<string, unknown> }[];
  crops: { path: string; rect: Record<string, number>; out: string }[];
  screenResult: unknown;
  marksResult: unknown;
  renderResult: unknown;
  mismatch: number;
  addFile(path: string, markdown: string): void;
  touch(path: string): void;
  log(level: string, message: string): void;
}

export function createFakeMain(): FakeMain {
  const fake = {
    files: new Map<string, { markdown: string; mtime: number }>(),
    sent: [] as { name: string; payload: unknown }[],
    logs: [] as string[],
    revealed: [] as string[],
    handlers: {} as Record<string, unknown>,
    config: defaultConfig(),
    session: defaultSession(),
    clipboard: null as string | null,
    pick: [] as string[],
    lastPick: null as { startingFolder?: string } | null,
    pickDir: null as string | null,
    failSave: false,
    artifacts: new Map<string, string>(),
    renders: [] as {
      dir: string;
      html: string;
      options: Record<string, unknown>;
    }[],
    crops: [] as { path: string; rect: Record<string, number>; out: string }[],
    screenResult: undefined as unknown,
    marksResult: undefined as unknown,
    renderResult: undefined as unknown,
    mismatch: 0,
    info: {
      version: '0.0.0-test',
      channel: 'dev',
      platform: 'linux',
      online: false,
      smoke: false,
      headless: true,
      profile: {
        name: 'test',
        kind: 'named',
        configDir: '/tmp/cfg',
        dataDir: '/tmp/data',
      },
      paths: {
        config: '/tmp/cfg',
        data: '/tmp/data',
        cache: '/tmp/cache',
        logs: '/tmp/logs',
      },
    } as AppInfo,
  };
  let clock = 1000;
  const request = {
    getAppInfo: async () => fake.info,
    pickOpenPaths: async (params: { startingFolder?: string }) => {
      fake.lastPick = params;
      return { paths: fake.pick };
    },
    pickDirectory: async () => ({ dir: fake.pickDir }),
    readDocument: async ({ path }: { path: string }): Promise<DocResult> => {
      const file = fake.files.get(path);
      if (!file) throw new Error(`ENOENT: ${path}`);
      return { path, markdown: file.markdown, mtime: file.mtime };
    },
    saveDocument: async ({
      path,
      markdown,
      expectedMtime,
    }: {
      path: string;
      markdown: string;
      expectedMtime?: number;
    }): Promise<SaveResult> => {
      const file = fake.files.get(path);
      if (file && expectedMtime !== undefined && Math.abs(file.mtime - expectedMtime) > 1) {
        return {
          ok: false,
          reason: 'conflict',
          message: `${path} changed on disk since it was opened`,
          mtime: file.mtime,
        };
      }
      if (fake.failSave) {
        return { ok: false, reason: 'error', message: 'disk full' };
      }
      clock += 10;
      fake.files.set(path, { markdown, mtime: clock });
      return { ok: true, mtime: clock };
    },
    getConfig: async () => fake.config,
    saveConfig: async ({ config }: { config: Config }) => {
      fake.config = config;
      return {};
    },
    getSession: async () => fake.session,
    saveSession: async ({ session }: { session: Session }) => {
      fake.session = session;
      return {};
    },
    clipboardReadText: async () => ({ text: fake.clipboard }),
    clipboardWriteText: async ({ text }: { text: string }) => {
      fake.clipboard = text;
      return {};
    },
    revealPath: async ({ path }: { path: string }) => {
      fake.revealed.push(path);
      return {};
    },
    newShotDir: async ({ label }: { label: string }) => ({
      dir: `/shots/${label}`,
    }),
    writeArtifact: async ({ dir, name, content }: { dir: string; name: string; content: string }) => {
      fake.artifacts.set(`${dir}/${name}`, content);
      return { path: `${dir}/${name}` };
    },
    shotScreen: async ({ dir, name }: { dir: string; name?: string }) =>
      fake.screenResult ?? {
        ok: true,
        path: `${dir}/${name ?? 'screen.png'}`,
        width: 1200,
        height: 800,
        backend: 'fake',
      },
    renderHtml: async ({
      dir,
      html,
      options,
    }: {
      dir: string;
      html: string;
      options: { width: number; name?: string };
    }) => {
      fake.renders.push({ dir, html, options });
      return (
        fake.renderResult ?? {
          ok: true,
          path: `${dir}/${options.name ?? 'page'}.png`,
          htmlPath: `${dir}/${options.name ?? 'page'}.html`,
          width: options.width * 2,
          height: 400,
          metrics: {
            dpr: 2,
            innerWidth: options.width,
            innerHeight: 100,
            docWidth: options.width,
            docHeight: 200,
          },
        }
      );
    },
    cropImage: async ({ path, rect, out }: { path: string; rect: Record<string, number>; out: string }) => {
      fake.crops.push({ path, rect, out });
      return { ok: true, path: out, ...rect };
    },
    diffImages: async ({ out, tolerance }: { a: string; b: string; out?: string; tolerance?: number }) => ({
      ok: true,
      tolerance: tolerance ?? 0,
      width: 10,
      height: 10,
      sameSize: true,
      mismatch: (tolerance ?? 0) >= 32 ? 0 : fake.mismatch,
      mismatchPct: (tolerance ?? 0) >= 32 ? 0 : fake.mismatch,
      bbox: fake.mismatch ? [0, 0, 1, 1] : null,
      diffPath: fake.mismatch && out ? out : null,
    }),
    locateMarks: async ({ path, out }: { path: string; out: string }) =>
      fake.marksResult ?? {
        ok: true,
        path: out,
        frame: { x: 10, y: 10, width: 1200, height: 800, thickness: 7 },
        inner: { x: 17, y: 17, width: 1186, height: 786 },
      },
  };
  const send = new Proxy({} as Record<string, (payload: unknown) => void>, {
    get: (_target, name: string) => (payload: unknown) => {
      fake.sent.push({ name, payload });
    },
  });
  const result: FakeMain = {
    ...fake,
    main: { request: request as unknown as FakeMain['main']['request'], send },
    addFile(path, markdown) {
      clock += 10;
      fake.files.set(path, { markdown, mtime: clock });
    },
    touch(path) {
      const file = fake.files.get(path);
      if (file) file.mtime += 5000;
    },
    log(level, message) {
      fake.logs.push(`${level}:${message}`);
    },
  };
  // Keep the mutable fields shared between `fake` and `result`.
  Object.defineProperties(result, {
    files: { get: () => fake.files },
    sent: { get: () => fake.sent },
    logs: { get: () => fake.logs },
    revealed: { get: () => fake.revealed },
    handlers: { get: () => fake.handlers },
    info: { get: () => fake.info, set: (v: AppInfo) => void (fake.info = v) },
    config: {
      get: () => fake.config,
      set: (v: Config) => void (fake.config = v),
    },
    session: {
      get: () => fake.session,
      set: (v: Session) => void (fake.session = v),
    },
    clipboard: {
      get: () => fake.clipboard,
      set: (v: string | null) => void (fake.clipboard = v),
    },
    pick: { get: () => fake.pick, set: (v: string[]) => void (fake.pick = v) },
    lastPick: { get: () => fake.lastPick },
    pickDir: {
      get: () => fake.pickDir,
      set: (v: string | null) => void (fake.pickDir = v),
    },
    failSave: {
      get: () => fake.failSave,
      set: (v: boolean) => void (fake.failSave = v),
    },
    artifacts: { get: () => fake.artifacts },
    renders: { get: () => fake.renders },
    crops: { get: () => fake.crops },
    screenResult: {
      get: () => fake.screenResult,
      set: (v: unknown) => void (fake.screenResult = v),
    },
    marksResult: {
      get: () => fake.marksResult,
      set: (v: unknown) => void (fake.marksResult = v),
    },
    renderResult: {
      get: () => fake.renderResult,
      set: (v: unknown) => void (fake.renderResult = v),
    },
    mismatch: {
      get: () => fake.mismatch,
      set: (v: number) => void (fake.mismatch = v),
    },
  });
  return result;
}

export const tick = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));
