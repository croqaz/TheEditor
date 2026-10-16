import { describe, expect, test } from 'bun:test';
import { TextSelection } from '@milkdown/kit/prose/state';
import { createEditor } from '../../src/view/editor/create';
import { computeStats } from '../../src/view/stats/engine';

async function make(markdown: string) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const handle = await createEditor(root, markdown, {
    onDocChanged() {},
    onSelectionChanged() {},
  });
  return { root, handle, view: handle.view() };
}

describe('raw HTML', () => {
  test('inline HTML is a mark on text, HTML blocks are textblocks, and both round-trip', async () => {
    const markdown =
      'Raw <kbd>Ctrl</kbd>+<kbd>S</kbd> and <!-- hidden -->.\n\n<div class="x">\n  <p>Block</p>\n</div>\n\n<!-- comment block -->\n';
    const { root, handle, view } = await make(markdown);
    const doc = view.state.doc;
    expect(doc.childCount).toBe(3);
    const marked: string[] = [];
    doc.child(0).forEach(node => {
      if (node.marks.some(m => m.type.name === 'html_inline')) {
        marked.push(node.text ?? '');
      }
    });
    expect(marked).toEqual(['<kbd>', '</kbd>', '<kbd>', '</kbd>', '<!-- hidden -->']);
    expect(doc.child(0).textContent).toBe('Raw <kbd>Ctrl</kbd>+<kbd>S</kbd> and <!-- hidden -->.');
    expect(doc.child(1).type.name).toBe('html_block');
    expect(doc.child(1).textContent).toBe('<div class="x">\n  <p>Block</p>\n</div>');
    expect(doc.child(2).type.name).toBe('html_block');
    expect(doc.child(2).textContent).toBe('<!-- comment block -->');
    expect(handle.getMarkdown()).toBe(markdown);

    expect(root.querySelectorAll('span[data-type="html"]')).toHaveLength(5);
    expect(root.querySelector('span[data-type="html"]')?.textContent).toBe('<kbd>');
    expect(root.querySelectorAll('pre[data-type="html_block"][data-language="html"]')).toHaveLength(2);
    expect(root.querySelector('span[data-type=html]:not(.te-html)')).toBeNull();
    // no inline atoms left anywhere: the caret can enter every character
    expect(doc.nodeSize).toBe(2 + doc.child(0).nodeSize + doc.child(1).nodeSize + doc.child(2).nodeSize);
    doc.descendants(node => {
      expect(node.isInline && !node.isText && node.isAtom).toBe(false);
      return true;
    });
    await handle.destroy();
  });

  test('typing inside inline HTML edits the HTML; a new HTML block keeps its text as one line per source line', async () => {
    const { handle, view } = await make('a <b>x</b> z\n');
    const pos = 1 + 'a <b'.length;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)));
    view.dispatch(view.state.tr.insertText('r'));
    expect(handle.getMarkdown()).toBe('a <br>x</b> z\n');
    // text typed right after the closing tag is plain prose (the mark is not inclusive)
    const after = 1 + 'a <br>x</b>'.length;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, after)));
    const marks = view.state.storedMarks ?? view.state.selection.$from.marks();
    expect(marks.some(m => m.type.name === 'html_inline')).toBe(false);

    handle.setMarkdown('<section>\nline two\n</section>\n');
    const block = handle.view().state.doc.firstChild!;
    expect(block.type.name).toBe('html_block');
    expect(block.textContent.split('\n')).toEqual(['<section>', 'line two', '</section>']);
    expect(handle.getMarkdown()).toBe('<section>\nline two\n</section>\n');
    await handle.destroy();
  });

  test('statistics count an HTML block as a code block, not a paragraph', async () => {
    const { view, handle } = await make('one two three\n\n<div>\n  <p>four five six seven</p>\n</div>\n');
    const stats = computeStats(view, 0, { lang: 'en', wpm: 240 });
    expect(stats.paragraphs).toBe(1);
    expect(stats.codeBlocks).toBe(1);
    await handle.destroy();
  });
});
