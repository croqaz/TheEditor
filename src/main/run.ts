// Spawn helper processes (the snapshot tool, spectacle). Prefers Bun's spawn,
// which Cottontail provides, and falls back to node:child_process.
import type { RunResult } from "./shots";

export async function runCommand(cmd: string, args: string[], options: { timeoutMs: number }): Promise<RunResult> {
	const bun = (globalThis as { Bun?: { spawn?: unknown } }).Bun;
	if (bun?.spawn) return runWithBun(cmd, args, options.timeoutMs);
	return runWithNode(cmd, args, options.timeoutMs);
}

export async function runWithBun(cmd: string, args: string[], timeoutMs: number): Promise<RunResult> {
	let proc: ReturnType<typeof Bun.spawn>;
	try {
		proc = Bun.spawn([cmd, ...args], { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
	} catch (error) {
		return { code: 127, stdout: "", stderr: error instanceof Error ? error.message : String(error) };
	}
	const timer = setTimeout(() => proc.kill(), timeoutMs);
	try {
		const [stdout, stderr, code] = await Promise.all([
			new Response(proc.stdout as ReadableStream).text(),
			new Response(proc.stderr as ReadableStream).text(),
			proc.exited,
		]);
		return { code, stdout, stderr };
	} finally {
		clearTimeout(timer);
	}
}

export async function runWithNode(cmd: string, args: string[], timeoutMs: number): Promise<RunResult> {
	const { execFile } = await import("node:child_process");
	return new Promise((resolve) => {
		execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
			const code = error && typeof (error as { code?: unknown }).code === "number" ? ((error as { code: number }).code ?? 1) : error ? 1 : 0;
			resolve({ code, stdout: String(stdout), stderr: String(stderr) });
		});
	});
}

export async function which(binary: string): Promise<boolean> {
	const result = await runCommand("sh", ["-c", `command -v ${JSON.stringify(binary)} >/dev/null 2>&1`], { timeoutMs: 5_000 });
	return result.code === 0;
}
