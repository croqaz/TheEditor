// One capture-phase keydown handler resolves shortcuts through the registry.
// Editing keys stay with ProseMirror; typing in inputs is left alone except
// for the few combos that must work everywhere.
import { comboFromParts, type CommandRegistry } from '../shared/commands';
import type { AppContext } from './commands/context';

const ALWAYS = new Set(['F12', 'Ctrl+;', 'F11', 'Ctrl+Q', 'Ctrl+Tab', 'Ctrl+Shift+Tab']);

export function installKeymap(registry: CommandRegistry<AppContext>, ctx: AppContext) {
  window.addEventListener(
    'keydown',
    event => {
      if (event.isComposing) return;
      const combo = comboFromParts({
        key: event.key,
        ctrl: event.ctrlKey,
        alt: event.altKey,
        shift: event.shiftKey,
        meta: event.metaKey,
      });
      const id = registry.idForKey(combo);
      if (!id) return;
      const target = event.target as HTMLElement | null;
      const inField = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');
      if (inField && !ALWAYS.has(combo)) return;
      event.preventDefault();
      event.stopPropagation();
      Promise.resolve()
        .then(() => registry.run(id, ctx))
        .catch(error => ctx.status.flash(String(error), true));
    },
    { capture: true }
  );
}
