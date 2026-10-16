// Syntax colours for fenced code, raw HTML blocks and the YAML front-matter.
//
// Milkdown's own highlight plugin (`@milkdown/plugin-highlight`, a thin wrapper
// over `prosemirror-highlight`) colours the text of chosen textblocks with
// inline decorations: the document is untouched, so the Markdown round-trips
// exactly as before. The grammars come from lowlight (highlight.js), which
// runs offline and emits class names only (`hljs-keyword`, …); editor.css maps
// those to the theme's `syn-*` colours.
import type { Ctx } from '@milkdown/kit/ctx';
import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import { Decoration } from '@milkdown/kit/prose/view';
import { highlight as highlightPlugin, highlightPluginConfig } from '@milkdown/plugin-highlight';
import type { Parser } from '@milkdown/plugin-highlight/lowlight';
import { common, createLowlight } from 'lowlight';

/** highlight.js's "common" grammars: 37 languages with their aliases (js, ts, sh, html, yml, …). */
export const lowlight = createLowlight(common);

/** Textblocks whose text is coloured; `languageOf` picks the grammar for each. */
export const HIGHLIGHT_NODE_TYPES = ['code_block', 'html_block', 'frontmatter'];

/** Grammar for a highlighted node, or undefined when its text stays plain. */
export function languageOf(node: ProseNode): string | undefined {
  switch (node.type.name) {
    case 'html_block':
      return 'xml'; // highlight.js's HTML grammar
    case 'frontmatter':
      return 'yaml';
    default: {
      const language = String(node.attrs.language ?? '')
        .trim()
        .toLowerCase();
      return language && lowlight.registered(language) ? language : undefined;
    }
  }
}

/** The part of a hast tree the flattening below reads. */
interface HastNode {
  type: string;
  value?: string;
  properties?: { className?: unknown };
  children?: HastNode[];
}

function classOf(node: HastNode): string | undefined {
  const names = node.properties?.className;
  return Array.isArray(names) && names.length ? names.join(' ') : undefined;
}

/**
 * One inline decoration per text leaf, carrying the classes of its nearest
 * element. highlight.js nests tokens (`name`, `attr` and `string` inside `tag`,
 * `subst` inside `string`); prosemirror-highlight's own lowlight adapter keeps
 * the outer level only, which would leave HTML tags as a single token.
 */
function decorate(out: Decoration[], node: HastNode, from: number, className: string | undefined): number {
  for (const child of node.children ?? []) {
    if (child.type === 'text') {
      const to = from + (child.value ?? '').length;
      if (className && to > from) out.push(Decoration.inline(from, to, { class: className }));
      from = to;
    } else if (child.type === 'element') {
      from = decorate(out, child, from, classOf(child) ?? className);
    }
  }
  return from;
}

/** lowlight's tokens as decorations; a block without a known grammar stays plain instead of being auto-detected. */
export const parser: Parser = ({ content, language, pos }) => {
  if (!language) return [];
  const decorations: Decoration[] = [];
  decorate(decorations, lowlight.highlight(language, content) as HastNode, pos + 1, undefined);
  return decorations;
};

/** Milkdown `config()` step; the plugin reads this slice when it is created. */
export function configureHighlight(ctx: Ctx): void {
  ctx.set(highlightPluginConfig.key, {
    parser,
    nodeTypes: HIGHLIGHT_NODE_TYPES,
    languageExtractor: languageOf,
  });
}

export const highlight = highlightPlugin;
