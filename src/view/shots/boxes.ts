// te.debug.boxes(): an overlay in the pane that draws the block and line
// boxes measureDocument() reports, so what you see on screen is exactly what
// measure.json says. Boxes are 1 px lines painted inside each rect (the
// outer edge of the line is the rect edge). A saved measure.json can be
// overlaid instead of the live measurement to compare two layouts.
import type { EditorView } from '@milkdown/kit/prose/view';
import { type BlockMeasure, measureDocument, type MeasureResult } from './measure';

export interface BoxesOptions {
  blocks: boolean;
  lines: boolean;
  labels: boolean;
}

export const DEFAULT_BOXES: BoxesOptions = {
  blocks: true,
  lines: true,
  labels: true,
};

/** Only blocks whose document rect intersects [from, to) are drawn (window around the viewport). */
export interface BoxWindow {
  from: number;
  to: number;
}

const px = (n: number) => `${Math.round(n * 100) / 100}px`;

function place(el: HTMLElement, rect: { x: number; y: number; width: number; height: number }) {
  el.style.left = px(rect.x);
  el.style.top = px(rect.y);
  el.style.width = px(rect.width);
  el.style.height = px(rect.height);
}

/** Text of a block label: index, type, size, line count and leading. */
export function blockLabel(block: BlockMeasure): string {
  const lead = block.lines.length > 1 ? ` lead ${Math.round((block.lines[1]!.y - block.lines[0]!.y) * 100) / 100}` : '';
  return `#${block.index} ${block.type} ${Math.round(block.document.width)}×${Math.round(
    block.document.height
  )} ·${block.lines.length}${lead}`;
}

/** Fill `layer` with boxes for `result`. Labels go in the right margin when there is room, else above the block's top-right corner (in the gap between blocks). */
export function renderBoxes(
  layer: HTMLElement,
  result: MeasureResult,
  options: BoxesOptions,
  window?: BoxWindow
): { blocks: number; lines: number } {
  layer.replaceChildren();
  layer.style.width = px(result.pane.width);
  layer.style.height = px(Math.max(result.content.height, result.pane.height));
  const doc = layer.ownerDocument;
  const roomRight = (block: BlockMeasure) =>
    result.pane.width - (block.document.x + block.document.width) >= 18 * (result.font.size || 15) * 0.6;
  let blocks = 0;
  let lines = 0;
  for (const block of result.blocks) {
    const rect = block.document;
    if (window && (rect.y + rect.height <= window.from || rect.y >= window.to)) continue;
    if (options.blocks || options.labels) {
      const box = doc.createElement('div');
      box.className = `te-box te-box--block${options.blocks ? '' : ' te-box--invisible'}`;
      box.dataset.index = String(block.index);
      place(box, rect);
      if (options.labels) {
        const label = doc.createElement('span');
        label.className = `te-box__label ${roomRight(block) ? 'te-box__label--right' : 'te-box__label--above'}`;
        label.textContent = blockLabel(block);
        box.appendChild(label);
      }
      layer.appendChild(box);
      blocks++;
    }
    if (options.lines) {
      for (const line of block.lines) {
        const box = doc.createElement('div');
        box.className = 'te-box te-box--line';
        place(box, line);
        layer.appendChild(box);
        lines++;
      }
    }
  }
  return { blocks, lines };
}

/** A detached layer with every block, for the document render (no viewport window). */
export function boxesLayerHtml(result: MeasureResult, options: BoxesOptions): string {
  const layer = document.createElement('div');
  layer.className = 'te-boxes';
  renderBoxes(layer, result, options);
  return layer.outerHTML;
}

/** Minimal shape check for a measure.json loaded from disk. */
export function parseMeasure(text: string): MeasureResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('not a JSON file');
  }
  const result = data as Partial<MeasureResult>;
  if (!result || typeof result !== 'object' || !Array.isArray(result.blocks) || !result.pane || !result.content) {
    throw new Error('not a measure.json (needs blocks, pane, content)');
  }
  return result as MeasureResult;
}

export class BoxOverlay {
  readonly layer: HTMLElement;
  options: BoxesOptions = { ...DEFAULT_BOXES };
  /** A loaded measure.json; when set, the live layout is not measured. */
  fixed: MeasureResult | null = null;
  fixedFrom: string | null = null;
  last: MeasureResult | null = null;
  private mutations: MutationObserver | null = null;
  private resize: ResizeObserver | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    readonly pane: HTMLElement,
    private readonly view: () => EditorView
  ) {
    this.layer = pane.ownerDocument.createElement('div');
    this.layer.className = 'te-boxes';
    this.layer.setAttribute('aria-hidden', 'true');
    pane.appendChild(this.layer);
    const dom = view().dom;
    if (typeof MutationObserver !== 'undefined') {
      this.mutations = new MutationObserver(() => this.schedule());
      this.mutations.observe(dom, {
        childList: true,
        characterData: true,
        subtree: true,
        attributes: true,
      });
    }
    if (typeof ResizeObserver !== 'undefined') {
      this.resize = new ResizeObserver(() => this.schedule());
      this.resize.observe(pane);
      this.resize.observe(dom);
    }
    pane.addEventListener('scroll', this.schedule);
  }

  /** Re-measure (or reuse the loaded file) and redraw the boxes around the viewport. */
  refresh(): { blocks: number; lines: number; result: MeasureResult } {
    const result = this.fixed ?? measureDocument(this.view(), this.pane);
    this.last = result;
    const height = this.pane.clientHeight || result.pane.height;
    const top = this.pane.scrollTop;
    const drawn = renderBoxes(this.layer, result, this.options, {
      from: top - height,
      to: top + 2 * height,
    });
    return { ...drawn, result };
  }

  private schedule = () => {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.refresh();
    }, 100);
  };

  destroy() {
    if (this.timer) clearTimeout(this.timer);
    this.mutations?.disconnect();
    this.resize?.disconnect();
    this.pane.removeEventListener('scroll', this.schedule);
    this.layer.remove();
  }
}

const overlays = new WeakMap<HTMLElement, BoxOverlay>();

export function boxesFor(pane: HTMLElement): BoxOverlay | undefined {
  return overlays.get(pane);
}

export function enableBoxes(pane: HTMLElement, view: () => EditorView): BoxOverlay {
  let overlay = overlays.get(pane);
  if (!overlay) {
    overlay = new BoxOverlay(pane, view);
    overlays.set(pane, overlay);
  }
  return overlay;
}

export function disableBoxes(pane: HTMLElement): boolean {
  const overlay = overlays.get(pane);
  if (!overlay) return false;
  overlay.destroy();
  overlays.delete(pane);
  return true;
}
