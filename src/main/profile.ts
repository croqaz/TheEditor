// Profiles: every path the app writes to, derived from one spec.
//   (none) / "default"  → ~/.config/TheEditor, ~/.local/share/TheEditor, ~/.cache/TheEditor, ~/.local/state/TheEditor
//   "test" (a name)     → the same roots with /profiles/<name> appended
//   "./dir", "~/x", "/abs" (a path) → everything under that directory, same structure
import { isAbsolute, join, resolve } from "node:path";

export interface ProfileBase {
	/** XDG config root, e.g. ~/.config */
	config: string;
	/** XDG data root, e.g. ~/.local/share */
	data: string;
	/** XDG cache root, e.g. ~/.cache */
	cache: string;
	/** XDG state root, e.g. ~/.local/state */
	logs: string;
	home: string;
	/** Directory relative profile paths are resolved against. */
	cwd: string;
}

export interface ProfilePaths {
	name: string;
	kind: "default" | "named" | "path";
	configDir: string;
	dataDir: string;
	cacheDir: string;
	logsDir: string;
	configFile: string;
	sessionFile: string;
	recoveryDir: string;
	backupsDir: string;
}

export const APP_DIR_NAME = "TheEditor";
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

export function isPathSpec(spec: string): boolean {
	return spec.includes("/") || spec.startsWith("~") || spec.startsWith(".");
}

function expandHome(spec: string, home: string): string {
	if (spec === "~") return home;
	if (spec.startsWith("~/")) return join(home, spec.slice(2));
	return spec;
}

function finish(partial: Omit<ProfilePaths, "configFile" | "sessionFile" | "recoveryDir" | "backupsDir">): ProfilePaths {
	return {
		...partial,
		configFile: join(partial.configDir, "config.json"),
		sessionFile: join(partial.configDir, "session.json"),
		recoveryDir: join(partial.dataDir, "recovery"),
		backupsDir: join(partial.dataDir, "backups"),
	};
}

export function resolveProfile(spec: string | undefined, base: ProfileBase): ProfilePaths {
	const trimmed = spec?.trim() ?? "";
	if (trimmed === "" || trimmed === "default") {
		return finish({
			name: "default",
			kind: "default",
			configDir: join(base.config, APP_DIR_NAME),
			dataDir: join(base.data, APP_DIR_NAME),
			cacheDir: join(base.cache, APP_DIR_NAME),
			logsDir: join(base.logs, APP_DIR_NAME),
		});
	}
	if (isPathSpec(trimmed)) {
		const expanded = expandHome(trimmed, base.home);
		const root = isAbsolute(expanded) ? resolve(expanded) : resolve(base.cwd, expanded);
		if (root === "/" || root === resolve(base.home)) {
			throw new Error(`Refusing to use ${root} as a profile directory`);
		}
		const name = root.split("/").filter(Boolean).pop() ?? "profile";
		return finish({
			name,
			kind: "path",
			configDir: root,
			dataDir: join(root, "data"),
			cacheDir: join(root, "cache"),
			logsDir: join(root, "logs"),
		});
	}
	if (!NAME_PATTERN.test(trimmed)) {
		throw new Error(`Invalid profile "${spec}": use a name like "test" or a path like ./profile or ~/x`);
	}
	const sub = join(APP_DIR_NAME, "profiles", trimmed);
	return finish({
		name: trimmed,
		kind: "named",
		configDir: join(base.config, sub),
		dataDir: join(base.data, sub),
		cacheDir: join(base.cache, sub),
		logsDir: join(base.logs, sub),
	});
}
