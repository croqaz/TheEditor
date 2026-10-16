import { afterEach, describe, expect, test } from 'bun:test';
import { encode as encodePng } from 'fast-png';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  chooseBackend,
  parseToolOutput,
  pngSize,
  type RunResult,
  shotDirName,
  Shots,
  type ShotsDeps,
  slug,
} from '../../src/main/shots';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tinyPng(width = 3, height = 2): Uint8Array {
  return encodePng({
    width,
    height,
    data: new Uint8Array(width * height * 4).fill(200),
    channels: 4,
    depth: 8,
  });
}

describe('helpers', () => {
  test('slug and directory names', () => {
    expect(slug('Hello World!')).toBe('hello-world');
    expect(slug('   ')).toBe('shot');
    expect(slug('x'.repeat(80))).toHaveLength(40);
    expect(shotDirName('Verify Run', new Date(2026, 9, 16, 7, 5, 9))).toBe('20261016-070509-verify-run');
  });

  test('parseToolOutput takes the last JSON line and ignores warnings', () => {
    expect(parseToolOutput('WARNING: radv…\n{"ok": true, "n": 1}\n')).toEqual({
      ok: true,
      n: 1,
    });
    expect(parseToolOutput('{"ok": false}\nnot json {\n')).toEqual({
      ok: false,
    });
    expect(() => parseToolOutput('nothing here')).toThrow(/no JSON/);
  });

  test('pngSize reads the IHDR chunk', () => {
    expect(pngSize(tinyPng(7, 5))).toEqual({ width: 7, height: 5 });
    expect(() => pngSize(new Uint8Array(10))).toThrow(/not a PNG/);
  });

  test('chooseBackend', () => {
    expect(chooseBackend('auto', 'KDE', true)).toBe('spectacle');
    expect(chooseBackend('auto', 'KDE', false)).toBe('electrobun');
    expect(chooseBackend('auto', 'GNOME', true)).toBe('electrobun');
    expect(chooseBackend('none', 'KDE', true)).toBe('none');
    expect(chooseBackend('spectacle', 'GNOME', false)).toBe('spectacle');
  });
});

describe('Shots', () => {
  function make(overrides: Partial<ShotsDeps> = {}) {
    const root = mkdtempSync(join(tmpdir(), 'te-shots-'));
    dirs.push(root);
    const calls: { cmd: string; args: string[] }[] = [];
    let toolResponse: Record<string, unknown> | ((args: string[]) => Record<string, unknown>) = { ok: true };
    let toolCode = 0;
    const run = async (cmd: string, args: string[]): Promise<RunResult> => {
      calls.push({ cmd, args });
      if (cmd === 'spectacle') {
        const out = args[args.length - 1]!;
        if (!overrides.log || true) writeFileSync(out, tinyPng(4, 3));
        return { code: 0, stdout: '', stderr: '' };
      }
      const response = typeof toolResponse === 'function' ? toolResponse(args) : toolResponse;
      return {
        code: toolCode,
        stdout: `some warning\n${JSON.stringify(response)}\n`,
        stderr: '',
      };
    };
    const deps: ShotsDeps = {
      cacheDir: root,
      toolPath: '/tools/te-snap.py',
      python: 'python3',
      run,
      which: async bin => bin === 'spectacle',
      backend: 'auto',
      desktop: 'KDE',
      captureRegion: () => null,
      windowFrame: () => ({ x: 0, y: 0, width: 4, height: 3 }),
      log: () => {},
      now: () => new Date(2026, 9, 16, 12, 0, 0),
      ...overrides,
    };
    const shots = new Shots(deps);
    return {
      shots,
      root,
      calls,
      setTool(response: typeof toolResponse, code = 0) {
        toolResponse = response;
        toolCode = code;
      },
    };
  }

  test('newDir and writeArtifact create the shots tree', async () => {
    const { shots, root } = make();
    const dir = await shots.newDir('My Label');
    expect(dir).toBe(join(root, 'shots', '20261016-120000-my-label'));
    expect(existsSync(dir)).toBe(true);
    const path = await shots.writeArtifact(dir, 'measure.json', '{}');
    expect(readFileSync(path, 'utf8')).toBe('{}');
    const bytes = await shots.writeArtifact(dir, 'x.bin', new Uint8Array([1, 2]));
    expect(readFileSync(bytes)).toEqual(Buffer.from([1, 2]));
  });

  test('screen via spectacle writes the active window and reports its size', async () => {
    const { shots, calls } = make();
    const dir = await shots.newDir('s');
    const result = await shots.screen(dir);
    expect(result).toEqual({
      ok: true,
      path: join(dir, 'screen.png'),
      width: 4,
      height: 3,
      backend: 'spectacle',
    });
    expect(calls[0]).toEqual({
      cmd: 'spectacle',
      args: ['-b', '-n', '-a', '-o', join(dir, 'screen.png')],
    });
  });

  test('screen via spectacle reports a missing output', async () => {
    const { shots } = make({
      run: async () => ({ code: 1, stdout: '', stderr: 'no display' }),
    });
    const dir = await shots.newDir('s');
    const result = await shots.screen(dir, 'x.png');
    expect(result).toMatchObject({ ok: false, backend: 'spectacle' });
    expect((result as { error: string }).error).toContain('spectacle wrote nothing');
  });

  test('screen via electrobun encodes captured pixels; reports unavailability', async () => {
    const pixels = new Uint8Array(4 * 3 * 4).fill(128);
    const { shots } = make({ desktop: 'GNOME', captureRegion: () => pixels });
    const dir = await shots.newDir('e');
    const result = await shots.screen(dir);
    expect(result).toMatchObject({
      ok: true,
      width: 4,
      height: 3,
      backend: 'electrobun',
    });
    expect(pngSize(new Uint8Array(readFileSync((result as { path: string }).path)))).toEqual({ width: 4, height: 3 });

    const noPixels = make({ desktop: 'GNOME' });
    expect(await noPixels.shots.screen(await noPixels.shots.newDir('n'))).toMatchObject({
      ok: false,
      error: expect.stringContaining('captureRegion'),
    });
    const noFrame = make({ desktop: 'GNOME', windowFrame: () => null });
    expect(await noFrame.shots.screen(await noFrame.shots.newDir('f'))).toMatchObject({
      ok: false,
      error: 'window frame unavailable',
    });
    const disabled = make({ backend: 'none' });
    expect(await disabled.shots.screen(await disabled.shots.newDir('d'))).toMatchObject({ ok: false, backend: 'none' });
  });

  test('render writes the HTML, calls the tool with the right arguments and parses metrics', async () => {
    const { shots, calls, setTool } = make();
    setTool(args => ({
      ok: true,
      path: args[args.indexOf('--out') + 1],
      width: 1800,
      height: 900,
      metrics: {
        dpr: 2,
        innerWidth: 900,
        innerHeight: 450,
        docWidth: 900,
        docHeight: 450,
      },
    }));
    const dir = await shots.newDir('r');
    const result = await shots.render(dir, '<p>hi</p>', {
      width: 900,
      height: 450,
      name: 'page',
      backend: 'x11',
      viewport: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.path).toBe(join(dir, 'page.png'));
    expect(readFileSync(result.htmlPath, 'utf8')).toBe('<p>hi</p>');
    expect(result.metrics.dpr).toBe(2);
    const args = calls[0]!.args;
    expect(calls[0]!.cmd).toBe('python3');
    expect(args.slice(0, 3)).toEqual(['-I', '/tools/te-snap.py', 'render']);
    expect(args).toContain('--viewport');
    expect(args[args.indexOf('--backend') + 1]).toBe('x11');
    expect(args[args.indexOf('--width') + 1]).toBe('900');
    expect(args[args.indexOf('--height') + 1]).toBe('450');
  });

  test('render failures are reported, not thrown', async () => {
    const { shots, setTool } = make();
    setTool({ ok: false, error: 'load failed' }, 1);
    const result = await shots.render(await shots.newDir('f'), '<p>', {
      width: 100,
    });
    expect(result).toEqual({ ok: false, error: 'load failed' });
  });

  test("crop, diff and marks pass through the tool's JSON", async () => {
    const { shots, calls, setTool } = make();
    setTool(args => {
      if (args[2] === 'crop') {
        return {
          ok: true,
          path: args[args.indexOf('--out') + 1],
          x: 1,
          y: 2,
          width: 3,
          height: 4,
        };
      }
      if (args[2] === 'diff') {
        return {
          ok: true,
          width: 3,
          height: 4,
          sameSize: true,
          mismatch: 2,
          mismatchPct: 16.6,
          bbox: [0, 0, 1, 1],
          diffPath: null,
        };
      }
      return {
        ok: true,
        path: '/inner.png',
        frame: { x: 0, y: 0, width: 10, height: 10, thickness: 2 },
        inner: { x: 2, y: 2, width: 6, height: 6 },
      };
    });
    expect(await shots.crop('/a.png', { x: 1, y: 2, width: 3, height: 4 }, '/c.png')).toMatchObject({
      ok: true,
      path: '/c.png',
    });
    expect(calls.at(-1)!.args).toEqual([
      '-I',
      '/tools/te-snap.py',
      'crop',
      '--in',
      '/a.png',
      '--out',
      '/c.png',
      '--x',
      '1',
      '--y',
      '2',
      '--w',
      '3',
      '--h',
      '4',
    ]);
    expect(await shots.diff('/a.png', '/b.png', '/d.png')).toMatchObject({
      ok: true,
      mismatch: 2,
      tolerance: 0,
    });
    expect(calls.at(-1)!.args).toContain('--out');
    expect(
      calls.at(-1)!.args.slice(calls.at(-1)!.args.indexOf('--tolerance'), calls.at(-1)!.args.indexOf('--tolerance') + 2)
    ).toEqual(['--tolerance', '0']);
    expect(await shots.diff('/a.png', '/b.png', undefined, 31.6)).toMatchObject({ tolerance: 31.6 });
    expect(calls.at(-1)!.args).not.toContain('--out');
    expect(calls.at(-1)!.args).toContain('32');
    expect(await shots.marks('/s.png', '/i.png')).toMatchObject({
      ok: true,
      inner: { width: 6 },
    });
    expect(calls.at(-1)!.args.slice(-2)).toEqual(['--region', 'outer']);
    await shots.marks('/s.png', '/i.png', 'inner');
    expect(calls.at(-1)!.args.slice(-2)).toEqual(['--region', 'inner']);
    setTool({ ok: false, error: 'no registration marks found' }, 1);
    expect(await shots.marks('/s.png', '/i.png')).toEqual({
      ok: false,
      error: 'no registration marks found',
    });
    setTool({}, 1);
    await expect(shots.crop('/a.png', { x: 0, y: 0, width: 1, height: 1 }, '/c.png')).rejects.toThrow();
  });
});
