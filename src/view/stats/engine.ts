// Document statistics from the ProseMirror document, cached per top-level
// node (nodes are immutable, so unchanged blocks keep their identity).
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { Selection, TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import {
	type BlockKind,
	type BlockStats,
	type CountedBlock,
	type DocumentStats,
	countBlock,
	summarise,
} from "../../shared/stats/count";

const cache = new WeakMap<ProseNode, CountedBlock>();

function kindOf(node: ProseNode): BlockKind {
	switch (node.type.name) {
		case "paragraph":
			return node.childCount === 1 && node.firstChild?.type.name === "image" ? "image" : "paragraph";
		case "heading":
			return "heading";
		case "bullet_list":
		case "ordered_list":
			return "list";
		case "code_block":
			return "code";
		case "blockquote":
			return "quote";
		default:
			return "other";
	}
}

/** Text of a block with "\n" between nested blocks; `textContent` would glue list items together. */
export function blockText(node: ProseNode): string {
	return node.isTextblock ? node.textContent : node.textBetween(0, node.content.size, "\n");
}

function countNode(node: ProseNode, lang: string): CountedBlock {
	const cached = cache.get(node);
	if (cached) return cached;
	const kind = kindOf(node);
	const text = node.type.name === "frontmatter" ? "" : blockText(node);
	const counted: CountedBlock = { kind, stats: countBlock(text, lang) };
	cache.set(node, counted);
	return counted;
}

export function computeStats(view: EditorView, markdownBytes: number, options: { lang: string; wpm: number }): DocumentStats {
	const blocks: CountedBlock[] = [];
	view.state.doc.forEach((node) => {
		blocks.push(countNode(node, options.lang));
	});
	const stats = summarise(blocks, markdownBytes, { lang: options.lang, wpm: options.wpm });
	const selection = view.state.selection;
	if (selection instanceof TextSelection && !selection.empty) {
		const text = view.state.doc.textBetween(selection.from, selection.to, "\n", " ");
		stats.selection = countBlock(text, options.lang);
	}
	return stats;
}

const lineCounts = new WeakMap<ProseNode, number>();

function linesIn(node: ProseNode): number {
	let n = lineCounts.get(node);
	if (n === undefined) {
		n = Math.max(1, blockText(node).split("\n").length) + 1;
		lineCounts.set(node, n);
	}
	return n;
}

export function cursorPosition(view: EditorView): { line: number; column: number } {
	const { $from } = view.state.selection;
	const doc = view.state.doc;
	const blockIndex = $from.depth > 0 ? $from.index(0) : 0;
	let line = 0;
	for (let i = 0; i < blockIndex; i++) line += linesIn(doc.child(i));
	// Text of the top-level block before the caret. Nested textblocks (list items, quotes) are
	// separated by "\n" exactly as linesIn() counts them, so every item gets its own line number.
	const textBefore = $from.depth > 0 ? doc.child(blockIndex).textBetween(0, $from.pos - $from.start(1), "\n") : "";
	const lastBreak = textBefore.lastIndexOf("\n");
	const column = lastBreak === -1 ? textBefore.length : textBefore.length - lastBreak - 1;
	const linesInBlock = textBefore.split("\n").length - 1;
	return { line: line + linesInBlock + 1, column: column + 1 };
}

/** Start position and length of every line of a textblock (hard breaks and literal newlines both end a line). */
function textblockLines(textblock: ProseNode, contentStart: number): { pos: number; length: number }[] {
	const lines = [{ pos: contentStart, length: 0 }];
	let pos = contentStart;
	textblock.forEach((child) => {
		const text = child.isText ? (child.text ?? "") : (child.type.spec.leafText?.(child) ?? "");
		if (child.isText) {
			for (let k = 0; k < text.length; k++) {
				if (text[k] === "\n") lines.push({ pos: pos + k + 1, length: 0 });
				else lines[lines.length - 1]!.length++;
			}
		} else if (text === "\n") {
			lines.push({ pos: pos + child.nodeSize, length: 0 });
		} else {
			lines[lines.length - 1]!.length += text.length;
		}
		pos += child.nodeSize;
	});
	return lines;
}

/** Inverse of cursorPosition: the document position of a 1-based line and column (both clamped). */
export function positionAt(doc: ProseNode, line: number, column = 1): number {
	const target = Math.max(1, Math.floor(line));
	const col = Math.max(0, Math.floor(column) - 1);
	let acc = 0;
	let blockStart = 0;
	for (let i = 0; i < doc.childCount; i++) {
		const block = doc.child(i);
		const count = linesIn(block); // text lines + the blank line after the block
		if (target <= acc + count) {
			const lines: { pos: number; length: number }[] = [];
			if (block.isTextblock) lines.push(...textblockLines(block, blockStart + 1));
			else {
				block.descendants((node, pos) => {
					if (node.isTextblock) lines.push(...textblockLines(node, blockStart + 1 + pos + 1));
					return !node.isTextblock;
				});
			}
			if (!lines.length) return Selection.near(doc.resolve(blockStart + block.nodeSize), 1).head; // front matter, rules
			const entry = lines[Math.min(target - acc, lines.length) - 1]!;
			const atBlank = target - acc > lines.length; // the blank line after the block: end of its last line
			return entry.pos + (atBlank ? entry.length : Math.min(col, entry.length));
		}
		acc += count;
		blockStart += block.nodeSize;
	}
	return Selection.atEnd(doc).head;
}

export type { BlockStats, DocumentStats };
