import { describe, expect, test } from 'bun:test';
import { TextSelection } from '@milkdown/kit/prose/state';
import { defaultConfig } from '../../src/shared/config-schema';
import { setFakeMain } from '../helpers/electrobun-view-mock';
import { createFakeMain, tick } from '../helpers/fake-main';

const fake = createFakeMain();
setFakeMain(fake);

const { TabManager, isPristineUntitled, titleFor } = await import('../../src/view/documents/tabs');
type Manager = InstanceType<typeof TabManager>;

function makeManager(configOverrides: Partial<ReturnType<typeof defaultConfig>['autosave']> = {}) {
  const host = document.createElement('main');
  document.body.appendChild(host);
  const events: string[] = [];
  const config = defaultConfig();
  config.autosave = {
    ...config.autosave,
    debounceMs: 15,
    maxWaitMs: 60,
    ...configOverrides,
  };
  const manager = new TabManager(
    host,
    {
      onDocChanged: tab => events.push(`doc:${tab.title}`),
      onSelectionChanged: tab => events.push(`sel:${tab.title}`),
      onSaved: (tab, auto) => events.push(`${auto ? 'autosaved' : 'saved'}:${tab.title}`),
    },
    config
  );
  return { manager, host, events, config };
}

function typeInto(manager: Manager, text: string) {
  const tab = manager.active.get()!;
  const view = tab.editor.view();
  view.dispatch(view.state.tr.insertText(text, 1));
}

describe('titleFor', () => {
  test('file names lose their extension; untitled tabs are numbered without gaps', () => {
    expect(titleFor('/a/b/Chapter One.md')).toBe('Chapter One');
    expect(titleFor('/x/notes.markdown')).toBe('notes');
    expect(titleFor('/x/plain.txt')).toBe('plain');
    expect(titleFor('/x/keep.ext')).toBe('keep.ext');
    expect(titleFor(null)).toBe('untitled');
    expect(titleFor(null, ['untitled'])).toBe('untitled-2');
    expect(titleFor(null, ['untitled', 'untitled-2', 'untitled-3'])).toBe('untitled-4');
    expect(titleFor(null, ['untitled-2'])).toBe('untitled');
  });
});

describe('TabManager', () => {
  test('new tabs are untitled, pristine, active and visible', async () => {
    const { manager, host } = makeManager();
    const tab = await manager.newTab();
    expect(tab.title).toBe('untitled');
    expect(tab.dirty).toBe(false);
    expect(isPristineUntitled(tab)).toBe(true);
    expect(manager.active.get()).toBe(tab);
    expect(host.querySelectorAll('.te-pane')).toHaveLength(1);
    expect(tab.pane.hidden).toBe(false);
    const second = await manager.newTab('x');
    expect(second.title).toBe('untitled-2');
    expect(tab.pane.hidden).toBe(true);
    expect(second.pane.hidden).toBe(false);
  });

  test('closing the last empty tab does nothing; closing the last file leaves one untitled', async () => {
    const { manager } = makeManager();
    const only = await manager.newTab();
    expect(await manager.close()).toBe(false);
    expect(manager.list()).toEqual([only]);

    fake.addFile('/docs/a.md', '# A\n');
    await manager.open(['/docs/a.md']);
    expect(manager.list().map(t => t.title)).toEqual(['a']); // replaced the pristine untitled tab
    expect(await manager.close()).toBe(true);
    expect(manager.list().map(t => t.title)).toEqual(['untitled']);
    expect(await manager.close()).toBe(false);
    expect(manager.list().map(t => t.title)).toEqual(['untitled']);
  });

  test('open: existing path activates, missing path logs, dialog is used when no paths given', async () => {
    const { manager } = makeManager();
    fake.addFile('/docs/one.md', 'one\n');
    fake.addFile('/docs/two.md', 'two\n');
    const [one] = await manager.open(['/docs/one.md']);
    const [two] = await manager.open(['/docs/two.md']);
    expect(manager.active.get()).toBe(two!);
    const [again] = await manager.open(['/docs/one.md']);
    expect(again).toBe(one!);
    expect(manager.active.get()).toBe(one!);
    expect(manager.list()).toHaveLength(2);

    await manager.open(['/docs/missing.md']);
    expect(fake.logs.some(l => l.startsWith('error:open failed for /docs/missing.md'))).toBe(true);

    fake.pick = ['/docs/two.md'];
    const picked = await manager.open();
    expect(picked[0]).toBe(two!);
    // the dialog opens in the active document's folder, or wherever the main process defaults to
    expect(fake.lastPick).toEqual({ startingFolder: '/docs' });
    fake.pick = [];
    expect(await manager.open()).toEqual([]);
    await manager.newTab();
    await manager.open();
    expect(fake.lastPick).toEqual({});
  });

  test('dirty tracking via document identity, manual save, saved events', async () => {
    const { manager, events } = makeManager({ enabled: false });
    fake.addFile('/docs/d.md', 'hello\n');
    const [tab] = await manager.open(['/docs/d.md']);
    expect(tab!.dirty).toBe(false);
    typeInto(manager, 'X');
    expect(tab!.dirty).toBe(true);
    expect(events).toContain('doc:d');
    expect(await manager.save()).toBe(true);
    expect(tab!.dirty).toBe(false);
    expect(fake.files.get('/docs/d.md')?.markdown).toBe('Xhello\n');
    expect(events).toContain('saved:d');
    expect(tab!.bytes).toBe(7);
    // saving a clean tab is a no-op success
    const saves = fake.files.get('/docs/d.md')!.mtime;
    expect(await manager.save()).toBe(true);
    expect(fake.files.get('/docs/d.md')!.mtime).toBe(saves);
    expect(await manager.save(999)).toBe(false);
  });

  test('autosave fires after the debounce and reports as auto', async () => {
    const { manager, events } = makeManager({ enabled: true });
    fake.addFile('/docs/auto.md', 'a\n');
    const [tab] = await manager.open(['/docs/auto.md']);
    typeInto(manager, '1');
    typeInto(manager, '2');
    await tick(40);
    expect(fake.files.get('/docs/auto.md')?.markdown).toBe('21a\n');
    expect(tab!.dirty).toBe(false);
    expect(events.filter(e => e === 'autosaved:auto')).toHaveLength(1);
    // turning autosave off cancels pending timers
    typeInto(manager, '3');
    manager.setConfig({
      ...defaultConfig(),
      autosave: { enabled: false, debounceMs: 15, maxWaitMs: 60 },
    });
    await tick(40);
    expect(fake.files.get('/docs/auto.md')?.markdown).toBe('21a\n');
    expect(tab!.dirty).toBe(true);
  });

  test('conflicts are detected, logged, and resolved by force save or reload', async () => {
    const { manager } = makeManager({ enabled: false });
    fake.addFile('/docs/c.md', 'base\n');
    const [tab] = await manager.open(['/docs/c.md']);
    typeInto(manager, 'mine ');
    fake.touch('/docs/c.md');
    expect(await manager.save()).toBe(false);
    expect(tab!.conflict).toBe(true);
    expect(fake.logs.some(l => l.includes('changed on disk'))).toBe(true);
    expect(await manager.save(undefined, true)).toBe(true);
    expect(tab!.conflict).toBe(false);
    expect(fake.files.get('/docs/c.md')?.markdown).toBe('mine base\n');

    fake.files.set('/docs/c.md', { markdown: 'theirs\n', mtime: 99999 });
    expect(await manager.reload()).toBe(true);
    expect(tab!.editor.getMarkdown()).toBe('theirs\n');
    expect(tab!.dirty).toBe(false);
    const untitled = await manager.newTab();
    expect(await manager.reload(untitled.id)).toBe(false);

    fake.failSave = true;
    manager.activate(tab!.id);
    typeInto(manager, 'z');
    expect(await manager.save(tab!.id)).toBe(false);
    expect(fake.logs.some(l => l.includes('save failed: disk full'))).toBe(true);
    fake.failSave = false;
  });

  test('saveAs with an explicit path, with a picked folder, and cancelled', async () => {
    const { manager, events } = makeManager({ enabled: false });
    const tab = await manager.newTab('draft\n');
    expect(await manager.save()).toBe(false); // untitled + no folder picked → saveAs cancelled
    fake.pickDir = '/docs/out/';
    expect(await manager.save()).toBe(true);
    expect(tab.path).toBe('/docs/out/untitled.md');
    expect(tab.title).toBe('untitled');
    expect(fake.files.has('/docs/out/untitled.md')).toBe(true);
    expect(events).toContain('saved:untitled');
    expect(await manager.saveAs(tab.id, '/docs/renamed')).toBe(true);
    expect(tab.path).toBe('/docs/renamed.md');
    expect(tab.title).toBe('renamed');
    fake.failSave = true;
    expect(await manager.saveAs(tab.id, '/docs/fail.md')).toBe(false);
    fake.failSave = false;
    expect(await manager.saveAs(999)).toBe(false);
    fake.pickDir = null;
  });

  test('close saves dirty files, keeps dirty untitled text unless discarded', async () => {
    const { manager } = makeManager({ enabled: false });
    fake.addFile('/docs/e.md', 'e\n');
    await manager.open(['/docs/e.md']);
    typeInto(manager, 'more ');
    expect(await manager.close()).toBe(true);
    expect(fake.files.get('/docs/e.md')?.markdown).toBe('more e\n');

    const draft = manager.active.get()!; // the replacement untitled tab
    typeInto(manager, 'unsaved');
    expect(await manager.close()).toBe(false);
    expect(fake.logs.some(l => l.includes('has unsaved text'))).toBe(true);
    expect(manager.list()).toContain(draft);
    expect(await manager.close(draft.id, true)).toBe(true);
    expect(manager.list().map(t => t.title)).toEqual(['untitled']);
    expect(await manager.close(12345)).toBe(false);

    // a conflicting file blocks close until resolved
    fake.addFile('/docs/f.md', 'f\n');
    const [f] = await manager.open(['/docs/f.md']);
    typeInto(manager, 'x');
    fake.touch('/docs/f.md');
    expect(await manager.close(f!.id)).toBe(false);
    expect(await manager.close(f!.id, true)).toBe(true);
  });

  test('clicking the pane outside the text keeps focus and moves the caret to the end', async () => {
    const { manager } = makeManager();
    const tab = await manager.newTab('alpha\n\nbeta\n');
    const view = tab.editor.view();
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)));
    const click = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: 30,
      clientY: 900,
    });
    tab.pane.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(view.state.selection.from).toBe(view.state.doc.content.size - 1);
    expect(view.state.selection.empty).toBe(true);
  });

  test('openText creates a tab named after the dropped file and replaces a lone blank tab', async () => {
    const { manager } = makeManager();
    await manager.newTab();
    const tab = await manager.openText('Chapter One.md', '# Chapter One\n');
    expect(tab.title).toBe('Chapter One');
    expect(tab.path).toBeNull();
    expect(tab.editor.getMarkdown()).toBe('# Chapter One\n');
    expect(manager.list()).toEqual([tab]);
    const second = await manager.openText('Chapter One.md', 'again\n');
    expect(second.title).toBe('Chapter One');
    expect(manager.list()).toHaveLength(2);
  });

  test('navigation: activateByIndex, cycle, move', async () => {
    const { manager } = makeManager();
    const a = await manager.newTab('a');
    const b = await manager.newTab('b');
    const c = await manager.newTab('c');
    manager.activateByIndex(0);
    expect(manager.active.get()).toBe(a);
    manager.activateByIndex(99);
    expect(manager.active.get()).toBe(a);
    manager.cycle(1);
    expect(manager.active.get()).toBe(b);
    manager.cycle(-2);
    expect(manager.active.get()).toBe(c);
    manager.move(1); // already last: no-op
    expect(manager.list()).toEqual([a, b, c]);
    manager.move(-1);
    expect(manager.list()).toEqual([a, c, b]);
    manager.activate(4242); // unknown id: ignored
    expect(manager.active.get()).toBe(c);
    expect(manager.byPath('/nope')).toBeUndefined();
  });

  test('session snapshot, save and restore', async () => {
    const { manager } = makeManager();
    fake.addFile('/docs/s1.md', 's1\n');
    fake.addFile('/docs/s2.md', 's2\n');
    await manager.open(['/docs/s1.md', '/docs/s2.md']);
    manager.activateByIndex(0);
    const snap = manager.snapshot();
    expect(snap.tabs.map(t => t.path)).toEqual(['/docs/s1.md', '/docs/s2.md']);
    expect(snap.active).toBe(0);
    fake.session = { ...fake.session, recent: ['/docs/old.md', '/docs/s1.md'] };
    await manager.saveSession();
    expect(fake.session.tabs.map(t => t.path)).toEqual(['/docs/s1.md', '/docs/s2.md']);
    expect(fake.session.recent).toEqual(['/docs/s1.md', '/docs/s2.md', '/docs/old.md']);

    const { manager: restored } = makeManager();
    await restored.restore(fake.session);
    expect(restored.list().map(t => t.path)).toEqual(['/docs/s1.md', '/docs/s2.md']);
    expect(restored.active.get()?.path).toBe('/docs/s1.md');

    const { manager: empty } = makeManager();
    await empty.restore({ ...fake.session, tabs: [{ path: null }], active: 0 });
    expect(empty.list().map(t => t.title)).toEqual(['untitled']);
  });
});
