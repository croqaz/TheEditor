// Screenshots on the main-process side: a directory per capture, the visible
// window through a screen backend, full-document renders through tools/te-snap.py
// (WebKitGTK), and crop/diff/marks through the same tool. All external work goes
// through injected functions so this module is unit-testable.
import { encode as encodePng } from 'fast-png';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  CropResult,
  DiffResult,
  MarksResult,
  PixelRect,
  RenderOptions,
  RenderResult,
  ScreenShotResult,
} from '../shared/rpc-schema';

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type Runner = (cmd: string, args: string[], options: { timeoutMs: number }) => Promise<RunResult>;

export type ScreenBackend = 'auto' | 'spectacle' | 'electrobun' | 'none';

export interface ShotsDeps {
  cacheDir: string;
  toolPath: string;
  python: string;
  run: Runner;
  which: (binary: string) => Promise<boolean>;
  backend: ScreenBackend;
  desktop: string;
  /** Electrobun `Screen.captureRegion`; RGBA or null when unavailable. */
  captureRegion: (rect: PixelRect) => Uint8Array | null;
  /** Window frame in Electrobun's logical screen coordinates. */
  windowFrame: () => PixelRect | null;
  log: (message: string) => void;
  now?: () => Date;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function slug(label: string): string {
  return (
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'shot'
  );
}

export function shotDirName(label: string, now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(
    now.getDate()
  )}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${stamp}-${slug(label)}`;
}

/** The tool prints exactly one JSON object as its last stdout line; warnings may precede it. */
export function parseToolOutput(stdout: string): Record<string, unknown> {
  const lines = stdout.trim().split('\n').reverse();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      return JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      // keep looking
    }
  }
  throw new Error(`te-snap produced no JSON: ${stdout.slice(-400)}`);
}

/** Width and height from a PNG's IHDR chunk. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } {
  if (bytes.length < 24 || bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52) {
    throw new Error('not a PNG');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

export function chooseBackend(
  requested: ScreenBackend,
  desktop: string,
  hasSpectacle: boolean
): 'spectacle' | 'electrobun' | 'none' {
  if (requested !== 'auto') return requested;
  if (hasSpectacle && /kde/i.test(desktop)) return 'spectacle';
  return 'electrobun';
}

export class Shots {
  constructor(private readonly deps: ShotsDeps) {}

  private get shotsRoot() {
    return join(this.deps.cacheDir, 'shots');
  }

  async newDir(label: string): Promise<string> {
    const dir = join(this.shotsRoot, shotDirName(label, this.deps.now?.() ?? new Date()));
    await mkdir(dir, { recursive: true });
    return dir;
  }

  async writeArtifact(dir: string, name: string, content: string | Uint8Array): Promise<string> {
    await mkdir(dir, { recursive: true });
    const path = join(dir, name);
    await writeFile(path, content);
    return path;
  }

  private async tool(args: string[], timeoutMs = 60_000): Promise<Record<string, unknown>> {
    const result = await this.deps.run(this.deps.python, ['-I', this.deps.toolPath, ...args], { timeoutMs });
    const parsed = parseToolOutput(result.stdout);
    if (result.code !== 0 && parsed.ok !== true) {
      throw new Error(String(parsed.error ?? result.stderr.slice(-400) ?? `exit ${result.code}`));
    }
    return parsed;
  }

  async screen(dir: string, name = 'screen.png'): Promise<ScreenShotResult> {
    const path = join(dir, name);
    const backend = chooseBackend(this.deps.backend, this.deps.desktop, await this.deps.which('spectacle'));
    try {
      if (backend === 'none') {
        return { ok: false, error: 'screen capture disabled', backend };
      }
      if (backend === 'spectacle') {
        const result = await this.deps.run('spectacle', ['-b', '-n', '-a', '-o', path], { timeoutMs: 20_000 });
        try {
          await stat(path);
        } catch {
          return {
            ok: false,
            error: `spectacle wrote nothing (exit ${result.code}): ${result.stderr.slice(-200)}`,
            backend,
          };
        }
        const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
        return { ok: true, path, ...pngSize(bytes), backend };
      }
      const frame = this.deps.windowFrame();
      if (!frame) {
        return { ok: false, error: 'window frame unavailable', backend };
      }
      const rect = {
        x: frame.x,
        y: frame.y,
        width: Math.round(frame.width),
        height: Math.round(frame.height),
      };
      const pixels = this.deps.captureRegion(rect);
      if (!pixels) {
        return {
          ok: false,
          error: 'captureRegion returned null (portal approval pending or unsupported)',
          backend,
        };
      }
      const png = encodePng({
        width: rect.width,
        height: rect.height,
        data: pixels,
        channels: 4,
        depth: 8,
      });
      await writeFile(path, png);
      return {
        ok: true,
        path,
        width: rect.width,
        height: rect.height,
        backend,
      };
    } catch (error) {
      return { ok: false, error: errorMessage(error), backend };
    }
  }

  async render(dir: string, html: string, options: RenderOptions): Promise<RenderResult> {
    const base = (options.name ?? 'page').replace(/\.png$/i, '');
    const htmlPath = await this.writeArtifact(dir, `${base}.html`, html);
    const out = join(dir, `${base}.png`);
    const args = ['render', '--html', htmlPath, '--out', out, '--width', String(Math.round(options.width))];
    if (options.height) {
      args.push('--height', String(Math.round(options.height)));
    }
    if (options.viewport) args.push('--viewport');
    if (options.backend) args.push('--backend', options.backend);
    args.push('--metrics', join(dir, `${base}.metrics.json`));
    try {
      const result = await this.tool(args, 120_000);
      return {
        ok: true,
        path: out,
        htmlPath,
        width: Number(result.width),
        height: Number(result.height),
        metrics: result.metrics as RenderResult extends {
          ok: true;
          metrics: infer M;
        }
          ? M
          : never,
      } as RenderResult;
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  }

  async crop(path: string, rect: PixelRect, out: string): Promise<CropResult> {
    const result = await this.tool([
      'crop',
      '--in',
      path,
      '--out',
      out,
      '--x',
      String(rect.x),
      '--y',
      String(rect.y),
      '--w',
      String(rect.width),
      '--h',
      String(rect.height),
    ]);
    return result as unknown as CropResult;
  }

  /** `tolerance` is the per-channel difference (0–255) below which pixels count as equal; 32 hides anti-aliasing. */
  async diff(a: string, b: string, out?: string, tolerance = 0): Promise<DiffResult> {
    const args = ['diff', '--a', a, '--b', b, '--tolerance', String(Math.max(0, Math.round(tolerance)))];
    if (out) args.push('--out', out);
    return { ...((await this.tool(args)) as unknown as DiffResult), tolerance };
  }

  async marks(path: string, out: string, region: 'outer' | 'inner' = 'outer'): Promise<MarksResult> {
    try {
      return (await this.tool(['marks', '--in', path, '--out', out, '--region', region])) as unknown as MarksResult;
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  }
}
