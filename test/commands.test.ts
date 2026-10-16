import { describe, expect, test } from 'bun:test';
import { canonicalCombo, comboFromParts, CommandRegistry, parsePromptLine } from '../src/shared/commands';

describe('key combos', () => {
  test('canonical order and casing', () => {
    expect(canonicalCombo('ctrl+shift+s')).toBe('Ctrl+Shift+S');
    expect(canonicalCombo('Shift+Ctrl+s')).toBe('Ctrl+Shift+S');
    expect(canonicalCombo('f12')).toBe('F12');
    expect(canonicalCombo('Ctrl+;')).toBe('Ctrl+;');
    expect(canonicalCombo('ctrl+`')).toBe('Ctrl+`');
    expect(comboFromParts({ key: '`', ctrl: true })).toBe('Ctrl+`');
    expect(comboFromParts({ key: 'Tab', ctrl: true, shift: true })).toBe('Ctrl+Shift+Tab');
    expect(comboFromParts({ key: 'ArrowLeft', alt: true })).toBe('Alt+Left');
  });
});

describe('CommandRegistry', () => {
  type Ctx = { log: string[] };

  function make() {
    const registry = new CommandRegistry<Ctx>();
    registry.registerAll([
      {
        id: 'theme',
        title: 'set theme',
        run: (ctx, name) => ctx.log.push(`theme:${String(name)}`),
      },
      { id: 'theme.list', title: 'list themes', run: () => ['a', 'b'] },
      {
        id: 'text.lowercase',
        title: 'lower',
        keys: ['Ctrl+Shift+L'],
        run: ctx => ctx.log.push('lower'),
      },
      {
        id: 'file.save',
        title: 'save',
        keys: ['Ctrl+S'],
        when: () => false,
        run: () => 'saved',
      },
    ]);
    return registry;
  }

  test('builds a nested api with callable namespaces', () => {
    const registry = make();
    const ctx: Ctx = { log: [] };
    const te = registry.buildApi(ctx) as {
      theme: ((name: string) => unknown) & { list: () => string[] };
      text: { lowercase: () => unknown };
    };
    te.theme('nord');
    te.text.lowercase();
    expect(ctx.log).toEqual(['theme:nord', 'lower']);
    expect(te.theme.list()).toEqual(['a', 'b']);
  });

  test('resolves keys and respects when()', () => {
    const registry = make();
    expect(registry.idForKey('ctrl+shift+l')).toBe('text.lowercase');
    expect(registry.run('file.save', { log: [] })).toEqual({
      unavailable: 'file.save',
    });
  });

  test('rejects duplicate ids and double-bound keys', () => {
    const registry = make();
    expect(() => registry.register({ id: 'theme', title: 'dup', run: () => 0 })).toThrow();
    expect(() =>
      registry.register({
        id: 'x',
        title: 'dup key',
        keys: ['Ctrl+S'],
        run: () => 0,
      })
    ).toThrow();
  });

  test('a namespace registered before its callable root keeps its children', () => {
    const registry = new CommandRegistry<Ctx>();
    registry.register({ id: 'font.measure', title: 'm', run: () => 'measure' });
    registry.register({ id: 'font', title: 'f', run: () => 'font' });
    const te = registry.buildApi({ log: [] }) as {
      font: (() => string) & { measure: () => string };
    };
    expect(te.font()).toBe('font');
    expect(te.font.measure()).toBe('measure');
    expect(() => registry.run('nope', { log: [] })).toThrow(/Unknown command/);
  });

  test('help lines include keys', () => {
    const lines = make().helpLines('text');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('te.text.lowercase()');
    expect(lines[0]).toContain('Ctrl+Shift+L');
  });
});

describe('parsePromptLine', () => {
  test('parses ids and typed arguments', () => {
    expect(parsePromptLine('theme gruvbox-light')).toEqual({
      id: 'theme',
      args: ['gruvbox-light'],
    });
    expect(parsePromptLine('tabs.go 2')).toEqual({ id: 'tabs.go', args: [2] });
    expect(parsePromptLine('te.lines.sort() true')).toEqual({
      id: 'lines.sort',
      args: [true],
    });
    expect(parsePromptLine('status.fields ["words","net"]')).toEqual({
      id: 'status.fields',
      args: [['words', 'net']],
    });
    expect(parsePromptLine('   ')).toBeNull();
  });
});
