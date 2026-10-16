// Front-matter as a first-class block node. The keys belong to the user; the
// app only shows the block collapsed (one muted line) or expanded (raw YAML in
// a textarea). YAML is parsed solely to flag syntax errors.
import type { Ctx } from "@milkdown/kit/ctx";
import { keymap } from "@milkdown/kit/prose/keymap";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { type EditorState, TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView, NodeView } from "@milkdown/kit/prose/view";
import { $nodeSchema, $prose, $remark, $view } from "@milkdown/kit/utils";
import remarkFrontmatter from "remark-frontmatter";
import { parse as parseYaml } from "yaml";

// Milkdown passes `{}` when no options are given, which remark-frontmatter rejects
// ("Missing `type` in matter"); the preset name must be passed explicitly.
export const frontmatterRemark = $remark("remarkFrontmatter", () => remarkFrontmatter, "yaml" as const);

export const frontmatterSchema = $nodeSchema("frontmatter", () => ({
	group: "block",
	atom: true,
	// Not selectable: ProseMirror would otherwise start with the front-matter
	// node selected instead of a caret in the first paragraph. Backspace at the
	// start of the body is guarded by frontmatterKeymap below; emptying the YAML
	// in the editor removes the node.
	selectable: false,
	draggable: false,
	defining: true,
	isolating: true,
	attrs: {
		value: { default: "" },
	},
	parseDOM: [
		{
			tag: 'div[data-type="frontmatter"]',
			getAttrs: (dom) => ({ value: (dom as HTMLElement).dataset.value ?? "" }),
		},
	],
	toDOM: (node) => ["div", { "data-type": "frontmatter", "data-value": node.attrs.value as string, class: "te-frontmatter" }, node.attrs.value as string],
	parseMarkdown: {
		match: ({ type }) => type === "yaml",
		runner: (state, node, type) => {
			state.addNode(type, { value: (node as { value?: string }).value ?? "" });
		},
	},
	toMarkdown: {
		match: (node) => node.type.name === "frontmatter",
		runner: (state, node) => {
			state.addNode("yaml", undefined, node.attrs.value as string);
		},
	},
}));

function summaryOf(value: string): string {
	const lines = value
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => l && !l.startsWith("#"));
	if (!lines.length) return "--- (empty front-matter)";
	return `--- ${lines.slice(0, 4).join(" · ")}${lines.length > 4 ? " · …" : ""}`;
}

function validate(value: string): string | null {
	try {
		parseYaml(value);
		return null;
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
}

class FrontmatterNodeView implements NodeView {
	dom: HTMLElement;
	private summary: HTMLElement;
	private editor: HTMLTextAreaElement | null = null;
	private node: ProseNode;

	constructor(
		node: ProseNode,
		private readonly view: EditorView,
		private readonly getPos: () => number | undefined,
	) {
		this.node = node;
		this.dom = document.createElement("div");
		this.dom.className = "te-frontmatter";
		this.dom.dataset.type = "frontmatter";
		this.dom.contentEditable = "false";
		this.summary = document.createElement("div");
		this.summary.className = "te-frontmatter__summary";
		this.dom.appendChild(this.summary);
		this.render();
		this.dom.addEventListener("mousedown", (event) => {
			if (!this.editor) {
				event.preventDefault();
				this.expand();
			}
		});
	}

	private render() {
		const value = this.node.attrs.value as string;
		this.dom.dataset.value = value;
		const error = validate(value);
		this.dom.dataset.invalid = error ? "true" : "false";
		this.dom.title = error ? `YAML error: ${error}` : "Front-matter (click to edit)";
		this.summary.textContent = summaryOf(value);
		if (this.editor && this.editor.value !== value) this.editor.value = value;
	}

	expand() {
		if (this.editor) return;
		const textarea = document.createElement("textarea");
		textarea.className = "te-frontmatter__editor";
		textarea.value = this.node.attrs.value as string;
		textarea.rows = Math.max(2, textarea.value.split("\n").length + 1);
		textarea.spellcheck = false;
		textarea.addEventListener("input", () => {
			textarea.rows = Math.max(2, textarea.value.split("\n").length + 1);
		});
		textarea.addEventListener("keydown", (event) => {
			if (event.key === "Escape") {
				event.preventDefault();
				this.collapse(true);
				this.view.focus();
			}
			event.stopPropagation();
		});
		textarea.addEventListener("blur", () => this.collapse(true));
		this.summary.hidden = true;
		this.dom.appendChild(textarea);
		this.editor = textarea;
		textarea.focus();
	}

	collapse(commit: boolean) {
		const textarea = this.editor;
		if (!textarea) return;
		this.editor = null;
		const value = textarea.value;
		textarea.remove();
		this.summary.hidden = false;
		if (commit && value !== this.node.attrs.value) {
			const pos = this.getPos();
			if (pos !== undefined) {
				const tr = this.view.state.tr;
				if (value.trim() === "") tr.delete(pos, pos + this.node.nodeSize);
				else tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, value });
				this.view.dispatch(tr);
			}
		}
		this.render();
	}

	update(node: ProseNode): boolean {
		if (node.type !== this.node.type) return false;
		this.node = node;
		this.render();
		return true;
	}

	stopEvent(event: Event): boolean {
		return this.editor !== null && event.target === this.editor;
	}

	ignoreMutation(): boolean {
		return true;
	}

	destroy() {
		this.editor?.remove();
	}
}

export const frontmatterView = $view(frontmatterSchema.node, (_ctx: Ctx) => {
	return (node, view, getPos) => new FrontmatterNodeView(node, view, getPos);
});

/** True when the caret sits at the very start of the first top-level textblock after the front-matter. */
export function caretFollowsFrontmatter(state: EditorState): boolean {
	const selection = state.selection;
	if (!(selection instanceof TextSelection) || !selection.$cursor) return false;
	const $cursor = selection.$cursor;
	if ($cursor.depth !== 1 || $cursor.parentOffset !== 0) return false;
	const before = state.doc.maybeChild($cursor.index(0) - 1);
	return before?.type.name === "frontmatter";
}

// prosemirror-commands' joinBackward deletes an atom node that precedes the
// caret ("If the node before is an atom, delete it"). Backspace at the start of
// the body must not silently remove the front-matter, so it is consumed here.
export const frontmatterKeymap = $prose(() =>
	keymap({
		Backspace: (state) => caretFollowsFrontmatter(state),
	}),
);

export const frontmatter = [frontmatterRemark, frontmatterSchema, frontmatterView, frontmatterKeymap].flat();
