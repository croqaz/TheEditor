// Bare URLs stay bare. GFM autolink literals (`https://…`, `www.…`, an e-mail
// address) are ordinary `link` nodes in mdast, and mdast-util-to-markdown can
// only write a link as `<url>` or `[text](url)`, so a save rewrote every one of
// them. The link mark gets a `literal` attribute, set when the node's source
// span is exactly its text (`<url>` and `[t](u)` are longer and keep their
// form); literals serialize through an mdast node of our own whose
// remark-stringify handler returns the text verbatim. Plain `text` cannot do
// that: the serializer would escape it back into `www\.example.com`.
import { linkSchema } from '@milkdown/kit/preset/commonmark';

export const AUTOLINK_LITERAL = 'autolinkLiteral';

interface MdNode {
  type: string;
  value?: unknown;
  children?: MdNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
}

/** True when the link's source text is exactly its visible text: no brackets, no angle brackets. */
export function isAutolinkLiteral(node: MdNode): boolean {
  const only = node.children?.length === 1 ? node.children[0] : undefined;
  if (!only || only.type !== 'text' || typeof only.value !== 'string') return false;
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start == null || end == null) return false;
  return end - start === only.value.length;
}

export const linkWithLiterals = linkSchema.extendSchema(prev => ctx => {
  const base = prev(ctx);
  return {
    ...base,
    attrs: { ...base.attrs, literal: { default: false, validate: 'boolean' } },
    parseMarkdown: {
      match: base.parseMarkdown.match,
      runner: (state, node, markType) => {
        state.openMark(markType, {
          href: node.url as string,
          title: (node.title as string | null | undefined) ?? null,
          literal: isAutolinkLiteral(node as MdNode),
        });
        state.next(node.children);
        state.closeMark(markType);
      },
    },
    toMarkdown: {
      match: base.toMarkdown.match,
      runner: (state, mark, node) => {
        if (!mark.attrs.literal) return base.toMarkdown.runner(state, mark, node);
        state.withMark(mark, AUTOLINK_LITERAL, node.text ?? '');
        return true;
      },
    },
  };
});

/** remark-stringify handler for the literal node: the text as the file had it. */
export const autolinkLiteralHandler = (node: { value: string }): string => node.value;
