import { describe, expect, test } from 'bun:test';
import { debounce, el, Signal, signal } from '../../src/view/state';

describe('Signal', () => {
  test('get/set/update and subscriptions', () => {
    const s = signal(1);
    const seen: number[] = [];
    const off = s.subscribe(v => seen.push(v));
    s.set(2);
    s.set(2); // no change, no notification
    s.update(v => v + 1);
    off();
    s.set(10);
    expect(seen).toEqual([1, 2, 3]);
    expect(s.get()).toBe(10);
    expect(new Signal('x').get()).toBe('x');
  });
});

describe('debounce', () => {
  test('collapses calls and can be cancelled', async () => {
    const calls: number[] = [];
    const fn = debounce((n: number) => calls.push(n), 10);
    fn(1);
    fn(2);
    await new Promise(r => setTimeout(r, 30));
    fn(3);
    fn.cancel();
    await new Promise(r => setTimeout(r, 30));
    expect(calls).toEqual([2]);
  });
});

describe('el', () => {
  test('creates elements with class and text', () => {
    const node = el('span', 'a b', 'hi');
    expect(node.tagName).toBe('SPAN');
    expect(node.className).toBe('a b');
    expect(node.textContent).toBe('hi');
    expect(el('div').className).toBe('');
  });
});
