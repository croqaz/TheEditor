import { describe, expect, test } from 'bun:test';
import { CommandRegistry } from '../../src/shared/commands';
import type { AppContext } from '../../src/view/commands/context';
import { installKeymap } from '../../src/view/keymap';

const settle = () => new Promise(r => setTimeout(r, 0));

async function press(target: EventTarget, init: KeyboardEventInit) {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  await settle(); // commands run on a microtask
  return event;
}

describe('keymap', () => {
  test('routes combos to commands and leaves fields alone except for global keys', async () => {
    const registry = new CommandRegistry<AppContext>();
    const ran: string[] = [];
    const flashes: string[] = [];
    registry.registerAll([
      {
        id: 'file.save',
        title: 'save',
        keys: ['Ctrl+S'],
        run: () => ran.push('save'),
      },
      {
        id: 'view.devtools',
        title: 'devtools',
        keys: ['F12'],
        run: () => ran.push('devtools'),
      },
      {
        id: 'boom',
        title: 'boom',
        keys: ['Ctrl+Shift+B'],
        run: () => Promise.reject(new Error('nope')),
      },
      {
        id: 'unavailable',
        title: 'n/a',
        keys: ['Ctrl+U'],
        when: () => false,
        run: () => ran.push('never'),
      },
    ]);
    const ctx = {
      status: { flash: (text: string) => flashes.push(text), openPrompt() {} },
    } as unknown as AppContext;
    installKeymap(registry, ctx);

    const saveEvent = await press(window, { key: 's', ctrlKey: true });
    expect(ran).toEqual(['save']);
    expect(saveEvent.defaultPrevented).toBe(true);

    const plain = await press(window, { key: 's' });
    expect(plain.defaultPrevented).toBe(false);
    expect(ran).toEqual(['save']);

    await press(window, { key: 's', ctrlKey: true, isComposing: true });
    expect(ran).toEqual(['save']);

    const input = document.createElement('input');
    document.body.appendChild(input);
    await press(input, { key: 's', ctrlKey: true });
    expect(ran).toEqual(['save']);
    await press(input, { key: 'F12' });
    expect(ran).toEqual(['save', 'devtools']);

    await press(window, { key: 'u', ctrlKey: true });
    expect(ran).toEqual(['save', 'devtools']);

    await press(window, { key: 'B', ctrlKey: true, shiftKey: true });
    expect(flashes).toEqual(['Error: nope']);
  });
});
