// Turn the live editor DOM into a standalone HTML document that the
// WebKitGTK helper renders with the same stylesheet, theme variables and
// column width, so its pixels can be compared with the screen.

export const RENDER_CSS = `
html, body { margin: 0; height: auto; overflow: visible; }
body.te-render { display: block; grid-template-rows: none; }
body.te-render #editor { position: static; overflow: visible; }
body.te-render .te-pane { position: static; inset: auto; overflow: visible; height: auto; }
body.te-render .te-pane__inner { padding-bottom: calc(var(--te-size) * var(--te-lh) * 2); }
body.te-render .te-doc { caret-color: transparent; }
body.te-render .te-doc > * { content-visibility: visible; contain-intrinsic-size: none; }
body.te-render.te-marks .te-pane { outline: 4px solid #ff00ff; outline-offset: -4px; }
body.te-render.te-page { height: var(--te-page-height); overflow: hidden; }
`;

/** Text of every same-origin stylesheet currently applied to the page. */
export function collectStyles(doc: Document = document): string {
  const chunks: string[] = [];
  for (const sheet of Array.from(doc.styleSheets)) {
    try {
      const rules = Array.from((sheet as CSSStyleSheet).cssRules);
      chunks.push(rules.map(r => r.cssText).join('\n'));
    } catch {
      // cross-origin or unavailable; skip
    }
  }
  return chunks.join('\n');
}

export interface SerializeOptions {
  /** The ProseMirror root (`.te-doc`). */
  editorDom: Element;
  /** Width of the pane in CSS px: the body gets exactly this width. */
  width: number;
  /** Keep only these top-level block indices (undefined = all). */
  only?: Set<number>;
  marks?: boolean;
  /** Fixed page height in CSS px (overflow hidden) for paged exports. */
  pageHeight?: number;
  /** Extra HTML placed in the pane after the editor, e.g. the te.debug.boxes() layer. */
  overlay?: string;
  styles?: string;
  rootStyle?: string;
  theme?: string;
  title?: string;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
}

/** A clean copy of the editor root: no editing attributes, no selection classes, optional block filter. */
export function cleanEditorClone(editorDom: Element, only?: Set<number>): Element {
  const clone = editorDom.cloneNode(true) as Element;
  clone.removeAttribute('contenteditable');
  clone.removeAttribute('spellcheck');
  clone.removeAttribute('role');
  clone.removeAttribute('aria-multiline');
  clone.classList.remove('ProseMirror-focused');
  for (const el of Array.from(clone.querySelectorAll('.ProseMirror-selectednode')))
    el.classList.remove('ProseMirror-selectednode');
  for (const el of Array.from(clone.querySelectorAll('textarea, .ProseMirror-widget, .ProseMirror-gapcursor')))
    el.remove();
  if (only) {
    Array.from(clone.children).forEach((child, index) => {
      if (!only.has(index)) child.remove();
    });
  }
  return clone;
}

export function documentHtml(options: SerializeOptions): string {
  const styles = options.styles ?? collectStyles();
  const rootStyle = options.rootStyle ?? document.documentElement.getAttribute('style') ?? '';
  const theme = options.theme ?? document.documentElement.dataset.theme ?? '';
  const bodyClasses = ['te-render', options.marks ? 'te-marks' : '', options.pageHeight ? 'te-page' : '']
    .filter(Boolean)
    .join(' ');
  const bodyStyle = `width:${Math.round(options.width)}px;${
    options.pageHeight ? `--te-page-height:${Math.round(options.pageHeight)}px;` : ''
  }`;
  const clone = cleanEditorClone(options.editorDom, options.only);
  return [
    '<!doctype html>',
    `<html lang="en" data-theme="${escapeHtml(theme)}" style="${escapeHtml(rootStyle)}">`,
    '<head>',
    '<meta charset="utf-8">',
    `<title>${escapeHtml(options.title ?? 'TheEditor render')}</title>`,
    `<style>${styles}</style>`,
    `<style>${RENDER_CSS}</style>`,
    '</head>',
    `<body class="${bodyClasses}" style="${bodyStyle}">`,
    '<main id="editor"><div class="te-pane"><div class="te-pane__inner"><div class="milkdown">',
    clone.outerHTML,
    '</div></div>',
    options.overlay ?? '',
    '</div></main>',
    '</body>',
    '</html>',
  ].join('\n');
}

/** Group top-level block indices into sections that start at headings of `level`. */
export function sectionsByHeading(blocks: { type: string; level?: number }[], level = 1): number[][] {
  const sections: number[][] = [];
  let current: number[] = [];
  blocks.forEach((block, index) => {
    const isBreak = block.type === 'heading' && (block.level ?? 1) === level;
    if (isBreak && current.length) {
      sections.push(current);
      current = [];
    }
    current.push(index);
  });
  if (current.length) sections.push(current);
  return sections;
}
