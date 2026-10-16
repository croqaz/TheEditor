// The dialect is CommonMark + GFM, and a save keeps what the file had: bare
// URLs, emphasis markers, the whole info string of a fence, single tildes.
// Task items toggle by command and by a click on their marker.
import { describe, expect, test } from 'bun:test';
import { TextSelection } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { createEditor } from '../../src/view/editor/create';
import { isAutolinkLiteral } from '../../src/view/editor/links';
import { clearTask, listItemAround, markerClick, toggleTask } from '../../src/view/editor/tasks';

async function make(markdown: string) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const handle = await createEditor(root, markdown, {
    onDocChanged() {},
    onSelectionChanged() {},
  });
  return { root, handle, view: handle.view() };
}

describe('what a save keeps', () => {
  test('bare URLs, www addresses and e-mails stay bare; angle and bracket links keep their form', async () => {
    const markdown =
      'See https://example.com/a?b=1#c and www.example.com and someone@example.org.\n\n' +
      'Also <https://example.com/angle>, [text](https://example.com/t "T") and `https://no.link`.\n';
    const { root, handle } = await make(markdown);
    expect(handle.getMarkdown()).toBe(markdown);
    const links = Array.from(root.querySelectorAll('a')).map(a => a.getAttribute('href'));
    expect(links).toEqual([
      'https://example.com/a?b=1#c',
      'http://www.example.com',
      'mailto:someone@example.org',
      'https://example.com/angle',
      'https://example.com/t',
    ]);
  });

  test('isAutolinkLiteral compares the source span with the text', () => {
    const text = { type: 'text', value: 'www.example.com' };
    const span = (length: number) => ({ start: { offset: 10 }, end: { offset: 10 + length } });
    expect(isAutolinkLiteral({ type: 'link', children: [text], position: span(15) })).toBe(true);
    expect(isAutolinkLiteral({ type: 'link', children: [text], position: span(17) })).toBe(false); // <…>
    expect(isAutolinkLiteral({ type: 'link', children: [text] })).toBe(false); // no position: never a literal
    expect(isAutolinkLiteral({ type: 'link', children: [text, text], position: span(30) })).toBe(false);
  });

  test('emphasis and strong keep the marker the file used', async () => {
    const markdown = 'Mixed _under_ and *star*, __under__ and **star**, _**both**_.\n';
    const { handle } = await make(markdown);
    expect(handle.getMarkdown()).toBe(markdown);
  });

  test('a single tilde is not strikethrough', async () => {
    const markdown = 'Water is H~2~O, but ~~this~~ is struck.\n';
    const { root, handle } = await make(markdown);
    expect(root.querySelectorAll('del, s')).toHaveLength(1);
    expect(root.textContent).toContain('H~2~O');
    // The GFM serializer may escape a lone tilde in text (its `unsafe` rule has no single-tilde
    // switch; Milkdown's text handler skips the escaping for runs that end in a space), so the
    // saved form is the same text up to `\\~`, and saving it again changes nothing.
    const saved = handle.getMarkdown();
    expect(saved.replace(/\\~/g, '~')).toBe(markdown);
    handle.setMarkdown(saved);
    expect(handle.getMarkdown()).toBe(saved);
  });

  test('a fence keeps its whole info string', async () => {
    const markdown = '```python title="x.py" {1,3}\nprint(1)\n```\n\n```{.python .numberLines startFrom="10"}\ndef f():\n    return 42\n```\n';
    const { view, handle } = await make(markdown);
    expect(view.state.doc.child(0).attrs).toMatchObject({ language: 'python', meta: 'title="x.py" {1,3}' });
    expect(view.state.doc.child(1).attrs).toMatchObject({ language: '{.python', meta: '.numberLines startFrom="10"}' });
    expect(handle.getMarkdown()).toBe(markdown);
  });
});

describe('task items', () => {
  const caretInto = (view: EditorView, itemIndex: number) => {
    const list = view.state.doc.child(0);
    let pos = 1; // inside the list
    for (let i = 0; i < itemIndex; i++) pos += list.child(i).nodeSize;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos + 2))); // inside the paragraph
  };

  test('the DOM carries the state and the Markdown round-trips', async () => {
    const markdown = '- [ ] open\n- [x] done\n- plain\n';
    const { root, handle } = await make(markdown);
    const items = Array.from(root.querySelectorAll('li'));
    expect(items.map(li => li.dataset.checked ?? null)).toEqual(['false', 'true', null]);
    expect(items.map(li => li.dataset.itemType ?? null)).toEqual(['task', 'task', null]);
    expect(root.querySelectorAll('input')).toHaveLength(0);
    expect(handle.getMarkdown()).toBe(markdown);
  });

  test('toggle: plain → open → done → open; clear: back to plain', async () => {
    const { view, handle } = await make('- [ ] open\n- [x] done\n- plain\n');
    caretInto(view, 2);
    expect(listItemAround(view.state)?.checked).toBeNull();
    expect(toggleTask(view.state, view.dispatch)).toBe(true);
    expect(handle.getMarkdown()).toBe('- [ ] open\n- [x] done\n- [ ] plain\n');
    expect(toggleTask(view.state, view.dispatch)).toBe(true);
    expect(handle.getMarkdown()).toBe('- [ ] open\n- [x] done\n- [x] plain\n');
    expect(toggleTask(view.state, view.dispatch)).toBe(true);
    expect(handle.getMarkdown()).toBe('- [ ] open\n- [x] done\n- [ ] plain\n');
    caretInto(view, 1);
    expect(clearTask(view.state, view.dispatch)).toBe(true);
    expect(handle.getMarkdown()).toBe('- [ ] open\n- done\n- [ ] plain\n');
    expect(clearTask(view.state, view.dispatch)).toBe(false); // already plain
  });

  test('outside a list nothing happens', async () => {
    const { view } = await make('just text\n');
    expect(listItemAround(view.state)).toBeNull();
    expect(toggleTask(view.state, view.dispatch)).toBe(false);
    expect(clearTask(view.state, view.dispatch)).toBe(false);
  });

  test('a click on the marker (target: the <li> itself) toggles; a click on the text does not', async () => {
    const { view, handle } = await make('- [ ] open\n- plain\n');
    const list = view.state.doc.child(0);
    const item = list.child(0);
    const itemPos = 1;
    const li = view.nodeDOM(itemPos) as HTMLElement;
    const onMarker = { target: li } as unknown as MouseEvent;
    expect(markerClick(view, itemPos + 1, item, itemPos, onMarker)).toBe(true);
    expect(handle.getMarkdown()).toBe('- [x] open\n- plain\n');
    const onText = { target: li.querySelector('p') } as unknown as MouseEvent;
    expect(markerClick(view, itemPos + 1, view.state.doc.child(0).child(0), itemPos, onText)).toBe(false);
    // a plain item has no marker to click
    const plainPos = itemPos + item.nodeSize;
    const plain = view.state.doc.child(0).child(1);
    expect(markerClick(view, plainPos + 1, plain, plainPos, { target: view.nodeDOM(plainPos) } as unknown as MouseEvent)).toBe(
      false
    );
    expect(handle.getMarkdown()).toBe('- [x] open\n- plain\n');
  });
});
