// Built-in commands. Every entry is reachable as te.<id>() from the F12
// console, from its key combo, and from the status-bar prompt.
import { TextSelection } from "@milkdown/kit/prose/state";
import type { Command } from "../../shared/commands";
import { formatMinutes } from "../../shared/stats/count";
import { lineOps, textOps, transformSelectedLines, transformSelectionText } from "../editor/transforms";
import { cursorPosition, positionAt } from "../stats/engine";
import { applyCaret, applyFont, applyTheme, listThemes } from "../theme";
import type { AppContext } from "./context";

const needsEditor = (ctx: AppContext) => ctx.tabs.active.get() !== null;

export const builtinCommands: Command<AppContext>[] = [
	// ---- help ------------------------------------------------------------
	{
		id: "help",
		title: "List commands (optionally for one namespace)",
		usage: "te.help('text')",
		run: (ctx, ns) => {
			const lines = ctx.registry.helpLines(typeof ns === "string" ? ns : undefined);
			console.log(lines.join("\n"));
			return lines;
		},
	},

	// ---- files -----------------------------------------------------------
	{
		id: "file.new",
		title: "New untitled document",
		keys: ["Ctrl+N"],
		run: async (ctx) => (await ctx.tabs.newTab()).title,
	},
	{
		id: "file.open",
		title: "Open file(s); with no argument shows the file dialog",
		keys: ["Ctrl+O"],
		usage: "te.file.open('/path/a.md')",
		run: async (ctx, ...paths) => {
			const list = paths.filter((p): p is string => typeof p === "string");
			const opened = await ctx.tabs.open(list.length ? list : undefined);
			return opened.map((t) => t.path ?? t.title);
		},
	},
	{
		id: "file.save",
		title: "Save the active document (true = overwrite a conflicting file)",
		keys: ["Ctrl+S"],
		when: needsEditor,
		run: (ctx, force) => ctx.tabs.save(undefined, force === true),
	},
	{
		id: "file.saveAs",
		title: "Save the active document under a new path (asks for a folder when omitted)",
		keys: ["Ctrl+Shift+S"],
		when: needsEditor,
		usage: "te.file.saveAs('/path/new.md')",
		run: (ctx, target) => ctx.tabs.saveAs(undefined, typeof target === "string" ? target : undefined),
	},
	{
		id: "file.saveAll",
		title: "Save every dirty document that has a path",
		when: needsEditor,
		run: async (ctx) => {
			let n = 0;
			for (const tab of ctx.tabs.list()) if (tab.dirty && tab.path && (await ctx.tabs.save(tab.id))) n++;
			return n;
		},
	},
	{
		id: "file.reload",
		title: "Reload the active document from disk, discarding local changes",
		when: needsEditor,
		run: (ctx) => ctx.tabs.reload(),
	},
	{
		id: "file.close",
		title: "Close the active tab (true = discard unsaved text)",
		keys: ["Ctrl+W"],
		when: needsEditor,
		run: (ctx, discard) => ctx.tabs.close(undefined, discard === true),
	},
	{
		id: "file.reveal",
		title: "Show the active file in the file manager",
		when: (ctx) => !!ctx.tabs.active.get()?.path,
		run: async (ctx) => {
			const path = ctx.tabs.active.get()?.path;
			if (path) await ctx.main.request.revealPath({ path });
			return path;
		},
	},
	{
		id: "file.path",
		title: "Print the active file path",
		run: (ctx) => ctx.tabs.active.get()?.path ?? null,
	},

	// ---- tabs ------------------------------------------------------------
	{ id: "tabs.next", title: "Next tab", keys: ["Ctrl+Tab", "Ctrl+PageDown"], run: (ctx) => ctx.tabs.cycle(1) },
	{ id: "tabs.prev", title: "Previous tab", keys: ["Ctrl+Shift+Tab", "Ctrl+PageUp"], run: (ctx) => ctx.tabs.cycle(-1) },
	{
		id: "tabs.go",
		title: "Activate tab by 1-based index",
		usage: "te.tabs.go(2)",
		run: (ctx, n) => ctx.tabs.activateByIndex((typeof n === "number" ? n : 1) - 1),
	},
	{ id: "tabs.moveLeft", title: "Move active tab left", keys: ["Alt+Left"], run: (ctx) => ctx.tabs.move(-1) },
	{ id: "tabs.moveRight", title: "Move active tab right", keys: ["Alt+Right"], run: (ctx) => ctx.tabs.move(1) },
	{
		id: "tabs.list",
		title: "List open tabs",
		run: (ctx) => {
			const rows = ctx.tabs.list().map((t, i) => ({ index: i + 1, title: t.title, path: t.path, dirty: t.dirty }));
			console.table(rows);
			return rows;
		},
	},
	...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(
		(n): Command<AppContext> => ({
			id: `tabs.go${n}`,
			title: `Activate tab ${n}`,
			keys: [`Ctrl+${n}`],
			run: (ctx) => ctx.tabs.activateByIndex(n - 1),
		}),
	),

	// ---- navigation --------------------------------------------------------
	{
		id: "goto",
		title: "Move the caret to a line (and column) as counted in the status bar; no argument opens the prompt",
		usage: "te.goto(120, 5)",
		keys: ["Ctrl+G"],
		when: needsEditor,
		run: (ctx, line, column) => {
			const view = ctx.view();
			if (typeof line !== "number") {
				ctx.status.openPrompt("goto ");
				return cursorPosition(view);
			}
			const pos = positionAt(view.state.doc, line, typeof column === "number" ? column : 1);
			view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(pos))).scrollIntoView());
			view.focus();
			return cursorPosition(view);
		},
	},

	// ---- text transforms (selection or word at caret) --------------------
	{
		id: "text.lowercase",
		title: "Lowercase the selection",
		when: needsEditor,
		run: (ctx) => transformSelectionText(ctx.view(), textOps.lower),
	},
	{
		id: "text.uppercase",
		title: "Uppercase the selection",
		when: needsEditor,
		run: (ctx) => transformSelectionText(ctx.view(), textOps.upper),
	},
	{
		id: "text.titleCase",
		title: "Title Case The Selection",
		when: needsEditor,
		run: (ctx) => transformSelectionText(ctx.view(), textOps.title),
	},
	{
		id: "text.sentenceCase",
		title: "Sentence case the selection",
		when: needsEditor,
		run: (ctx) => transformSelectionText(ctx.view(), textOps.sentence),
	},

	// ---- lines (selected top-level blocks) --------------------------------
	{
		id: "lines.sort",
		title: "Sort selected lines/blocks ascending (true = descending)",
		when: needsEditor,
		run: (ctx, desc) => transformSelectedLines(ctx.view(), lineOps.sort(desc === true)),
	},
	{
		id: "lines.sortDesc",
		title: "Sort selected lines/blocks descending",
		when: needsEditor,
		run: (ctx) => transformSelectedLines(ctx.view(), lineOps.sort(true)),
	},
	{
		id: "lines.unique",
		title: "Remove duplicate lines/blocks in the selection",
		when: needsEditor,
		run: (ctx) => transformSelectedLines(ctx.view(), lineOps.unique()),
	},
	{
		id: "lines.reverse",
		title: "Reverse selected lines/blocks",
		when: needsEditor,
		run: (ctx) => transformSelectedLines(ctx.view(), lineOps.reverse()),
	},
	{
		id: "lines.shuffle",
		title: "Shuffle selected lines/blocks",
		when: needsEditor,
		run: (ctx) => transformSelectedLines(ctx.view(), lineOps.shuffle()),
	},

	// ---- theme and font ----------------------------------------------------
	{
		id: "theme",
		title: "Set the theme; with no argument prints the current one",
		usage: "te.theme('nord-light')",
		run: async (ctx, name) => {
			if (typeof name !== "string") return ctx.config.get().theme;
			applyTheme(name);
			await ctx.patchConfig({ theme: name });
			return name;
		},
	},
	{ id: "theme.list", title: "List themes", run: () => listThemes() },
	{
		id: "theme.next",
		title: "Cycle to the next theme",
		keys: ["Ctrl+Shift+T"],
		run: async (ctx) => {
			const names = listThemes();
			const idx = names.indexOf(ctx.config.get().theme);
			const next = names[(idx + 1) % names.length]!;
			applyTheme(next);
			await ctx.patchConfig({ theme: next });
			return next;
		},
	},
	{
		id: "font",
		title: "Set font family / size / leading; no argument prints the current values",
		usage: "te.font('Iosevka', 16, 1.7)",
		run: async (ctx, family, size, leading) => {
			const current = ctx.config.get().font;
			if (family === undefined) return current;
			const font = {
				...current,
				...(typeof family === "string" ? { family } : {}),
				...(typeof size === "number" ? { size } : {}),
				...(typeof leading === "number" ? { leading } : {}),
			};
			applyFont(font);
			await ctx.patchConfig({ font });
			return font;
		},
	},
	{
		id: "font.measure",
		title: "Set the line measure in characters",
		usage: "te.font.measure(64)",
		run: async (ctx, measure) => {
			const font = { ...ctx.config.get().font, measure: typeof measure === "number" ? measure : 72 };
			applyFont(font);
			await ctx.patchConfig({ font });
			return font.measure;
		},
	},

	// ---- statistics ---------------------------------------------------------
	{
		id: "stats",
		title: "Print statistics for the active document",
		when: needsEditor,
		run: (ctx) => {
			const stats = ctx.stats();
			console.table({
				words: stats.words,
				characters: stats.chars,
				"characters (no spaces)": stats.charsNoSpaces,
				sentences: stats.sentences,
				paragraphs: stats.paragraphs,
				headings: stats.headings,
				lines: stats.lines,
				"read time": formatMinutes(stats.readMinutes),
				"speak time": formatMinutes(stats.speakMinutes),
				bytes: stats.bytes,
			});
			return stats;
		},
	},
	{
		id: "stats.wpm",
		title: "Set words-per-minute for time-to-read",
		usage: "te.stats.wpm(200)",
		run: async (ctx, wpm) => {
			if (typeof wpm !== "number") return ctx.config.get().stats.wpm;
			await ctx.patchConfig({ stats: { ...ctx.config.get().stats, wpm } });
			ctx.refreshStats();
			return wpm;
		},
	},
	{
		id: "status.fields",
		title: "Choose status bar cells",
		usage: "te.status.fields(['words','readtime','net'])",
		run: async (ctx, fields) => {
			if (!Array.isArray(fields)) return ctx.config.get().stats.fields;
			const list = fields.filter((f): f is string => typeof f === "string");
			await ctx.patchConfig({ stats: { ...ctx.config.get().stats, fields: list } });
			ctx.refreshStats();
			return list;
		},
	},

	// ---- autosave -------------------------------------------------------------
	{
		id: "autosave",
		title: "Turn autosave on/off; no argument prints the current state",
		usage: "te.autosave(false)",
		run: async (ctx, on) => {
			const current = ctx.config.get().autosave;
			if (typeof on !== "boolean") return current.enabled;
			await ctx.patchConfig({ autosave: { ...current, enabled: on } });
			ctx.status.flash(on ? "autosave on" : "autosave off (Ctrl+S saves)");
			return on;
		},
	},

	// ---- view ---------------------------------------------------------------
	{
		id: "view.devtools",
		title: "Toggle the WebKit inspector",
		keys: ["F12"],
		run: (ctx) => ctx.main.send.toggleDevTools({}),
	},
	{
		id: "view.prompt",
		title: "Open the command prompt in the status bar",
		keys: ["Ctrl+;"],
		run: (ctx) => ctx.status.openPrompt(),
	},
	{
		id: "view.zen",
		title: "Toggle both bars",
		keys: ["Ctrl+Shift+Z"],
		run: () => document.body.classList.toggle("te-zen"),
	},
	{
		id: "caret",
		title: "Caret style: 'block' (one character cell, default) or 'bar' (WebKit's 1 px caret); no argument prints it",
		usage: "te.caret('bar')",
		run: async (ctx, style) => {
			if (style === undefined) return ctx.config.get().caret;
			if (style !== "block" && style !== "bar") throw new Error(`caret style must be "block" or "bar", got ${JSON.stringify(style)}`);
			applyCaret(style);
			await ctx.patchConfig({ caret: style });
			return style;
		},
	},
	{
		id: "view.fullscreen",
		title: "Toggle fullscreen",
		keys: ["F11"],
		run: (ctx) => ctx.main.send.windowCommand({ action: "fullscreen" }),
	},

	// ---- app ----------------------------------------------------------------
	{
		id: "app.info",
		title: "Version, channel, profile, paths, online state",
		run: (ctx) => ctx.info,
	},
	{
		id: "app.profile",
		title: "Name and directories of the active profile",
		run: (ctx) => ctx.info.profile,
	},
	{
		id: "app.config",
		title: "Print the current config",
		run: (ctx) => ctx.config.get(),
	},
	{
		id: "app.quit",
		title: "Save session and quit",
		keys: ["Ctrl+Q"],
		run: async (ctx) => {
			await ctx.tabs.saveSession();
			ctx.main.send.windowCommand({ action: "quit" });
		},
	},
];
