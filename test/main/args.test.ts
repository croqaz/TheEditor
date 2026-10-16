import { describe, expect, test } from 'bun:test';
import { parseArgs, parseRun } from '../../src/main/args';

const cwd = '/work';

describe('parseArgs', () => {
  test('defaults with nothing set', () => {
    const o = parseArgs([], {}, cwd);
    expect(o).toEqual({
      profile: undefined,
      online: false,
      smoke: false,
      smokeShots: false,
      headless: false,
      run: undefined,
      keep: false,
      files: [],
      unknown: [],
    });
  });

  test('flags in both spellings and positional files', () => {
    const o = parseArgs(['--profile', 'test', '--online', 'a.md', '--headless', '/abs/b.md'], {}, cwd);
    expect(o.profile).toBe('test');
    expect(o.online).toBe(true);
    expect(o.headless).toBe(true);
    expect(o.files).toEqual(['/work/a.md', '/abs/b.md']);

    const eq = parseArgs(['--profile=./p', '--online=false', '--', '--not-a-flag.md'], {}, cwd);
    expect(eq.profile).toBe('./p');
    expect(eq.online).toBe(false);
    expect(eq.files).toEqual(['/work/--not-a-flag.md']);
  });

  test('environment fallbacks', () => {
    const o = parseArgs(
      [],
      {
        TE_PROFILE: 'env-prof',
        THEEDITOR_ONLINE: '1',
        TE_HEADLESS: 'true',
        TE_OPEN: 'c.md',
      },
      cwd
    );
    expect(o.profile).toBe('env-prof');
    expect(o.online).toBe(true);
    expect(o.headless).toBe(true);
    expect(o.files).toEqual(['/work/c.md']);
    expect(parseArgs(['--offline'], { THEEDITOR_ONLINE: '1' }, cwd).online).toBe(false);
  });

  test('argv wins over environment for the profile', () => {
    expect(parseArgs(['--profile', 'cli'], { TE_PROFILE: 'env' }, cwd).profile).toBe('cli');
  });

  test('smoke defaults to the test profile unless one is given', () => {
    expect(parseArgs(['--smoke'], {}, cwd).profile).toBe('test');
    expect(parseArgs(['--smoke-shots'], {}, cwd)).toMatchObject({
      smokeShots: true,
      profile: 'test',
    });
    expect(parseArgs([], { TE_SMOKE_SHOTS: '1' }, cwd).smokeShots).toBe(true);
    expect(parseArgs([], { TE_SMOKE: '1' }, cwd).profile).toBe('test');
    expect(parseArgs(['--smoke', '--profile', 'mine'], {}, cwd).profile).toBe('mine');
  });

  test('--run takes a JSON list of commands, defaults to the test profile, --keep keeps the window', () => {
    const script = [
      ['debug.boxes', true],
      ['shot.screen', { label: 'boxes' }],
    ];
    const o = parseArgs(['--run', JSON.stringify(script), '--keep'], {}, cwd);
    expect(o.run).toEqual(script);
    expect(o.keep).toBe(true);
    expect(o.profile).toBe('test');
    expect(parseArgs([`--run=${JSON.stringify([['help']])}`, '--profile', 'mine'], {}, cwd)).toMatchObject({
      run: [['help']],
      profile: 'mine',
    });
    expect(parseArgs([], { TE_RUN: '[["measure"]]', TE_KEEP: '1' }, cwd)).toMatchObject({
      run: [['measure']],
      keep: true,
      profile: 'test',
    });
    expect(parseArgs([], { TE_RUN: '  ' }, cwd).run).toBeUndefined();
    expect(() => parseArgs(['--run'], {}, cwd)).toThrow(/--run/);
    expect(() => parseArgs(['--run', '{not json'], {}, cwd)).toThrow(/not valid JSON/);
    expect(() => parseArgs(['--run', '{"id": "x"}'], {}, cwd)).toThrow(/JSON array/);
    expect(() => parseRun('[[1]]')).toThrow(/JSON array/);
    expect(() => parseRun('[["ok"], "no"]')).toThrow(/JSON array/);
  });

  test('unknown flags are kept, missing profile value throws', () => {
    expect(parseArgs(['--whatever', '--x=1'], {}, cwd).unknown).toEqual(['--whatever', '--x=1']);
    expect(() => parseArgs(['--profile'], {}, cwd)).toThrow(/--profile/);
    expect(() => parseArgs(['--profile', '--online'], {}, cwd)).toThrow(/--profile/);
  });
});
