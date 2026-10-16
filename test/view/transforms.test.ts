import { describe, expect, test } from 'bun:test';
import { TextSelection } from '@milkdown/kit/prose/state';
import { createEditor } from '../../src/view/editor/create';
import {
  lineOps,
  selectedTopLevelBlocks,
  textOps,
  transformSelectedLines,
  transformSelectionText,
} from '../../src/view/editor/transforms';

async function make(markdown: string) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const handle = await createEditor(root, markdown, {
    onDocChanged() {},
    onSelectionChanged() {},
  });
  const view = handle.view();
  const selectAll = () =>
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, view.state.doc.content.size - 1)));
  const select = (from: number, to: number) =>
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));
  return { handle, view, selectAll, select };
}

describe('textOps', () => {
  test('case transforms', () => {
    expect(textOps.lower('Hello World')).toBe('hello world');
    expect(textOps.upper('Hello World')).toBe('HELLO WORLD');
    expect(textOps.title("the quick BROWN fox's tale")).toBe("The Quick Brown Fox's Tale");
    expect(textOps.sentence('hello world. how ARE you? fine! ok')).toBe('Hello world. How are you? Fine! Ok');
    expect(textOps.trimTrailing('a  \nb\t\nc')).toBe('a\nb\nc');
  });
});

describe('lineOps', () => {
  test('sort, unique, reverse, shuffle', () => {
    const lines = ['b', 'a10', 'a2', 'b', 'C'];
    expect(lineOps.sort()(lines)).toEqual(['a2', 'a10', 'b', 'b', 'C']);
    expect(lineOps.sort(true)(lines)).toEqual(['C', 'b', 'b', 'a10', 'a2']);
    expect(lineOps.unique()(lines)).toEqual(['b', 'a10', 'a2', 'C']);
    expect(lineOps.reverse()(lines)).toEqual(['C', 'b', 'a2', 'a10', 'b']);
    const shuffled = lineOps.shuffle(42)(lines);
    expect([...shuffled].sort()).toEqual([...lines].sort());
    expect(lineOps.shuffle(42)(lines)).toEqual(shuffled);
  });
});

describe('transformSelectionText', () => {
  test('transforms the selected text across inline marks', async () => {
    const { handle, view, select } = await make('Hello *brave* new World\n');
    select(1, view.state.doc.content.size - 1);
    expect(transformSelectionText(view, textOps.upper)).toBeGreaterThan(0);
    expect(handle.getMarkdown()).toBe('HELLO *BRAVE* NEW WORLD\n');
    await handle.destroy();
  });

  test('with a caret, transforms the word under it; nothing on whitespace', async () => {
    const { handle, view, select } = await make('alpha beta  gamma\n');
    select(8, 8); // inside "beta"
    expect(transformSelectionText(view, textOps.upper)).toBe(1);
    expect(handle.getMarkdown()).toBe('alpha BETA  gamma\n');
    select(12, 12); // between the two spaces after BETA
    expect(transformSelectionText(view, textOps.upper)).toBe(0);
    select(8, 8);
    expect(transformSelectionText(view, s => s)).toBe(0);
    await handle.destroy();
  });
});

describe('transformSelectedLines', () => {
  test('sorts whole blocks when several are selected', async () => {
    const { handle, view, selectAll } = await make('banana\n\napple\n\n# cherry\n\napple\n');
    selectAll();
    const blocks = selectedTopLevelBlocks(view.state);
    expect(blocks.nodes.length).toBeGreaterThanOrEqual(4);
    expect(transformSelectedLines(view, lineOps.sort())).toBe(blocks.nodes.length);
    expect(handle.getMarkdown()).toBe('apple\n\napple\n\nbanana\n\n# cherry\n');
    selectAll();
    transformSelectedLines(view, lineOps.unique());
    expect(handle.getMarkdown()).toBe('apple\n\nbanana\n\n# cherry\n');
    selectAll();
    transformSelectedLines(view, lineOps.reverse());
    expect(handle.getMarkdown()).toBe('# cherry\n\nbanana\n\napple\n');
    await handle.destroy();
  });

  test('sorts the hard-broken lines of a single paragraph', async () => {
    const { handle, view, select } = await make('zeta\\\nalpha\\\nmid\n');
    select(3, 3);
    const { nodes } = selectedTopLevelBlocks(view.state);
    expect(nodes).toHaveLength(1);
    expect(transformSelectedLines(view, lineOps.sort())).toBe(3);
    expect(handle.getMarkdown()).toBe('alpha\\\nmid\\\nzeta\n');
    await handle.destroy();
  });

  test('caret in a block selects that block; empty op leaves the doc alone', async () => {
    const { handle, view, select } = await make('one\n\ntwo\n');
    select(7, 7);
    const { nodes, from, to } = selectedTopLevelBlocks(view.state);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.textContent).toBe('two');
    expect(to - from).toBe(nodes[0]!.nodeSize);
    expect(transformSelectedLines(view, () => [])).toBe(0);
    expect(handle.getMarkdown()).toBe('one\n\ntwo\n');
    await handle.destroy();
  });
});
