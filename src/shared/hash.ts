// Small, dependency-free hashes for file names and change detection.

/** FNV-1a 32-bit as 8 hex chars. Used to name recovery and backup folders per path. */
export function fnv1a(input: string): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash.toString(16).padStart(8, "0");
}

/** FNV-1a 64-bit (two 32-bit lanes) for content comparison; cheap enough for a few MB per save. */
export function contentHash(input: string): string {
	let h1 = 0x811c9dc5;
	let h2 = 0x01000193;
	for (let i = 0; i < input.length; i++) {
		const c = input.charCodeAt(i);
		h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
		h2 = Math.imul(h2 ^ c, 0x811c9dc5) >>> 0;
	}
	return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}
