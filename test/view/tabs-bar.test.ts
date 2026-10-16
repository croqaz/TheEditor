import { describe, expect, test } from 'bun:test';
import { mountTabBar } from '../../src/view/bars/tabs';
import type { Tab, TabManager } from '../../src/view/documents/tabs';
import { signal } from '../../src/view/state';

function fakeTabs() {
  const tabs = signal<Tab[]>([]);
  const active = signal<Tab | null>(null);
  const calls: string[] = [];
  const manager = {
    tabs,
    active,
    activate: (id: number) => {
      calls.push(`activate:${id}`);
      active.set(tabs.get().find(t => t.id === id) ?? null);
    },
    close: async (id: number) => {
      calls.push(`close:${id}`);
      return true;
    },
  } as unknown as TabManager;
  return { manager, tabs, active, calls };
}

const tab = (id: number, title: string, path: string | null, dirty = false, conflict = false) =>
  ({ id, title, path, dirty, conflict }) as Tab;

describe('tab bar', () => {
  test('renders tabs, marks the active and dirty ones, handles clicks', () => {
    const host = document.createElement('header');
    document.body.appendChild(host);
    const { manager, tabs, active, calls } = fakeTabs();
    mountTabBar(host, manager, true);
    expect(host.classList.contains('te-bar--drag')).toBe(true);

    tabs.set([tab(1, 'book', '/b.md'), tab(2, 'notes', null, true), tab(3, 'clash', '/c.md', true, true)]);
    active.set(tabs.get()[0]!);
    const cells = [...host.querySelectorAll<HTMLElement>('.te-tab')];
    expect(cells.map(c => c.querySelector('.te-tab__name')?.textContent)).toEqual(['book', 'notes', 'clash']);
    expect(cells.map(c => c.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
    expect(cells.map(c => c.querySelector('.te-tab__dirty')?.textContent)).toEqual(['', '·', '!']);
    expect(cells[1]!.title).toBe('unsaved');
    expect(cells[0]!.title).toBe('/b.md');

    const left = new MouseEvent('mousedown', {
      button: 0,
      bubbles: true,
      cancelable: true,
    });
    cells[1]!.dispatchEvent(left);
    expect(calls).toEqual(['activate:2']);
    expect(left.defaultPrevented).toBe(true); // the editor keeps focus; activate() refocuses
    expect(host.querySelectorAll('[aria-selected="true"]')).toHaveLength(1);

    const middle = new MouseEvent('mousedown', {
      button: 1,
      bubbles: true,
      cancelable: true,
    });
    host.querySelectorAll<HTMLElement>('.te-tab')[2]!.dispatchEvent(middle);
    expect(calls).toEqual(['activate:2', 'close:3']);
    expect(middle.defaultPrevented).toBe(true);

    mountTabBar(host, manager, false);
    expect(host.classList.contains('te-bar--drag')).toBe(false);
  });
});
