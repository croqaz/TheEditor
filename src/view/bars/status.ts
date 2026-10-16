// Bottom bar: statistics cells, transient messages, and the command prompt.
import { parsePromptLine } from "../../shared/commands";
import { type DocumentStats, formatCount, formatMinutes } from "../../shared/stats/count";
import { el } from "../state";

export interface StatusModel {
	stats: DocumentStats | null;
	cursor: { line: number; column: number } | null;
	lang: string;
	online: boolean;
	autosave: boolean;
	fields: string[];
	flash: { text: string; error: boolean } | null;
}

export interface PromptHost {
	run(id: string, args: unknown[]): unknown;
	complete(prefix: string): string[];
	history(): string[];
	remember(line: string): void;
}

function cellsFor(model: StatusModel): { text: string; cls?: string }[] {
	const s = model.stats;
	const sel = s?.selection;
	const out: { text: string; cls?: string }[] = [];
	for (const field of model.fields) {
		switch (field) {
			case "words":
				out.push(sel ? { text: `${formatCount(sel.words)} w`, cls: "te-cell--selection" } : { text: `${formatCount(s?.words ?? 0)} w` });
				break;
			case "chars":
				out.push(sel ? { text: `${formatCount(sel.chars)} c`, cls: "te-cell--selection" } : { text: `${formatCount(s?.chars ?? 0)} c` });
				break;
			case "lines":
				out.push(sel ? { text: `${formatCount(sel.lines)} l`, cls: "te-cell--selection" } : { text: `${formatCount(s?.lines ?? 0)} l` });
				break;
			case "paragraphs":
				out.push({ text: `${formatCount(s?.paragraphs ?? 0)} ¶` });
				break;
			case "sentences":
				out.push({ text: `${formatCount(s?.sentences ?? 0)} s` });
				break;
			case "readtime":
				out.push({ text: formatMinutes(s?.readMinutes ?? 0) });
				break;
			case "speaktime":
				out.push({ text: `speak ${formatMinutes(s?.speakMinutes ?? 0)}` });
				break;
			case "headings":
				out.push({ text: `${formatCount(s?.headings ?? 0)} h` });
				break;
			case "bytes":
				out.push({ text: `${formatCount(s?.bytes ?? 0)} B` });
				break;
			case "cursor":
				out.push({ text: model.cursor ? `Ln ${model.cursor.line}, Col ${model.cursor.column}` : "" });
				break;
			case "lang":
				out.push({ text: model.lang });
				break;
			case "net":
				out.push({ text: model.online ? "ONLINE" : "OFFLINE" });
				break;
			case "autosave":
				out.push({ text: model.autosave ? "autosave" : "" });
				break;
			default:
				out.push({ text: field });
		}
	}
	return out;
}

export function mountStatusBar(host: HTMLElement, prompt: PromptHost) {
	let model: StatusModel = { stats: null, cursor: null, lang: "en-GB", online: false, autosave: true, fields: [], flash: null };
	let flashTimer: ReturnType<typeof setTimeout> | null = null;
	let promptInput: HTMLInputElement | null = null;
	let historyIndex = -1;

	const render = () => {
		if (promptInput) return;
		const cells = cellsFor(model).filter((c) => c.text !== "");
		const nodes = cells.map((c) => el("span", `te-cell${c.cls ? ` ${c.cls}` : ""}`, c.text));
		if (model.flash) {
			nodes.push(el("span", "te-cell te-cell--spacer"));
			nodes.push(el("span", `te-cell ${model.flash.error ? "te-cell--error" : "te-cell--flash"}`, model.flash.text));
		}
		host.replaceChildren(...nodes);
	};

	const api = {
		update(partial: Partial<StatusModel>) {
			model = { ...model, ...partial };
			render();
		},
		flash(text: string, error = false, ms = 5000) {
			if (flashTimer) clearTimeout(flashTimer);
			model = { ...model, flash: { text, error } };
			render();
			flashTimer = setTimeout(() => {
				model = { ...model, flash: null };
				render();
			}, ms);
		},
		isPromptOpen: () => promptInput !== null,
		openPrompt(initial = "") {
			if (promptInput) {
				promptInput.focus();
				return;
			}
			const input = el("input", "te-prompt") as HTMLInputElement;
			input.type = "text";
			input.placeholder = "command (Tab completes, Esc closes): theme gruvbox-light · lines.sort · help";
			input.value = initial;
			input.spellcheck = false;
			input.autocomplete = "off";
			historyIndex = -1;
			input.addEventListener("keydown", (event) => {
				event.stopPropagation();
				if (event.key === "Escape") {
					event.preventDefault();
					api.closePrompt();
				} else if (event.key === "Enter") {
					event.preventDefault();
					const line = input.value;
					api.closePrompt();
					const parsed = parsePromptLine(line);
					if (!parsed) return;
					prompt.remember(line);
					try {
						const result = prompt.run(parsed.id, parsed.args);
						if (result instanceof Promise) {
							result.then((value) => api.flash(summarise(value)), (error) => api.flash(String(error), true));
						} else {
							api.flash(summarise(result));
						}
					} catch (error) {
						api.flash(String(error), true);
					}
				} else if (event.key === "Tab") {
					event.preventDefault();
					const options = prompt.complete(input.value);
					if (options.length === 1) input.value = `${options[0]} `;
					else if (options.length > 1) api.flashNow(options.slice(0, 12).join("  "));
				} else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
					event.preventDefault();
					const history = prompt.history();
					if (!history.length) return;
					historyIndex = event.key === "ArrowUp" ? Math.min(historyIndex + 1, history.length - 1) : Math.max(historyIndex - 1, -1);
					input.value = historyIndex === -1 ? "" : (history[historyIndex] ?? "");
				}
			});
			input.addEventListener("blur", () => {
				if (promptInput === input) api.closePrompt();
			});
			promptInput = input;
			host.replaceChildren(el("span", "te-cell", ":"), input);
			input.focus();
			input.setSelectionRange(input.value.length, input.value.length);
		},
		flashNow(text: string) {
			// Shows a hint while the prompt is open, without closing it.
			const existing = host.querySelector(".te-cell--flash");
			existing?.remove();
			host.appendChild(el("span", "te-cell te-cell--flash", text));
		},
		closePrompt() {
			if (!promptInput) return;
			promptInput = null;
			render();
			document.dispatchEvent(new CustomEvent("te:prompt-closed"));
		},
	};

	// Clicking the bar must not take the caret out of the text (the prompt input is the exception).
	host.addEventListener("mousedown", (event) => {
		if (!(event.target instanceof HTMLInputElement)) event.preventDefault();
	});

	render();
	return api;
}

function summarise(value: unknown): string {
	if (value === undefined) return "ok";
	if (value === null) return "null";
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	if (Array.isArray(value)) return value.map((v) => (typeof v === "string" ? v : JSON.stringify(v))).join("  ");
	if (typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>).slice(0, 8);
		return entries.map(([k, v]) => `${k}: ${typeof v === "number" ? Math.round(v * 100) / 100 : JSON.stringify(v)}`).join(" · ");
	}
	return String(value);
}
