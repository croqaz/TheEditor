// DOM coordinates of every top-level block and its line boxes, in CSS px
// relative to the editor pane (what the screen shot shows) and to the
// document (what the full-document render shows), plus device-pixel copies.
import type { EditorView } from '@milkdown/kit/prose/view';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BlockMeasure {
  index: number;
  type: string;
  text: string;
  /** Relative to the pane's top-left, CSS px (matches the cropped screen shot). */
  viewport: Rect;
  /** Relative to the document's top-left, CSS px (matches the full-document render). */
  document: Rect;
  lines: Rect[];
  /** Whether the whole block is inside the visible pane. */
  visible: boolean;
}

export interface MeasureResult {
  takenAt: string;
  dpr: number;
  pane: {
    width: number;
    height: number;
    scrollTop: number;
    scrollLeft: number;
  };
  content: { width: number; height: number };
  font: { family: string; size: number; lineHeight: number; measure: string };
  blocks: BlockMeasure[];
}

/** Width in CSS px of the registration band drawn inside the pane while capturing (see index.css). */
export const MARK_WIDTH = 4;

const round = (n: number) => Math.round(n * 100) / 100;

export function relativeRect(
  rect: DOMRect | { left: number; top: number; width: number; height: number },
  origin: { left: number; top: number }
): Rect {
  return {
    x: round(rect.left - origin.left),
    y: round(rect.top - origin.top),
    width: round(rect.width),
    height: round(rect.height),
  };
}

/**
 * Smallest number of CSS px that is a whole number of device px at this ratio
 * (1.75 → 4 CSS px = 7 device px). Scroll offsets that are multiples of it put the
 * content on whole device pixels, so a screen shot lines up with the render.
 */
export function cssStep(dpr: number): number {
  for (const q of [1, 2, 3, 4, 5, 8, 10, 16, 20, 25, 32, 50, 100]) {
    const scaled = dpr * q;
    if (Math.abs(scaled - Math.round(scaled)) < 1e-6) return q;
  }
  return 1;
}

/** Move the pane's scroll offset to the nearest multiple of cssStep(dpr); returns before/after. */
export function alignScroll(pane: HTMLElement, dpr: number): { before: number; after: number; step: number } {
  const before = pane.scrollTop;
  const step = cssStep(dpr);
  const after = Math.round(before / step) * step;
  if (after !== before) pane.scrollTop = after;
  return { before, after: pane.scrollTop, step };
}

export function scaleRect(rect: Rect, factor: number): Rect {
  return {
    x: Math.round(rect.x * factor),
    y: Math.round(rect.y * factor),
    width: Math.round(rect.width * factor),
    height: Math.round(rect.height * factor),
  };
}

/** Merge client rects of the text nodes in `element` into line boxes (same top within 1 px). */
export function lineBoxes(element: Element, origin: { left: number; top: number }): Rect[] {
  const lines: Rect[] = [];
  const doc = element.ownerDocument;
  const walker = doc.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let node: Node | null = walker.nextNode();
  while (node) {
    if (node.textContent?.trim()) {
      const range = doc.createRange();
      range.selectNodeContents(node);
      for (const r of Array.from(range.getClientRects())) {
        if (r.width === 0 && r.height === 0) continue;
        const rect = relativeRect(r, origin);
        const line = lines.find(l => Math.abs(l.y - rect.y) <= 1 && Math.abs(l.height - rect.height) <= 1);
        if (line) {
          const right = Math.max(line.x + line.width, rect.x + rect.width);
          line.x = Math.min(line.x, rect.x);
          line.width = round(right - line.x);
        } else {
          lines.push(rect);
        }
      }
    }
    node = walker.nextNode();
  }
  return lines.sort((a, b) => a.y - b.y || a.x - b.x);
}

export function measureDocument(view: EditorView, pane: HTMLElement): MeasureResult {
  const paneRect = pane.getBoundingClientRect();
  const origin = { left: paneRect.left, top: paneRect.top };
  const scrollTop = pane.scrollTop;
  const scrollLeft = pane.scrollLeft;
  const computed = getComputedStyle(view.dom);
  const blocks: BlockMeasure[] = [];
  let index = 0;
  view.state.doc.forEach((node, offset) => {
    const dom = view.nodeDOM(offset);
    if (dom instanceof Element) {
      const viewport = relativeRect(dom.getBoundingClientRect(), origin);
      const document = {
        ...viewport,
        x: round(viewport.x + scrollLeft),
        y: round(viewport.y + scrollTop),
      };
      blocks.push({
        index,
        type: node.type.name,
        text: node.textContent.slice(0, 60),
        viewport,
        document,
        lines: lineBoxes(dom, origin).map(l => ({
          ...l,
          x: round(l.x + scrollLeft),
          y: round(l.y + scrollTop),
        })),
        // Fully inside the pane and clear of the registration band at the top and bottom edges.
        visible: viewport.y >= MARK_WIDTH && viewport.y + viewport.height <= pane.clientHeight - MARK_WIDTH,
      });
    }
    index++;
  });
  return {
    takenAt: new Date().toISOString(),
    dpr: window.devicePixelRatio,
    pane: {
      width: pane.clientWidth,
      height: pane.clientHeight,
      scrollTop,
      scrollLeft,
    },
    content: { width: pane.scrollWidth, height: pane.scrollHeight },
    font: {
      family: computed.fontFamily,
      size: Number.parseFloat(computed.fontSize),
      lineHeight: Number.parseFloat(computed.lineHeight),
      measure: getComputedStyle(document.documentElement).getPropertyValue('--te-measure').trim(),
    },
    blocks,
  };
}

/** Short table rows for console.table. */
export function measureTable(result: MeasureResult) {
  return result.blocks.map(b => ({
    '#': b.index,
    type: b.type,
    y: b.document.y,
    h: b.document.height,
    lines: b.lines.length,
    lead: b.lines.length > 1 ? round(b.lines[1]!.y - b.lines[0]!.y) : null,
    text: b.text.slice(0, 32),
  }));
}
