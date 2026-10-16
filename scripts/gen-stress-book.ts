// Generates test/gold/04-stress-book.md: a deterministic ~2 MB "book" with
// chapters, headings, lists, quotes, code, HTML blocks, images and dialogue.
// Usage: bun scripts/gen-stress-book.ts [targetBytes] [seed]
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const target = Number(process.argv[2] ?? 2 * 1024 * 1024);
let seed = Number(process.argv[3] ?? 20261016) >>> 0;

function rand(): number {
	seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
	return seed / 0x100000000;
}
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)]!;
const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));

const WORDS =
	"the of and to in a is that for it as was with be by on not he this are or his from at which but have an had they you were their one all we can her has there been if more when will would who so no she said what up its about than into them only other time new some could these two may first then do any like my now over such our man me even most made after also did many off before must well back through years much where your way down should because long each just state those people too mr how little good world make very year still see own work men day get here old life both between being under three never know same last another while us off might great go come since against right came take states used himself few house use during without again place american around however home small found mrs thought went say part once general high upon school every don't does got united left number course war until always away something fact though water less public put think almost hand enough far took head yet government system better set told nothing night end why called didn't eyes find going look asked later knew point next program city business give group toward young days let room president side social given present several order national second possible rather per face among form important often things looked early white case become large big need four within felt along children saw best church ever least power development light thing seemed family interest want members mind country area others turned although open god service certain kind problem began different door thus help means sense whole matter perhaps itself times human law line above name example action company hands local show whether five history gave either act today feet across taken anything quite having seen death experience body word really".split(
		/\s+/,
	);
const NAMES = ["Mira", "Tomas", "Ilse", "Rook", "Anselm", "Petra", "Dov", "Yara", "Lioba", "Casimir"];
const PLACES = ["the harbour", "the lighthouse", "a rain-soaked market", "the observatory", "the night train", "a quiet library"];

function sentence(min = 6, max = 22): string {
	const n = int(min, max);
	const words: string[] = [];
	for (let i = 0; i < n; i++) {
		let w = pick(WORDS);
		if (i === 0) w = w[0]!.toUpperCase() + w.slice(1);
		if (rand() < 0.08) w = `*${w}*`;
		else if (rand() < 0.03) w = `**${w}**`;
		else if (rand() < 0.01) w = `\`${w}\``;
		words.push(w);
	}
	let s = words.join(" ");
	if (rand() < 0.12) s += `, ${pick(WORDS)} ${pick(WORDS)}`;
	return s + pick([".", ".", ".", ".", "!", "?", "…"]);
}

function paragraph(): string {
	const n = int(2, 7);
	const out: string[] = [];
	for (let i = 0; i < n; i++) out.push(sentence());
	return out.join(" ");
}

function dialogue(): string {
	const lines = int(2, 6);
	const out: string[] = [];
	for (let i = 0; i < lines; i++) {
		const who = pick(NAMES);
		out.push(`"${sentence(3, 14)}" ${pick(["said", "whispered", "asked", "muttered"])} ${who}.`);
	}
	return out.join("\n\n");
}

function list(): string {
	const ordered = rand() < 0.4;
	const n = int(3, 8);
	const out: string[] = [];
	for (let i = 0; i < n; i++) {
		out.push(`${ordered ? `${i + 1}.` : "-"} ${sentence(3, 12)}`);
		if (rand() < 0.2) out.push(`  ${ordered ? "1." : "-"} ${sentence(3, 9)}`);
	}
	return out.join("\n");
}

function quote(): string {
	return `> ${sentence()}\n> ${sentence()}\n>\n> — ${pick(NAMES)}, at ${pick(PLACES)}`;
}

function code(): string {
	return ["```js", `const ${pick(WORDS)} = (${pick(WORDS)}) => ${pick(WORDS)}.map((x) => x + 1);`, `console.log(${pick(WORDS)}(${int(1, 99)}));`, "```"].join("\n");
}

function html(): string {
	return [
		`<aside class="note" style="border-left: 2px solid currentColor; padding-left: 1ch">`,
		`  <p><strong>${pick(NAMES)}'s note:</strong> ${sentence(5, 14)}</p>`,
		"</aside>",
	].join("\n");
}

function image(chapter: number, n: number): string {
	return `![Figure ${chapter}.${n}: ${pick(PLACES)}](img/ch${String(chapter).padStart(2, "0")}-${n}.png)`;
}

function table(): string {
	return [
		"| Name | Place | Year |",
		"|------|-------|-----:|",
		...Array.from({ length: int(3, 6) }, () => `| ${pick(NAMES)} | ${pick(PLACES)} | ${int(1890, 2026)} |`),
	].join("\n");
}

const parts: string[] = [];
parts.push("---", "title: The Long Shore", "author: Generated", "generated: true", `seed: ${process.argv[3] ?? 20261016}`, "---", "");
parts.push("# The Long Shore", "", paragraph(), "");

let bytes = parts.join("\n").length;
let chapter = 0;
while (bytes < target) {
	chapter++;
	parts.push(`# Chapter ${chapter}: ${sentence(2, 5).replace(/[.!?…]$/, "")}`, "");
	const sections = int(3, 7);
	for (let s = 1; s <= sections; s++) {
		parts.push(`## ${chapter}.${s} ${sentence(2, 4).replace(/[.!?…]$/, "")}`, "");
		const blocks = int(6, 16);
		let figure = 0;
		for (let b = 0; b < blocks; b++) {
			const r = rand();
			if (r < 0.6) parts.push(paragraph());
			else if (r < 0.72) parts.push(dialogue());
			else if (r < 0.8) parts.push(list());
			else if (r < 0.86) parts.push(quote());
			else if (r < 0.9) parts.push(`### ${sentence(2, 4).replace(/[.!?…]$/, "")}`);
			else if (r < 0.93) parts.push(image(chapter, ++figure));
			else if (r < 0.96) parts.push(table());
			else if (r < 0.98) parts.push(html());
			else parts.push(code());
			parts.push("");
		}
	}
	parts.push("---", "");
	bytes = parts.reduce((n, p) => n + p.length + 1, 0);
}

const out = resolve(import.meta.dirname, "../test/gold/04-stress-book.md");
mkdirSync(dirname(out), { recursive: true });
const text = `${parts.join("\n").replace(/\n{3,}/g, "\n\n")}\n`;
writeFileSync(out, text, "utf8");
console.log(`${out}: ${text.length} chars, ${chapter} chapters`);
