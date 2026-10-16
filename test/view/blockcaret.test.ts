import { describe, expect, test } from 'bun:test';
import { NodeSelection, TextSelection } from '@milkdown/kit/prose/state';
import {
  blockCaretView,
  caretBox,
  caretHost,
  cellWidth,
  isOverwrite,
  overwriteTextInput,
  setOverwrite,
} from '../../src/view/editor/blockcaret';
import { createEditor } from '../../src/view/editor/create';

// tests/setup.ts gives every element and range the box {0,0,100,20}.

async function makeEditor(markdown = '# Title\n\nSome text here.\n') {
  const pane = document.createElement('div');
  pane.className = 'te-pane';
  const inner = document.createElement('div');
  pane.appendChild(inner);
  document.body.appendChild(pane);
  const handle = await createEditor(inner, markdown, {
    onDocChanged() {},
    onSelectionChanged() {},
  });
  return { pane, handle, view: handle.view() };
}

describe('caretBox', () => {
  test('covers the character after the head, spans the line box and reports the text style', async () => {
    const { pane, view, handle } = await makeEditor('---\nk: v\n---\n\n# Title\n\nSome text here.\n');
    const paragraph = view.state.doc.child(2);
    const start = view.state.doc.child(0).nodeSize + view.state.doc.child(1).nodeSize + 1; // inside the paragraph
    expect(paragraph.type.name).toBe('paragraph');
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, start)));
    const box = caretBox(view, pane)!;
    expect(box).not.toBeNull();
    expect(box.char).toBe('S');
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBe(20);
    expect(box.left).toBe(0);
    expect(box.top).toBe(0);
    expect(typeof box.font).toBe('string');

    // at the end of the block there is no character under the block
    const end = start + paragraph.content.size;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, end)));
    expect(caretBox(view, pane)!.char).toBe('');

    // a range selection and a node selection draw nothing
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, start, start + 4)));
    expect(caretBox(view, pane)).toBeNull();
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, 0)));
    expect(caretBox(view, pane)).toBeNull();
    await handle.destroy();
  });

  test('scroll offsets move the box into document coordinates', async () => {
    const { pane, view, handle } = await makeEditor();
    Object.defineProperty(pane, 'scrollTop', { value: 300, writable: true });
    Object.defineProperty(pane, 'scrollLeft', { value: 7, writable: true });
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)));
    const box = caretBox(view, pane)!;
    expect(box.top).toBe(300);
    expect(box.left).toBe(7);
    await handle.destroy();
  });

  test('cellWidth falls back to six tenths of the font size when nothing can be measured', async () => {
    const { view, handle } = await makeEditor();
    const width = cellWidth(view, 1);
    expect(width).toBeGreaterThan(0);
    expect(cellWidth(view, 1)).toBe(width); // cached per font string
    await handle.destroy();
  });
});

describe('block caret plugin', () => {
  test('appends .te-caret to the pane, shows it only while focused with a collapsed selection, and cleans up', async () => {
    const { pane, view, handle } = await makeEditor();
    const el = pane.querySelector<HTMLElement>('.te-caret')!;
    expect(el).not.toBeNull();
    expect(el.hidden).toBe(true); // not focused

    view.hasFocus = () => true;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)));
    expect(el.hidden).toBe(false);
    expect(el.textContent).toBe('T');
    expect(el.style.width).not.toBe('');
    expect(el.style.height).toBe('20px');
    expect(el.style.lineHeight).toBe('20px');

    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 3)));
    expect(el.hidden).toBe(true);

    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)));
    expect(el.hidden).toBe(false);
    view.hasFocus = () => false;
    view.dom.dispatchEvent(new Event('blur'));
    expect(el.hidden).toBe(true);
    view.hasFocus = () => true;
    view.dom.dispatchEvent(new Event('focus'));
    expect(el.hidden).toBe(false);

    await handle.destroy();
    expect(pane.querySelector('.te-caret')).toBeNull();
  });

  test('overwrite mode: Insert toggles it, typing replaces the next character, the caret fills', async () => {
    const { pane, view, handle } = await makeEditor('abc\n');
    const el = pane.querySelector<HTMLElement>('.te-caret')!;
    view.hasFocus = () => true;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)));
    expect(isOverwrite(view.state)).toBe(false);
    expect(el.classList.contains('te-caret--full')).toBe(false);
    expect(overwriteTextInput(view, 1, 1, 'X')).toBe(false); // inserting: ProseMirror handles the input

    const announced: boolean[] = [];
    const listener = (event: Event) => announced.push((event as CustomEvent<boolean>).detail);
    document.addEventListener('te:overwrite', listener);
    const keydown = (init: KeyboardEventInit) =>
      view.someProp('handleKeyDown', f =>
        f(
          view,
          new KeyboardEvent('keydown', {
            bubbles: true,
            cancelable: true,
            ...init,
          })
        )
      );
    expect(keydown({ key: 'Insert', shiftKey: true })).toBeFalsy(); // Shift+Insert pastes; not ours
    expect(keydown({ key: 'Insert' })).toBe(true);
    document.removeEventListener('te:overwrite', listener);
    expect(announced).toEqual([true]);
    expect(isOverwrite(view.state)).toBe(true);
    expect(el.classList.contains('te-caret--full')).toBe(true);

    expect(overwriteTextInput(view, 1, 1, 'X')).toBe(true);
    expect(view.state.doc.textContent).toBe('Xbc');
    expect(view.state.selection.from).toBe(2);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 4)));
    expect(overwriteTextInput(view, 4, 4, 'Y')).toBe(false); // nothing after the caret: insert
    expect(overwriteTextInput(view, 1, 3, 'Z')).toBe(false); // a range is replaced the normal way

    view.dispatch(setOverwrite(view.state, false));
    expect(isOverwrite(view.state)).toBe(false);
    expect(el.classList.contains('te-caret--full')).toBe(false);
    await handle.destroy();
  });

  test('a gap cursor between blocks gets a block too, a node selection does not', async () => {
    const { pane, view, handle } = await makeEditor('a\n\n---\n\nb\n');
    const { GapCursor } = await import('@milkdown/kit/prose/gapcursor');
    const hr = view.state.doc.child(1);
    expect(hr.type.name).toBe('hr');
    const before = view.state.doc.child(0).nodeSize;
    view.dispatch(view.state.tr.setSelection(new GapCursor(view.state.doc.resolve(before))));
    const box = caretBox(view, pane)!;
    expect(box).not.toBeNull();
    expect(box.char).toBe('');
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, before)));
    expect(caretBox(view, pane)).toBeNull();
    await handle.destroy();
  });

  test('the caret works inside front-matter and HTML text like anywhere else', async () => {
    const { pane, view, handle } = await makeEditor('---\nk: v\n---\n\n<div>\nx\n</div>\n\npara <b>t</b>\n');
    view.hasFocus = () => true;
    const el = pane.querySelector<HTMLElement>('.te-caret')!;
    // front-matter: position 1 is before "k"
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)));
    expect(el.hidden).toBe(false);
    expect(caretBox(view, pane)!.char).toBe('k');
    // html block: first character "<"
    const htmlStart = view.state.doc.child(0).nodeSize + 1;
    expect(view.state.doc.child(1).type.name).toBe('html_block');
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, htmlStart)));
    expect(caretBox(view, pane)!.char).toBe('<');
    // inline html inside the paragraph
    const paraStart = htmlStart - 1 + view.state.doc.child(1).nodeSize + 1;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, paraStart + 'para <'.length)));
    expect(caretBox(view, pane)!.char).toBe('b');
    expect(el.hidden).toBe(false);
    await handle.destroy();
  });

  test('outside the app shell the overlay goes next to the editor', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const handle = await createEditor(root, 'x\n', {
      onDocChanged() {},
      onSelectionChanged() {},
    });
    const view = handle.view();
    expect(caretHost(view)).toBe(view.dom.parentElement!);
    expect(view.dom.parentElement!.querySelector('.te-caret')).not.toBeNull();
    const plugin = blockCaretView(view);
    expect(view.dom.parentElement!.querySelectorAll('.te-caret')).toHaveLength(2);
    plugin.destroy();
    expect(view.dom.parentElement!.querySelectorAll('.te-caret')).toHaveLength(1);
    await handle.destroy();
  });
});
