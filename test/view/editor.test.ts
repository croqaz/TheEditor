// The real Milkdown editor under happy-dom: construction, round-trips of the
// gold files, the front-matter node view, and the change tracker.
import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Selection, TextSelection } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { createEditor, type EditorHandle } from '../../src/view/editor/create';
import {
  bodyStart,
  caretFollowsFrontmatter,
  frontmatterAround,
  goToEnd,
  goToStart,
} from '../../src/view/editor/frontmatter';

const GOLD = join(import.meta.dirname, '..', 'gold');
const ROUNDTRIP = join(GOLD, 'roundtrip');
const UPDATE = process.env.UPDATE_GOLD === '1';

async function make(markdown: string, hooks?: Partial<Parameters<typeof createEditor>[2]>) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const handle = await createEditor(root, markdown, {
    onDocChanged: hooks?.onDocChanged ?? (() => {}),
    onSelectionChanged: hooks?.onSelectionChanged ?? (() => {}),
  });
  return { root, handle };
}

describe('createEditor', () => {
  test('mounts, serialises, replaces and destroys', async () => {
    const changes: string[] = [];
    const { root, handle } = await make('# Hi\n\nSome *text*.\n', {
      onDocChanged: () => changes.push('doc'),
      onSelectionChanged: () => changes.push('sel'),
    });
    expect(root.querySelector('.te-doc')).not.toBeNull();
    expect(root.querySelector('h1')?.textContent).toBe('Hi');
    expect(handle.getMarkdown()).toBe('# Hi\n\nSome *text*.\n');

    changes.length = 0; // mounting may itself emit a change (initial content, trailing node)
    const view = handle.view();
    view.dispatch(view.state.tr.insertText('Oh. ', 1));
    // Milkdown may dispatch follow-up transactions of its own; every one of them is a doc change.
    expect(changes.length).toBeGreaterThanOrEqual(1);
    expect(changes.every(c => c === 'doc')).toBe(true);
    expect(handle.getMarkdown()).toBe('# Oh. Hi\n\nSome *text*.\n');
    handle.setMarkdown('## Two\n\nreplaced\n');
    expect(handle.getMarkdown()).toBe('## Two\n\nreplaced\n');
    handle.focus();
    await handle.destroy();
    expect(root.querySelector('.te-doc')).toBeNull();
  });

  test('selection changes are reported separately from document changes', async () => {
    const events: string[] = [];
    const { handle } = await make('one two three\n', {
      onDocChanged: () => events.push('doc'),
      onSelectionChanged: () => events.push('sel'),
    });
    const view = handle.view();
    const { TextSelection } = await import('@milkdown/kit/prose/state');
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 4)));
    expect(events).toEqual(['sel']);
    await handle.destroy();
  });
});

describe('gold files round-trip', () => {
  const names = ['01-commonmark', '02-gfm', '03-extended', '05-network-bait', '06-comic-script'];
  for (const name of names) {
    test(`${name}: serialisation is idempotent and matches the recorded round-trip`, async () => {
      const source = readFileSync(join(GOLD, `${name}.md`), 'utf8');
      const { handle } = await make(source);
      const once = handle.getMarkdown();
      handle.setMarkdown(once);
      const twice = handle.getMarkdown();
      expect(twice).toBe(once);
      expect(once.length).toBeGreaterThan(source.length * 0.6);

      const expectedPath = join(ROUNDTRIP, `${name}.md`);
      if (UPDATE || !existsSync(expectedPath)) {
        mkdirSync(ROUNDTRIP, { recursive: true });
        writeFileSync(expectedPath, once, 'utf8');
      }
      expect(once).toBe(readFileSync(expectedPath, 'utf8'));
      await handle.destroy();
    });
  }

  test('the headings of the CommonMark file survive, including setext', async () => {
    const { handle } = await make(readFileSync(join(GOLD, '01-commonmark.md'), 'utf8'));
    let headings = 0;
    handle.view().state.doc.forEach(node => {
      if (node.type.name === 'heading') headings++;
    });
    expect(headings).toBe(9);
    await handle.destroy();
  });
});

describe('front-matter node', () => {
  async function withFrontmatter(markdown: string) {
    const { root, handle } = await make(markdown);
    const fm = root.querySelector<HTMLElement>('.te-frontmatter')!;
    return { root, handle, fm, view: handle.view() };
  }
  const inside = (view: EditorView) => frontmatterAround(view.state) !== null;
  const key = (init: KeyboardEventInit) => new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });

  test('is the first node, its YAML is editable text between fences, and the caret starts in the body', async () => {
    const { handle, fm, view } = await withFrontmatter(
      '---\ntitle: X\nanything: goes\nnested:\n  key: 1\n---\n\nBody.\n'
    );
    const doc = view.state.doc;
    expect(doc.firstChild?.type.name).toBe('frontmatter');
    expect(doc.firstChild?.textContent).toBe('title: X\nanything: goes\nnested:\n  key: 1');
    expect(fm.dataset.invalid).toBe('false');
    expect(fm.querySelectorAll('.te-frontmatter__fence')).toHaveLength(2);
    expect(fm.querySelector('.te-frontmatter__yaml')?.textContent).toBe('title: X\nanything: goes\nnested:\n  key: 1');
    expect(fm.querySelector('.te-frontmatter__more')?.textContent).toBe(''); // four lines: nothing hidden
    expect(fm.querySelector('textarea')).toBeNull();
    expect(handle.getMarkdown()).toBe('---\ntitle: X\nanything: goes\nnested:\n  key: 1\n---\n\nBody.\n');
    expect(view.state.selection.empty).toBe(true);
    expect(inside(view)).toBe(false);
    expect(view.state.selection.$from.parent.textContent).toBe('Body.');
    await handle.destroy();
  });

  test('flags invalid YAML and counts the lines hidden while collapsed', async () => {
    const { handle, fm } = await withFrontmatter('---\na: [unclosed\n---\n\nBody.\n');
    expect(fm.dataset.invalid).toBe('true');
    expect(fm.title).toContain('YAML error');
    await handle.destroy();

    const long = await withFrontmatter('---\na: 1\nb: 2\nc: 3\nd: 4\ne: 5\n# comment\n---\n\nx\n');
    expect(long.fm.querySelector('.te-frontmatter__more')?.textContent).toBe(' … 2 more lines');
    expect(long.fm.dataset.invalid).toBe('false');
    await long.handle.destroy();

    const one = await withFrontmatter('---\na: 1\nb: 2\nc: 3\nd: 4\ne: 5\n---\n\nx\n');
    expect(one.fm.querySelector('.te-frontmatter__more')?.textContent).toBe(' … 1 more line');
    await one.handle.destroy();
  });

  test('expands while the caret is inside, edits as text, Enter adds a line, Escape leaves, Backspace on empty removes it', async () => {
    const { handle, fm, view } = await withFrontmatter('---\ntitle: X\n---\n\nBody.\n');
    expect(fm.classList.contains('te-frontmatter--active')).toBe(false);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1 + 'title: X'.length)));
    expect(inside(view)).toBe(true);
    expect(view.dom.querySelector('.te-frontmatter')!.classList.contains('te-frontmatter--active')).toBe(true);

    expect(view.someProp('handleKeyDown', f => f(view, key({ key: 'Enter', code: 'Enter', keyCode: 13 })))).toBe(true);
    view.dispatch(view.state.tr.insertText('author: me'));
    expect(handle.getMarkdown()).toBe('---\ntitle: X\nauthor: me\n---\n\nBody.\n');
    expect(view.dom.querySelector('.te-frontmatter__yaml')?.textContent).toBe('title: X\nauthor: me');

    const escape = () =>
      view.someProp('handleKeyDown', f => f(view, key({ key: 'Escape', code: 'Escape', keyCode: 27 })));
    expect(escape()).toBe(true);
    expect(inside(view)).toBe(false);
    expect(view.state.selection.$from.parent.textContent).toBe('Body.');
    expect(view.dom.querySelector('.te-frontmatter')!.classList.contains('te-frontmatter--active')).toBe(false);
    expect(escape()).toBeFalsy(); // outside the block the key is not ours

    // Delete the YAML, then Backspace in the empty block removes the front-matter altogether.
    view.dispatch(view.state.tr.delete(1, 1 + view.state.doc.firstChild!.content.size));
    expect(view.state.doc.firstChild!.content.size).toBe(0);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)));
    expect(view.someProp('handleKeyDown', f => f(view, key({ key: 'Backspace', code: 'Backspace', keyCode: 8 })))).toBe(
      true
    );
    expect(handle.getMarkdown()).toBe('Body.\n');
    expect(view.dom.querySelector('.te-frontmatter')).toBeNull();
    await handle.destroy();
  });

  test('Backspace at the start of the first paragraph neither deletes nor joins the front-matter', async () => {
    const { handle, view } = await withFrontmatter('---\nk: v\n---\n\nBody.\n');
    const { joinBackward } = await import('@milkdown/kit/prose/commands');
    const bodyStart = view.state.doc.firstChild!.nodeSize + 1;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, bodyStart)));
    expect(caretFollowsFrontmatter(view.state)).toBe(true);
    expect(view.someProp('handleKeyDown', f => f(view, key({ key: 'Backspace', code: 'Backspace', keyCode: 8 })))).toBe(
      true
    );
    expect(handle.getMarkdown()).toBe('---\nk: v\n---\n\nBody.\n');
    // The node is isolating, so even the bare ProseMirror command refuses to join into it.
    expect(joinBackward(view.state)).toBe(false);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, bodyStart + 2)));
    expect(caretFollowsFrontmatter(view.state)).toBe(false);
    await handle.destroy();
  });

  test('Ctrl+Home goes to the body start, then to the front-matter start; Ctrl+End to the very end', async () => {
    const { handle, view } = await withFrontmatter('---\nk: v\n---\n\nFirst.\n\nLast.\n');
    const bodyStartPos = view.state.doc.firstChild!.nodeSize + 1;
    expect(bodyStart(view.state)).toBe(bodyStartPos);
    const home = () =>
      view.someProp('handleKeyDown', f => f(view, key({ key: 'Home', code: 'Home', keyCode: 36, ctrlKey: true })));
    const end = () =>
      view.someProp('handleKeyDown', f => f(view, key({ key: 'End', code: 'End', keyCode: 35, ctrlKey: true })));

    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, bodyStartPos + 3)));
    expect(home()).toBe(true);
    expect(view.state.selection.from).toBe(bodyStartPos); // first: start of the text
    expect(home()).toBe(true);
    expect(view.state.selection.from).toBe(1); // again: start of the front-matter
    expect(inside(view)).toBe(true);
    expect(home()).toBe(true);
    expect(view.state.selection.from).toBe(1); // stays there
    expect(end()).toBe(true);
    expect(view.state.selection.from).toBe(view.state.doc.content.size - 1);
    expect(view.state.selection.$from.parent.textContent).toBe('Last.');
    expect(home()).toBe(true);
    expect(view.state.selection.from).toBe(bodyStartPos);
    await handle.destroy();

    // without front-matter Ctrl+Home is simply the document start
    const plain = await make('One.\n\nTwo.\n');
    const v = plain.handle.view();
    v.dispatch(v.state.tr.setSelection(Selection.atEnd(v.state.doc)));
    expect(goToStart(v.state, v.dispatch)).toBe(true);
    expect(v.state.selection.from).toBe(1);
    expect(goToStart(v.state, v.dispatch)).toBe(true);
    expect(v.state.selection.from).toBe(1);
    expect(goToEnd(v.state, v.dispatch)).toBe(true);
    expect(v.state.selection.$from.parent.textContent).toBe('Two.');
    await plain.handle.destroy();
  });

  test('setMarkdown also puts the caret after a leading front-matter', async () => {
    const { handle } = await withFrontmatter('plain\n');
    handle.setMarkdown('---\nk: v\n---\n\nAfter.\n');
    const view = handle.view();
    expect(inside(view)).toBe(false);
    expect(view.state.selection.$from.parent.textContent).toBe('After.');
    await handle.destroy();
  });
});

export type { EditorHandle };
