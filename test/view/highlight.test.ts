// Syntax colours through Milkdown's highlight plugin with lowlight: inline
// decorations only, so the text and the Markdown never change.
import { describe, expect, spyOn, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createEditor } from '../../src/view/editor/create';
import { HIGHLIGHT_NODE_TYPES, languageOf, lowlight, parser } from '../../src/view/editor/highlight';

async function make(markdown: string) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const handle = await createEditor(root, markdown, {
    onDocChanged() {},
    onSelectionChanged() {},
  });
  return { root, handle, view: handle.view() };
}

const classesIn = (el: Element | null) =>
  Array.from(el?.querySelectorAll('[class*="hljs-"]') ?? []).map(span => span.className);

describe('languageOf', () => {
  test('code blocks use their info string when lowlight knows it, aliases and case included', async () => {
    const { view } = await make('```JS\nlet a = 1\n```\n\n```nothing-like-this\nx\n```\n\n```\nplain\n```\n');
    const doc = view.state.doc;
    expect(languageOf(doc.child(0))).toBe('js');
    expect(languageOf(doc.child(1))).toBeUndefined();
    expect(languageOf(doc.child(2))).toBeUndefined();
  });

  test('HTML blocks are xml, the front-matter is yaml', async () => {
    const { view } = await make('---\ntitle: x\n---\n\n<div>\n</div>\n');
    expect(languageOf(view.state.doc.child(0))).toBe('yaml');
    expect(languageOf(view.state.doc.child(1))).toBe('xml');
    expect(HIGHLIGHT_NODE_TYPES).toEqual(['code_block', 'html_block', 'frontmatter']);
  });

  test('the parser leaves a block without a grammar plain instead of guessing', () => {
    expect(parser({ content: 'const a = 1', language: undefined, pos: 0, size: 13 })).toEqual([]);
    const decorations = parser({ content: 'const a = 1', language: 'js', pos: 0, size: 13 });
    expect(Array.isArray(decorations) && decorations.length > 0).toBe(true);
    expect(lowlight.registered('html')).toBe(true);
    expect(lowlight.registered('nothing-like-this')).toBe(false);
  });

  test('nested tokens become one decoration per text leaf, in order and inside the block', () => {
    const content = '<a href="x">t</a>';
    const pos = 10; // the block starts here; its text starts one position later
    const decorations = parser({ content, language: 'xml', pos, size: content.length + 2 });
    if (!Array.isArray(decorations)) throw new Error('expected decorations');
    const classes = decorations.map(d => (d.spec as { class?: string }).class ?? (d as unknown as { type: { attrs: { class: string } } }).type.attrs.class);
    expect(classes).toEqual(['hljs-tag', 'hljs-name', 'hljs-tag', 'hljs-attr', 'hljs-tag', 'hljs-string', 'hljs-tag', 'hljs-tag', 'hljs-name', 'hljs-tag']);
    let last = pos + 1;
    for (const d of decorations) {
      expect(d.from).toBeGreaterThanOrEqual(last);
      expect(d.to).toBeGreaterThan(d.from);
      last = d.to;
    }
    expect(last).toBe(pos + 1 + content.length); // the plain text leaf "t" in the middle has no decoration
  });
});

describe('highlighting in the editor', () => {
  test('fenced code is coloured by class; the text and the Markdown are untouched', async () => {
    const markdown = '```js\nconst greeting = "hi" // note\n```\n';
    const { root, handle } = await make(markdown);
    const pre = root.querySelector('pre');
    const classes = classesIn(pre);
    expect(classes).toContain('hljs-keyword');
    expect(classes).toContain('hljs-string');
    expect(classes).toContain('hljs-comment');
    expect(pre?.textContent).toBe('const greeting = "hi" // note');
    expect(handle.getMarkdown()).toBe(markdown);
  });

  test('HTML blocks and the front-matter are coloured too', async () => {
    const markdown = '---\ntitle: Hello\ncount: 3\n---\n\n<div class="x">\n</div>\n';
    const { root, handle } = await make(markdown);
    const yaml = classesIn(root.querySelector('.te-frontmatter__yaml'));
    expect(yaml).toContain('hljs-attr');
    expect(yaml).toContain('hljs-number');
    const html = classesIn(root.querySelector('pre.te-html-block'));
    for (const token of ['hljs-tag', 'hljs-name', 'hljs-attr', 'hljs-string']) expect(html).toContain(token);
    expect(root.querySelector('pre.te-html-block')?.textContent).toBe('<div class="x">\n</div>');
    expect(handle.getMarkdown()).toBe(markdown);
  });

  test('unknown or missing languages stay plain, without errors', async () => {
    const errors = spyOn(console, 'error');
    errors.mockClear();
    const { root } = await make('```nothing-like-this\nconst a = 1\n```\n\n```\nconst b = 2\n```\n');
    expect(classesIn(root)).toEqual([]);
    expect(root.querySelectorAll('pre')).toHaveLength(2);
    expect(errors).not.toHaveBeenCalled();
  });

  test('editing a code block updates its colours', async () => {
    const { root, view } = await make('```js\nlet a\n```\n');
    const keywords = () => classesIn(root).filter(c => c === 'hljs-keyword').length;
    expect(keywords()).toBe(1);
    const end = view.state.doc.child(0).nodeSize - 1; // after the last character of the code
    view.dispatch(view.state.tr.insertText('\nreturn a', end));
    expect(keywords()).toBe(2);
  });

  test(
    'the 2 MB book: every code block is coloured and a keystroke stays cheap',
    async () => {
      const book = readFileSync(join(import.meta.dirname, '..', 'gold', '04-stress-book.md'), 'utf8');
      const t0 = performance.now();
      const { root, view } = await make(book);
      const created = performance.now() - t0;
      const codeBlocks: { content: string; pos: number; size: number }[] = [];
      view.state.doc.forEach((node, pos) => {
        if (node.type.name === 'code_block') codeBlocks.push({ content: node.textContent, pos, size: node.nodeSize });
      });
      expect(codeBlocks.length).toBeGreaterThan(100);
      expect(root.querySelectorAll('pre .hljs-keyword').length).toBeGreaterThan(codeBlocks.length);
      // What the plugin costs: parsing every block once (editor creation) and, per keystroke,
      // one walk over the document to find the blocks plus the state transition itself.
      const t1 = performance.now();
      for (const block of codeBlocks) parser({ ...block, language: 'js' });
      const parsed = performance.now() - t1;
      const t2 = performance.now();
      view.state.doc.descendants(() => true);
      const walk = performance.now() - t2;
      const t3 = performance.now();
      const next = view.state.apply(view.state.tr.insertText('x', 2));
      const keystroke = performance.now() - t3;
      expect(next.doc.textContent.length).toBe(view.state.doc.textContent.length + 1);
      console.info(
        `stress book: editor ${Math.round(created)} ms, ${codeBlocks.length} code blocks parsed in ${parsed.toFixed(1)} ms, ` +
          `document walk ${walk.toFixed(1)} ms, keystroke ${keystroke.toFixed(1)} ms`
      );
      expect(parsed).toBeLessThan(2000);
      expect(keystroke).toBeLessThan(250);
    },
    30_000
  );
});
