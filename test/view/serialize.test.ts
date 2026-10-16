import { describe, expect, test } from 'bun:test';
import { createEditor } from '../../src/view/editor/create';
import {
  cleanEditorClone,
  collectStyles,
  documentHtml,
  RENDER_CSS,
  sectionsByHeading,
} from '../../src/view/shots/serialize';

describe('sectionsByHeading', () => {
  test('starts a new section at each heading of the level; content before the first heading forms its own section', () => {
    const blocks = [
      { type: 'frontmatter' },
      { type: 'heading', level: 1 },
      { type: 'paragraph' },
      { type: 'heading', level: 2 },
      { type: 'heading', level: 1 },
      { type: 'paragraph' },
    ];
    expect(sectionsByHeading(blocks, 1)).toEqual([[0], [1, 2, 3], [4, 5]]);
    expect(sectionsByHeading(blocks, 2)).toEqual([
      [0, 1, 2],
      [3, 4, 5],
    ]);
    expect(sectionsByHeading([], 1)).toEqual([]);
    expect(sectionsByHeading([{ type: 'heading', level: 1 }], 1)).toEqual([[0]]);
  });
});

describe('collectStyles', () => {
  test('concatenates rules of same-origin stylesheets', () => {
    const style = document.createElement('style');
    style.textContent = '.te-probe { color: red; }';
    document.head.appendChild(style);
    expect(collectStyles()).toContain('.te-probe');
    style.remove();
  });
});

describe('documentHtml', () => {
  test('produces a standalone document with styles, root variables, width and the editor clone', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const handle = await createEditor(root, '# One\n\npara\n\n# Two\n\nmore\n', {
      onDocChanged() {},
      onSelectionChanged() {},
    });
    document.documentElement.setAttribute('style', '--te-bg: #111;');
    document.documentElement.dataset.theme = 'nord-dark';
    const html = documentHtml({
      editorDom: handle.view().dom,
      width: 640.4,
      styles: '.x{}',
      marks: true,
      pageHeight: 480,
    });
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('data-theme="nord-dark"');
    expect(html).toContain('--te-bg: #111;');
    expect(html).toContain('<style>.x{}</style>');
    expect(html).toContain(RENDER_CSS.trim().split('\n')[0]!);
    expect(html).toContain('content-visibility: visible'); // the render lays out every block
    expect(html).toContain('class="te-render te-marks te-page"');
    expect(html).toContain('width:640px;--te-page-height:480px;');
    expect(html).toMatch(/<h1[^>]*>One<\/h1>/);
    expect(html).toContain('more');
    expect(html).not.toContain('contenteditable');

    const withOverlay = documentHtml({
      editorDom: handle.view().dom,
      width: 500,
      styles: '',
      overlay: '<div class="te-boxes"><div class="te-box"></div></div>',
    });
    expect(withOverlay).toContain(
      '</div></div>\n<div class="te-boxes"><div class="te-box"></div></div>\n</div></main>'
    );
    expect(html).not.toContain('te-boxes');

    const only = documentHtml({
      editorDom: handle.view().dom,
      width: 500,
      styles: '',
      only: new Set([2, 3]),
    });
    expect(only).toMatch(/<h1[^>]*>Two<\/h1>/);
    expect(only).not.toMatch(/<h1[^>]*>One<\/h1>/);
    expect(only).toContain('class="te-render"');
    await handle.destroy();
  });

  test('cleanEditorClone strips editing state and widgets', () => {
    const editor = document.createElement('div');
    editor.className = 'ProseMirror te-doc ProseMirror-focused';
    editor.setAttribute('contenteditable', 'true');
    editor.setAttribute('spellcheck', 'false');
    editor.setAttribute('role', 'textbox');
    editor.setAttribute('aria-multiline', 'true');
    editor.innerHTML =
      '<p class="ProseMirror-selectednode">a</p><div class="te-frontmatter"><textarea>x</textarea></div><span class="ProseMirror-widget"></span><p>b</p>';
    const clone = cleanEditorClone(editor);
    expect(clone.getAttribute('contenteditable')).toBeNull();
    expect(clone.getAttribute('role')).toBeNull();
    expect(clone.classList.contains('ProseMirror-focused')).toBe(false);
    expect(clone.querySelector('.ProseMirror-selectednode')).toBeNull();
    expect(clone.querySelector('textarea')).toBeNull();
    expect(clone.querySelector('.ProseMirror-widget')).toBeNull();
    expect(clone.children).toHaveLength(3);
    expect(editor.getAttribute('contenteditable')).toBe('true'); // original untouched
    const filtered = cleanEditorClone(editor, new Set([2]));
    expect(filtered.children).toHaveLength(1);
    expect(filtered.firstElementChild?.textContent).toBe('b');
  });
});
