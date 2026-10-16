import { describe, expect, test } from 'bun:test';
import {
  carriesFiles,
  DROP_TARGET_CLASS,
  installDropHandler,
  pathsFromText,
  pathsFromUriList,
  zoneOf,
} from '../../src/view/drop';

type FakeTransfer = {
  types: string[];
  files?: { name: string; text(): Promise<string> }[];
  data?: Record<string, string>;
  dropEffect?: string;
  getData(type: string): string;
};

function transfer(init: Omit<FakeTransfer, 'getData'>): FakeTransfer {
  return { ...init, getData: type => init.data?.[type] ?? '' };
}

function fire(
  target: EventTarget,
  type: string,
  dataTransfer: FakeTransfer | null,
  extra: Record<string, unknown> = {}
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
  for (const [key, value] of Object.entries(extra)) {
    Object.defineProperty(event, key, { value });
  }
  target.dispatchEvent(event);
  return event;
}

const settle = () => new Promise(r => setTimeout(r, 0));

/** The app shell: tab bar, editor, status bar inside one root the handler is installed on. */
function shell() {
  const root = document.createElement('div');
  const tabs = document.createElement('header');
  const editor = document.createElement('main');
  const pane = document.createElement('div');
  editor.appendChild(pane);
  const status = document.createElement('footer');
  root.append(tabs, editor, status);
  document.body.appendChild(root);
  const opened: string[][] = [];
  const texts: [string, string][] = [];
  const inserted: [string, { x: number; y: number }][] = [];
  const reports: [string, boolean | undefined][] = [];
  const uninstall = installDropHandler(root, {
    openPaths: p => opened.push(p),
    openText: (n, t) => texts.push([n, t]),
    insertText: (text, at) => inserted.push([text, at]),
    report: (message, error) => reports.push([message, error]),
    zones: { tabs, editor, status },
  });
  return {
    root,
    tabs,
    editor,
    pane,
    status,
    opened,
    texts,
    inserted,
    reports,
    uninstall,
  };
}

const FILES = transfer({
  types: ['Files', 'text/uri-list'],
  data: {
    'text/uri-list': 'file:///docs/a.md\r\nfile:///docs/image.png\r\nfile:///docs/notes.markdown',
  },
});

describe('pathsFromUriList', () => {
  test('decodes file URIs, skips comments and non-file URIs', () => {
    const list = '# comment\r\nfile:///home/u/My%20Notes/a.md\nhttps://example.com/x.md\nfile://localhost/tmp/b.md\n\n';
    expect(pathsFromUriList(list)).toEqual(['/home/u/My Notes/a.md', '/tmp/b.md']);
    expect(pathsFromUriList('')).toEqual([]);
    expect(pathsFromUriList(undefined)).toEqual([]);
    expect(pathsFromUriList('file:///bad%zz')).toEqual(['/bad%zz']);
  });

  test('pathsFromText also reads file links in HTML, single-slash file URLs and bare paths', () => {
    expect(pathsFromText('<meta charset="utf-8"><a href="file:///home/u/My%20Notes/a.md">a.md</a>')).toEqual([
      '/home/u/My Notes/a.md',
    ]);
    expect(pathsFromText('file:/tmp/b.md\nfile://localhost/tmp/c.md')).toEqual(['/tmp/b.md', '/tmp/c.md']);
    expect(pathsFromText('/plain/path.md\nnot a path\n/other.txt')).toEqual(['/plain/path.md', '/other.txt']);
    expect(pathsFromText('file:///dup.md\nfile:///dup.md')).toEqual(['/dup.md']); // once
    expect(pathsFromText('')).toEqual([]);
    expect(pathsFromText(null)).toEqual([]);
  });

  test('carriesFiles recognises Files and URL lists only', () => {
    expect(carriesFiles(transfer({ types: ['Files'] }))).toBe(true);
    expect(carriesFiles(transfer({ types: ['text/uri-list'] }))).toBe(true);
    expect(carriesFiles(transfer({ types: ['text/plain'] }))).toBe(false);
    expect(carriesFiles(null)).toBe(false);
  });

  test('zoneOf maps a target to the bar or pane it is in', () => {
    const { tabs, pane, status, root } = shell();
    const zones = { tabs, editor: pane.parentElement, status };
    expect(zoneOf(tabs, zones)).toBe('tabs');
    expect(zoneOf(pane, zones)).toBe('editor');
    expect(zoneOf(status, zones)).toBe('status');
    expect(zoneOf(root, zones)).toBe('other');
    expect(zoneOf(null, zones)).toBe('other');
    expect(zoneOf(tabs, undefined)).toBe('other');
  });
});

describe('installDropHandler', () => {
  test('tab bar: highlights while a file is over it, opens Markdown files, refuses the rest', async () => {
    const { tabs, opened, texts, reports, inserted } = shell();
    const over = fire(tabs, 'dragover', transfer({ types: ['Files'] }));
    expect(over.defaultPrevented).toBe(true);
    expect((over as unknown as { dataTransfer: FakeTransfer }).dataTransfer.dropEffect).toBe('copy');
    expect(tabs.classList.contains(DROP_TARGET_CLASS)).toBe(true);
    const enter = fire(tabs, 'dragenter', transfer({ types: ['text/uri-list'] }));
    expect(enter.defaultPrevented).toBe(true);

    const drop = fire(tabs, 'drop', FILES);
    expect(drop.defaultPrevented).toBe(true);
    expect(tabs.classList.contains(DROP_TARGET_CLASS)).toBe(false);
    expect(opened).toEqual([['/docs/a.md', '/docs/notes.markdown']]);
    expect(texts).toEqual([]);
    expect(inserted).toEqual([]);
    expect(reports[0]![0]).toStartWith('drop on tabs: Files text/uri-list · 3 path(s) · 0 file(s) · text/uri-list=');
    expect(reports[0]![0]).toContain('"file:///docs/a.md');
    expect(reports[1]).toEqual(['not Markdown or text: image.png', true]);
  });

  test('tab bar: paths hidden in HTML links or plain text still open (what KDE drags carried)', () => {
    const { tabs, opened, reports } = shell();
    fire(
      tabs,
      'drop',
      transfer({
        types: ['text/uri-list', 'text/html'],
        data: {
          'text/uri-list': '',
          'text/html': '<a href="file:///home/u/notes/today.md">today.md</a>',
        },
      })
    );
    expect(opened).toEqual([['/home/u/notes/today.md']]);
    expect(reports[0]![0]).toContain('text/uri-list=empty text/html=');
    fire(
      tabs,
      'drop',
      transfer({
        types: ['text/plain'],
        data: { 'text/plain': '/home/u/notes/plain.md' },
      })
    );
    expect(opened).toHaveLength(1); // plain text drags are not file drags
  });

  test('tab bar: falls back to file contents when no path is available', async () => {
    const { tabs, texts, reports } = shell();
    fire(
      tabs,
      'drop',
      transfer({
        types: ['Files'],
        files: [
          { name: 'chapter.md', text: async () => '# Chapter\n' },
          { name: 'photo.jpg', text: async () => 'binary' },
        ],
      })
    );
    await settle();
    expect(texts).toEqual([['chapter.md', '# Chapter\n']]);
    expect(reports.at(-1)).toEqual(['not Markdown or text: photo.jpg', true]);
  });

  test('editor: shows the link effect and inserts the dropped paths where the pointer is', () => {
    const { pane, tabs, opened, inserted } = shell();
    const over = fire(pane, 'dragover', transfer({ types: ['Files'] }));
    expect(over.defaultPrevented).toBe(true);
    expect((over as unknown as { dataTransfer: FakeTransfer }).dataTransfer.dropEffect).toBe('link');
    expect(tabs.classList.contains(DROP_TARGET_CLASS)).toBe(false);
    const drop = fire(pane, 'drop', FILES, { clientX: 120, clientY: 300 });
    expect(drop.defaultPrevented).toBe(true);
    expect(opened).toEqual([]);
    expect(inserted).toEqual([['/docs/a.md\n/docs/image.png\n/docs/notes.markdown', { x: 120, y: 300 }]]);

    // File objects without paths: their names
    fire(
      pane,
      'drop',
      transfer({
        types: ['Files'],
        files: [{ name: 'photo.jpg', text: async () => '' }],
      }),
      { clientX: 1, clientY: 2 }
    );
    expect(inserted.at(-1)).toEqual(['photo.jpg', { x: 1, y: 2 }]);
    fire(pane, 'drop', transfer({ types: ['Files'] }));
    expect(inserted).toHaveLength(2);
  });

  test('status bar and anything else: not allowed, and the drop does nothing', () => {
    const { status, root, opened, inserted, texts } = shell();
    for (const target of [status, root]) {
      const over = fire(target, 'dragover', transfer({ types: ['Files'] }));
      expect(over.defaultPrevented).toBe(true); // prevented so WebKit never navigates to the file
      expect((over as unknown as { dataTransfer: FakeTransfer }).dataTransfer.dropEffect).toBe('none');
      const drop = fire(target, 'drop', FILES);
      expect(drop.defaultPrevented).toBe(true);
    }
    expect(opened).toEqual([]);
    expect(inserted).toEqual([]);
    expect(texts).toEqual([]);
  });

  test('the highlight follows the drag: leaving the bar or ending the drag clears it', () => {
    const { tabs, pane, root } = shell();
    const cell = document.createElement('div');
    tabs.appendChild(cell);
    fire(tabs, 'dragover', transfer({ types: ['Files'] }));
    expect(tabs.classList.contains(DROP_TARGET_CLASS)).toBe(true);
    fire(tabs, 'dragleave', transfer({ types: ['Files'] }), {
      relatedTarget: cell,
    }); // still inside the bar
    expect(tabs.classList.contains(DROP_TARGET_CLASS)).toBe(true);
    fire(tabs, 'dragleave', transfer({ types: ['Files'] }), {
      relatedTarget: pane,
    });
    expect(tabs.classList.contains(DROP_TARGET_CLASS)).toBe(false);
    fire(tabs, 'dragover', transfer({ types: ['Files'] }));
    fire(tabs, 'dragleave', transfer({ types: ['Files'] }), {
      relatedTarget: null,
    }); // left the window
    expect(tabs.classList.contains(DROP_TARGET_CLASS)).toBe(false);
    fire(tabs, 'dragover', transfer({ types: ['Files'] }));
    fire(root, 'dragend', null);
    expect(tabs.classList.contains(DROP_TARGET_CLASS)).toBe(false);
    fire(pane, 'dragover', transfer({ types: ['Files'] })); // moving onto the editor clears it too
    expect(tabs.classList.contains(DROP_TARGET_CLASS)).toBe(false);
  });

  test('plain text drags are left to the editor; URL drags are blocked but open nothing; uninstall stops everything', () => {
    const { tabs, opened, uninstall } = shell();
    const text = fire(tabs, 'drop', transfer({ types: ['text/plain'], data: { 'text/plain': 'hello' } }));
    expect(text.defaultPrevented).toBe(false);
    const url = fire(
      tabs,
      'drop',
      transfer({
        types: ['text/uri-list'],
        data: { 'text/uri-list': 'https://example.com/' },
      })
    );
    expect(url.defaultPrevented).toBe(true);
    expect(opened).toEqual([]);
    const none = fire(tabs, 'dragover', null);
    expect(none.defaultPrevented).toBe(false);
    uninstall();
    const after = fire(tabs, 'drop', FILES);
    expect(after.defaultPrevented).toBe(false);
    expect(opened).toEqual([]);
  });

  test('works without zones: everything is refused except the navigation block', () => {
    const target = document.createElement('div');
    const opened: string[][] = [];
    installDropHandler(target, {
      openPaths: p => opened.push(p),
      openText: () => {},
    });
    const drop = fire(target, 'drop', FILES);
    expect(drop.defaultPrevented).toBe(true);
    expect(opened).toEqual([]);
  });
});
