import { describe, expect, test } from 'bun:test';
import { TextSelection } from '@milkdown/kit/prose/state';
import { createEditor } from '../../src/view/editor/create';
import { computeStats, cursorPosition, positionAt } from '../../src/view/stats/engine';

const MARKDOWN = `---
title: Stats
---

# Title

First paragraph with five words.

- item one
- item two

> quoted text

\`\`\`js
code();
\`\`\`

![alt](img.png)

Second paragraph.
`;

describe('stats engine', () => {
  test('counts kinds, words, bytes and caches per node', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const handle = await createEditor(root, MARKDOWN, {
      onDocChanged() {},
      onSelectionChanged() {},
    });
    const view = handle.view();
    const stats = computeStats(view, 321, { lang: 'en', wpm: 200 });
    expect(stats.headings).toBe(1);
    expect(stats.paragraphs).toBe(2);
    expect(stats.lists).toBe(1);
    expect(stats.quotes).toBe(1);
    expect(stats.codeBlocks).toBe(1);
    expect(stats.images).toBe(1);
    expect(stats.bytes).toBe(321);
    // Title(1) + first paragraph(5) + list items(4, not glued together) + quote(2) + code(1) + second paragraph(2)
    expect(stats.words).toBe(15);
    expect(stats.readMinutes).toBeCloseTo(15 / 200, 6);
    expect(stats.selection).toBeUndefined();

    // a text selection adds selection stats; the cache keeps totals stable
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2, 7)));
    const withSelection = computeStats(view, 321, { lang: 'en', wpm: 200 });
    expect(withSelection.words).toBe(15);
    expect(withSelection.selection?.chars).toBe(5);
    await handle.destroy();
  });

  test('cursor position counts lines across blocks and columns within a line', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const handle = await createEditor(root, 'first\n\nsecond line\\\nthird\n', {
      onDocChanged() {},
      onSelectionChanged() {},
    });
    const view = handle.view();
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 3)));
    expect(cursorPosition(view)).toEqual({ line: 1, column: 3 });
    // inside "third": paragraph 2 starts after "first" (1 line + blank), then "second line" is line 3, "third" line 4
    const secondStart = view.state.doc.firstChild!.nodeSize + 1;
    const pos = secondStart + 'second line'.length + 1 + 2; // hard break + 2 chars
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)));
    expect(cursorPosition(view)).toEqual({ line: 4, column: 3 });
    await handle.destroy();
  });

  test('positionAt is the inverse of cursorPosition across front matter, lists, hard breaks and code', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const markdown =
      '---\nk: v\n---\n\n# Title\n\n- one\n- two\n\nsecond line\\\nthird\n\n```\ncode a\ncode b\n```\n\nlast\n';
    const handle = await createEditor(root, markdown, {
      onDocChanged() {},
      onSelectionChanged() {},
    });
    const view = handle.view();
    const doc = view.state.doc;
    const go = (line: number, column?: number) => {
      const pos = positionAt(doc, line, column);
      view.dispatch(view.state.tr.setSelection(TextSelection.near(doc.resolve(pos))));
      return cursorPosition(view);
    };
    // Source lines: 1 `---`, 2 `k: v`, 3 `---`, 4 blank, 5 `# Title`, 6 blank, 7-8 the list, 9 blank,
    // 10-11 the paragraph with its hard break, 12 blank, 13-14 the code, 15 blank, 16 `last`.
    expect(go(1)).toEqual({ line: 2, column: 1 }); // the opening fence has no text: first YAML line
    expect(go(2, 3)).toEqual({ line: 2, column: 3 });
    expect(go(3)).toEqual({ line: 2, column: 5 }); // closing fence → end of the YAML
    expect(go(4)).toEqual({ line: 2, column: 5 });
    expect(go(5, 3)).toEqual({ line: 5, column: 3 }); // "Title"
    expect(go(5, 99)).toEqual({ line: 5, column: 6 }); // clamped to the line end
    expect(go(6)).toEqual({ line: 5, column: 6 }); // the blank line after a block → end of the block
    expect(go(7, 2)).toEqual({ line: 7, column: 2 }); // "one"
    expect(go(8, 4)).toEqual({ line: 8, column: 4 }); // "two"
    expect(go(10, 3)).toEqual({ line: 10, column: 3 }); // "second line"
    expect(go(11, 2)).toEqual({ line: 11, column: 2 }); // "third", after the hard break
    expect(go(13, 1)).toEqual({ line: 13, column: 1 }); // "code a"
    expect(go(14, 7)).toEqual({ line: 14, column: 7 }); // end of "code b"
    expect(go(16, 2)).toEqual({ line: 16, column: 2 }); // "last"
    expect(go(999)).toEqual({ line: 16, column: 5 }); // past the end
    expect(go(0, 0)).toEqual({ line: 2, column: 1 }); // clamped at the start
    // every text position round-trips
    doc.descendants((node, pos) => {
      if (!node.isTextblock) return true;
      for (let offset = 0; offset <= node.content.size; offset++) {
        view.dispatch(view.state.tr.setSelection(TextSelection.create(doc, pos + 1 + offset)));
        const here = cursorPosition(view);
        expect(positionAt(doc, here.line, here.column)).toBe(pos + 1 + offset);
      }
      return false;
    });
    await handle.destroy();
  });
});
