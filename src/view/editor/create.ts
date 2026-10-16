// Milkdown kit editor: CommonMark + GFM + history/clipboard/cursor/trailing/indent,
// the front-matter node, and a change tracker. No Crepe, no toolbars.
import {
  defaultValueCtx,
  Editor,
  editorViewCtx,
  editorViewOptionsCtx,
  remarkStringifyOptionsCtx,
  rootCtx,
} from '@milkdown/kit/core';
import { clipboard } from '@milkdown/kit/plugin/clipboard';
import { cursor } from '@milkdown/kit/plugin/cursor';
import { history } from '@milkdown/kit/plugin/history';
import { indent } from '@milkdown/kit/plugin/indent';
import { trailing } from '@milkdown/kit/plugin/trailing';
import { commonmark, htmlSchema, remarkHtmlTransformer } from '@milkdown/kit/preset/commonmark';
import { gfm } from '@milkdown/kit/preset/gfm';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { $prose, getMarkdown, replaceAll } from '@milkdown/kit/utils';
import { blockCaret } from './blockcaret';
import { frontmatter, skipFrontmatter } from './frontmatter';
import { html } from './html';

export interface EditorHooks {
  onDocChanged: () => void;
  onSelectionChanged: () => void;
}

export interface EditorHandle {
  editor: Editor;
  view(): EditorView;
  getMarkdown(): string;
  setMarkdown(markdown: string): void;
  focus(): void;
  destroy(): Promise<void>;
}

const trackerKey = new PluginKey('te-change-tracker');

function changeTracker(hooks: EditorHooks) {
  return $prose(
    () =>
      new Plugin({
        key: trackerKey,
        view: () => ({
          update(view, prevState) {
            if (!view.state.doc.eq(prevState.doc)) hooks.onDocChanged();
            else if (!view.state.selection.eq(prevState.selection)) {
              hooks.onSelectionChanged();
            }
          },
        }),
      })
  );
}

// The preset's `html` node is an inline atom the caret cannot enter, and its
// remark transformer wraps HTML blocks into paragraphs so that atom can hold them
// (the preset's own source marks it obsolete "once the preset supports HTML").
// editor/html.ts replaces both with editable text; the two are left out here.
const presetHtml: readonly unknown[] = [...htmlSchema, ...remarkHtmlTransformer];
const commonmarkWithoutHtml = commonmark.filter(plugin => !presetHtml.includes(plugin));

// Block indices as node decorations were dropped: ProseMirror recomputes
// `decorations(state)` on every transaction, which is O(blocks) per keystroke
// (7k blocks for the 2 MB book). CSS addresses blocks as `.te-doc > *`.

export async function createEditor(root: HTMLElement, markdown: string, hooks: EditorHooks): Promise<EditorHandle> {
  const t0 = performance.now();
  const editor = await Editor.make()
    .config(ctx => {
      ctx.set(rootCtx, root);
      ctx.set(defaultValueCtx, markdown);
      ctx.set(remarkStringifyOptionsCtx, {
        bullet: '-',
        rule: '-',
        emphasis: '*',
        strong: '*',
        fences: true,
        listItemIndent: 'one',
        incrementListMarker: true,
      });
      ctx.update(editorViewOptionsCtx, prev => ({
        ...prev,
        attributes: {
          class: 'te-doc',
          spellcheck: 'false',
          role: 'textbox',
          'aria-multiline': 'true',
        },
      }));
    })
    .use(commonmarkWithoutHtml)
    .use(html)
    .use(gfm)
    .use(history)
    .use(clipboard)
    .use(cursor)
    .use(trailing)
    .use(indent)
    .use(frontmatter)
    .use(blockCaret)
    .use(changeTracker(hooks))
    .create();
  const created = performance.now() - t0;
  if (created > 200) {
    console.info(`editor created in ${Math.round(created)} ms (${markdown.length} chars)`);
  }
  // A document that opens with front-matter starts with the caret on the first body line.
  skipFrontmatter(editor.ctx.get(editorViewCtx));

  return {
    editor,
    view: () => editor.ctx.get(editorViewCtx),
    getMarkdown: () => editor.action(getMarkdown()),
    setMarkdown: next => {
      editor.action(replaceAll(next, true));
      skipFrontmatter(editor.ctx.get(editorViewCtx));
    },
    focus: () => editor.ctx.get(editorViewCtx).focus(),
    destroy: async () => {
      await editor.destroy();
    },
  };
}
