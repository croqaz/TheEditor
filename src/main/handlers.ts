// RPC handlers for the main process, built from injected dependencies so they
// can be unit-tested without Electrobun.
// The config type is exported from the browser entry only; it is the same shared type.
import type { ElectrobunRPCConfig } from "electrobun/view";
import type { ConfigSchema, SessionSchema } from "../shared/config-schema";
import type { AppInfo, AppRPC } from "../shared/rpc-schema";
import { readDocument, saveDocument } from "./documents";
import type { ProfilePaths } from "./profile";
import type { Shots } from "./shots";
import type { JsonStore } from "./store";

export interface MainDeps {
	paths: ProfilePaths;
	info: () => Promise<AppInfo>;
	config: JsonStore<typeof ConfigSchema>;
	session: JsonStore<typeof SessionSchema>;
	dialogs: {
		openFiles(startingFolder?: string): Promise<string[]>;
		openDirectory(startingFolder?: string): Promise<string | null>;
	};
	clipboard: {
		readText(): string | null;
		writeText(text: string): void;
	};
	reveal(path: string): void;
	window: {
		toggleDevTools(): void;
		requestClose(): void;
		minimize(): void;
		toggleMaximize(): void;
		toggleFullscreen(): void;
	};
	quit(): void;
	onRendererReady(): void;
	log: (message: string) => void;
	defaultFolder: string;
	shots: Pick<Shots, "newDir" | "writeArtifact" | "screen" | "render" | "crop" | "diff" | "marks">;
}

export type MainHandlers = ElectrobunRPCConfig<AppRPC, "bun">["handlers"];

/** Dialog results may arrive as file:// URIs on some backends; normalise to plain paths. */
export function normaliseDialogPath(entry: string): string {
	const trimmed = entry.trim();
	if (trimmed.startsWith("file://")) {
		try {
			return decodeURIComponent(trimmed.slice("file://".length));
		} catch {
			return trimmed.slice("file://".length);
		}
	}
	return trimmed;
}

export function createHandlers(deps: MainDeps): MainHandlers {
	return {
		requests: {
			getAppInfo: () => deps.info(),
			newShotDir: async ({ label }) => ({ dir: await deps.shots.newDir(label) }),
			writeArtifact: async ({ dir, name, content }) => ({ path: await deps.shots.writeArtifact(dir, name, content) }),
			shotScreen: ({ dir, name }) => deps.shots.screen(dir, name),
			renderHtml: ({ dir, html, options }) => deps.shots.render(dir, html, options),
			cropImage: ({ path, rect, out }) => deps.shots.crop(path, rect, out),
			diffImages: ({ a, b, out, tolerance }) => deps.shots.diff(a, b, out, tolerance),
			locateMarks: ({ path, out, region }) => deps.shots.marks(path, out, region),
			pickOpenPaths: async ({ startingFolder }) => {
				const raw = await deps.dialogs.openFiles(startingFolder ?? deps.defaultFolder);
				const paths = raw.map(normaliseDialogPath).filter(Boolean);
				deps.log(`open dialog returned ${paths.length} path(s)${paths.length ? `: ${paths.join(", ")}` : ""}`);
				return { paths };
			},
			pickDirectory: async ({ startingFolder }) => {
				const dir = await deps.dialogs.openDirectory(startingFolder ?? deps.defaultFolder);
				return { dir: dir ? normaliseDialogPath(dir) : null };
			},
			readDocument: ({ path }) => readDocument(path),
			saveDocument: ({ path, markdown, expectedMtime }) =>
				saveDocument(path, markdown, expectedMtime, deps.paths.recoveryDir),
			getConfig: () => deps.config.get(),
			saveConfig: ({ config }) => {
				deps.config.set(config);
				return {};
			},
			getSession: () => deps.session.get(),
			saveSession: ({ session }) => {
				deps.session.set(session);
				return {};
			},
			clipboardReadText: () => ({ text: deps.clipboard.readText() }),
			clipboardWriteText: ({ text }) => {
				deps.clipboard.writeText(text);
				return {};
			},
			revealPath: ({ path }) => {
				deps.reveal(path);
				return {};
			},
		},
		messages: {
			rendererReady: () => deps.onRendererReady(),
			toggleDevTools: () => deps.window.toggleDevTools(),
			windowCommand: ({ action }) => {
				switch (action) {
					case "close":
						deps.window.requestClose();
						break;
					case "minimize":
						deps.window.minimize();
						break;
					case "maximize":
						deps.window.toggleMaximize();
						break;
					case "fullscreen":
						deps.window.toggleFullscreen();
						break;
					case "quit":
						deps.quit();
						break;
				}
			},
			log: ({ level, message }) => {
				deps.log(`[view:${level}] ${message}`);
			},
		},
	};
}
