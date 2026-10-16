import { describe, expect, test } from 'bun:test';
import { TextSelection } from '@milkdown/kit/prose/state';
import { handlePaneMouseDown, placeCaretFromOutsideClick } from '../../src/view/editor/caret';
import { createEditor } from '../../src/view/editor/create';

// tests/setup.ts gives every element the box {top 0, bottom 20, left 0, right 100}.
async function make(markdown = 'first paragraph\n\nsecond paragraph\n') {
  const pane = document.createElement('div');
  const inner = document.createElement('div');
  pane.appendChild(inner);
  document.body.appendChild(pane);
  const handle = await createEditor(inner, markdown, {
    onDocChanged() {},
    onSelectionChanged() {},
  });
  const view = handle.view();
  const end = view.state.doc.content.size - 1;
  return { pane, handle, view, end };
}

describe('placeCaretFromOutsideClick', () => {
  test('below the text goes to the very end, above to the start', async () => {
    const { handle, view, end } = await make();
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 3)));
    expect(placeCaretFromOutsideClick(view, { x: 50, y: 500 })).toBe('end');
    expect(view.state.selection.from).toBe(end);
    expect(view.state.selection.empty).toBe(true);
    expect(placeCaretFromOutsideClick(view, { x: 50, y: -40 })).toBe('start');
    expect(view.state.selection.from).toBe(1);
    await handle.destroy();
  });

  test('beside the column uses the line at that height, with x clamped into the text box', async () => {
    const { handle, view } = await make();
    const asked: { left: number; top: number }[] = [];
    view.posAtCoords = coords => {
      asked.push(coords);
      return { pos: 7, inside: 1 };
    };
    expect(placeCaretFromOutsideClick(view, { x: -300, y: 10 })).toBe('line');
    expect(view.state.selection.from).toBe(7);
    expect(asked[0]).toEqual({ left: 1, top: 10 });
    expect(placeCaretFromOutsideClick(view, { x: 900, y: 12 })).toBe('line');
    expect(asked[1]).toEqual({ left: 99, top: 12 });
    await handle.destroy();
  });

  test('falls back to the end when no position is found, and never dispatches a no-op', async () => {
    const { handle, view, end } = await make();
    view.posAtCoords = () => null;
    let dispatches = 0;
    const original = view.dispatch.bind(view);
    view.dispatch = tr => {
      dispatches++;
      original(tr);
    };
    expect(placeCaretFromOutsideClick(view, { x: 50, y: 10 })).toBe('end');
    expect(view.state.selection.from).toBe(end);
    expect(dispatches).toBe(1);
    expect(placeCaretFromOutsideClick(view, { x: 50, y: 10 })).toBe('end');
    expect(dispatches).toBe(1); // already there
    await handle.destroy();
  });
});

describe('handlePaneMouseDown', () => {
  test('clicks outside the text are claimed and place the caret; inside and non-primary clicks are ignored', async () => {
    const { pane, handle, view, end } = await make();
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)));

    const outside = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: 40,
      clientY: 400,
    });
    pane.dispatchEvent(outside);
    expect(outside.defaultPrevented).toBe(false); // nothing listens on this bare pane yet
    expect(handlePaneMouseDown(view, outside)).toBe('end');
    expect(outside.defaultPrevented).toBe(true);
    expect(view.state.selection.from).toBe(end);

    const inside = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: 5,
      clientY: 5,
    });
    view.dom.firstElementChild!.dispatchEvent(inside);
    expect(handlePaneMouseDown(view, inside)).toBeNull();

    const right = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      button: 2,
      clientX: 40,
      clientY: 400,
    });
    pane.dispatchEvent(right);
    expect(handlePaneMouseDown(view, right)).toBeNull();
    expect(right.defaultPrevented).toBe(false);
    await handle.destroy();
  });
});
