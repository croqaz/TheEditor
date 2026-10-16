// Task list items. Milkdown's GFM preset keeps the state in the `checked`
// attribute of `list_item` (null for a plain item) and offers an input rule
// (`[ ] ` / `[x] ` typed at the start of an item) but nothing that changes an
// existing one. This adds the toggle as a ProseMirror command (Ctrl+Enter,
// te.task.toggle()) and a click on the marker: editor.css draws the marker as
// the item's ::before, so a click on it has the <li> itself as its target,
// while a click on the text lands inside the paragraph.
import { keymap } from '@milkdown/kit/prose/keymap';
import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import { type EditorState, Plugin, PluginKey, type Transaction } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';

export interface ListItemAt {
  node: ProseNode;
  pos: number;
  /** null: a plain item; false: an open task; true: a done task. */
  checked: boolean | null;
}

/** The innermost list item around the selection head. */
export function listItemAround(state: EditorState): ListItemAt | null {
  const $head = state.selection.$head;
  for (let depth = $head.depth; depth > 0; depth--) {
    const node = $head.node(depth);
    if (node.type.name === 'list_item') {
      return { node, pos: $head.before(depth), checked: (node.attrs.checked as boolean | null | undefined) ?? null };
    }
  }
  return null;
}

type Dispatch = ((tr: Transaction) => void) | undefined;

function setChecked(state: EditorState, dispatch: Dispatch, item: ListItemAt, checked: boolean | null): boolean {
  dispatch?.(state.tr.setNodeMarkup(item.pos, undefined, { ...item.node.attrs, checked }));
  return true;
}

/** A plain item becomes an open task, an open task is done, a done task is open again. */
export function toggleTask(state: EditorState, dispatch?: Dispatch): boolean {
  const item = listItemAround(state);
  if (!item) return false;
  return setChecked(state, dispatch, item, item.checked === null ? false : !item.checked);
}

/** Back to a plain list item. */
export function clearTask(state: EditorState, dispatch?: Dispatch): boolean {
  const item = listItemAround(state);
  if (!item || item.checked === null) return false;
  return setChecked(state, dispatch, item, null);
}

/** ProseMirror `handleClickOn`: a click whose target is the task item's own element is a click on its marker. */
export function markerClick(view: EditorView, _pos: number, node: ProseNode, nodePos: number, event: MouseEvent): boolean {
  if (node.type.name !== 'list_item' || node.attrs.checked == null) return false;
  if (event.target !== view.nodeDOM(nodePos)) return false;
  view.dispatch(view.state.tr.setNodeMarkup(nodePos, undefined, { ...node.attrs, checked: !node.attrs.checked }));
  return true;
}

export const taskKeymap = $prose(() => keymap({ 'Mod-Enter': toggleTask }));

export const taskClicks = $prose(
  () =>
    new Plugin({
      key: new PluginKey('te-task-clicks'),
      props: { handleClickOn: markerClick },
    })
);

export const tasks = [taskKeymap, taskClicks];
