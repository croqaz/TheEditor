import { describe, expect, test } from 'bun:test';
import { createEditor } from '../../src/view/editor/create';
import {
  blockLabel,
  boxesFor,
  boxesLayerHtml,
  BoxOverlay,
  DEFAULT_BOXES,
  disableBoxes,
  enableBoxes,
  parseMeasure,
  renderBoxes,
} from '../../src/view/shots/boxes';
import type { BlockMeasure, MeasureResult } from '../../src/view/shots/measure';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function block(index: number, y: number, height: number, lines: number[], x = 40, width = 500): BlockMeasure {
  const rect = { x, y, width, height };
  return {
    index,
    type: index === 0 ? 'heading' : 'paragraph',
    text: `block ${index}`,
    viewport: rect,
    document: rect,
    lines: lines.map(ly => ({ x, y: ly, width: width - 10, height: 18 })),
    visible: true,
  };
}

function measure(blocks: BlockMeasure[], paneWidth = 800): MeasureResult {
  return {
    takenAt: 'now',
    dpr: 2,
    pane: { width: paneWidth, height: 400, scrollTop: 0, scrollLeft: 0 },
    content: { width: paneWidth, height: 1200 },
    font: { family: 'mono', size: 15, lineHeight: 24, measure: '72ch' },
    blocks,
  };
}

describe('blockLabel', () => {
  test('index, type, size, line count and leading', () => {
    expect(blockLabel(block(0, 0, 24, [3]))).toBe('#0 heading 500×24 ·1');
    expect(blockLabel(block(3, 100, 48.4, [103, 127.25]))).toBe('#3 paragraph 500×48 ·2 lead 24.25');
  });
});

describe('renderBoxes', () => {
  test('draws one box per block and per line, sized to the content, labels outside when there is room', () => {
    const layer = document.createElement('div');
    const result = measure([block(0, 0, 24, [3]), block(1, 40, 48, [43, 67])]);
    const drawn = renderBoxes(layer, result, DEFAULT_BOXES);
    expect(drawn).toEqual({ blocks: 2, lines: 3 });
    expect(layer.style.width).toBe('800px');
    expect(layer.style.height).toBe('1200px');
    const blocks = layer.querySelectorAll<HTMLElement>('.te-box--block');
    expect(blocks).toHaveLength(2);
    expect(blocks[1]!.style.top).toBe('40px');
    expect(blocks[1]!.style.height).toBe('48px');
    expect(blocks[1]!.dataset.index).toBe('1');
    const labels = layer.querySelectorAll<HTMLElement>('.te-box__label');
    expect(labels).toHaveLength(2);
    expect(labels[0]!.textContent).toBe('#0 heading 500×24 ·1');
    expect(labels[0]!.classList.contains('te-box__label--right')).toBe(true); // 800 - 540 = 260 px of room
    const lines = layer.querySelectorAll<HTMLElement>('.te-box--line');
    expect(lines).toHaveLength(3);
    expect(lines[2]!.style.top).toBe('67px');
    expect(lines[2]!.style.width).toBe('490px');
  });

  test('labels move above the block in a narrow pane; options drop lines, labels or the block outline', () => {
    const layer = document.createElement('div');
    const narrow = measure([block(0, 0, 24, [3])], 560);
    renderBoxes(layer, narrow, DEFAULT_BOXES);
    expect(layer.querySelector('.te-box__label')!.className).toBe('te-box__label te-box__label--above');

    expect(renderBoxes(layer, narrow, { blocks: true, lines: false, labels: false })).toEqual({ blocks: 1, lines: 0 });
    expect(layer.querySelector('.te-box__label')).toBeNull();
    expect(layer.querySelector('.te-box--line')).toBeNull();

    expect(renderBoxes(layer, narrow, { blocks: false, lines: true, labels: true })).toEqual({ blocks: 1, lines: 1 });
    expect(layer.querySelector('.te-box--block')!.classList.contains('te-box--invisible')).toBe(true);

    expect(
      renderBoxes(layer, narrow, {
        blocks: false,
        lines: false,
        labels: false,
      })
    ).toEqual({ blocks: 0, lines: 0 });
    expect(layer.children).toHaveLength(0);
  });

  test('a window keeps only blocks that intersect it', () => {
    const layer = document.createElement('div');
    const result = measure([block(0, 0, 24, []), block(1, 100, 24, []), block(2, 500, 24, []), block(3, 1000, 24, [])]);
    expect(renderBoxes(layer, result, DEFAULT_BOXES, { from: 24, to: 500 })).toEqual({ blocks: 1, lines: 0 });
    expect(layer.querySelector<HTMLElement>('.te-box--block')!.dataset.index).toBe('1');
    expect(renderBoxes(layer, result, DEFAULT_BOXES, { from: 10, to: 501 }).blocks).toBe(3);
  });

  test('boxesLayerHtml is a detached layer with every block', () => {
    const html = boxesLayerHtml(measure([block(0, 0, 24, [3]), block(1, 2000, 24, [])]), DEFAULT_BOXES);
    expect(html.startsWith('<div class="te-boxes"')).toBe(true);
    expect(html.match(/te-box--block/g)).toHaveLength(2);
  });
});

describe('parseMeasure', () => {
  test('accepts a measure.json and rejects other files', () => {
    const good = JSON.stringify(measure([block(0, 0, 24, [])]));
    expect(parseMeasure(good).blocks).toHaveLength(1);
    expect(() => parseMeasure('{nope')).toThrow(/JSON/);
    expect(() => parseMeasure('{"blocks": 3}')).toThrow(/measure\.json/);
    expect(() => parseMeasure('{"blocks": [], "pane": {}}')).toThrow(/content/);
    expect(() => parseMeasure('null')).toThrow(/measure\.json/);
  });
});

describe('BoxOverlay', () => {
  async function makePane() {
    const pane = document.createElement('div');
    pane.className = 'te-pane';
    const inner = document.createElement('div');
    pane.appendChild(inner);
    document.body.appendChild(pane);
    Object.defineProperty(pane, 'clientWidth', { value: 600 });
    Object.defineProperty(pane, 'clientHeight', { value: 400 });
    Object.defineProperty(pane, 'scrollHeight', { value: 900 });
    Object.defineProperty(pane, 'scrollTop', { value: 0, writable: true });
    const handle = await createEditor(inner, '# One\n\npara\n\n# Two\n\nmore\n', {
      onDocChanged() {},
      onSelectionChanged() {},
    });
    return { pane, handle, view: handle.view() };
  }

  test('enable appends the layer once, refresh measures live and draws, disable removes it', async () => {
    const { pane, handle, view } = await makePane();
    expect(boxesFor(pane)).toBeUndefined();
    const overlay = enableBoxes(pane, () => view);
    expect(enableBoxes(pane, () => view)).toBe(overlay);
    expect(pane.querySelectorAll('.te-boxes')).toHaveLength(1);
    const drawn = overlay.refresh();
    expect(drawn.blocks).toBe(4);
    expect(drawn.lines).toBe(4);
    expect(drawn.result.blocks).toHaveLength(4);
    expect(overlay.last).toBe(drawn.result);
    expect(overlay.layer.querySelectorAll('.te-box--block')).toHaveLength(4);
    expect(disableBoxes(pane)).toBe(true);
    expect(pane.querySelector('.te-boxes')).toBeNull();
    expect(disableBoxes(pane)).toBe(false);
    await handle.destroy();
  });

  test('edits and scrolling schedule a redraw; a loaded measurement replaces the live one', async () => {
    const { pane, handle, view } = await makePane();
    const overlay = new BoxOverlay(pane, () => view);
    overlay.refresh();
    expect(overlay.layer.querySelectorAll('.te-box--block')).toHaveLength(4);
    view.dispatch(view.state.tr.insertText('Z', 1));
    view.dispatch(view.state.tr.insertText('Y', 1));
    pane.dispatchEvent(new Event('scroll'));
    await sleep(160);
    expect(overlay.last!.blocks[0]!.text).toBe('YZOne');

    overlay.fixed = measure([block(0, 10, 24, [13])]);
    overlay.options.labels = false;
    const drawn = overlay.refresh();
    expect(drawn).toMatchObject({ blocks: 1, lines: 1 });
    expect(overlay.layer.querySelector<HTMLElement>('.te-box--block')!.style.top).toBe('10px');
    overlay.destroy();
    expect(pane.querySelector('.te-boxes')).toBeNull();
    await handle.destroy();
  });
});
