// te.shot.* and te.measure(): pictures and coordinates for debugging typography
// and for paged exports. Pictures land in <profile cache>/shots/<stamp>-<label>/.
import type { Command } from "../../shared/commands";
import type { PixelRect } from "../../shared/rpc-schema";
import type { AppContext } from "../commands/context";
import { type BoxesOptions, boxesFor, boxesLayerHtml, disableBoxes, enableBoxes, parseMeasure } from "./boxes";
import { type MeasureResult, alignScroll, measureDocument, measureTable, scaleRect } from "./measure";
import { documentHtml, sectionsByHeading } from "./serialize";

const needsEditor = (ctx: AppContext) => ctx.tabs.active.get() !== null;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Opts = { label?: string; width?: number; level?: number; margin?: number; backend?: "x11" | "wayland"; height?: number; tolerance?: number; caret?: boolean };

/** Per-channel tolerance that hides anti-aliasing differences between the compositor and an offscreen render. */
export const AA_TOLERANCE = 32;

function opts(value: unknown): Opts {
	return value && typeof value === "object" ? (value as Opts) : {};
}

function activePane(ctx: AppContext): HTMLElement {
	const tab = ctx.tabs.active.get();
	if (!tab) throw new Error("no open document");
	return tab.pane;
}

function pad(n: number, width = 2) {
	return String(n).padStart(width, "0");
}

/**
 * Run `fn` with every block laid out (`body.te-full` turns `content-visibility: auto` off).
 * Without it, blocks that were never scrolled into view are one line tall in the live page,
 * so document coordinates below the viewport would not match the full-document render.
 */
export async function withFullLayout<T>(pane: HTMLElement, fn: () => Promise<T>): Promise<T> {
	const body = pane.ownerDocument.body;
	const already = body.classList.contains("te-full");
	body.classList.add("te-full");
	void pane.offsetHeight; // force the layout before anything is measured or captured
	try {
		return await fn();
	} finally {
		if (!already) body.classList.remove("te-full");
	}
}

export async function takeMeasure(ctx: AppContext, dir?: string, name = "measure.json"): Promise<MeasureResult> {
	const result = measureDocument(ctx.view(), activePane(ctx));
	if (dir) await ctx.main.request.writeArtifact({ dir, name, content: JSON.stringify(result, null, 2) });
	return result;
}

export async function takeScreen(ctx: AppContext, dir: string, options: { caret?: boolean } = {}) {
	const pane = activePane(ctx);
	const scrollBefore = pane.scrollTop;
	// The block caret is hidden while the marks are up (it is not in the render), unless asked for.
	document.body.classList.add("te-marks");
	document.body.classList.toggle("te-keep-caret", !!options.caret);
	await sleep(120); // let the marks paint before the compositor is asked
	try {
		const raw = await ctx.main.request.shotScreen({ dir, name: "screen-raw.png" });
		const scrollAfter = pane.scrollTop;
		if (scrollAfter !== scrollBefore) ctx.status.flash(`pane scrolled during capture: ${scrollBefore} → ${scrollAfter}`, true);
		if (!raw.ok) return { ok: false as const, error: raw.error, backend: raw.backend };
		const marks = await ctx.main.request.locateMarks({ path: raw.path, out: `${dir}/screen.png`, region: "outer" });
		if (!marks.ok) return { ok: false as const, error: marks.error, backend: raw.backend, raw: raw.path };
		return {
			ok: true as const,
			backend: raw.backend,
			raw: raw.path,
			path: marks.path,
			scroll: { before: scrollBefore, after: scrollAfter },
			frame: marks.frame,
			inner: marks.inner,
			/** The crop is the outer frame: the mark band is drawn inside the pane, so pane coordinates start at the frame edge. */
			rect: marks.frame,
			/** device pixels per CSS px, measured from the picture itself */
			dpr: pane.clientWidth > 0 ? marks.frame.width / pane.clientWidth : 1,
		};
	} finally {
		document.body.classList.remove("te-marks", "te-keep-caret");
	}
}

export async function takePage(ctx: AppContext, dir: string, options: Opts & { only?: Set<number>; name?: string; marks?: boolean }) {
	const pane = activePane(ctx);
	const width = options.width ?? pane.clientWidth;
	// A te.debug.boxes() overlay goes into the render too (document coordinates match), but not
	// into section renders, where blocks are removed and the coordinates no longer apply.
	const boxes = options.only ? undefined : boxesFor(pane);
	const overlay = boxes ? boxesLayerHtml(boxes.fixed ?? measureDocument(ctx.view(), pane), boxes.options) : undefined;
	const html = documentHtml({ editorDom: ctx.view().dom, width, only: options.only, marks: options.marks, pageHeight: options.height, overlay });
	const render = await ctx.main.request.renderHtml({
		dir,
		html,
		options: { width, name: options.name ?? "page", backend: options.backend ?? "x11", height: options.height ?? pane.clientHeight, viewport: !!options.height },
	});
	return render;
}

export const shotCommands: Command<AppContext>[] = [
	{
		id: "measure",
		title: "DOM coordinates of every block and line (CSS px, pane- and document-relative)",
		usage: "te.measure({ label: 'before' })  → writes measure.json when a label is given",
		when: needsEditor,
		run: async (ctx, raw) => {
			const pane = activePane(ctx);
			return withFullLayout(pane, async () => {
				const o = opts(raw);
				const dir = o.label ? (await ctx.main.request.newShotDir({ label: o.label })).dir : undefined;
				const result = await takeMeasure(ctx, dir);
				console.table(measureTable(result));
				if (dir) ctx.status.flash(`measure.json in ${dir}`);
				return dir ? { ...result, dir } : result;
			});
		},
	},
	{
		id: "debug.boxes",
		title: "Overlay the block and line boxes that te.measure() reports on the active document",
		usage: "te.debug.boxes(true|false|{ blocks, lines, labels, from: '…/measure.json' })",
		when: needsEditor,
		run: async (ctx, raw) => {
			const pane = activePane(ctx);
			const wants = raw === undefined ? !boxesFor(pane) : typeof raw === "boolean" ? raw : true;
			if (!wants) {
				disableBoxes(pane);
				ctx.status.flash("boxes off");
				return { on: false };
			}
			const overlay = enableBoxes(pane, () => ctx.view());
			const o = raw && typeof raw === "object" ? (raw as Partial<BoxesOptions> & { from?: string | null }) : {};
			for (const key of ["blocks", "lines", "labels"] as const) if (typeof o[key] === "boolean") overlay.options[key] = o[key]!;
			if (typeof o.from === "string") {
				const file = await ctx.main.request.readDocument({ path: o.from });
				overlay.fixed = parseMeasure(file.markdown);
				overlay.fixedFrom = o.from;
			} else if (o.from === null) {
				overlay.fixed = null;
				overlay.fixedFrom = null;
			}
			const drawn = overlay.refresh();
			const from = overlay.fixedFrom ? ` from ${overlay.fixedFrom}` : "";
			ctx.status.flash(`boxes: ${drawn.blocks} block(s), ${drawn.lines} line(s) drawn${from}`);
			return { on: true, blocks: drawn.blocks, lines: drawn.lines, total: drawn.result.blocks.length, options: { ...overlay.options }, from: overlay.fixedFrom ?? undefined };
		},
	},
	{
		id: "shot.screen",
		title: "Picture of the visible window, cropped to the editor pane (what you see)",
		usage: "te.shot.screen({ label, caret: true })  → caret: keep the block caret in the picture",
		when: needsEditor,
		run: async (ctx, raw) => {
			const pane = activePane(ctx);
			return withFullLayout(pane, async () => {
				const o = opts(raw);
				const dir = (await ctx.main.request.newShotDir({ label: o.label ?? "screen" })).dir;
				const aligned = alignScroll(pane, window.devicePixelRatio);
				const shot = { ...(await takeScreen(ctx, dir, { caret: o.caret })), aligned };
				await takeMeasure(ctx, dir);
				ctx.status.flash(shot.ok ? `screen shot in ${dir}` : `screen shot failed: ${shot.error}`, !shot.ok);
				return { dir, ...shot };
			});
		},
	},
	{
		id: "shot.page",
		title: "Picture of the whole document rendered by WebKitGTK (same engine, independent of the window)",
		usage: "te.shot.page({ label, width, backend: 'x11'|'wayland' })",
		when: needsEditor,
		run: async (ctx, raw) => {
			const pane = activePane(ctx);
			return withFullLayout(pane, async () => {
				const o = opts(raw);
				const dir = (await ctx.main.request.newShotDir({ label: o.label ?? "page" })).dir;
				const render = await takePage(ctx, dir, { ...o, height: undefined });
				await takeMeasure(ctx, dir);
				ctx.status.flash(render.ok ? `page render in ${dir}` : `render failed: ${render.error}`, !render.ok);
				return { dir, ...render };
			});
		},
	},
	{
		id: "shot.sections",
		title: "One picture per section (default: each H1 starts a page), like slides",
		usage: "te.shot.sections({ level: 1, height: 1200, label })",
		when: needsEditor,
		run: async (ctx, raw) => {
			const o = opts(raw);
			const dir = (await ctx.main.request.newShotDir({ label: o.label ?? "sections" })).dir;
			const blocks: { type: string; level?: number }[] = [];
			ctx.view().state.doc.forEach((node) => blocks.push({ type: node.type.name, level: node.attrs.level as number | undefined }));
			const sections = sectionsByHeading(blocks, o.level ?? 1);
			const pages: unknown[] = [];
			for (const [i, indices] of sections.entries()) {
				const render = await takePage(ctx, dir, { ...o, only: new Set(indices), name: `section-${pad(i + 1)}` });
				pages.push({ section: i + 1, blocks: indices, ...render });
			}
			await ctx.main.request.writeArtifact({ dir, name: "sections.json", content: JSON.stringify({ level: o.level ?? 1, sections, pages }, null, 2) });
			ctx.status.flash(`${pages.length} section picture(s) in ${dir}`);
			return { dir, pages };
		},
	},
	{
		id: "shot.element",
		title: "Picture of one block, cropped from the full-document render",
		usage: "te.shot.element(3, { label, margin: 8 })",
		when: needsEditor,
		run: async (ctx, indexRaw, raw) => {
			const pane = activePane(ctx);
			return withFullLayout(pane, async () => {
				const index = typeof indexRaw === "number" ? indexRaw : 0;
				const o = opts(raw);
				const dir = (await ctx.main.request.newShotDir({ label: o.label ?? `element-${index}` })).dir;
				const measure = await takeMeasure(ctx, dir);
				const block = measure.blocks[index];
				if (!block) throw new Error(`no block ${index} (document has ${measure.blocks.length})`);
				const render = await takePage(ctx, dir, { ...o, height: undefined });
				if (!render.ok) throw new Error(render.error);
				const margin = o.margin ?? 8;
				const rect = scaleRect(
					{ x: block.document.x - margin, y: block.document.y - margin, width: block.document.width + 2 * margin, height: block.document.height + 2 * margin },
					render.metrics.dpr,
				);
				const crop = await ctx.main.request.cropImage({ path: render.path, rect, out: `${dir}/element-${pad(index, 3)}.png` });
				ctx.status.flash(`block ${index} in ${crop.path}`);
				return { dir, block, render: render.path, crop };
			});
		},
	},
	{
		id: "shot.verify",
		title: "Screen shot vs document render: crop every visible block from both and pixel-diff them",
		usage: "te.shot.verify({ label, index, tolerance })",
		when: needsEditor,
		run: async (ctx, raw) => {
			const pane = activePane(ctx);
			return withFullLayout(pane, async () => {
				const o = opts(raw) as Opts & { index?: number };
				const dir = (await ctx.main.request.newShotDir({ label: o.label ?? "verify" })).dir;
				// Whole device pixels first: at dpr 1.75 a scroll offset of 718 CSS px is 1256.5 device px,
				// which the compositor snaps, and every screen crop would be off by a pixel.
				const aligned = alignScroll(pane, window.devicePixelRatio);
				const measure = await takeMeasure(ctx, dir);
				const screen = { ...(await takeScreen(ctx, dir)), aligned };
				const render = await takePage(ctx, dir, { ...o, height: undefined });
				const report: Record<string, unknown> = { dir, screen, render, blocks: [] as unknown[] };
				if (!screen.ok || !render.ok) {
					await ctx.main.request.writeArtifact({ dir, name: "verify.json", content: JSON.stringify(report, null, 2) });
					ctx.status.flash("verify incomplete; see verify.json", true);
					return report;
				}
				const candidates = measure.blocks.filter((b) => (o.index === undefined ? b.visible : b.index === o.index));
				// The screen dpr is measured from a rounded frame width; when it agrees with WebKit's exact
				// value the exact one is used for both crops so far-down blocks do not drift by a pixel.
				const screenDpr = Math.abs(screen.dpr - render.metrics.dpr) < 0.02 ? render.metrics.dpr : screen.dpr;
				const results: unknown[] = [];
				for (const block of candidates) {
					const name = `block-${pad(block.index, 3)}`;
					const screenRect = scaleRect(block.viewport, screenDpr);
					const pageRect = scaleRect(block.document, render.metrics.dpr);
					const a = await ctx.main.request.cropImage({ path: screen.path, rect: screenRect, out: `${dir}/${name}-screen.png` });
					const b = await ctx.main.request.cropImage({ path: render.path, rect: pageRect, out: `${dir}/${name}-page.png` });
					const diff = await ctx.main.request.diffImages({ a: a.path, b: b.path, out: `${dir}/${name}-diff.png`, tolerance: o.tolerance ?? 0 });
					const diffAA = await ctx.main.request.diffImages({ a: a.path, b: b.path, tolerance: AA_TOLERANCE });
					results.push({ index: block.index, type: block.type, text: block.text, screenRect, pageRect, screen: a.path, page: b.path, diff, diffAA });
				}
				report.blocks = results;
				report.summary = {
					blocks: results.length,
					tolerance: o.tolerance ?? 0,
					identical: results.filter((r) => (r as { diff: { mismatch: number } }).diff.mismatch === 0).length,
					identicalWithinAA: results.filter((r) => (r as { diffAA: { mismatch: number } }).diffAA.mismatch === 0).length,
					screenDpr: screen.dpr,
					screenDprUsed: screenDpr,
					pageDpr: render.metrics.dpr,
				};
				await ctx.main.request.writeArtifact({ dir, name: "verify.json", content: JSON.stringify(report, null, 2) });
				console.table(results.map((r) => {
					const x = r as { index: number; type: string; diff: { mismatchPct: number; sameSize: boolean }; diffAA: { mismatchPct: number } };
					return { "#": x.index, type: x.type, "mismatch %": Math.round(x.diff.mismatchPct * 100) / 100, "beyond AA %": Math.round(x.diffAA.mismatchPct * 100) / 100, sameSize: x.diff.sameSize };
				}));
				const summary = report.summary as { identical: number; identicalWithinAA: number };
				ctx.status.flash(`verify: ${summary.identical}/${results.length} identical, ${summary.identicalWithinAA}/${results.length} within anti-aliasing, see ${dir}`);
				return report;
			});
		},
	},
	{
		id: "shot.crop",
		title: "Crop a picture: te.shot.crop(path, x, y, w, h, out?)",
		run: (ctx, path, x, y, w, h, out) => {
			const rect: PixelRect = { x: Number(x), y: Number(y), width: Number(w), height: Number(h) };
			const target = typeof out === "string" ? out : String(path).replace(/\.png$/i, `-crop-${rect.x}-${rect.y}.png`);
			return ctx.main.request.cropImage({ path: String(path), rect, out: target });
		},
	},
	{
		id: "shot.diff",
		title: "Pixel-diff two pictures: te.shot.diff(a, b, out?, tolerance?)",
		run: (ctx, a, b, out, tolerance) =>
			ctx.main.request.diffImages({ a: String(a), b: String(b), out: typeof out === "string" ? out : undefined, tolerance: typeof tolerance === "number" ? tolerance : 0 }),
	},
];
