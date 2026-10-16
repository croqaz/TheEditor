// What every command receives.
import type { EditorView } from "@milkdown/kit/prose/view";
import type { CommandRegistry } from "../../shared/commands";
import type { Config } from "../../shared/config-schema";
import type { AppInfo } from "../../shared/rpc-schema";
import type { DocumentStats } from "../../shared/stats/count";
import type { TabManager } from "../documents/tabs";
import type { main } from "../rpc";
import type { Signal } from "../state";

export interface AppContext {
	registry: CommandRegistry<AppContext>;
	tabs: TabManager;
	config: Signal<Config>;
	info: AppInfo;
	main: typeof main;
	status: { openPrompt(initial?: string): void; flash(text: string, error?: boolean): void };
	/** Active editor view; throws when no tab is open. */
	view(): EditorView;
	stats(): DocumentStats;
	refreshStats(): void;
	patchConfig(partial: Partial<Config>): Promise<Config>;
}
