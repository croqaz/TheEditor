// Raw HTML as editable text. Milkdown's preset renders every mdast `html`
// node as an inline atom (a span the caret cannot enter), which also puts
// HTML *blocks* inside paragraphs. Here the same mdast node becomes either
//
//   - an `html_inline` mark on plain text when it appears inside a textblock
//     (the design Milkdown uses for inline code), or
//   - an `html_block` textblock (`code: true`, like code_block) at flow level,
//
// so the caret, selection and typing work in HTML exactly as in prose and
// code. Rendering the HTML itself is a separate, later feature.
import { $markSchema, $nodeSchema } from '@milkdown/kit/utils';

export const htmlInlineSchema = $markSchema('html_inline', () => ({
  code: true,
  inclusive: false,
  excludes: '_',
  parseDOM: [{ tag: 'span[data-type="html"]' }],
  toDOM: () => ['span', { 'data-type': 'html', class: 'te-html' }],
  // mdast `html` nodes are routed by htmlBlockSchema below, which knows the parse context.
  parseMarkdown: { match: () => false, runner: () => {} },
  toMarkdown: {
    match: mark => mark.type.name === 'html_inline',
    runner: (state, mark, node) => {
      state.withMark(mark, 'html', node.text ?? '');
      return true;
    },
  },
}));

export const htmlBlockSchema = $nodeSchema('html_block', ctx => ({
  content: 'text*',
  group: 'block',
  marks: '',
  code: true,
  defining: true,
  parseDOM: [
    {
      tag: 'pre[data-type="html_block"]',
      preserveWhitespace: 'full' as const,
    },
  ],
  toDOM: () => [
    'pre',
    {
      'data-type': 'html_block',
      'data-language': 'html',
      class: 'te-html-block',
    },
    ['code', {}, 0],
  ],
  parseMarkdown: {
    match: ({ type }) => type === 'html',
    runner: (state, node, type) => {
      const value = ((node as { value?: string }).value ?? '').toString();
      // Inside a paragraph (or any textblock) the HTML is phrasing content: a marked text run.
      if (state.top()?.type.isTextblock) {
        const mark = htmlInlineSchema.type(ctx);
        state.openMark(mark);
        state.addText(value);
        state.closeMark(mark);
        return;
      }
      state.openNode(type);
      if (value) state.addText(value);
      state.closeNode();
    },
  },
  toMarkdown: {
    match: node => node.type.name === 'html_block',
    runner: (state, node) => {
      state.addNode('html', undefined, node.textContent);
    },
  },
}));

export const html = [htmlInlineSchema, htmlBlockSchema].flat();
