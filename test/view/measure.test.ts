import { describe, expect, test } from 'bun:test';
import { createEditor } from '../../src/view/editor/create';
import {
  alignScroll,
  cssStep,
  lineBoxes,
  measureDocument,
  measureTable,
  relativeRect,
  scaleRect,
} from '../../src/view/shots/measure';

// test/setup.ts gives every element and range the box {0,0,100,20}.

describe('rect helpers', () => {
  test('relativeRect subtracts the origin and rounds to 1/100', () => {
    expect(
      relativeRect(
        { left: 10.123, top: 20.456, width: 5, height: 6 },
        {
          left: 1,
          top: 2,
        }
      )
    ).toEqual({ x: 9.12, y: 18.46, width: 5, height: 6 });
  });
  test('scaleRect multiplies and rounds to whole pixels', () => {
    expect(scaleRect({ x: 1.4, y: 2.6, width: 10.5, height: 3 }, 1.75)).toEqual({ x: 2, y: 5, width: 18, height: 5 });
  });
  test('cssStep is the CSS distance that is a whole number of device pixels', () => {
    expect(cssStep(1)).toBe(1);
    expect(cssStep(2)).toBe(1);
    expect(cssStep(1.5)).toBe(2);
    expect(cssStep(1.75)).toBe(4);
    expect(cssStep(1.25)).toBe(4);
    expect(cssStep(1.1)).toBe(10);
    expect(cssStep(4 / 3)).toBe(3);
    expect(cssStep(1.4142)).toBe(1); // nothing small fits: leave the offset alone
  });
  test('alignScroll moves the pane to the nearest aligned offset and reports it', () => {
    const pane = document.createElement('div');
    let top = 718;
    Object.defineProperty(pane, 'scrollTop', {
      get: () => top,
      set: (v: number) => void (top = v),
    });
    expect(alignScroll(pane, 1.75)).toEqual({
      before: 718,
      after: 720,
      step: 4,
    });
    expect(alignScroll(pane, 1.75)).toEqual({
      before: 720,
      after: 720,
      step: 4,
    });
    top = 94;
    expect(alignScroll(pane, 2)).toEqual({ before: 94, after: 94, step: 1 });
  });
});

describe('lineBoxes', () => {
  test('merges rects on the same line and keeps separate lines apart', () => {
    const element = document.createElement('p');
    element.append(document.createTextNode('alpha '), document.createElement('em'), document.createTextNode('beta'));
    element.querySelector('em')!.textContent = 'mid';
    const original = Range.prototype.getClientRects;
    let call = 0;
    Range.prototype.getClientRects = (() => {
      call++;
      const rect = (x: number, y: number, w: number) => ({
        x,
        y,
        left: x,
        top: y,
        right: x + w,
        bottom: y + 20,
        width: w,
        height: 20,
        toJSON: () => ({}),
      });
      if (call === 1) return [rect(0, 0, 40)];
      if (call === 2) return [rect(40, 0, 20)];
      return [rect(60, 0, 30), rect(0, 24, 25), rect(0, 0, 0)];
    }) as unknown as typeof Range.prototype.getClientRects;
    try {
      const lines = lineBoxes(element, { left: 0, top: 0 });
      expect(lines).toEqual([
        { x: 0, y: 0, width: 90, height: 20 },
        { x: 0, y: 24, width: 25, height: 20 },
      ]);
    } finally {
      Range.prototype.getClientRects = original;
    }
  });
});

describe('measureDocument', () => {
  test('reports one entry per top-level block with pane- and document-relative rects', async () => {
    const pane = document.createElement('div');
    const inner = document.createElement('div');
    pane.appendChild(inner);
    document.body.appendChild(pane);
    Object.defineProperty(pane, 'clientWidth', { value: 600 });
    Object.defineProperty(pane, 'clientHeight', { value: 400 });
    Object.defineProperty(pane, 'scrollTop', { value: 50, writable: true });
    Object.defineProperty(pane, 'scrollHeight', { value: 900 });
    Object.defineProperty(pane, 'scrollWidth', { value: 600 });
    const handle = await createEditor(inner, '---\nk: v\n---\n\n# Title\n\nSome text here.\n', {
      onDocChanged() {},
      onSelectionChanged() {},
    });
    const result = measureDocument(handle.view(), pane);
    expect(result.pane).toEqual({
      width: 600,
      height: 400,
      scrollTop: 50,
      scrollLeft: 0,
    });
    expect(result.content).toEqual({ width: 600, height: 900 });
    expect(result.dpr).toBeGreaterThan(0);
    expect(typeof result.font.family).toBe('string');
    const types = result.blocks.map(b => b.type);
    expect(types.slice(0, 3)).toEqual(['frontmatter', 'heading', 'paragraph']);
    const heading = result.blocks[1]!;
    expect(heading.text).toBe('Title');
    expect(heading.viewport).toEqual({ x: 0, y: 0, width: 100, height: 20 });
    expect(heading.document).toEqual({ x: 0, y: 50, width: 100, height: 20 });
    expect(heading.visible).toBe(false); // y 0 is under the 4 px registration band
    expect(heading.lines).toEqual([{ x: 0, y: 50, width: 100, height: 20 }]);
    const rows = measureTable(result);
    expect(rows[1]).toMatchObject({
      '#': 1,
      type: 'heading',
      y: 50,
      h: 20,
      lines: 1,
      lead: null,
    });
    await handle.destroy();
  });
});
