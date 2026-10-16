// A caret as wide as one character cell, drawn as an overlay in the pane.
//
// WebKit's native caret is a 1 px bar and `caret-color` is its only style
// hook, so editor.css makes the native caret transparent (unless the config
// asks for `caret: "bar"`) and this plugin positions `.te-caret` over the
// character after the selection head. The block is hollow while typing
// inserts and filled while it overwrites (the Insert key toggles, as in most
// editors); in the filled state the overlay repeats the character in the
// background colour, which gives the inverted glyph.
//
// Every empty selection that is not a node selection gets the block: text
// carets in prose, code, front-matter and HTML, and gap cursors between
// blocks (for example on a horizontal rule, whose own cursor ProseMirror
// draws with CSS the app does not load).
import { NodeSelection, Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state';
import type { EditorState, Transaction } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';

export const blockCaretKey = new PluginKey<CaretState>('te-block-caret');

export interface CaretState {
  /** Typing replaces the character after the caret instead of inserting before it. */
  overwrite: boolean;
}

export interface CaretBox {
  /** CSS px from the host's padding-box origin, scroll offset included (document coordinates). */
  left: number;
  top: number;
  width: number;
  height: number;
  /** The character under the block, "" at the end of a block or at a gap. */
  char: string;
  /** Computed text style of the character, copied onto the overlay so the repeated glyph lands on the real one. */
  font: string;
  letterSpacing: string;
  textTransform: string;
}

const widthCache = new Map<string, number>();

function styleAt(view: EditorView, pos: number): CSSStyleDeclaration | null {
  try {
    const { node } = view.domAtPos(pos);
    const element = node instanceof Element ? node : node.parentElement;
    return element ? getComputedStyle(element) : null;
  } catch {
    return null;
  }
}

function fontOf(style: CSSStyleDeclaration | null): string {
  if (!style) return '';
  return [style.fontStyle, style.fontWeight, style.fontSize, style.fontFamily].filter(Boolean).join(' ');
}

/** Advance width of one monospace cell in the font at `pos`; measured once per font string. */
export function cellWidth(view: EditorView, pos: number): number {
  const style = styleAt(view, pos);
  const font = fontOf(style);
  const cached = widthCache.get(font);
  if (cached) return cached;
  let width = 0;
  if (font) {
    const context = document.createElement('canvas').getContext('2d');
    if (context) {
      context.font = font;
      width = context.measureText('0').width;
    }
  }
  if (!width) {
    const size = style ? Number.parseFloat(style.fontSize) : Number.NaN;
    width = (Number.isFinite(size) ? size : 15) * 0.6;
  }
  widthCache.set(font, width);
  return width;
}

/** Where the block caret goes; null when there is nothing to draw (a range or a node selection). */
export function caretBox(view: EditorView, host: HTMLElement): CaretBox | null {
  const { selection } = view.state;
  if (!selection.empty || selection instanceof NodeSelection) return null;
  const head = selection.head;
  const $head = selection.$head;
  let coords: { left: number; right: number; top: number; bottom: number };
  try {
    coords = view.coordsAtPos(head, 1);
  } catch {
    return null;
  }
  const hostRect = host.getBoundingClientRect();
  const hasCharAfter = $head.parent.isTextblock && $head.parentOffset < $head.parent.content.size;
  const char = hasCharAfter ? view.state.doc.textBetween(head, head + 1, '', '') : '';
  let width = 0;
  if (char) {
    try {
      const next = view.coordsAtPos(head + 1, -1);
      if (Math.abs(next.top - coords.top) < 1 && next.left > coords.left) {
        width = next.left - coords.left;
      }
    } catch {
      // no DOM position for the next character; use the cell width
    }
  }
  if (!width) width = cellWidth(view, head);
  const style = styleAt(view, head);
  const rectHeight = coords.bottom - coords.top;
  const lineHeight = style ? Number.parseFloat(style.lineHeight) : Number.NaN;
  // coordsAtPos gives the glyph box, centred in the line box: the block spans the whole line box.
  // At a gap between blocks the glyph box is empty; the line box comes from the computed style.
  const fontSize = style ? Number.parseFloat(style.fontSize) : Number.NaN;
  const fallback = (Number.isFinite(fontSize) ? fontSize : 15) * 1.6;
  const height = Number.isFinite(lineHeight) && lineHeight > rectHeight ? lineHeight : rectHeight || fallback;
  const top = coords.top - (height - rectHeight) / 2;
  return {
    left: coords.left - hostRect.left + host.scrollLeft,
    top: top - hostRect.top + host.scrollTop,
    width,
    height,
    char,
    font: fontOf(style),
    letterSpacing: style?.letterSpacing ?? '',
    textTransform: style?.textTransform ?? '',
  };
}

/** Host element for the overlay: the scrolling pane, or the editor's parent outside the app shell. */
export function caretHost(view: EditorView): HTMLElement {
  return (view.dom.closest('.te-pane') as HTMLElement | null) ?? view.dom.parentElement ?? document.body;
}

/** WebKit's page focus: false while the GTK widget has no keyboard focus, even if an element is "active". */
export function pageHasFocus(): boolean {
  return typeof document.hasFocus !== 'function' || document.hasFocus();
}

export function isOverwrite(state: EditorState): boolean {
  return blockCaretKey.getState(state)?.overwrite ?? false;
}

/** Transaction that switches overwrite mode; `on` omitted toggles. */
export function setOverwrite(state: EditorState, on = !isOverwrite(state)): Transaction {
  return state.tr.setMeta(blockCaretKey, {
    overwrite: on,
  } satisfies CaretState);
}

/** In overwrite mode, typed text replaces the text character after the caret (never a newline or a non-text node). */
export function overwriteTextInput(view: EditorView, from: number, to: number, text: string): boolean {
  if (!isOverwrite(view.state) || from !== to) return false;
  const $from = view.state.doc.resolve(from);
  const after = $from.nodeAfter;
  if (!after?.isText || !after.text || after.text.startsWith('\n')) {
    return false;
  }
  // A caret at the start of a replaced range stays before the replacement, so it is moved explicitly.
  const tr = view.state.tr.insertText(text, from, from + 1);
  view.dispatch(tr.setSelection(TextSelection.create(tr.doc, from + text.length)).scrollIntoView());
  return true;
}

export function blockCaretView(view: EditorView) {
  const host = caretHost(view);
  const el = document.createElement('div');
  el.className = 'te-caret';
  el.setAttribute('aria-hidden', 'true');
  el.hidden = true;
  host.appendChild(el);
  let last = '';

  const refresh = () => {
    // Both: the element must be active and the page must hold keyboard focus, so the caret
    // never claims keys will work when the window is not actually focused.
    const keep = document.body.classList.contains('te-keep-caret'); // a picture asked for the caret
    const box = view.hasFocus() && (pageHasFocus() || keep) ? caretBox(view, host) : null;
    el.classList.toggle('te-caret--full', isOverwrite(view.state));
    if (!box) {
      el.hidden = true;
      last = '';
      return;
    }
    el.hidden = false;
    el.style.left = `${box.left}px`;
    el.style.top = `${box.top}px`;
    el.style.width = `${box.width}px`;
    el.style.height = `${box.height}px`;
    el.style.font = box.font; // the shorthand resets line-height, so it is set after
    el.style.lineHeight = `${box.height}px`;
    el.style.letterSpacing = box.letterSpacing;
    el.style.textTransform = box.textTransform;
    el.textContent = box.char;
    const key = `${box.left},${box.top}`;
    if (key !== last) {
      // Restart the blink so the caret is solid right after it moves.
      el.style.animation = 'none';
      void el.offsetWidth;
      el.style.animation = '';
    }
    last = key;
  };

  view.dom.addEventListener('focus', refresh);
  view.dom.addEventListener('blur', refresh);
  window.addEventListener('focus', refresh);
  window.addEventListener('blur', refresh);
  const resize = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => refresh()) : null;
  resize?.observe(view.dom);
  refresh();

  return {
    update: refresh,
    destroy() {
      view.dom.removeEventListener('focus', refresh);
      view.dom.removeEventListener('blur', refresh);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('blur', refresh);
      resize?.disconnect();
      el.remove();
    },
  };
}

export const blockCaret = $prose(
  () =>
    new Plugin<CaretState>({
      key: blockCaretKey,
      state: {
        init: () => ({ overwrite: false }),
        apply(tr, prev) {
          const meta = tr.getMeta(blockCaretKey) as Partial<CaretState> | undefined;
          return meta ? { ...prev, ...meta } : prev;
        },
      },
      props: {
        handleKeyDown(view, event) {
          if (event.key !== 'Insert' || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return false;
          view.dispatch(setOverwrite(view.state));
          // The status bar announces the mode (main.ts listens).
          document.dispatchEvent(
            new CustomEvent('te:overwrite', {
              detail: isOverwrite(view.state),
            })
          );
          return true;
        },
        handleTextInput: overwriteTextInput,
      },
      view: blockCaretView,
    })
);
