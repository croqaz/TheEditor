import { beforeEach, describe, expect, test } from 'bun:test';
import { countText } from '../../src/shared/stats/count';
import { mountStatusBar, type PromptHost } from '../../src/view/bars/status';

function key(target: HTMLElement, key: string) {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

describe('status bar', () => {
  let host: HTMLElement;
  let runs: { id: string; args: unknown[] }[];
  let history: string[];
  let prompt: PromptHost;
  let nextResult: unknown;

  beforeEach(() => {
    host = document.createElement('footer');
    document.body.appendChild(host);
    runs = [];
    history = [];
    nextResult = 'done';
    prompt = {
      run: (id, args) => {
        runs.push({ id, args });
        if (id === 'boom') throw new Error('kaboom');
        if (id === 'slow') return Promise.resolve({ words: 3, ok: true });
        if (id === 'fail') return Promise.reject(new Error('later'));
        return nextResult;
      },
      complete: prefix => ['theme', 'theme.list', 'theme.next', 'text.lowercase'].filter(c => c.startsWith(prefix)),
      history: () => history,
      remember: line => history.unshift(line),
    };
  });

  test('renders the configured cells from stats', () => {
    const bar = mountStatusBar(host, prompt);
    const stats = countText('One two three. Four five.', { wpm: 60 });
    bar.update({
      stats,
      cursor: { line: 3, column: 7 },
      fields: [
        'words',
        'chars',
        'lines',
        'paragraphs',
        'sentences',
        'readtime',
        'speaktime',
        'headings',
        'bytes',
        'cursor',
        'lang',
        'autosave',
        'net',
        'custom',
      ],
      lang: 'en-GB',
      online: true,
      autosave: true,
    });
    const texts = [...host.querySelectorAll('.te-cell')].map(c => c.textContent);
    expect(texts).toEqual([
      '5 w',
      '25 c',
      '1 l',
      '1 ¶',
      '2 s',
      '5 s',
      'speak 2 s',
      '0 h',
      '25 B',
      'Ln 3, Col 7',
      'en-GB',
      'autosave',
      'ONLINE',
      'custom',
    ]);
    bar.update({ online: false, autosave: false, cursor: null });
    const after = [...host.querySelectorAll('.te-cell')].map(c => c.textContent);
    expect(after).toContain('OFFLINE');
    expect(after).not.toContain('autosave');
    expect(after.some(t => t?.startsWith('Ln'))).toBe(false);
  });

  test('selection stats take over the first cells in the accent colour', () => {
    const bar = mountStatusBar(host, prompt);
    const stats = countText('Lorem ipsum dolor sit amet.');
    stats.selection = {
      chars: 5,
      charsNoSpaces: 5,
      words: 1,
      sentences: 0,
      lines: 1,
    };
    bar.update({ stats, fields: ['words', 'chars', 'lines'] });
    const cells = [...host.querySelectorAll('.te-cell--selection')].map(c => c.textContent);
    expect(cells).toEqual(['1 w', '5 c', '1 l']);
  });

  test('flash shows a message and clears it', async () => {
    const bar = mountStatusBar(host, prompt);
    bar.update({ fields: ['net'] });
    bar.flash('saved book', false, 20);
    expect(host.querySelector('.te-cell--flash')?.textContent).toBe('saved book');
    bar.flash('oops', true, 20);
    expect(host.querySelector('.te-cell--error')?.textContent).toBe('oops');
    await new Promise(r => setTimeout(r, 40));
    expect(host.querySelector('.te-cell--error')).toBeNull();
  });

  test('prompt runs commands, completes, walks history and closes', async () => {
    const bar = mountStatusBar(host, prompt);
    bar.update({ fields: ['net'] });
    expect(bar.isPromptOpen()).toBe(false);
    bar.openPrompt('the');
    expect(bar.isPromptOpen()).toBe(true);
    const input = host.querySelector<HTMLInputElement>('input.te-prompt')!;
    expect(input.value).toBe('the');
    bar.openPrompt(); // already open: just focuses

    // completion with several candidates shows a hint, with one fills the input
    key(input, 'Tab');
    expect(host.querySelector('.te-cell--flash')?.textContent).toContain('theme.list');
    input.value = 'text.l';
    key(input, 'Tab');
    expect(input.value).toBe('text.lowercase ');

    // run a command
    input.value = 'theme gruvbox-light';
    key(input, 'Enter');
    expect(runs).toEqual([{ id: 'theme', args: ['gruvbox-light'] }]);
    expect(history).toEqual(['theme gruvbox-light']);
    expect(bar.isPromptOpen()).toBe(false);
    expect(host.querySelector('.te-cell--flash')?.textContent).toBe('done');

    // history navigation
    bar.openPrompt();
    const input2 = host.querySelector<HTMLInputElement>('input.te-prompt')!;
    key(input2, 'ArrowUp');
    expect(input2.value).toBe('theme gruvbox-light');
    key(input2, 'ArrowDown');
    expect(input2.value).toBe('');
    key(input2, 'Escape');
    expect(bar.isPromptOpen()).toBe(false);
  });

  test('prompt reports errors and async results', async () => {
    const bar = mountStatusBar(host, prompt);
    bar.openPrompt();
    let input = host.querySelector<HTMLInputElement>('input.te-prompt')!;
    input.value = 'boom';
    key(input, 'Enter');
    expect(host.querySelector('.te-cell--error')?.textContent).toBe('Error: kaboom');

    bar.openPrompt();
    input = host.querySelector<HTMLInputElement>('input.te-prompt')!;
    input.value = 'slow';
    key(input, 'Enter');
    await new Promise(r => setTimeout(r, 0));
    expect(host.querySelector('.te-cell--flash')?.textContent).toBe('words: 3 · ok: true');

    bar.openPrompt();
    input = host.querySelector<HTMLInputElement>('input.te-prompt')!;
    input.value = 'fail';
    key(input, 'Enter');
    await new Promise(r => setTimeout(r, 0));
    expect(host.querySelector('.te-cell--error')?.textContent).toBe('Error: later');

    // empty line does nothing; blur closes
    bar.openPrompt();
    input = host.querySelector<HTMLInputElement>('input.te-prompt')!;
    input.value = '   ';
    key(input, 'Enter');
    expect(runs.map(r => r.id)).toEqual(['boom', 'slow', 'fail']);
    bar.openPrompt();
    input = host.querySelector<HTMLInputElement>('input.te-prompt')!;
    input.dispatchEvent(new Event('blur'));
    expect(bar.isPromptOpen()).toBe(false);
  });

  test('mousedown on the bar is prevented so the editor keeps focus, except on the prompt input', () => {
    const bar = mountStatusBar(host, prompt);
    bar.update({ fields: ['net'] });
    const onCell = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
    });
    host.querySelector('.te-cell')!.dispatchEvent(onCell);
    expect(onCell.defaultPrevented).toBe(true);
    bar.openPrompt();
    const onInput = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
    });
    host.querySelector('input')!.dispatchEvent(onInput);
    expect(onInput.defaultPrevented).toBe(false);
    bar.closePrompt();
  });

  test('result summaries cover scalars, arrays and undefined', () => {
    const bar = mountStatusBar(host, prompt);
    const cases: [unknown, string][] = [
      [undefined, 'ok'],
      [null, 'null'],
      [42, '42'],
      [true, 'true'],
      [['a', { b: 1 }], 'a  {"b":1}'],
      [{ pi: 3.14159, name: 'x' }, 'pi: 3.14 · name: "x"'],
      [Symbol.for('odd'), 'Symbol(odd)'],
    ];
    for (const [value, expected] of cases) {
      nextResult = value;
      bar.openPrompt();
      const input = host.querySelector<HTMLInputElement>('input.te-prompt')!;
      input.value = 'anything';
      key(input, 'Enter');
      expect(host.querySelector('.te-cell--flash')?.textContent).toBe(expected);
    }
  });
});
