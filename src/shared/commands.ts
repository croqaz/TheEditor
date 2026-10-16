// Command registry: one list drives keyboard shortcuts, the F12 console API
// (window.te), and the status-bar prompt. Pure TypeScript, no DOM.

export type CommandRun<Ctx> = (ctx: Ctx, ...args: unknown[]) => unknown;

export interface Command<Ctx> {
	/** Dotted id, e.g. "text.lowercase". The last segment becomes a function on `te`. */
	id: string;
	title: string;
	/** Key combos in canonical form, e.g. "Ctrl+Shift+S", "F12". */
	keys?: string[];
	/** When false the command is skipped by shortcuts and reports "not available" from the console. */
	when?: (ctx: Ctx) => boolean;
	/** Short usage shown by te.help(). */
	usage?: string;
	run: CommandRun<Ctx>;
}

export interface KeyParts {
	key: string;
	ctrl?: boolean;
	shift?: boolean;
	alt?: boolean;
	meta?: boolean;
}

const KEY_ALIASES: Record<string, string> = {
	" ": "Space",
	esc: "Escape",
	escape: "Escape",
	return: "Enter",
	enter: "Enter",
	tab: "Tab",
	arrowup: "Up",
	arrowdown: "Down",
	arrowleft: "Left",
	arrowright: "Right",
	backspace: "Backspace",
	delete: "Delete",
	";": ";",
};

/** Canonical combo string: modifiers in fixed order, key normalised. */
export function comboFromParts(parts: KeyParts): string {
	const out: string[] = [];
	if (parts.ctrl) out.push("Ctrl");
	if (parts.alt) out.push("Alt");
	if (parts.shift) out.push("Shift");
	if (parts.meta) out.push("Meta");
	out.push(normaliseKey(parts.key));
	return out.join("+");
}

export function normaliseKey(key: string): string {
	const lower = key.toLowerCase();
	if (KEY_ALIASES[lower]) return KEY_ALIASES[lower];
	if (/^f\d{1,2}$/.test(lower)) return lower.toUpperCase();
	if (lower.length === 1) return lower.toUpperCase();
	return key.length > 1 ? key[0]!.toUpperCase() + key.slice(1) : key;
}

/** Parse a human-written combo ("ctrl+shift+s") into canonical form. */
export function canonicalCombo(combo: string): string {
	const parts = combo.split("+").map((p) => p.trim()).filter(Boolean);
	const keyPart = parts.pop() ?? "";
	const mods = new Set(parts.map((p) => p.toLowerCase()));
	return comboFromParts({
		key: keyPart,
		ctrl: mods.has("ctrl") || mods.has("control"),
		alt: mods.has("alt") || mods.has("option"),
		shift: mods.has("shift"),
		meta: mods.has("meta") || mods.has("cmd") || mods.has("super"),
	});
}

export class CommandRegistry<Ctx> {
	private readonly commands = new Map<string, Command<Ctx>>();
	private readonly byKey = new Map<string, string>();

	register(command: Command<Ctx>): this {
		if (this.commands.has(command.id)) throw new Error(`Command already registered: ${command.id}`);
		this.commands.set(command.id, command);
		for (const key of command.keys ?? []) {
			const canonical = canonicalCombo(key);
			const existing = this.byKey.get(canonical);
			if (existing) throw new Error(`Key ${canonical} bound twice: ${existing} and ${command.id}`);
			this.byKey.set(canonical, command.id);
		}
		return this;
	}

	registerAll(commands: Command<Ctx>[]): this {
		for (const c of commands) this.register(c);
		return this;
	}

	get(id: string): Command<Ctx> | undefined {
		return this.commands.get(id);
	}

	list(): Command<Ctx>[] {
		return [...this.commands.values()].sort((a, b) => a.id.localeCompare(b.id));
	}

	idForKey(combo: string): string | undefined {
		return this.byKey.get(canonicalCombo(combo));
	}

	/** Run by id; returns `undefined` and reports when the command is unavailable. */
	run(id: string, ctx: Ctx, ...args: unknown[]): unknown {
		const command = this.commands.get(id);
		if (!command) throw new Error(`Unknown command: ${id}`);
		if (command.when && !command.when(ctx)) return { unavailable: id };
		return command.run(ctx, ...args);
	}

	/**
	 * Build the nested console object: "text.lowercase" becomes te.text.lowercase().
	 * A command whose id has a single segment becomes a function directly on the root.
	 * If both "theme" and "theme.list" exist, te.theme is a callable function with properties.
	 */
	buildApi(ctx: Ctx): Record<string, unknown> {
		const root: Record<string, unknown> = {};
		for (const command of this.list()) {
			const segments = command.id.split(".");
			let node: Record<string, unknown> = root;
			for (let i = 0; i < segments.length - 1; i++) {
				const seg = segments[i]!;
				const existing = node[seg];
				if (existing === undefined) {
					const container: Record<string, unknown> = {};
					node[seg] = container;
					node = container;
				} else if (typeof existing === "function" || (typeof existing === "object" && existing !== null)) {
					node = existing as Record<string, unknown>;
				}
			}
			const leaf = segments[segments.length - 1]!;
			const fn = (...args: unknown[]) => this.run(command.id, ctx, ...args);
			const existing = node[leaf];
			if (existing && typeof existing === "object") {
				// A namespace with the same name exists: make the function carry its children.
				Object.assign(fn, existing);
			}
			node[leaf] = fn;
		}
		return root;
	}

	/** Lines for te.help(): id, keys, title. */
	helpLines(prefix?: string): string[] {
		return this.list()
			.filter((c) => !prefix || c.id === prefix || c.id.startsWith(`${prefix}.`))
			.map((c) => {
				const keys = c.keys?.length ? `  [${c.keys.join(", ")}]` : "";
				const usage = c.usage ? `  ${c.usage}` : "";
				return `te.${c.id}()${keys}  ${c.title}${usage}`;
			});
	}
}

/** Parse a prompt line like `theme gruvbox-light` or `tabs.go 2` into id and JSON-ish args. */
export function parsePromptLine(line: string): { id: string; args: unknown[] } | null {
	const trimmed = line.trim();
	if (!trimmed) return null;
	const [head, ...rest] = trimmed.split(/\s+/);
	const id = head!.replace(/^te\./, "").replace(/\(\)$/, "");
	const args = rest.map((token) => {
		if (/^-?\d+(\.\d+)?$/.test(token)) return Number(token);
		if (token === "true") return true;
		if (token === "false") return false;
		if (token === "null") return null;
		if ((token.startsWith("[") && token.endsWith("]")) || (token.startsWith("{") && token.endsWith("}"))) {
			try {
				return JSON.parse(token);
			} catch {
				return token;
			}
		}
		return token.replace(/^["']|["']$/g, "");
	});
	return { id, args };
}
