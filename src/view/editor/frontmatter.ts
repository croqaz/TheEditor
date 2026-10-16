// Front-matter as a first-class block node whose YAML is ordinary editable
// text (a `code: true` textblock, like Milkdown's code_block), so the caret,
// selection and keymaps behave exactly as in the rest of the document. The
// keys belong to the user; the app only draws the `---` fences, collapses
// the block to its first lines while the caret is elsewhere, and parses the
// YAML solely to flag syntax errors.
import type { Ctx } from '@milkdown/kit/ctx';
import { keymap } from '@milkdown/kit/prose/keymap';
import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import {
  type EditorState,
  Plugin,
  PluginKey,
  Selection,
  TextSelection,
  type Transaction,
} from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet, type EditorView, type NodeView } from '@milkdown/kit/prose/view';
import { $nodeSchema, $prose, $remark, $view } from '@milkdown/kit/utils';
import remarkFrontmatter from 'remark-frontmatter';
import { parse as parseYaml } from 'yaml';

// Milkdown passes `{}` when no options are given, which remark-frontmatter rejects
// ("Missing `type` in matter"); the preset name must be passed explicitly.
export const frontmatterRemark = $remark('remarkFrontmatter', () => remarkFrontmatter, 'yaml' as const);

/** Lines shown while the block is collapsed (the caret is elsewhere). */
export const COLLAPSED_LINES = 4;

export const frontmatterSchema = $nodeSchema('frontmatter', () => ({
  content: 'text*',
  group: 'block',
  marks: '',
  code: true,
  defining: true,
  // Isolating: Backspace/Delete at the body boundary never join body text into the YAML.
  isolating: true,
  // Not selectable as a node: the block is text, there is nothing to "select whole".
  selectable: false,
  draggable: false,
  parseDOM: [
    {
      tag: 'div[data-type="frontmatter"]',
      preserveWhitespace: 'full' as const,
      contentElement: '.te-frontmatter__yaml',
    },
  ],
  toDOM: () => [
    'div',
    { 'data-type': 'frontmatter', class: 'te-frontmatter' },
    ['div', { class: 'te-frontmatter__yaml' }, 0],
  ],
  parseMarkdown: {
    match: ({ type }) => type === 'yaml',
    runner: (state, node, type) => {
      const value = (node as { value?: string }).value ?? '';
      state.openNode(type);
      if (value) state.addText(value);
      state.closeNode();
    },
  },
  toMarkdown: {
    match: node => node.type.name === 'frontmatter',
    runner: (state, node) => {
      state.addNode('yaml', undefined, node.textContent);
    },
  },
}));

export function validateYaml(value: string): string | null {
  try {
    parseYaml(value);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** `---` fences around ProseMirror-managed YAML text; validation state and the collapsed-lines hint on the outer element. */
class FrontmatterNodeView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private readonly more: HTMLElement;
  private type: ProseNode['type'];

  constructor(node: ProseNode) {
    this.type = node.type;
    this.dom = document.createElement('div');
    this.dom.className = 'te-frontmatter';
    this.dom.dataset.type = 'frontmatter';
    const top = document.createElement('div');
    top.className = 'te-frontmatter__fence';
    top.contentEditable = 'false';
    top.textContent = '---';
    this.contentDOM = document.createElement('div');
    this.contentDOM.className = 'te-frontmatter__yaml';
    const bottom = document.createElement('div');
    bottom.className = 'te-frontmatter__fence';
    bottom.contentEditable = 'false';
    bottom.textContent = '---';
    this.more = document.createElement('span');
    this.more.className = 'te-frontmatter__more';
    bottom.appendChild(this.more);
    this.dom.append(top, this.contentDOM, bottom);
    this.update(node);
  }

  update(node: ProseNode): boolean {
    if (node.type !== this.type) return false;
    const value = node.textContent;
    const error = validateYaml(value);
    this.dom.dataset.invalid = error ? 'true' : 'false';
    this.dom.title = error ? `YAML error: ${error}` : 'Front-matter';
    const lines = value ? value.split('\n').length : 0;
    this.more.textContent =
      lines > COLLAPSED_LINES
        ? ` … ${lines - COLLAPSED_LINES} more line${lines - COLLAPSED_LINES === 1 ? '' : 's'}`
        : '';
    return true;
  }

  /** Fences and the hint are ours; everything inside the YAML element belongs to ProseMirror. */
  ignoreMutation(mutation: { type: string; target: Node }): boolean {
    return mutation.type !== 'selection' && !this.contentDOM.contains(mutation.target);
  }
}

export const frontmatterView = $view(frontmatterSchema.node, (_ctx: Ctx) => {
  return node => new FrontmatterNodeView(node);
});

/** The front-matter node the selection is inside, with its position, or null. */
export function frontmatterAround(state: EditorState): { node: ProseNode; pos: number } | null {
  const { $from, $to } = state.selection;
  if ($from.depth < 1) return null;
  const node = $from.node(1);
  if (node.type.name !== 'frontmatter') return null;
  const pos = $from.before(1);
  if ($to.pos > pos + node.nodeSize) return null;
  return { node, pos };
}

export const frontmatterStateKey = new PluginKey('te-frontmatter-state');

// While the caret is inside the block it is expanded; the class is a node decoration,
// so ProseMirror puts it on the node view's outer element (editor.css collapses the rest).
export const frontmatterState = $prose(
  () =>
    new Plugin({
      key: frontmatterStateKey,
      props: {
        decorations(state) {
          const around = frontmatterAround(state);
          if (!around) return DecorationSet.empty;
          return DecorationSet.create(state.doc, [
            Decoration.node(around.pos, around.pos + around.node.nodeSize, {
              class: 'te-frontmatter--active',
            }),
          ]);
        },
      },
    })
);

/** True when the caret sits at the very start of the first top-level textblock after the front-matter. */
export function caretFollowsFrontmatter(state: EditorState): boolean {
  const selection = state.selection;
  if (!(selection instanceof TextSelection) || !selection.$cursor) return false;
  const $cursor = selection.$cursor;
  if ($cursor.depth !== 1 || $cursor.parentOffset !== 0) return false;
  const before = state.doc.maybeChild($cursor.index(0) - 1);
  return before?.type.name === 'frontmatter';
}

/** Put the caret on the first text after a leading front-matter block (used right after a document is loaded). */
export function skipFrontmatter(view: EditorView) {
  const { doc, selection } = view.state;
  const first = doc.firstChild;
  if (!first || first.type.name !== 'frontmatter' || selection.from > first.nodeSize) return;
  const next = Selection.near(doc.resolve(first.nodeSize), 1);
  if (next.from > first.nodeSize || next.from === selection.from) {
    view.dispatch(view.state.tr.setSelection(next));
  }
}

/** Position of the first body text: after a leading front-matter block, else the document start. */
export function bodyStart(state: EditorState): number {
  const first = state.doc.firstChild;
  const from = first && first.type.name === 'frontmatter' ? first.nodeSize : 0;
  return Selection.near(state.doc.resolve(from), 1).from;
}

/**
 * Ctrl+Home: the start of the body text; pressed again there (or without body text before
 * the caret), the start of the front-matter. Without front-matter, the document start.
 */
export function goToStart(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const start = bodyStart(state);
  const first = state.doc.firstChild;
  const hasFrontmatter = !!first && first.type.name === 'frontmatter';
  const target = hasFrontmatter && state.selection.from <= start ? Selection.near(state.doc.resolve(1), 1).from : start;
  dispatch?.(state.tr.setSelection(TextSelection.create(state.doc, target)).scrollIntoView());
  return true;
}

/** Ctrl+End: the absolute end of the text. */
export function goToEnd(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  dispatch?.(state.tr.setSelection(Selection.atEnd(state.doc)).scrollIntoView());
  return true;
}

export const frontmatterKeymap = $prose(() =>
  keymap({
    'Mod-Home': goToStart,
    'Mod-End': goToEnd,
    // Backspace at the start of the body must not touch the block (isolating already
    // stops the join; this keeps the key from falling through to other handlers), and
    // Backspace in an empty block removes it, which is how the user deletes front-matter.
    Backspace: (state, dispatch) => {
      const around = frontmatterAround(state);
      if (around && around.node.content.size === 0) {
        dispatch?.(state.tr.delete(around.pos, around.pos + around.node.nodeSize));
        return true;
      }
      return caretFollowsFrontmatter(state);
    },
    // Escape leaves the block for the first line of the body.
    Escape: (state, dispatch) => {
      const around = frontmatterAround(state);
      if (!around) return false;
      dispatch?.(
        state.tr.setSelection(Selection.near(state.doc.resolve(around.pos + around.node.nodeSize), 1)).scrollIntoView()
      );
      return true;
    },
  })
);

export const frontmatter = [
  frontmatterRemark,
  frontmatterSchema,
  frontmatterView,
  frontmatterState,
  frontmatterKeymap,
].flat();
