import { describe, expect, test } from 'bun:test';
import { runCommand, runWithBun, runWithNode, which } from '../../src/main/run';

describe('runCommand', () => {
  test('captures stdout, stderr and the exit code with Bun.spawn', async () => {
    const result = await runCommand('sh', ['-c', 'echo out; echo err 1>&2; exit 3'], { timeoutMs: 5000 });
    expect(result.code).toBe(3);
    expect(result.stdout.trim()).toBe('out');
    expect(result.stderr.trim()).toBe('err');
  });

  test('a missing binary is reported as exit 127 instead of throwing', async () => {
    const result = await runWithBun('/definitely/not/a/binary', [], 5000);
    expect(result.code).toBe(127);
    expect(result.stderr.length).toBeGreaterThan(0);
  });

  test('the node:child_process path yields the same shape', async () => {
    // Under Bun, node:child_process is itself built on Bun.spawn, so the fallback is
    // exercised directly rather than by removing Bun.spawn.
    const ok = await runWithNode('sh', ['-c', 'echo node-path'], 5000);
    expect(ok).toEqual({ code: 0, stdout: 'node-path\n', stderr: '' });
    const failing = await runWithNode('sh', ['-c', 'exit 2'], 5000);
    expect(failing.code).toBe(2);
    const missing = await runWithNode('/definitely/not/a/binary', [], 5000);
    expect(missing.code).not.toBe(0);
  });

  test('which finds binaries on PATH', async () => {
    expect(await which('sh')).toBe(true);
    expect(await which('definitely-not-a-binary-xyz')).toBe(false);
  });
});
