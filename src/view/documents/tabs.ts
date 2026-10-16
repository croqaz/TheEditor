// Tabs: one Milkdown editor per open document, all mounted, only one visible.
import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import type { Config, Session } from '../../shared/config-schema';
import { handlePaneMouseDown } from '../editor/caret';
import { createEditor, type EditorHandle } from '../editor/create';
import { log, main } from '../rpc';
import { debounce, el, Signal, signal } from '../state';

export interface Tab {
  id: number;
  path: string | null;
  title: string;
  dirty: boolean;
  mtime: number | undefined;
  /** Document as last loaded or saved; dirty = !doc.eq(savedDoc). */
  savedDoc: ProseNode;
  /** UTF-8 size of the Markdown as last loaded or saved. */
  bytes: number;
  pane: HTMLElement;
  editor: EditorHandle;
  conflict: boolean;
}

export interface TabEvents {
  onDocChanged: (tab: Tab) => void;
  onSelectionChanged: (tab: Tab) => void;
  onSaved?: (tab: Tab, auto: boolean) => void;
}

let nextId = 1;

/** File name without extension, or "untitled", "untitled-2", … avoiding the titles in use. */
export function titleFor(path: string | null, taken: Iterable<string> = []): string {
  if (path) {
    const base = path.split('/').pop() ?? path;
    return base.replace(/\.(md|markdown|txt)$/i, '');
  }
  const used = new Set(taken);
  if (!used.has('untitled')) return 'untitled';
  let n = 2;
  while (used.has(`untitled-${n}`)) n++;
  return `untitled-${n}`;
}

export function isPristineUntitled(tab: Tab): boolean {
  return !tab.path && !tab.dirty && tab.editor.getMarkdown().trim() === '';
}

export class TabManager {
  readonly tabs: Signal<Tab[]> = signal<Tab[]>([]);
  readonly active: Signal<Tab | null> = signal<Tab | null>(null);
  private readonly saveSessionDebounced = debounce(() => void this.saveSession(), 500);
  private autosaveTimers = new Map<number, ReturnType<typeof setTimeout>>();
  private autosaveFirstChange = new Map<number, number>();

  constructor(
    private readonly host: HTMLElement,
    private readonly events: TabEvents,
    private config: Config
  ) {}

  setConfig(config: Config) {
    this.config = config;
    if (!config.autosave.enabled) {
      for (const timer of this.autosaveTimers.values()) clearTimeout(timer);
      this.autosaveTimers.clear();
      this.autosaveFirstChange.clear();
    }
  }

  list(): Tab[] {
    return this.tabs.get();
  }

  byId(id: number): Tab | undefined {
    return this.tabs.get().find(t => t.id === id);
  }

  byPath(path: string): Tab | undefined {
    return this.tabs.get().find(t => t.path === path);
  }

  async newTab(markdown = '', path: string | null = null, mtime?: number): Promise<Tab> {
    const id = nextId++;
    const pane = el('div', 'te-pane');
    pane.hidden = true;
    const inner = el('div', 'te-pane__inner');
    pane.appendChild(inner);
    this.host.appendChild(pane);
    const tabRef: { current: Tab | null } = { current: null };
    const editor = await createEditor(inner, markdown, {
      onDocChanged: () => {
        const tab = tabRef.current;
        if (!tab) return;
        this.markDirty(tab);
        this.events.onDocChanged(tab);
      },
      onSelectionChanged: () => {
        if (tabRef.current) this.events.onSelectionChanged(tabRef.current);
      },
    });
    pane.addEventListener('mousedown', event => handlePaneMouseDown(editor.view(), event));
    const tab: Tab = {
      id,
      path,
      title: titleFor(
        path,
        this.tabs.get().map(t => t.title)
      ),
      dirty: false,
      mtime,
      savedDoc: editor.view().state.doc,
      bytes: new TextEncoder().encode(markdown).byteLength,
      pane,
      editor,
      conflict: false,
    };
    tabRef.current = tab;
    this.tabs.update(list => [...list, tab]);
    this.activate(tab.id);
    return tab;
  }

  private markDirty(tab: Tab) {
    // Node.eq short-circuits on identity, so this costs O(changed path), not O(document).
    const dirty = !tab.editor.view().state.doc.eq(tab.savedDoc);
    if (dirty !== tab.dirty) {
      tab.dirty = dirty;
      this.tabs.update(list => [...list]);
    }
    if (dirty && tab.path && this.config.autosave.enabled && !tab.conflict) {
      this.scheduleAutosave(tab);
    }
  }

  private scheduleAutosave(tab: Tab) {
    const { debounceMs, maxWaitMs } = this.config.autosave;
    const first = this.autosaveFirstChange.get(tab.id) ?? Date.now();
    this.autosaveFirstChange.set(tab.id, first);
    const existing = this.autosaveTimers.get(tab.id);
    if (existing) clearTimeout(existing);
    const elapsed = Date.now() - first;
    const wait = Math.max(0, Math.min(debounceMs, maxWaitMs - elapsed));
    this.autosaveTimers.set(
      tab.id,
      setTimeout(() => {
        this.autosaveTimers.delete(tab.id);
        this.autosaveFirstChange.delete(tab.id);
        void this.save(tab.id, false, true);
      }, wait)
    );
  }

  async open(paths?: string[]): Promise<Tab[]> {
    let targets = paths;
    if (!targets?.length) {
      const activePath = this.active.get()?.path;
      const startingFolder = activePath?.includes('/') ? activePath.slice(0, activePath.lastIndexOf('/')) : undefined;
      const picked = await main.request.pickOpenPaths(startingFolder ? { startingFolder } : {});
      targets = picked.paths;
    }
    const opened: Tab[] = [];
    for (const path of targets ?? []) {
      const existing = this.byPath(path);
      if (existing) {
        this.activate(existing.id);
        opened.push(existing);
        continue;
      }
      try {
        const t0 = performance.now();
        const doc = await main.request.readDocument({ path });
        const t1 = performance.now();
        // A lone pristine untitled tab is replaced, not kept beside the file.
        const list = this.tabs.get();
        const blank = list.length === 1 && list[0] && isPristineUntitled(list[0]) ? list[0] : null;
        const tab = await this.newTab(doc.markdown, doc.path, doc.mtime);
        if (blank) await this.remove(blank);
        const t2 = performance.now();
        log(
          'info',
          `opened ${tab.title}: ${doc.markdown.length} chars, read ${Math.round(
            t1 - t0
          )} ms, parse+mount ${Math.round(t2 - t1)} ms`
        );
        opened.push(tab);
      } catch (error) {
        log('error', `open failed for ${path}: ${String(error)}`);
      }
    }
    this.saveSessionDebounced();
    return opened;
  }

  /** Open dropped content whose path is unknown: a new untitled tab named after the file. */
  async openText(name: string, markdown: string): Promise<Tab> {
    const list = this.tabs.get();
    const blank = list.length === 1 && list[0] && isPristineUntitled(list[0]) ? list[0] : null;
    const tab = await this.newTab(markdown);
    tab.title = titleFor(
      name,
      this.tabs
        .get()
        .filter(t => t !== tab)
        .map(t => t.title)
    );
    this.tabs.update(l => [...l]);
    if (blank) await this.remove(blank);
    return tab;
  }

  activate(id: number) {
    const tab = this.byId(id);
    if (!tab) return;
    for (const t of this.tabs.get()) t.pane.hidden = t.id !== id;
    this.active.set(tab);
    queueMicrotask(() => tab.editor.focus());
    this.saveSessionDebounced();
  }

  activateByIndex(index: number) {
    const tab = this.tabs.get()[index];
    if (tab) this.activate(tab.id);
  }

  cycle(delta: number) {
    const list = this.tabs.get();
    const current = this.active.get();
    if (!list.length || !current) return;
    const idx = list.findIndex(t => t.id === current.id);
    const next = list[(idx + delta + list.length) % list.length];
    if (next) this.activate(next.id);
  }

  move(delta: number) {
    const list = [...this.tabs.get()];
    const current = this.active.get();
    if (!current) return;
    const idx = list.findIndex(t => t.id === current.id);
    const target = idx + delta;
    if (target < 0 || target >= list.length) return;
    [list[idx], list[target]] = [list[target]!, list[idx]!];
    this.tabs.set(list);
    this.saveSessionDebounced();
  }

  async save(id?: number, force = false, auto = false): Promise<boolean> {
    const tab = id === undefined ? this.active.get() : this.byId(id);
    if (!tab) return false;
    if (!tab.path) return auto ? false : this.saveAs(tab.id);
    if (!force && !tab.dirty) return true;
    const doc = tab.editor.view().state.doc;
    const markdown = tab.editor.getMarkdown();
    const result = await main.request.saveDocument({
      path: tab.path,
      markdown,
      expectedMtime: force ? undefined : tab.mtime,
    });
    if (result.ok) {
      tab.savedDoc = doc;
      tab.bytes = new TextEncoder().encode(markdown).byteLength;
      tab.mtime = result.mtime;
      tab.dirty = !tab.editor.view().state.doc.eq(doc);
      tab.conflict = false;
      this.tabs.update(list => [...list]);
      this.events.onSaved?.(tab, auto);
      return true;
    }
    if (result.reason === 'conflict') {
      tab.conflict = true;
      log(
        'warn',
        `${result.message}. Use te.file.save(true) to overwrite or te.file.reload() to discard local changes.`
      );
    } else {
      log('error', `save failed: ${result.message}`);
    }
    this.tabs.update(list => [...list]);
    return false;
  }

  async saveAs(id?: number, target?: string): Promise<boolean> {
    const tab = id === undefined ? this.active.get() : this.byId(id);
    if (!tab) return false;
    let path = target ?? null;
    if (!path) {
      const { dir } = await main.request.pickDirectory({});
      if (!dir) return false;
      path = `${dir.replace(/\/$/, '')}/${tab.title}.md`;
    }
    if (!/\.(md|markdown|txt)$/i.test(path)) path = `${path}.md`;
    const doc = tab.editor.view().state.doc;
    const markdown = tab.editor.getMarkdown();
    const result = await main.request.saveDocument({ path, markdown });
    if (!result.ok) {
      log('error', `save as failed: ${result.message}`);
      return false;
    }
    tab.path = path;
    tab.title = titleFor(path);
    tab.savedDoc = doc;
    tab.bytes = new TextEncoder().encode(markdown).byteLength;
    tab.mtime = result.mtime;
    tab.dirty = false;
    tab.conflict = false;
    this.tabs.update(list => [...list]);
    this.events.onSaved?.(tab, false);
    this.saveSessionDebounced();
    return true;
  }

  async reload(id?: number): Promise<boolean> {
    const tab = id === undefined ? this.active.get() : this.byId(id);
    if (!tab?.path) return false;
    const doc = await main.request.readDocument({ path: tab.path });
    tab.editor.setMarkdown(doc.markdown);
    tab.savedDoc = tab.editor.view().state.doc;
    tab.bytes = new TextEncoder().encode(doc.markdown).byteLength;
    tab.mtime = doc.mtime;
    tab.dirty = false;
    tab.conflict = false;
    this.tabs.update(list => [...list]);
    return true;
  }

  /** Destroy a tab's editor and pane and drop it from the list. Never creates a replacement. */
  private async remove(tab: Tab): Promise<void> {
    const timer = this.autosaveTimers.get(tab.id);
    if (timer) clearTimeout(timer);
    this.autosaveTimers.delete(tab.id);
    this.autosaveFirstChange.delete(tab.id);
    const list = this.tabs.get();
    const idx = list.findIndex(t => t.id === tab.id);
    const remaining = list.filter(t => t.id !== tab.id);
    await tab.editor.destroy();
    tab.pane.remove();
    this.tabs.set(remaining);
    if (this.active.get()?.id === tab.id) {
      const next = remaining[Math.min(Math.max(idx, 0), remaining.length - 1)];
      if (next) this.activate(next.id);
      else this.active.set(null);
    }
  }

  /**
   * Close a tab. Dirty files are saved first; dirty untitled text is kept
   * unless `discard`. The last tab is replaced by one empty untitled tab, and
   * closing that empty tab does nothing.
   */
  async close(id?: number, discard = false): Promise<boolean> {
    const tab = id === undefined ? this.active.get() : this.byId(id);
    if (!tab) return false;
    if (this.tabs.get().length === 1 && isPristineUntitled(tab)) return false;
    if (tab.dirty && !discard) {
      if (tab.path) {
        const saved = await this.save(tab.id);
        if (!saved) return false;
      } else if (tab.editor.getMarkdown().trim() !== '') {
        log('warn', `${tab.title} has unsaved text. te.file.saveAs() first, or te.file.close(true) to discard.`);
        return false;
      }
    }
    await this.remove(tab);
    if (!this.tabs.get().length) await this.newTab();
    this.saveSessionDebounced();
    return true;
  }

  snapshot(): Pick<Session, 'tabs' | 'active'> {
    const list = this.tabs.get();
    const current = this.active.get();
    return {
      tabs: list.map(t => ({
        path: t.path,
        cursor: t.editor.view().state.selection.from,
        scroll: t.pane.scrollTop,
      })),
      active: Math.max(
        0,
        list.findIndex(t => t.id === current?.id)
      ),
    };
  }

  async saveSession() {
    try {
      const previous = await main.request.getSession({});
      const snap = this.snapshot();
      const recent = [...snap.tabs.map(t => t.path).filter((p): p is string => !!p), ...previous.recent]
        .filter((p, i, arr) => arr.indexOf(p) === i)
        .slice(0, 30);
      await main.request.saveSession({
        session: { ...previous, ...snap, recent },
      });
    } catch (error) {
      log('warn', `session save failed: ${String(error)}`);
    }
  }

  async restore(session: Session) {
    const paths = session.tabs.map(t => t.path).filter((p): p is string => !!p);
    if (paths.length) await this.open(paths);
    if (!this.tabs.get().length) await this.newTab();
    const active = this.tabs.get()[session.active];
    if (active) this.activate(active.id);
  }
}
