// Text and block transforms expressed as ProseMirror transactions.
import { Fragment, type Node as ProseNode } from "@milkdown/kit/prose/model";
import type { EditorState } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";

/** Apply fn to every text segment inside the selection (or the whole word at the caret). */
export function transformSelectionText(view: EditorView, fn: (text: string) => string): number {
	const { state } = view;
	let { from, to } = state.selection;
	if (from === to) {
		const range = wordRangeAt(state, from);
		if (!range) return 0;
		({ from, to } = range);
	}
	const edits: { from: number; to: number; text: string }[] = [];
	state.doc.nodesBetween(from, to, (node, pos) => {
		if (!node.isText || !node.text) return;
		const start = Math.max(from, pos);
		const end = Math.min(to, pos + node.nodeSize);
		const slice = node.text.slice(start - pos, end - pos);
		const replaced = fn(slice);
		if (replaced !== slice) edits.push({ from: start, to: end, text: replaced });
	});
	if (!edits.length) return 0;
	const tr = state.tr;
	for (const edit of edits.reverse()) tr.insertText(edit.text, edit.from, edit.to);
	view.dispatch(tr.scrollIntoView());
	return edits.length;
}

function wordRangeAt(state: EditorState, pos: number): { from: number; to: number } | null {
	const $pos = state.doc.resolve(pos);
	const parent = $pos.parent;
	if (!parent.isTextblock) return null;
	const text = parent.textContent;
	const offset = $pos.parentOffset;
	const isWord = (ch: string) => /[\p{L}\p{N}'’_-]/u.test(ch);
	let start = offset;
	let end = offset;
	while (start > 0 && isWord(text[start - 1]!)) start--;
	while (end < text.length && isWord(text[end]!)) end++;
	if (start === end) return null;
	const base = $pos.start();
	return { from: base + start, to: base + end };
}

/** Top-level blocks touched by the selection, with their document range. */
export function selectedTopLevelBlocks(state: EditorState): { from: number; to: number; nodes: ProseNode[] } {
	const { from, to } = state.selection;
	const nodes: ProseNode[] = [];
	let rangeFrom = -1;
	let rangeTo = -1;
	state.doc.forEach((node, offset) => {
		const end = offset + node.nodeSize;
		if (end <= from && !(from === to && from === end)) return;
		if (offset >= to && !(from === to && offset === from)) return;
		if (end < from || offset > to) return;
		if (rangeFrom === -1) rangeFrom = offset;
		rangeTo = end;
		nodes.push(node);
	});
	if (!nodes.length) return { from, to, nodes };
	return { from: rangeFrom, to: rangeTo, nodes };
}

export type LineOp = (lines: string[]) => string[];

/** Reorder items by the strings `op` returns, keeping duplicates paired with their items. */
function reorderByKey<T>(items: T[], keyOf: (item: T) => string, op: LineOp): T[] {
	const byKey = new Map<string, T[]>();
	for (const item of items) {
		const key = keyOf(item);
		const list = byKey.get(key) ?? [];
		list.push(item);
		byKey.set(key, list);
	}
	const out: T[] = [];
	for (const key of op(items.map(keyOf))) {
		const item = byKey.get(key)?.shift();
		if (item !== undefined) out.push(item);
	}
	return out;
}

function hardBreakType(state: EditorState) {
	return state.schema.nodes.hardbreak ?? state.schema.nodes.hard_break ?? null;
}

/**
 * "Lines" are the selected top-level blocks. When only one paragraph is
 * selected and it contains hard breaks, its lines (kept as hard breaks) are
 * transformed instead.
 */
export function transformSelectedLines(view: EditorView, op: LineOp): number {
	const { state } = view;
	const { from, to, nodes } = selectedTopLevelBlocks(state);
	const hardBreak = hardBreakType(state);
	const single = nodes.length === 1 ? nodes[0]! : null;
	if (single?.isTextblock && hardBreak && single.content.content.some((n) => n.type === hardBreak)) {
		const lines: ProseNode[][] = [[]];
		single.forEach((child) => {
			if (child.type === hardBreak) lines.push([]);
			else lines[lines.length - 1]!.push(child);
		});
		const reordered = reorderByKey(lines, (line) => line.map((n) => n.textContent).join(""), op);
		if (!reordered.length) return 0;
		const content: ProseNode[] = [];
		reordered.forEach((line, i) => {
			if (i) content.push(hardBreak.create());
			content.push(...line);
		});
		view.dispatch(state.tr.replaceWith(from + 1, to - 1, Fragment.from(content)).scrollIntoView());
		return reordered.length;
	}
	const reordered = reorderByKey(nodes, (node) => node.textContent, op);
	if (!reordered.length) return 0;
	view.dispatch(state.tr.replaceWith(from, to, Fragment.from(reordered)).scrollIntoView());
	return reordered.length;
}

export const lineOps = {
	sort: (desc = false): LineOp => (lines) => {
		const sorted = [...lines].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
		return desc ? sorted.reverse() : sorted;
	},
	unique: (): LineOp => (lines) => [...new Set(lines)],
	reverse: (): LineOp => (lines) => [...lines].reverse(),
	shuffle: (seed = Date.now()): LineOp => (lines) => {
		let s = seed >>> 0;
		const rand = () => {
			s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
			return s / 0x100000000;
		};
		const out = [...lines];
		for (let i = out.length - 1; i > 0; i--) {
			const j = Math.floor(rand() * (i + 1));
			[out[i], out[j]] = [out[j]!, out[i]!];
		}
		return out;
	},
};

export const textOps = {
	lower: (s: string) => s.toLowerCase(),
	upper: (s: string) => s.toUpperCase(),
	title: (s: string) => s.replace(/\p{L}[\p{L}\p{M}'’]*/gu, (w) => w[0]!.toUpperCase() + w.slice(1).toLowerCase()),
	sentence: (s: string) =>
		s.toLowerCase().replace(/(^\s*\p{L}|[.!?]\s+\p{L})/gu, (m) => m.toUpperCase()),
	trimTrailing: (s: string) => s.replace(/[ \t]+$/gm, ""),
};
