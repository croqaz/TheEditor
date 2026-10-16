import { describe, expect, test } from 'bun:test';
import { applyCaret, applyFont, applyTheme, getTheme, listThemes, registerTheme } from '../../src/view/theme';

describe('themes', () => {
  test('four built-ins, each with twelve text and chrome colours and seven code colours', () => {
    expect(listThemes().sort()).toEqual(['gruvbox-dark', 'gruvbox-light', 'nord-dark', 'nord-light']);
    for (const name of listThemes()) {
      const theme = getTheme(name)!;
      const keys = Object.keys(theme.vars);
      expect(keys).toHaveLength(19);
      expect(keys.filter(key => key.startsWith('syn-')).sort()).toEqual(
        ['syn-attr', 'syn-comment', 'syn-keyword', 'syn-number', 'syn-string', 'syn-tag', 'syn-title'].sort()
      );
      expect(theme.name).toBe(name);
      expect(theme.dark).toBe(name.endsWith('-dark'));
    }
  });

  test('applyTheme sets custom properties and colour scheme', () => {
    const theme = applyTheme('nord-light');
    const style = document.documentElement.style;
    expect(style.getPropertyValue('--te-bg')).toBe('#eceff4');
    expect(style.getPropertyValue('--te-accent')).toBe(theme.vars.accent!);
    expect(document.documentElement.dataset.theme).toBe('nord-light');
    expect(style.colorScheme).toBe('light');
    applyTheme('gruvbox-dark');
    expect(style.colorScheme).toBe('dark');
    expect(() => applyTheme('rainbow')).toThrow(/Unknown theme: rainbow/);
  });

  test('registerTheme adds a user theme, raw -- keys pass through', () => {
    registerTheme({
      name: 'mine',
      dark: true,
      vars: { '--te-bg': '#000', fg: '#fff' },
    });
    applyTheme('mine');
    const style = document.documentElement.style;
    expect(style.getPropertyValue('--te-bg')).toBe('#000');
    expect(style.getPropertyValue('--te-fg')).toBe('#fff');
    // Variables the previous theme set and this one leaves out are gone, so the stylesheet defaults apply.
    expect(style.getPropertyValue('--te-accent')).toBe('');
    expect(style.getPropertyValue('--te-syn-keyword')).toBe('');
    expect(listThemes()).toContain('mine');
    applyTheme('nord-dark');
    expect(style.getPropertyValue('--te-syn-keyword')).toBe('#81a1c1');
  });

  test('applyFont writes the typography variables', () => {
    applyFont({
      family: 'Iosevka "Term"',
      size: 17,
      leading: 1.5,
      measure: 64,
    });
    const style = document.documentElement.style;
    expect(style.getPropertyValue('--te-font')).toContain('"Iosevka Term"');
    expect(style.getPropertyValue('--te-size')).toBe('17px');
    expect(style.getPropertyValue('--te-lh')).toBe('1.5');
    expect(style.getPropertyValue('--te-measure')).toBe('64ch');
  });

  test('applyCaret keys the caret rules on the body', () => {
    applyCaret('bar');
    expect(document.body.dataset.caret).toBe('bar');
    applyCaret('block');
    expect(document.body.dataset.caret).toBe('block');
  });
});
