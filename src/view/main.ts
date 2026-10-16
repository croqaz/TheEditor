// View boot: config → theme → tabs → bars → keymap → te.* → session → ready.
import "@milkdown/kit/prose/view/style/prosemirror.css";
import "./index.css";
import "./editor.css";
import { CommandRegistry } from "../shared/commands";
import type { Config } from "../shared/config-schema";
import type { AppInfo } from "../shared/rpc-schema";
import type { DocumentStats } from "../shared/stats/count";
import { mountStatusBar } from "./bars/status";
import { mountTabBar } from "./bars/tabs";
import { builtinCommands } from "./commands/builtin";
import type { AppContext } from "./commands/context";
import { TabManager } from "./documents/tabs";
import { installDropHandler } from "./drop";
import { shotCommands } from "./shots/commands";
import { installKeymap } from "./keymap";
import { installHandlers, log, main } from "./rpc";
import { debounce, signal } from "./state";
import { computeStats, cursorPosition } from "./stats/engine";
import { applyCaret, applyFont, applyTheme } from "./theme";

async function boot() {
	const tabsHost = document.getElementById("tabs")!;
	const editorHost = document.getElementById("editor")!;
	const statusHost = document.getElementById("status")!;

	const info: AppInfo = await main.request.getAppInfo({});
	const config = signal<Config>(await main.request.getConfig({}));
	try {
		applyTheme(config.get().theme);
	} catch (error) {
		log("warn", String(error));
		applyTheme("gruvbox-dark");
	}
	applyFont(config.get().font);
	applyCaret(config.get().caret);

	const registry = new CommandRegistry<AppContext>();
	let promptHistory: string[] = [];

	const status = mountStatusBar(statusHost, {
		run: (id, args) => {
			const resolved = registry.get(id) ? id : registry.list().find((c) => c.id.endsWith(`.${id}`))?.id;
			if (!resolved) throw new Error(`unknown command: ${id} (try help)`);
			return registry.run(resolved, ctx, ...args);
		},
		complete: (prefix) => registry.list().map((c) => c.id).filter((id) => id.startsWith(prefix)),
		history: () => promptHistory,
		remember: (line) => {
			promptHistory = [line, ...promptHistory.filter((l) => l !== line)].slice(0, 50);
			void main.request.getSession({}).then((s) => main.request.saveSession({ session: { ...s, promptHistory } }));
		},
	});

	let lastStats: DocumentStats | null = null;
	const refreshStats = () => {
		const tab = tabs.active.get();
		if (!tab) {
			lastStats = null;
			status.update({ stats: null, cursor: null });
			return;
		}
		const view = tab.editor.view();
		const t0 = performance.now();
		lastStats = computeStats(view, tab.bytes, {
			lang: config.get().spell.lang,
			wpm: config.get().stats.wpm,
		});
		status.update({ stats: lastStats, cursor: cursorPosition(view), fields: config.get().stats.fields });
		const dt = performance.now() - t0;
		if (dt > 50) log("info", `stats for ${tab.title}: ${Math.round(dt)} ms`);
	};
	const refreshStatsDebounced = debounce(refreshStats, 250);
	const refreshCursor = () => {
		const tab = tabs.active.get();
		if (!tab) return;
		const view = tab.editor.view();
		if (lastStats) {
			const { from, to } = view.state.selection;
			lastStats = { ...lastStats, selection: undefined };
			if (from !== to) refreshStatsDebounced();
		}
		status.update({ cursor: cursorPosition(view), stats: lastStats });
	};

	const tabs = new TabManager(
		editorHost,
		{
			onDocChanged: () => refreshStatsDebounced(),
			onSelectionChanged: () => refreshCursor(),
			onSaved: (tab, auto) => status.flash(`${auto ? "autosaved" : "saved"} ${tab.title}`, false, 2000),
		},
		config.get(),
	);
	tabs.active.subscribe(() => refreshStats());

	mountTabBar(tabsHost, tabs, config.get().window.chrome === "tabs");
	status.update({
		online: info.online,
		autosave: config.get().autosave.enabled,
		lang: config.get().spell.lang,
		fields: config.get().stats.fields,
	});

	const ctx: AppContext = {
		registry,
		tabs,
		config,
		info,
		main,
		status,
		view: () => {
			const tab = tabs.active.get();
			if (!tab) throw new Error("no open document");
			return tab.editor.view();
		},
		stats: () => {
			refreshStats();
			if (!lastStats) throw new Error("no open document");
			return lastStats;
		},
		refreshStats,
		patchConfig: async (partial) => {
			const next = { ...config.get(), ...partial };
			await main.request.saveConfig({ config: next });
			config.set(next);
			tabs.setConfig(next);
			status.update({ fields: next.stats.fields, lang: next.spell.lang, autosave: next.autosave.enabled });
			return next;
		},
	};

	registry.registerAll(builtinCommands);
	registry.registerAll(shotCommands);
	installKeymap(registry, ctx);
	window.te = registry.buildApi(ctx);
	Object.defineProperty(window.te, "registry", { value: registry, enumerable: false });

	installHandlers({
		getStats: () => ctx.stats(),
		requestClose: () => ({ allow: !tabs.list().some((t) => t.dirty && !t.path) }),
		runCommand: async (id, args) => {
			try {
				const result = await registry.run(id, ctx, ...args);
				return { ok: true, result };
			} catch (error) {
				return { ok: false, error: error instanceof Error ? error.message : String(error) };
			}
		},
		openPaths: (paths) => void tabs.open(paths),
		fileChangedOnDisk: (path, mtime) => {
			const tab = tabs.byPath(path);
			if (!tab) return;
			if (!tab.dirty) void tabs.reload(tab.id);
			else {
				tab.conflict = true;
				tab.mtime = mtime;
				status.flash(`${tab.title} changed on disk; te.file.reload() or te.file.save(true)`, true);
			}
		},
		configChanged: (next) => {
			config.set(next);
			tabs.setConfig(next);
			applyTheme(next.theme);
			applyFont(next.font);
			applyCaret(next.caret);
		},
	});

	const session = await main.request.getSession({});
	promptHistory = session.promptHistory;
	await tabs.restore(session);

	installDropHandler(window, {
		openPaths: (paths) => void tabs.open(paths),
		openText: (name, text) => void tabs.openText(name, text),
	});

	window.addEventListener("blur", () => {
		for (const tab of tabs.list()) if (tab.dirty && tab.path) void tabs.save(tab.id);
	});

	main.send.rendererReady({});
	const words = tabs.active.get() ? ctx.stats().words : 0;
	log(
		"info",
		`ready in ${Math.round(performance.now())} ms: ${tabs.list().length} tab(s), ${words} words, theme ${config.get().theme}, ${info.online ? "online" : "offline"}, dpr ${window.devicePixelRatio}, ${window.innerWidth}x${window.innerHeight}`,
	);
	console.log("TheEditor! commands: te.help()  ·  prompt: Ctrl+;  ·  devtools: F12");
}

boot().catch((error: unknown) => {
	const message = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
	console.error(`boot failed: ${message}`);
	document.body.textContent = `TheEditor! failed to start: ${message}`;
});
