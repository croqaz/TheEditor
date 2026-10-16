// Drag and drop of files onto the window, by zone. Without any handling
// WebKit navigates the whole page to the dropped file (everything goes black),
// so every file drag is claimed here and routed:
//
//   tab bar   → open the Markdown files in tabs (the bar lights up while a file is over it)
//   editor    → insert the dropped paths as text where the pointer is
//   status bar, anything else → refused (the pointer shows "not allowed")

export interface DropZones {
  tabs?: HTMLElement | null;
  editor?: HTMLElement | null;
  status?: HTMLElement | null;
}

export type DropZone = 'tabs' | 'editor' | 'status' | 'other';

export interface DropTargets {
  /** Absolute paths the main process can read. */
  openPaths(paths: string[]): void;
  /** Content of a dropped file whose path is not known (File objects only). */
  openText(name: string, text: string): void;
  /** Put text into the active document at a window position (editor zone). */
  insertText?(text: string, at: { x: number; y: number }): void;
  /** Something worth telling the user (a refused file) or the log (what the drop carried). */
  report?(message: string, error?: boolean): void;
  zones?: DropZones;
}

export const MARKDOWN_FILE = /\.(md|markdown|txt)$/i;

/** Class put on the tab bar while a file drag is over it (index.css). */
export const DROP_TARGET_CLASS = 'te-drop-target';

/** `text/uri-list` → local paths; non-file URIs and comments are dropped. */
export function pathsFromUriList(uriList: string | null | undefined): string[] {
  if (!uriList) return [];
  const paths: string[] = [];
  for (const raw of uriList.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.startsWith('file://')) continue;
    const withoutScheme = line.slice('file://'.length).replace(/^localhost(?=\/)/, '');
    try {
      paths.push(decodeURIComponent(withoutScheme));
    } catch {
      paths.push(withoutScheme);
    }
  }
  return paths;
}

/** `file:` URLs and absolute paths found in any text: URI lists, HTML links, plain text. */
export function pathsFromText(text: string | null | undefined): string[] {
  if (!text) return [];
  const found: string[] = [];
  const seen = new Set<string>();
  const add = (path: string) => {
    if (!seen.has(path)) {
      seen.add(path);
      found.push(path);
    }
  };
  // file:///x, file:/x and file://localhost/x, bare or as href="…" inside HTML, in text order
  for (const match of text.matchAll(/file:\/{0,2}(?:localhost)?(\/[^\s"'<>]+)/g)) {
    let path = match[1]!;
    try {
      path = decodeURIComponent(path);
    } catch {
      // keep as is
    }
    add(path);
  }
  // bare absolute paths, one per line
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('/') && !line.includes('<')) add(line);
  }
  return found;
}

type TransferLike = {
  types?: ArrayLike<string> | readonly string[];
  files?: ArrayLike<{ name: string; text(): Promise<string> }>;
  getData?(type: string): string;
  dropEffect?: string;
};

function transferOf(event: Event): TransferLike | null {
  return ((event as DragEvent).dataTransfer as TransferLike | null) ?? null;
}

/** True for drags that WebKit would otherwise turn into a navigation: files or URL lists. */
export function carriesFiles(transfer: TransferLike | null): boolean {
  if (!transfer) return false;
  const types = Array.from(transfer.types ?? []);
  return types.includes('Files') || types.includes('text/uri-list');
}

export function zoneOf(target: EventTarget | null, zones: DropZones | undefined): DropZone {
  if (!(target instanceof Node) || !zones) return 'other';
  if (zones.tabs?.contains(target)) return 'tabs';
  if (zones.status?.contains(target)) return 'status';
  if (zones.editor?.contains(target)) return 'editor';
  return 'other';
}

const basename = (path: string) => path.slice(path.lastIndexOf('/') + 1);

export function installDropHandler(target: EventTarget, handlers: DropTargets): () => void {
  const tabsEl = handlers.zones?.tabs ?? null;
  const highlight = (on: boolean) => tabsEl?.classList.toggle(DROP_TARGET_CLASS, on);

  const onDragOver = (event: Event) => {
    const transfer = transferOf(event);
    if (!carriesFiles(transfer)) return;
    event.preventDefault();
    const zone = zoneOf(event.target, handlers.zones);
    highlight(zone === 'tabs');
    if (transfer) {
      transfer.dropEffect = zone === 'tabs' ? 'copy' : zone === 'editor' ? 'link' : 'none';
    }
  };
  const onDragLeave = (event: Event) => {
    const related = (event as DragEvent).relatedTarget ?? null;
    if (zoneOf(related, handlers.zones) !== 'tabs') highlight(false);
  };
  const onDrop = (event: Event) => {
    const transfer = transferOf(event);
    if (!carriesFiles(transfer)) return;
    event.preventDefault();
    event.stopPropagation();
    highlight(false);
    const zone = zoneOf(event.target, handlers.zones);
    const types = Array.from(transfer?.types ?? []);
    // WebKit may expose the paths as a URI list, as HTML links, or as plain text; read every type it lists.
    const sources = types.filter(t => t !== 'Files').map(t => [t, transfer?.getData?.(t) ?? ''] as const);
    const paths = pathsFromText(sources.map(([, data]) => data).join('\n'));
    const files = Array.from(transfer?.files ?? []);
    const detail = sources
      .map(
        ([t, data]) =>
          `${t}=${data.length ? `${JSON.stringify(data.slice(0, 120))}${data.length > 120 ? '…' : ''}` : 'empty'}`
      )
      .join(' ');
    handlers.report?.(
      `drop on ${zone}: ${
        types.join(' ') || 'no types'
      } · ${paths.length} path(s) · ${files.length} file(s) · ${detail}`
    );
    if (zone === 'editor') {
      const names = paths.length ? paths : files.map(f => f.name);
      if (names.length) {
        const { clientX, clientY } = event as DragEvent;
        handlers.insertText?.(names.join('\n'), { x: clientX, y: clientY });
      }
      return;
    }
    if (zone !== 'tabs') return;
    const markdownPaths = paths.filter(p => MARKDOWN_FILE.test(p));
    if (markdownPaths.length) handlers.openPaths(markdownPaths);
    const refusedPaths = paths.filter(p => !MARKDOWN_FILE.test(p)).map(basename);
    if (!paths.length) {
      for (const file of files) {
        if (MARKDOWN_FILE.test(file.name)) {
          void file.text().then(text => handlers.openText(file.name, text));
        } else refusedPaths.push(file.name);
      }
    }
    if (refusedPaths.length) {
      handlers.report?.(`not Markdown or text: ${refusedPaths.join(', ')}`, true);
    }
  };
  const onDragEnd = () => highlight(false);
  const options = { capture: true } as const;
  target.addEventListener('dragenter', onDragOver, options);
  target.addEventListener('dragover', onDragOver, options);
  target.addEventListener('dragleave', onDragLeave, options);
  target.addEventListener('dragend', onDragEnd, options);
  target.addEventListener('drop', onDrop, options);
  return () => {
    target.removeEventListener('dragenter', onDragOver, options);
    target.removeEventListener('dragover', onDragOver, options);
    target.removeEventListener('dragleave', onDragLeave, options);
    target.removeEventListener('dragend', onDragEnd, options);
    target.removeEventListener('drop', onDrop, options);
  };
}
