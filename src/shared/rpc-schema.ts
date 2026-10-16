// Typed RPC contract between the main process (Cottontail) and the webview.
// Requests return data; messages are fire-and-forget. All payloads are JSON.
import type { RPCSchema } from "electrobun/view";
import type { Config, Session } from "./config-schema";
import type { DocumentStats } from "./stats/count";

export type DocResult = {
	path: string;
	markdown: string;
	mtime: number;
};

export type SaveResult =
	| { ok: true; mtime: number }
	| { ok: false; reason: "conflict" | "error"; message: string; mtime?: number };

export type AppInfo = {
	version: string;
	channel: string;
	platform: string;
	online: boolean;
	smoke: boolean;
	headless: boolean;
	profile: { name: string; kind: "default" | "named" | "path"; configDir: string; dataDir: string };
	paths: { config: string; data: string; cache: string; logs: string };
};

export type PixelRect = { x: number; y: number; width: number; height: number };

export type ScreenShotResult =
	| { ok: true; path: string; width: number; height: number; backend: string }
	| { ok: false; error: string; backend: string };

export type RenderResult =
	| {
			ok: true;
			path: string;
			htmlPath: string;
			width: number;
			height: number;
			metrics: { dpr: number; innerWidth: number; innerHeight: number; docWidth: number; docHeight: number };
	  }
	| { ok: false; error: string };

export type CropResult = { ok: true; path: string } & PixelRect;

export type DiffResult = {
	ok: true;
	tolerance?: number;
	width: number;
	height: number;
	sameSize: boolean;
	mismatch: number;
	mismatchPct: number;
	bbox: [number, number, number, number] | null;
	diffPath: string | null;
};

export type MarksResult =
	| { ok: true; path: string; region?: "outer" | "inner"; frame: PixelRect & { thickness: number }; inner: PixelRect }
	| { ok: false; error: string };

export type RenderOptions = {
	width: number;
	height?: number;
	name?: string;
	backend?: "x11" | "wayland";
	viewport?: boolean;
};

export type AppRPC = {
	bun: RPCSchema<{
		requests: {
			getAppInfo: { params: Record<string, never>; response: AppInfo };
			newShotDir: { params: { label: string }; response: { dir: string } };
			writeArtifact: { params: { dir: string; name: string; content: string }; response: { path: string } };
			shotScreen: { params: { dir: string; name?: string }; response: ScreenShotResult };
			renderHtml: { params: { dir: string; html: string; options: RenderOptions }; response: RenderResult };
			cropImage: { params: { path: string; rect: PixelRect; out: string }; response: CropResult };
			diffImages: { params: { a: string; b: string; out?: string; tolerance?: number }; response: DiffResult };
			locateMarks: { params: { path: string; out: string; region?: "outer" | "inner" }; response: MarksResult };
			pickOpenPaths: { params: { startingFolder?: string }; response: { paths: string[] } };
			pickDirectory: { params: { startingFolder?: string }; response: { dir: string | null } };
			readDocument: { params: { path: string }; response: DocResult };
			saveDocument: {
				params: { path: string; markdown: string; expectedMtime?: number };
				response: SaveResult;
			};
			getConfig: { params: Record<string, never>; response: Config };
			saveConfig: { params: { config: Config }; response: Record<string, never> };
			getSession: { params: Record<string, never>; response: Session };
			saveSession: { params: { session: Session }; response: Record<string, never> };
			clipboardReadText: { params: Record<string, never>; response: { text: string | null } };
			clipboardWriteText: { params: { text: string }; response: Record<string, never> };
			revealPath: { params: { path: string }; response: Record<string, never> };
		};
		messages: {
			rendererReady: Record<string, never>;
			toggleDevTools: Record<string, never>;
			windowCommand: { action: "close" | "minimize" | "maximize" | "fullscreen" | "quit" };
			log: { level: "info" | "warn" | "error"; message: string };
		};
	}>;
	webview: RPCSchema<{
		requests: {
			getStats: { params: Record<string, never>; response: DocumentStats };
			requestClose: { params: Record<string, never>; response: { allow: boolean } };
			/** Run any registered command from the main process (automation, smoke runs). */
			runCommand: { params: { id: string; args?: unknown[] }; response: { ok: boolean; result?: unknown; error?: string } };
		};
		messages: {
			openPaths: { paths: string[] };
			fileChangedOnDisk: { path: string; mtime: number };
			configChanged: { config: Config };
		};
	}>;
};
