// The caret must always be in the text. Clicks in the padding around the
// document (below the end when scrolled past it, or in the side margins of
// the central column) move the caret to the nearest sensible position
// instead of blurring the editor.
import { Selection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";

export type CaretPlacement = "start" | "end" | "line";

export function placeCaretFromOutsideClick(view: EditorView, point: { x: number; y: number }): CaretPlacement {
	const rect = view.dom.getBoundingClientRect();
	const doc = view.state.doc;
	let selection: Selection;
	let placement: CaretPlacement;
	if (point.y >= rect.bottom) {
		selection = Selection.atEnd(doc);
		placement = "end";
	} else if (point.y <= rect.top) {
		selection = Selection.atStart(doc);
		placement = "start";
	} else {
		// Beside the column: find the line at this height by clamping x into the text box.
		const left = Math.min(Math.max(point.x, rect.left + 1), rect.right - 1);
		const found = view.posAtCoords({ left, top: point.y });
		if (found) {
			selection = Selection.near(doc.resolve(found.pos));
			placement = "line";
		} else {
			selection = Selection.atEnd(doc);
			placement = "end";
		}
	}
	if (!view.state.selection.eq(selection)) view.dispatch(view.state.tr.setSelection(selection));
	view.focus();
	return placement;
}

/**
 * Mousedown on the pane that surrounds the document. Clicks inside the
 * ProseMirror DOM are left to ProseMirror; clicks outside keep focus (the
 * default would blur) and place the caret.
 */
export function handlePaneMouseDown(view: EditorView, event: MouseEvent): CaretPlacement | null {
	if (event.button !== 0) return null;
	const target = event.target as Node | null;
	if (target && view.dom.contains(target)) return null;
	event.preventDefault();
	return placeCaretFromOutsideClick(view, { x: event.clientX, y: event.clientY });
}
