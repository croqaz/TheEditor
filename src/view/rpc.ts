// Webview side of the typed RPC. Handlers are late-bound so the app can
// install them after it has built its state.
import { Electroview } from "electrobun/view";
import type { Config } from "../shared/config-schema";
import type { AppRPC } from "../shared/rpc-schema";
import type { DocumentStats } from "../shared/stats/count";

export interface ViewHandlers {
	getStats: () => DocumentStats;
	requestClose: () => { allow: boolean };
	runCommand: (id: string, args: unknown[]) => Promise<{ ok: boolean; result?: unknown; error?: string }>;
	openPaths: (paths: string[]) => void;
	fileChangedOnDisk: (path: string, mtime: number) => void;
	configChanged: (config: Config) => void;
}

const notReady = () => {
	throw new Error("view handlers not installed yet");
};

export const handlers: ViewHandlers = {
	getStats: notReady,
	requestClose: notReady,
	runCommand: notReady,
	openPaths: () => {},
	fileChangedOnDisk: () => {},
	configChanged: () => {},
};

export function installHandlers(next: ViewHandlers) {
	Object.assign(handlers, next);
}

const rpc = Electroview.defineRPC<AppRPC>({
	maxRequestTime: 30_000,
	handlers: {
		requests: {
			getStats: () => handlers.getStats(),
			requestClose: () => handlers.requestClose(),
			runCommand: ({ id, args }) => handlers.runCommand(id, args ?? []),
		},
		messages: {
			openPaths: ({ paths }) => handlers.openPaths(paths),
			fileChangedOnDisk: ({ path, mtime }) => handlers.fileChangedOnDisk(path, mtime),
			configChanged: ({ config }) => handlers.configChanged(config),
		},
	},
});

export const electroview = new Electroview({ rpc });

/** Typed calls into the main process. */
export const main = {
	request: rpc.request,
	send: rpc.send,
};

export function log(level: "info" | "warn" | "error", message: string) {
	console[level](message);
	try {
		main.send.log({ level, message });
	} catch {
		// not connected yet
	}
}
