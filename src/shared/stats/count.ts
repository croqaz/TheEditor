// Text statistics over plain-text blocks. Uses Intl.Segmenter so words and
// graphemes are counted correctly for CJK, apostrophes and combining marks.

export interface BlockStats {
  chars: number;
  charsNoSpaces: number;
  words: number;
  sentences: number;
  lines: number;
}

export interface DocumentStats extends BlockStats {
  paragraphs: number;
  headings: number;
  lists: number;
  codeBlocks: number;
  quotes: number;
  images: number;
  readMinutes: number;
  speakMinutes: number;
  bytes: number;
  /** Present when the selection is not empty. */
  selection?: BlockStats;
}

export interface CountOptions {
  lang?: string;
  wpm?: number;
  speakWpm?: number;
}

const segmenters = new Map<string, { grapheme: Intl.Segmenter; word: Intl.Segmenter; sentence: Intl.Segmenter }>();

function getSegmenters(lang: string) {
  let set = segmenters.get(lang);
  if (!set) {
    set = {
      grapheme: new Intl.Segmenter(lang, { granularity: 'grapheme' }),
      word: new Intl.Segmenter(lang, { granularity: 'word' }),
      sentence: new Intl.Segmenter(lang, { granularity: 'sentence' }),
    };
    segmenters.set(lang, set);
  }
  return set;
}

export function emptyBlockStats(): BlockStats {
  return { chars: 0, charsNoSpaces: 0, words: 0, sentences: 0, lines: 0 };
}

export function countBlock(text: string, lang = 'en'): BlockStats {
  if (!text) return emptyBlockStats();
  const seg = getSegmenters(lang);
  let chars = 0;
  let charsNoSpaces = 0;
  for (const g of seg.grapheme.segment(text)) {
    chars++;
    if (!/^\s$/u.test(g.segment)) charsNoSpaces++;
  }
  let words = 0;
  for (const w of seg.word.segment(text)) {
    if (w.isWordLike) words++;
  }
  let sentences = 0;
  for (const s of seg.sentence.segment(text)) {
    if (/\p{L}|\p{N}/u.test(s.segment)) sentences++;
  }
  const lines = text.split('\n').length;
  return { chars, charsNoSpaces, words, sentences, lines };
}

export function addBlockStats(a: BlockStats, b: BlockStats): BlockStats {
  return {
    chars: a.chars + b.chars,
    charsNoSpaces: a.charsNoSpaces + b.charsNoSpaces,
    words: a.words + b.words,
    sentences: a.sentences + b.sentences,
    lines: a.lines + b.lines,
  };
}

export type BlockKind = 'paragraph' | 'heading' | 'list' | 'code' | 'quote' | 'image' | 'other';

export interface CountedBlock {
  kind: BlockKind;
  stats: BlockStats;
}

/** Combine per-block stats into document totals. */
export function summarise(blocks: CountedBlock[], markdownBytes: number, options: CountOptions = {}): DocumentStats {
  const wpm = options.wpm ?? 240;
  const speakWpm = options.speakWpm ?? 150;
  let total = emptyBlockStats();
  let paragraphs = 0;
  let headings = 0;
  let lists = 0;
  let codeBlocks = 0;
  let quotes = 0;
  let images = 0;
  for (const block of blocks) {
    total = addBlockStats(total, block.stats);
    switch (block.kind) {
      case 'paragraph':
        paragraphs++;
        break;
      case 'heading':
        headings++;
        break;
      case 'list':
        lists++;
        break;
      case 'code':
        codeBlocks++;
        break;
      case 'quote':
        quotes++;
        break;
      case 'image':
        images++;
        break;
      default:
        break;
    }
  }
  return {
    ...total,
    paragraphs,
    headings,
    lists,
    codeBlocks,
    quotes,
    images,
    readMinutes: total.words / wpm,
    speakMinutes: total.words / speakWpm,
    bytes: markdownBytes,
  };
}

/** Convenience for plain Markdown-free text: paragraphs are separated by blank lines. */
export function countText(text: string, options: CountOptions = {}): DocumentStats {
  const lang = options.lang ?? 'en';
  const paragraphs = text
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(Boolean);
  const blocks: CountedBlock[] = paragraphs.map(p => ({
    kind: 'paragraph',
    stats: countBlock(p, lang),
  }));
  return summarise(blocks, new TextEncoder().encode(text).byteLength, options);
}

export function formatMinutes(minutes: number): string {
  if (minutes < 1) return `${Math.max(1, Math.round(minutes * 60))} s`;
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes - h * 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function formatCount(n: number): string {
  return new Intl.NumberFormat('en', { useGrouping: true }).format(n);
}
