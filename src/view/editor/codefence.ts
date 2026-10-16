// Fenced code keeps its whole info string. Milkdown's code_block stores the
// language only (mdast `lang`, the first word) and dropped the rest (`meta`:
// ```python title="x", Pandoc's ```{.python .numberLines startFrom="10"}), so a
// save lost it. The extended schema carries `meta` as a second attribute and
// writes it back after the language.
import { codeBlockSchema } from '@milkdown/kit/preset/commonmark';

export const codeBlockWithMeta = codeBlockSchema.extendSchema(prev => ctx => {
  const base = prev(ctx);
  return {
    ...base,
    attrs: { ...base.attrs, meta: { default: '', validate: 'string' } },
    parseMarkdown: {
      match: base.parseMarkdown.match,
      runner: (state, node, type) => {
        state.openNode(type, {
          language: (node.lang as string | null | undefined) ?? '',
          meta: (node.meta as string | null | undefined) ?? '',
        });
        const value = node.value as string | null | undefined;
        if (value) state.addText(value);
        state.closeNode();
      },
    },
    toMarkdown: {
      match: base.toMarkdown.match,
      runner: (state, node) => {
        state.addNode('code', undefined, node.textContent, {
          lang: node.attrs.language,
          meta: node.attrs.meta || undefined,
        });
      },
    },
  };
});
