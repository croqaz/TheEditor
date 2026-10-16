// Command line and environment → launch options. Pure, so it is unit-tested;
// how Hutch forwards argv to the app is checked by the smoke run.
import { resolve } from 'node:path';

export interface LaunchOptions {
  /** Profile spec; undefined means the default profile. */
  profile: string | undefined;
  online: boolean;
  smoke: boolean;
  /** Like smoke, but runs te.shot.verify() and prints SMOKE_SHOTS. Needs a visible window. */
  smokeShots: boolean;
  headless: boolean;
  /** Commands to run once the view is ready (`--run '[["id", arg…], …]'` / TE_RUN); each prints a RUN line. */
  run: unknown[][] | undefined;
  /** Keep the window open after `--run` instead of quitting. */
  keep: boolean;
  /** Absolute paths to open. */
  files: string[];
  /** Flags we did not understand, kept for the log. */
  unknown: string[];
}

type Env = Record<string, string | undefined>;

const truthy = (value: string | undefined) => value === '1' || value === 'true' || value === 'yes';

export function parseArgs(argv: string[], env: Env, cwd: string): LaunchOptions {
  const options: LaunchOptions = {
    profile: env.TE_PROFILE?.trim() || undefined,
    online: truthy(env.THEEDITOR_ONLINE) || truthy(env.TE_ONLINE),
    smoke: truthy(env.TE_SMOKE),
    smokeShots: truthy(env.TE_SMOKE_SHOTS),
    headless: truthy(env.TE_HEADLESS),
    run: env.TE_RUN?.trim() ? parseRun(env.TE_RUN) : undefined,
    keep: truthy(env.TE_KEEP),
    files: [],
    unknown: [],
  };
  let onlyFiles = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (onlyFiles || !arg.startsWith('--')) {
      if (arg) options.files.push(resolve(cwd, arg));
      continue;
    }
    if (arg === '--') {
      onlyFiles = true;
      continue;
    }
    const eq = arg.indexOf('=');
    const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    const inlineValue = eq === -1 ? undefined : arg.slice(eq + 1);
    switch (name) {
      case 'profile': {
        const value = inlineValue ?? argv[++i];
        if (value === undefined || value.startsWith('--')) {
          throw new Error('--profile needs a name or a path');
        }
        options.profile = value;
        break;
      }
      case 'online':
        options.online = inlineValue === undefined ? true : truthy(inlineValue);
        break;
      case 'offline':
        options.online = false;
        break;
      case 'smoke':
        options.smoke = true;
        break;
      case 'smoke-shots':
        options.smokeShots = true;
        break;
      case 'headless':
        options.headless = true;
        break;
      case 'run': {
        const value = inlineValue ?? argv[++i];
        if (value === undefined) {
          throw new Error('--run needs a JSON array of [id, ...args] arrays');
        }
        options.run = parseRun(value);
        break;
      }
      case 'keep':
        options.keep = true;
        break;
      default:
        options.unknown.push(arg);
    }
  }
  if (env.TE_OPEN?.trim()) options.files.push(resolve(cwd, env.TE_OPEN.trim()));
  // Smoke and scripted runs never touch the user's own profile unless one was named explicitly.
  if ((options.smoke || options.smokeShots || options.run) && options.profile === undefined) options.profile = 'test';
  return options;
}

/** `[["debug.boxes", true], ["shot.screen", {"label": "x"}]]` → the same, checked. */
export function parseRun(text: string): unknown[][] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`--run is not valid JSON: ${text}`);
  }
  if (
    !Array.isArray(data) ||
    !data.every(entry => Array.isArray(entry) && typeof entry[0] === 'string' && entry[0].length > 0)
  ) {
    throw new Error('--run needs a JSON array of [id, ...args] arrays, e.g. [["debug.boxes", true]]');
  }
  return data as unknown[][];
}
