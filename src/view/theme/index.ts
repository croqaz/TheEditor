// Themes are twelve custom properties plus optional font settings.
import type { Config } from '../../shared/config-schema';
import gruvboxDark from './gruvbox-dark.json';
import gruvboxLight from './gruvbox-light.json';
import nordDark from './nord-dark.json';
import nordLight from './nord-light.json';

export interface Theme {
  name: string;
  dark: boolean;
  vars: Record<string, string>;
}

const builtin: Theme[] = [gruvboxDark, gruvboxLight, nordDark, nordLight];
const themes = new Map<string, Theme>(builtin.map(t => [t.name, t]));

export function listThemes(): string[] {
  return [...themes.keys()];
}

export function getTheme(name: string): Theme | undefined {
  return themes.get(name);
}

export function registerTheme(theme: Theme) {
  themes.set(theme.name, theme);
}

export function applyTheme(name: string): Theme {
  const theme = themes.get(name);
  if (!theme) {
    throw new Error(`Unknown theme: ${name}. Known: ${listThemes().join(', ')}`);
  }
  const root = document.documentElement;
  for (const [key, value] of Object.entries(theme.vars)) {
    root.style.setProperty(key.startsWith('--') ? key : `--te-${key}`, value);
  }
  root.dataset.theme = theme.name;
  root.style.colorScheme = theme.dark ? 'dark' : 'light';
  return theme;
}

export function applyFont(font: Config['font']) {
  const root = document.documentElement;
  const fallbacks = `"Iosevka", "JetBrains Mono", "Hack", "DejaVu Sans Mono", ui-monospace, monospace`;
  root.style.setProperty('--te-font', `"${font.family.replace(/"/g, '')}", ${fallbacks}`);
  root.style.setProperty('--te-size', `${font.size}px`);
  root.style.setProperty('--te-lh', String(font.leading));
  root.style.setProperty('--te-measure', `${font.measure}ch`);
}

export type CaretStyle = Config['caret'];

/** editor.css keys the caret rules on body[data-caret]; the block is the default. */
export function applyCaret(style: CaretStyle) {
  document.body.dataset.caret = style;
}
