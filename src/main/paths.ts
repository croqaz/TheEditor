// Resolve the active profile's paths from Electrobun's platform directories.
import { Utils } from "electrobun/main";
import { type ProfilePaths, resolveProfile } from "./profile";

export function createPaths(profileSpec: string | undefined, cwd: string): ProfilePaths {
	return resolveProfile(profileSpec, {
		config: Utils.paths.config,
		data: Utils.paths.appData,
		cache: Utils.paths.cache,
		logs: Utils.paths.logs,
		home: Utils.paths.home,
		cwd,
	});
}

export type { ProfilePaths };
