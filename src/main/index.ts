// Main process bootstrap (Cottontail). Wiring only; logic lives in the
// tested modules: args.ts, profile.ts, store.ts, documents.ts, handlers.ts.
//
// Flags: --profile <name|path>  --online  --headless  --smoke  --run <json>  --keep  [files…]
// Env:   TE_PROFILE  THEEDITOR_ONLINE=1  TE_HEADLESS=1  TE_SMOKE=1  TE_RUN=<json>  TE_KEEP=1  TE_OPEN=<path>
import { dirname, join } from "node:path";
import Electrobun, { BrowserView, BrowserWindow, Screen, Updater, Utils } from "electrobun/main";
import { ConfigSchema, SessionSchema } from "../shared/config-schema";
import type { AppInfo, AppRPC } from "../shared/rpc-schema";
import { parseArgs } from "./args";
import { createHandlers } from "./handlers";
import { createPaths } from "./paths";
import { runCommand, which } from "./run";
import { type ScreenBackend, Shots } from "./shots";
import { JsonStore } from "./store";

const DEV_SERVER_URL = "http://localhost:5173";

const cwd = process.env.PWD ?? process.cwd();
const launch = parseArgs(process.argv.slice(2), process.env, cwd);
const paths = createPaths(launch.profile, cwd);

console.log(`[main] argv: ${JSON.stringify(process.argv.slice(2))}`);
console.log(
	`[main] profile "${paths.name}" (${paths.kind}): config ${paths.configDir}, data ${paths.dataDir}${launch.unknown.length ? `; unknown flags ${launch.unknown.join(" ")}` : ""}`,
);

const config = new JsonStore(paths.configFile, ConfigSchema);
const session = new JsonStore(paths.sessionFile, SessionSchema);

function flushStores() {
	config.flushSync();
	session.flushSync();
}

async function channelAndVersion(): Promise<{ channel: string; version: string }> {
	try {
		return { channel: await Updater.localInfo.channel(), version: await Updater.localInfo.version() };
	} catch {
		return { channel: "stable", version: "0.1.0" };
	}
}

async function getMainViewUrl(): Promise<string> {
	const { channel } = await channelAndVersion();
	if (channel === "dev") {
		try {
			await fetch(DEV_SERVER_URL, { method: "HEAD" });
			console.log(`[main] HMR: using Vite dev server at ${DEV_SERVER_URL}`);
			return DEV_SERVER_URL;
		} catch {
			// Vite dev server not running; use the built views.
		}
	}
	return "views://mainview/index.html";
}

async function appInfo(): Promise<AppInfo> {
	const { channel, version } = await channelAndVersion();
	return {
		version,
		channel,
		platform: process.platform,
		online: launch.online,
		smoke: launch.smoke,
		headless: launch.headless,
		profile: { name: paths.name, kind: paths.kind, configDir: paths.configDir, dataDir: paths.dataDir },
		paths: { config: paths.configDir, data: paths.dataDir, cache: paths.cacheDir, logs: paths.logsDir },
	};
}

// tools/te-snap.py lives next to the sources in dev and under Resources/tools in a bundle.
function locateTool(): string {
	const candidates = [
		join(cwd, "tools", "te-snap.py"),
		join(dirname(process.argv[1] ?? ""), "tools", "te-snap.py"),
		join(dirname(process.argv[1] ?? ""), "..", "Resources", "tools", "te-snap.py"),
	];
	return process.env.TE_SNAP_TOOL ?? candidates[0]!;
}

const shots = new Shots({
	cacheDir: paths.cacheDir,
	toolPath: locateTool(),
	python: process.env.TE_PYTHON ?? "python3",
	run: runCommand,
	which,
	backend: (process.env.TE_SHOT_BACKEND as ScreenBackend | undefined) ?? "auto",
	desktop: process.env.XDG_CURRENT_DESKTOP ?? "",
	captureRegion: (rect) => Screen.captureRegion(rect),
	windowFrame: () => {
		try {
			return win.getFrame();
		} catch {
			return null;
		}
	},
	log: (message) => console.log(`[shots] ${message}`),
});

const handlers = createHandlers({
	paths,
	info: appInfo,
	config,
	session,
	shots,
	dialogs: {
		openFiles: (startingFolder) =>
			Utils.openFileDialog({
				startingFolder,
				allowedFileTypes: "md,markdown,txt",
				canChooseFiles: true,
				canChooseDirectory: false,
				allowsMultipleSelection: true,
			}),
		openDirectory: async (startingFolder) =>
			(
				await Utils.openFileDialog({
					startingFolder,
					canChooseFiles: false,
					canChooseDirectory: true,
					allowsMultipleSelection: false,
				})
			)[0] ?? null,
	},
	clipboard: { readText: () => Utils.clipboardReadText(), writeText: (text) => Utils.clipboardWriteText(text) },
	reveal: (path) => Utils.showItemInFolder(path),
	window: {
		toggleDevTools: () => win.webview.toggleDevTools(),
		requestClose: () => win.requestClose(),
		minimize: () => win.minimize(),
		toggleMaximize: () => (win.isMaximized() ? win.unmaximize() : win.maximize()),
		toggleFullscreen: () => win.setFullScreen(!win.isFullScreen()),
	},
	quit: () => {
		flushStores();
		Utils.quit();
	},
	onRendererReady: () => onRendererReady(),
	log: (message) => console.log(`[main] ${message}`),
	defaultFolder: Utils.paths.documents,
});

const rpc = BrowserView.defineRPC<AppRPC>({ maxRequestTime: 30_000, handlers });

const url = await getMainViewUrl();
const chrome = config.get().window.chrome;
const { width, height } = session.get().window;

// Navigation allow-list: the webview may only navigate within the bundle (or the
// Vite dev server). A dropped file or a clicked link can no longer replace the app.
const navigationRules = [url.startsWith("http") ? `${url}/*` : "views://mainview/*", "views://mainview/*"];

const win = new BrowserWindow({
	title: paths.kind === "default" ? "TheEditor!" : `TheEditor! [${paths.name}]`,
	url,
	rpc,
	titleBarStyle: chrome === "tabs" ? "hidden" : "default",
	hidden: launch.headless,
	frame: { width, height },
	navigationRules: JSON.stringify(navigationRules),
});

win.on("resize", (event: unknown) => {
	const data = (event as { data?: { width?: number; height?: number } }).data;
	if (data?.width && data?.height) {
		session.patch({ window: { width: Math.round(data.width), height: Math.round(data.height) } });
	}
});

Electrobun.events.on("before-quit", () => {
	flushStores();
});

async function onRendererReady() {
	const viewRpc = win.webview.rpc;
	if (!viewRpc) return;
	if (launch.files.length) viewRpc.send.openPaths({ paths: launch.files });
	console.log(`[main] view ready; online=${launch.online} headless=${launch.headless} smoke=${launch.smoke} smokeShots=${launch.smokeShots} run=${launch.run?.length ?? 0}`);
	if (launch.run) {
		// Scripted session: run each [id, ...args] through te.* in order, print one RUN line per command.
		const script = launch.run;
		setTimeout(async () => {
			for (const [id, ...args] of script) {
				try {
					const outcome = await viewRpc.request.runCommand({ id: String(id), args });
					console.log(`RUN ${String(id)} ${JSON.stringify(outcome)}`);
				} catch (error) {
					console.log(`RUN_FAIL ${String(id)} ${String(error)}`);
				}
			}
			console.log("RUN_DONE");
			if (!launch.keep) {
				flushStores();
				Utils.quit();
			}
		}, 2500);
		return;
	}
	if (launch.smokeShots) {
		setTimeout(async () => {
			try {
				const outcome = await viewRpc.request.runCommand({ id: "shot.verify", args: [{ label: "smoke" }] });
				console.log(`SMOKE_SHOTS ${JSON.stringify(outcome)}`);
			} catch (error) {
				console.log(`SMOKE_SHOTS_FAIL ${String(error)}`);
			}
			flushStores();
			Utils.quit();
		}, 2500);
		return;
	}
	if (launch.smoke) {
		setTimeout(async () => {
			try {
				const stats = await viewRpc.request.getStats({});
				console.log(`SMOKE_OK ${JSON.stringify(stats)}`);
			} catch (error) {
				console.log(`SMOKE_FAIL ${String(error)}`);
			}
			flushStores();
			Utils.quit();
		}, 1500);
	}
}

console.log(`[main] TheEditor! starting (${url})`);
