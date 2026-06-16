/**
 * E2E instance registry + safety rails.
 *
 * Every VS Code instance the E2E suite spawns is recorded here as a small file
 * keyed by PID. The registry is the source of truth for "what did we launch",
 * survives across processes, and survives across crashed/interrupted runs.
 *
 * The point of this module is a single guarantee: no test bug, retry loop,
 * crash, or repeated re-run can ever leave more than `MAX_CONCURRENT` live
 * VS Code instances alive. `assertUnderCap()` is the fork-bomb stop — it is
 * called before every spawn and throws (spawning nothing) once the cap is hit.
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

/** Hard ceiling on simultaneously-live E2E VS Code instances. */
export const MAX_CONCURRENT = 2;

/**
 * Marker substring present in every launched instance's `--user-data-dir`
 * (see launch.ts). Used as the `pkill -f` pattern for the belt-and-suspenders
 * sweep, so it MUST stay in sync with the temp-dir prefix used there.
 */
export const MARKER = 'vscode-e2e-';

const REGISTRY_DIR = path.join(os.tmpdir(), 'cc-vscode-e2e', 'pids');

interface InstanceRecord {
  pid: number;
  userDataDir: string;
}

function recordPath(pid: number): string {
  return path.join(REGISTRY_DIR, `${pid}.json`);
}

/** Record a freshly-spawned instance. Best-effort; never throws. */
export function registerInstance(pid: number, userDataDir: string): void {
  try {
    fs.mkdirSync(REGISTRY_DIR, { recursive: true });
    const rec: InstanceRecord = { pid, userDataDir };
    fs.writeFileSync(recordPath(pid), JSON.stringify(rec), { flag: 'w' });
  } catch {
    /* registry is a safety net, not load-bearing for a single launch */
  }
}

/** Drop an instance from the registry once it has been killed. */
export function unregisterInstance(pid: number): void {
  try {
    fs.unlinkSync(recordPath(pid));
  } catch {
    /* already gone */
  }
}

/** All currently-registered instances (alive or not). */
export function listInstances(): InstanceRecord[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(REGISTRY_DIR).filter((e) => e.endsWith('.json'));
  } catch {
    return [];
  }
  const out: InstanceRecord[] = [];
  for (const entry of entries) {
    try {
      const rec = JSON.parse(fs.readFileSync(path.join(REGISTRY_DIR, entry), 'utf8'));
      if (typeof rec?.pid === 'number') out.push(rec);
    } catch {
      /* corrupt record — skip; sweepAll cleans it up */
    }
  }
  return out;
}

/** True if `pid` names a live process (signal 0 probes without killing). */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but we can't signal it — still "alive".
    return (err as NodeJS.ErrnoException)?.code === 'EPERM';
  }
}

/**
 * The fork-bomb stop. Counts live registered instances and throws — spawning
 * nothing — once the cap is reached. Stale (dead) records are pruned as a
 * side effect so the count stays accurate across crashed runs.
 */
export function assertUnderCap(): void {
  let live = 0;
  for (const rec of listInstances()) {
    if (isAlive(rec.pid)) live += 1;
    else unregisterInstance(rec.pid);
  }
  if (live >= MAX_CONCURRENT) {
    throw new Error(
      `E2E instance cap reached (${live} live VS Code instances, max ${MAX_CONCURRENT}) — ` +
        `aborting to prevent a runaway. Run \`pkill -9 -f ${MARKER}\` if windows are stuck.`,
    );
  }
}

/**
 * Kill an instance and its whole process group, so Electron helper processes
 * die too. We spawn instances `detached: true`, making each one a group leader
 * whose group id equals its pid; the negative-pid signal targets the group.
 */
export function killTree(pid: number): void {
  if (process.platform === 'win32') {
    // No POSIX process groups on Windows; taskkill /T kills the whole tree.
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* process may already be gone */
    }
    return;
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    /* group may already be gone */
  }
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    /* process may already be gone */
  }
}

/**
 * Kill every registered instance, remove its user-data-dir, and clear the
 * registry — then `pkill` anything matching the marker as a final backstop.
 * Used by both globalSetup (pre-flight) and globalTeardown (post-run).
 */
export async function sweepAll(): Promise<void> {
  for (const rec of listInstances()) {
    killTree(rec.pid);
    if (rec.userDataDir && rec.userDataDir.includes(MARKER)) {
      try {
        await fsp.rm(rec.userDataDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
    unregisterInstance(rec.pid);
  }
  // Belt-and-suspenders: kill any marker-tagged process not in the registry
  // (e.g. from a run that crashed before it could register). Ignore failures —
  // the sweeper exits non-zero when nothing matches, which is the common case.
  try {
    if (process.platform === 'win32') {
      // No pkill on Windows; match the marker in the command line via WMIC.
      spawnSync('wmic', ['process', 'where', `CommandLine like '%${MARKER}%'`, 'call', 'terminate'], {
        stdio: 'ignore',
      });
    } else {
      spawnSync('pkill', ['-9', '-f', MARKER], { stdio: 'ignore' });
    }
  } catch {
    /* sweeper unavailable — registry kills above already covered tracked pids */
  }
}
