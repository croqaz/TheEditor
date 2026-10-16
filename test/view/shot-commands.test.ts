import { describe, expect, test } from 'bun:test';
import { CommandRegistry } from '../../src/shared/commands';
import { type Config, defaultConfig } from '../../src/shared/config-schema';
import type { AppContext } from '../../src/view/commands/context';
import { signal } from '../../src/view/state';
import { setFakeMain } from '../helpers/electrobun-view-mock';
import { createFakeMain } from '../helpers/fake-main';

const fake = createFakeMain();
setFakeMain(fake);

const { TabManager } = await import('../../src/view/documents/tabs');
const { shotCommands, withFullLayout } = await import('../../src/view/shots/commands');
const { computeStats } = await import('../../src/view/stats/engine');

const MARKDOWN = '---\nt: 1\n---\n\n# One\n\nfirst\n\n## Sub\n\nsecond\n\n# Two\n\nthird\n';

async function makeApp() {
  const host = document.createElement('main');
  document.body.appendChild(host);
  const config = signal<Config>(defaultConfig());
  const registry = new CommandRegistry<AppContext>();
  const flashes: string[] = [];
  const tabs = new TabManager(
    host,
    {
      onDocChanged() {},
      onSelectionChanged() {},
    },
    config.get()
  );
  const ctx: AppContext = {
    registry,
    tabs,
    config,
    info: fake.info,
    main: fake.main as unknown as AppContext['main'],
    status: { openPrompt() {}, flash: text => flashes.push(text) },
    view: () => tabs.active.get()!.editor.view(),
    stats: () => computeStats(ctx.view(), 0, { lang: 'en', wpm: 240 }),
    refreshStats: () => {},
    patchConfig: async partial => {
      const next = { ...config.get(), ...partial };
      config.set(next);
      return next;
    },
  };
  registry.registerAll(shotCommands);
  const te = registry.buildApi(ctx) as Record<string, any>;
  const tab = await tabs.newTab(MARKDOWN);
  Object.defineProperty(tab.pane, 'clientWidth', { value: 600 });
  Object.defineProperty(tab.pane, 'clientHeight', { value: 400 });
  // Every element sits at {0,0,100,20}; put the pane 10 px higher so blocks are clear of the 4 px marks band.
  tab.pane.getBoundingClientRect = () =>
    ({
      x: 0,
      y: -10,
      top: -10,
      left: 0,
      right: 600,
      bottom: 390,
      width: 600,
      height: 400,
      toJSON: () => ({}),
    }) as DOMRect;
  fake.artifacts.clear();
  fake.renders.length = 0;
  fake.crops.length = 0;
  fake.screenResult = undefined;
  fake.marksResult = undefined;
  fake.renderResult = undefined;
  fake.mismatch = 0;
  return { ctx, te, tabs, flashes, tab };
}

describe('te.measure', () => {
  test('returns coordinates and writes measure.json when labelled', async () => {
    const { te } = await makeApp();
    const plain = await te.measure();
    expect(plain.blocks.length).toBeGreaterThan(3);
    expect(plain.dir).toBeUndefined();
    const labelled = await te.measure({ label: 'before' });
    expect(labelled.dir).toBe('/shots/before');
    expect(fake.artifacts.has('/shots/before/measure.json')).toBe(true);
    expect(JSON.parse(fake.artifacts.get('/shots/before/measure.json')!).blocks.length).toBe(plain.blocks.length);
  });
});

describe('withFullLayout', () => {
  test('forces every block visible while the callback runs, nests, and cleans up on errors', async () => {
    const { tab, te } = await makeApp();
    const body = document.body;
    expect(body.classList.contains('te-full')).toBe(false);
    const result = await withFullLayout(tab.pane, async () => {
      expect(body.classList.contains('te-full')).toBe(true);
      await withFullLayout(tab.pane, async () => expect(body.classList.contains('te-full')).toBe(true));
      expect(body.classList.contains('te-full')).toBe(true); // the inner call does not undo the outer one
      return 7;
    });
    expect(result).toBe(7);
    expect(body.classList.contains('te-full')).toBe(false);
    await expect(
      withFullLayout(tab.pane, async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    expect(body.classList.contains('te-full')).toBe(false);

    // the picture commands measure and capture under full layout
    const seen: boolean[] = [];
    const requests = fake.main.request as Record<string, (params: unknown) => Promise<unknown>>;
    const original = requests.writeArtifact!;
    requests.writeArtifact = async params => {
      seen.push(body.classList.contains('te-full'));
      return original(params);
    };
    await te.measure({ label: 'full' });
    await te.shot.screen({ label: 'full' });
    requests.writeArtifact = original;
    expect(seen.length).toBeGreaterThan(1);
    expect(seen.every(Boolean)).toBe(true);
    expect(body.classList.contains('te-full')).toBe(false);
  });
});

describe('te.debug.boxes', () => {
  test('toggles the overlay on the active pane, takes options, loads a measure.json and goes back to live', async () => {
    const { te, tab, flashes } = await makeApp();
    const on = await te.debug.boxes();
    expect(on.on).toBe(true);
    expect(on.blocks).toBeGreaterThan(3);
    expect(on.total).toBe(on.blocks);
    expect(on.lines).toBeGreaterThan(0);
    expect(on.options).toEqual({ blocks: true, lines: true, labels: true });
    expect(tab.pane.querySelector('.te-boxes')).not.toBeNull();
    expect(flashes.at(-1)).toMatch(/boxes: \d+ block\(s\), \d+ line\(s\) drawn$/);

    const bare = await te.debug.boxes({ lines: false, labels: false });
    expect(bare.lines).toBe(0);
    expect(bare.options).toEqual({ blocks: true, lines: false, labels: false });
    expect(tab.pane.querySelector('.te-box__label')).toBeNull();

    fake.files.set('/shots/x/measure.json', {
      markdown: JSON.stringify({
        pane: { width: 600, height: 400 },
        content: { width: 600, height: 700 },
        font: { size: 15 },
        blocks: [
          {
            index: 0,
            type: 'p',
            text: '',
            viewport: { x: 0, y: 0, width: 10, height: 10 },
            document: { x: 0, y: 0, width: 10, height: 10 },
            lines: [],
            visible: true,
          },
        ],
      }),
      mtime: 1,
    });
    const loaded = await te.debug.boxes({
      from: '/shots/x/measure.json',
      lines: true,
    });
    expect(loaded).toMatchObject({
      on: true,
      blocks: 1,
      total: 1,
      from: '/shots/x/measure.json',
    });
    expect(flashes.at(-1)).toContain('from /shots/x/measure.json');
    fake.files.set('/shots/bad.json', { markdown: 'nope', mtime: 1 });
    await expect(te.debug.boxes({ from: '/shots/bad.json' })).rejects.toThrow(/JSON/);
    const live = await te.debug.boxes({ from: null });
    expect(live.from).toBeUndefined();
    expect(live.total).toBe(on.total);

    expect(await te.debug.boxes(false)).toEqual({ on: false });
    expect(tab.pane.querySelector('.te-boxes')).toBeNull();
    expect(flashes.at(-1)).toBe('boxes off');
    expect(await te.debug.boxes(false)).toEqual({ on: false });
    expect((await te.debug.boxes(true)).on).toBe(true);
    expect((await te.debug.boxes()).on).toBe(false);
  });

  test('the overlay is rendered into the page picture but not into section pictures', async () => {
    const { te } = await makeApp();
    await te.debug.boxes(true);
    await te.shot.page({ label: 'pg' });
    expect(fake.renders.at(-1)!.html).toContain('<div class="te-boxes"');
    expect(fake.renders.at(-1)!.html).toMatch(/te-box--block/);
    fake.renders.length = 0;
    await te.shot.sections({ label: 'sec' });
    expect(fake.renders.every(r => !r.html.includes('te-boxes'))).toBe(true);
    await te.debug.boxes(false);
    await te.shot.page({ label: 'pg2' });
    expect(fake.renders.at(-1)!.html).not.toContain('te-boxes');
  });
});

describe('te.shot.screen', () => {
  test('adds marks while capturing, crops to the pane and measures the device pixel ratio', async () => {
    const { te, flashes } = await makeApp();
    const result = await te.shot.screen({ label: 'scr' });
    expect(result.ok).toBe(true);
    expect(result.dir).toBe('/shots/scr');
    expect(result.raw).toBe('/shots/scr/screen-raw.png');
    expect(result.path).toBe('/shots/scr/screen.png');
    expect(result.dpr).toBe(2); // 1200 px inner width / 600 CSS px
    expect(document.body.classList.contains('te-marks')).toBe(false);
    expect(fake.artifacts.has('/shots/scr/measure.json')).toBe(true);
    expect(flashes.at(-1)).toContain('screen shot in');
    const seen: boolean[] = [];
    const requests = fake.main.request as Record<string, (params: unknown) => Promise<unknown>>;
    const original = requests.shotScreen!;
    requests.shotScreen = async params => {
      seen.push(document.body.classList.contains('te-keep-caret'));
      return original(params);
    };
    await te.shot.screen({ caret: true });
    expect(seen).toEqual([true]);
    expect(document.body.classList.contains('te-keep-caret')).toBe(false);
    requests.shotScreen = original;
  });

  test('reports capture and marks failures', async () => {
    const { te, flashes } = await makeApp();
    fake.screenResult = {
      ok: false,
      error: 'portal denied',
      backend: 'electrobun',
    };
    const failed = await te.shot.screen();
    expect(failed).toMatchObject({
      ok: false,
      error: 'portal denied',
      backend: 'electrobun',
    });
    expect(flashes.at(-1)).toContain('failed');
    fake.screenResult = undefined;
    fake.marksResult = { ok: false, error: 'no registration marks found' };
    const noMarks = await te.shot.screen();
    expect(noMarks).toMatchObject({
      ok: false,
      error: 'no registration marks found',
      raw: '/shots/screen/screen-raw.png',
    });
  });
});

describe('te.shot.page and sections', () => {
  test('renders the whole document at the pane width on the x11 backend by default', async () => {
    const { te } = await makeApp();
    const result = await te.shot.page({ label: 'pg' });
    expect(result.ok).toBe(true);
    expect(result.path).toBe('/shots/pg/page.png');
    const render = fake.renders.at(-1)!;
    expect(render.options).toMatchObject({
      width: 600,
      name: 'page',
      backend: 'x11',
      viewport: false,
    });
    expect(render.html).toMatch(/<h1[^>]*>One<\/h1>/);
    expect(render.html).toMatch(/<h1[^>]*>Two<\/h1>/);
    const custom = await te.shot.page({ width: 480, backend: 'wayland' });
    expect(custom.ok).toBe(true);
    expect(fake.renders.at(-1)!.options).toMatchObject({
      width: 480,
      backend: 'wayland',
    });
  });

  test('sections split at H1 by default and at the requested level', async () => {
    const { te } = await makeApp();
    const result = await te.shot.sections({ label: 'sec' });
    expect(result.pages).toHaveLength(3); // front-matter alone, "One" with its H2, "Two"
    expect(fake.renders.map(r => r.options.name)).toEqual(['section-01', 'section-02', 'section-03']);
    expect(fake.renders[1]!.html).toMatch(/<h1[^>]*>One<\/h1>/);
    expect(fake.renders[1]!.html).toMatch(/<h2[^>]*>Sub<\/h2>/);
    expect(fake.renders[1]!.html).not.toMatch(/<h1[^>]*>Two<\/h1>/);
    expect(fake.artifacts.has('/shots/sec/sections.json')).toBe(true);
    fake.renders.length = 0;
    const byH2 = await te.shot.sections({ level: 2, height: 1000 });
    expect(byH2.pages).toHaveLength(2);
    expect(fake.renders[0]!.options).toMatchObject({
      height: 1000,
      viewport: true,
    });
    expect(fake.renders[0]!.html).toContain('te-page');
  });

  test('render failures are passed through', async () => {
    const { te, flashes } = await makeApp();
    fake.renderResult = { ok: false, error: 'tool missing' };
    const result = await te.shot.page();
    expect(result).toMatchObject({ ok: false, error: 'tool missing' });
    expect(flashes.at(-1)).toContain('render failed');
  });
});

describe('te.shot.element and verify', () => {
  test('element crops one block from the render with a margin, scaled by the render dpr', async () => {
    const { te } = await makeApp();
    const result = await te.shot.element(1, { label: 'el', margin: 4 });
    expect(result.block.type).toBe('heading');
    expect(result.crop.path).toBe('/shots/el/element-001.png');
    // block rect {0,10,100,20} at dpr 2 with 4 px margin → (-8,12) 216×56
    expect(fake.crops.at(-1)!.rect).toEqual({
      x: -8,
      y: 12,
      width: 216,
      height: 56,
    });
    await expect(te.shot.element(99)).rejects.toThrow(/no block 99/);
    fake.renderResult = { ok: false, error: 'nope' };
    await expect(te.shot.element(0)).rejects.toThrow(/nope/);
  });

  test('verify crops every visible block from both pictures and diffs them', async () => {
    const { te, flashes } = await makeApp();
    const report = await te.shot.verify({ label: 'v' });
    expect(report.dir).toBe('/shots/v');
    expect(report.screen.ok).toBe(true);
    expect(report.render.ok).toBe(true);
    expect(report.blocks.length).toBeGreaterThan(3);
    expect(report.summary.identical).toBe(report.blocks.length);
    expect(report.summary.identicalWithinAA).toBe(report.blocks.length);
    expect(report.summary.tolerance).toBe(0);
    expect(report.summary.screenDpr).toBe(2);
    expect(report.summary.pageDpr).toBe(2);
    expect(report.screen.aligned).toEqual({ before: 0, after: 0, step: 1 });
    expect(fake.crops.length).toBe(report.blocks.length * 2);
    expect(report.blocks[0].diffAA.tolerance).toBe(32);
    expect(fake.artifacts.has('/shots/v/verify.json')).toBe(true);
    expect(flashes.at(-1)).toMatch(/verify: \d+\/\d+ identical, \d+\/\d+ within anti-aliasing/);

    fake.mismatch = 5;
    const single = await te.shot.verify({ index: 1, tolerance: 8 });
    expect(single.blocks).toHaveLength(1);
    expect(single.summary.identical).toBe(0);
    expect(single.summary.identicalWithinAA).toBe(1); // the fake treats tolerance ≥ 32 as anti-aliasing only
    expect(single.blocks[0].diff.tolerance).toBe(8);
  });

  test('verify stops early when a picture is missing', async () => {
    const { te, flashes } = await makeApp();
    fake.screenResult = { ok: false, error: 'no display', backend: 'none' };
    const report = await te.shot.verify();
    expect(report.blocks).toEqual([]);
    expect(report.summary).toBeUndefined();
    expect(flashes.at(-1)).toContain('incomplete');
  });

  test('crop and diff wrappers', async () => {
    const { te } = await makeApp();
    const crop = await te.shot.crop('/x/a.png', 1, 2, 3, 4);
    expect(crop.path).toBe('/x/a-crop-1-2.png');
    const named = await te.shot.crop('/x/a.png', 0, 0, 1, 1, '/x/out.png');
    expect(named.path).toBe('/x/out.png');
    const diff = await te.shot.diff('/a.png', '/b.png', '/d.png');
    expect(diff.ok).toBe(true);
    expect(diff.tolerance).toBe(0);
    expect((await te.shot.diff('/a.png', '/b.png', undefined, 40)).tolerance).toBe(40);
  });
});
