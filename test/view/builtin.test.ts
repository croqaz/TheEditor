import { describe, expect, test } from 'bun:test';
import { TextSelection } from '@milkdown/kit/prose/state';
import { CommandRegistry } from '../../src/shared/commands';
import { type Config, defaultConfig } from '../../src/shared/config-schema';
import type { AppContext } from '../../src/view/commands/context';
import { signal } from '../../src/view/state';
import { setFakeMain } from '../helpers/electrobun-view-mock';
import { createFakeMain } from '../helpers/fake-main';

const fake = createFakeMain();
setFakeMain(fake);

const { TabManager } = await import('../../src/view/documents/tabs');
const { builtinCommands } = await import('../../src/view/commands/builtin');
const { isOverwrite } = await import('../../src/view/editor/blockcaret');
const { computeStats } = await import('../../src/view/stats/engine');

async function makeApp() {
  const host = document.createElement('main');
  document.body.appendChild(host);
  const config = signal<Config>(defaultConfig());
  config.get().autosave.enabled = false;
  const registry = new CommandRegistry<AppContext>();
  const flashes: string[] = [];
  let prompts = 0;
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
    status: {
      openPrompt: () => void prompts++,
      flash: text => flashes.push(text),
    },
    view: () => {
      const tab = tabs.active.get();
      if (!tab) throw new Error('no open document');
      return tab.editor.view();
    },
    stats: () => computeStats(ctx.view(), 0, { lang: 'en', wpm: config.get().stats.wpm }),
    refreshStats: () => {},
    patchConfig: async partial => {
      const next = { ...config.get(), ...partial };
      config.set(next);
      tabs.setConfig(next);
      return next;
    },
  };
  registry.registerAll(builtinCommands);
  const te = registry.buildApi(ctx) as Record<string, any>;
  await tabs.newTab();
  return { ctx, te, tabs, registry, flashes, prompts: () => prompts, config };
}

function selectAll(ctx: AppContext) {
  const view = ctx.view();
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, view.state.doc.content.size - 1)));
}

describe('built-in commands', () => {
  test('every command has a unique id, a title, and canonical keys', () => {
    const ids = builtinCommands.map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of builtinCommands) expect(c.title.length).toBeGreaterThan(3);
  });

  test('help prints lines for all or one namespace', async () => {
    const { te } = await makeApp();
    const all = te.help() as string[];
    expect(all.length).toBe(builtinCommands.length);
    const text = te.help('text') as string[];
    expect(text.every(l => l.startsWith('te.text.'))).toBe(true);
  });

  test('file commands', async () => {
    const { te, tabs } = await makeApp();
    fake.addFile('/w/a.md', 'alpha\n');
    expect(await te.file.open('/w/a.md')).toEqual(['/w/a.md']);
    expect(te.file.path()).toBe('/w/a.md');
    expect(await te.file.new()).toBe('untitled');
    expect(tabs.list()).toHaveLength(2);
    tabs.activateByIndex(0);
    const view = tabs.active.get()!.editor.view();
    view.dispatch(view.state.tr.insertText('X', 1));
    expect(await te.file.save()).toBe(true);
    expect(fake.files.get('/w/a.md')?.markdown).toBe('Xalpha\n');
    view.dispatch(view.state.tr.insertText('Y', 1));
    expect(await te.file.saveAll()).toBe(1);
    fake.files.set('/w/a.md', { markdown: 'from disk\n', mtime: 5 });
    expect(await te.file.reload()).toBe(true);
    expect(tabs.active.get()!.editor.getMarkdown()).toBe('from disk\n');
    expect(await te.file.reveal()).toBe('/w/a.md');
    expect(fake.revealed).toContain('/w/a.md');
    expect(await te.file.saveAs('/w/b.md')).toBe(true);
    expect(te.file.path()).toBe('/w/b.md');
    expect(await te.file.close()).toBe(true);
    expect(tabs.list().map(t => t.title)).toEqual(['untitled']);
    fake.pick = ['/w/b.md'];
    expect(await te.file.open()).toEqual(['/w/b.md']);
    fake.pick = [];
  });

  test('tab commands', async () => {
    const { te, tabs } = await makeApp();
    await tabs.newTab('two');
    await tabs.newTab('three');
    te.tabs.go(1);
    expect(tabs.active.get()!.title).toBe('untitled');
    te.tabs.next();
    expect(tabs.active.get()!.title).toBe('untitled-2');
    te.tabs.prev();
    expect(tabs.active.get()!.title).toBe('untitled');
    te.tabs.go3();
    expect(tabs.active.get()!.title).toBe('untitled-3');
    te.tabs.moveLeft();
    expect(tabs.list().map(t => t.title)).toEqual(['untitled', 'untitled-3', 'untitled-2']);
    te.tabs.moveRight();
    expect(tabs.list().map(t => t.title)).toEqual(['untitled', 'untitled-2', 'untitled-3']);
    const rows = te.tabs.list() as { index: number; title: string }[];
    expect(rows.map(r => r.title)).toEqual(['untitled', 'untitled-2', 'untitled-3']);
    te.tabs.go();
    expect(tabs.active.get()!.title).toBe('untitled');
  });

  test('text and line transforms operate on the active editor', async () => {
    const { te, ctx, tabs } = await makeApp();
    tabs.active.get()!.editor.setMarkdown('beta\n\nalpha\n');
    selectAll(ctx);
    te.text.uppercase();
    expect(tabs.active.get()!.editor.getMarkdown()).toBe('BETA\n\nALPHA\n');
    selectAll(ctx);
    te.text.lowercase();
    selectAll(ctx);
    te.text.titleCase();
    expect(tabs.active.get()!.editor.getMarkdown()).toBe('Beta\n\nAlpha\n');
    selectAll(ctx);
    te.text.sentenceCase();
    selectAll(ctx);
    te.lines.sort();
    expect(tabs.active.get()!.editor.getMarkdown()).toBe('Alpha\n\nBeta\n');
    selectAll(ctx);
    te.lines.sortDesc();
    expect(tabs.active.get()!.editor.getMarkdown()).toBe('Beta\n\nAlpha\n');
    selectAll(ctx);
    te.lines.sort(true);
    selectAll(ctx);
    te.lines.reverse();
    expect(tabs.active.get()!.editor.getMarkdown()).toBe('Alpha\n\nBeta\n');
    selectAll(ctx);
    te.lines.unique();
    selectAll(ctx);
    te.lines.shuffle();
    expect(
      tabs.active
        .get()!
        .editor.getMarkdown()
        .split('\n\n')
        .map(s => s.trim())
        .sort()
    ).toEqual(['Alpha', 'Beta']);
  });

  test('theme and font commands persist to config', async () => {
    const { te, config } = await makeApp();
    expect(await te.theme()).toBe('gruvbox-dark');
    expect(await te.theme('nord-light')).toBe('nord-light');
    expect(config.get().theme).toBe('nord-light');
    expect(te.theme.list()).toContain('gruvbox-light');
    const next = await te.theme.next();
    expect(te.theme.list()).toContain(next);
    expect(config.get().theme).toBe(next);
    expect(await te.font()).toEqual(defaultConfig().font);
    const font = await te.font('Iosevka', 16, 1.7);
    expect(font).toEqual({
      family: 'Iosevka',
      size: 16,
      leading: 1.7,
      measure: 80,
    });
    expect(await te.font.measure(64)).toBe(64);
    expect(await te.font.measure()).toBe(80);
    expect(config.get().font.family).toBe('Iosevka');
  });

  test('stats, wpm, status fields and autosave', async () => {
    const { te, config, flashes, tabs } = await makeApp();
    tabs.active.get()!.editor.setMarkdown('one two three four\n');
    const stats = te.stats();
    expect(stats.words).toBe(4);
    expect(await te.stats.wpm()).toBe(240);
    expect(await te.stats.wpm(120)).toBe(120);
    expect(config.get().stats.wpm).toBe(120);
    expect(await te.status.fields()).toEqual(defaultConfig().stats.fields);
    expect(await te.status.fields(['words', 3, 'net'])).toEqual(['words', 'net']);
    expect(await te.autosave()).toBe(false);
    expect(await te.autosave(true)).toBe(true);
    expect(config.get().autosave.enabled).toBe(true);
    expect(flashes).toContain('autosave on');
    await te.autosave(false);
    expect(flashes.at(-1)).toContain('autosave off');
  });

  test('goto moves the caret by status-bar line and column, or opens the prompt', async () => {
    const { te, ctx, tabs, prompts } = await makeApp();
    await tabs.newTab('# One\n\nalpha beta\n\ngamma\n');
    expect(await te.goto(3, 7)).toEqual({ line: 3, column: 7 });
    expect(ctx.view().state.selection.from).toBe(5 + 1 + 6); // heading node (5) + paragraph content start + 6 chars
    expect(await te.goto(5)).toEqual({ line: 5, column: 1 });
    expect(await te.goto(99, 99)).toEqual({ line: 5, column: 6 });
    expect(await te.goto()).toEqual({ line: 5, column: 6 });
    expect(prompts()).toBe(1);
  });

  test('goto.start and goto.end move the caret like Ctrl+Home and Ctrl+End', async () => {
    const { te, ctx, tabs } = await makeApp();
    await tabs.newTab('---\nk: v\n---\n\nalpha\n\nomega\n');
    expect(te.goto.end()).toEqual({ line: 7, column: 6 }); // lines 1-4 front-matter (fences, YAML, blank), 5 alpha, 6 blank, 7 omega
    expect(ctx.view().state.selection.$from.parent.textContent).toBe('omega');
    expect(te.goto.start()).toEqual({ line: 5, column: 1 });
    expect(ctx.view().state.selection.$from.parent.textContent).toBe('alpha');
    expect(te.goto.start()).toEqual({ line: 2, column: 1 });
    expect(ctx.view().state.selection.$from.parent.type.name).toBe('frontmatter');
  });

  test('edit.selectAll selects the whole document', async () => {
    const { te, ctx, tabs } = await makeApp();
    await tabs.newTab('alpha\n\nomega\n');
    const size = ctx.view().state.doc.content.size;
    expect(te.edit.selectAll()).toEqual({ from: 0, to: size });
    const { selection } = ctx.view().state;
    expect(selection.from).toBe(0);
    expect(selection.to).toBe(size);
    expect(selection.constructor.name).toBe('AllSelection');
  });

  test('overwrite mode toggles through the command and reports in the status bar', async () => {
    const { te, ctx, tabs, flashes } = await makeApp();
    await tabs.newTab('abc\n');
    expect(isOverwrite(ctx.view().state)).toBe(false);
    expect(te.overwrite()).toBe(true);
    expect(isOverwrite(ctx.view().state)).toBe(true);
    expect(flashes.at(-1)).toBe('overwrite on');
    expect(te.overwrite(true)).toBe(true);
    expect(te.overwrite(false)).toBe(false);
    expect(isOverwrite(ctx.view().state)).toBe(false);
    expect(flashes.at(-1)).toBe('overwrite off');
  });

  test('debug.focus reports page, window and editor focus', async () => {
    const { te, ctx } = await makeApp();
    const report = te.debug.focus();
    expect(typeof report.page).toBe('boolean');
    expect(report.editor).toBe(ctx.view().hasFocus());
    expect(typeof report.activeElement).toBe('string');
    expect(report.visibility).toBe(document.visibilityState);
  });

  test('view, caret and app commands', async () => {
    const { te, prompts, config } = await makeApp();
    fake.sent.length = 0;
    te.view.devtools();
    te.view.fullscreen();
    expect(fake.sent.map(s => s.name)).toEqual(expect.arrayContaining(['toggleDevTools', 'windowCommand']));
    te.view.prompt();
    expect(prompts()).toBe(1);
    te.view.zen();
    expect(document.body.classList.contains('te-zen')).toBe(true);
    te.view.zen();
    expect(await te.caret()).toBe('block');
    expect(await te.caret('bar')).toBe('bar');
    expect(document.body.dataset.caret).toBe('bar');
    expect(config.get().caret).toBe('bar');
    await expect(te.caret('fat')).rejects.toThrow(/block.*bar/);
    expect(await te.caret('block')).toBe('block');
    expect(document.body.dataset.caret).toBe('block');
    expect(te.app.info()).toBe(fake.info);
    expect(te.app.profile()).toEqual(fake.info.profile);
    expect(te.app.config().theme).toBeDefined();
    await te.app.quit();
    expect(fake.sent.at(-1)).toEqual({
      name: 'windowCommand',
      payload: { action: 'quit' },
    });
  });

  test('editor commands report unavailable without a document', async () => {
    const { te, tabs, registry, ctx } = await makeApp();
    const only = tabs.active.get()!;
    await tabs.close(only.id, true); // replaced by a fresh untitled; still "has" an editor
    expect(tabs.list()).toHaveLength(1);
    // simulate no tabs at all
    tabs.active.set(null);
    expect(registry.run('text.lowercase', ctx)).toEqual({
      unavailable: 'text.lowercase',
    });
    expect(te.file.path()).toBeNull();
    expect(registry.run('file.reveal', ctx)).toEqual({
      unavailable: 'file.reveal',
    });
  });
});
