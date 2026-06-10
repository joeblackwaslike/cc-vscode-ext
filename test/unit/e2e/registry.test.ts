import { spawn } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MAX_CONCURRENT,
  assertUnderCap,
  isAlive,
  killTree,
  listInstances,
  registerInstance,
  sweepAll,
  unregisterInstance,
} from '../../../test/e2e/helpers/registry';

/**
 * Exercises the E2E fork-bomb safety rails using harmless `node` processes
 * tagged with the 'vscode-e2e-' marker — this never launches VS Code.
 */

const spawned: number[] = [];

/** A long-lived, marker-tagged process leading its own group (detached). */
function spawnFake(): number {
  const p = spawn(
    process.execPath,
    ['-e', 'setInterval(() => {}, 1e9)', '/tmp/vscode-e2e-fake-marker'],
    { detached: true, stdio: 'ignore' },
  );
  p.unref();
  spawned.push(p.pid!);
  return p.pid!;
}

afterEach(async () => {
  // Kill anything this test spawned and clear the registry it touched.
  for (const pid of spawned.splice(0)) {
    killTree(pid);
    unregisterInstance(pid);
  }
  for (const rec of listInstances()) unregisterInstance(rec.pid);
});

describe('e2e registry safety rails', () => {
  it('registers, lists, and unregisters an instance', () => {
    const pid = spawnFake();
    registerInstance(pid, '/tmp/vscode-e2e-fake-marker');
    expect(listInstances().some((r) => r.pid === pid)).toBe(true);
    unregisterInstance(pid);
    expect(listInstances().some((r) => r.pid === pid)).toBe(false);
  });

  it('assertUnderCap throws once MAX_CONCURRENT live instances are registered', () => {
    for (let i = 0; i < MAX_CONCURRENT; i++) {
      const pid = spawnFake();
      registerInstance(pid, '/tmp/vscode-e2e-fake-marker');
    }
    // At the cap with live processes → spawning anything more must be refused.
    expect(() => assertUnderCap()).toThrow(/E2E instance cap reached/);
  });

  it('assertUnderCap prunes dead records and allows launching again', () => {
    const pid = spawnFake();
    registerInstance(pid, '/tmp/vscode-e2e-fake-marker');
    killTree(pid); // process dies but record lingers
    // Give the OS a moment to reap the process.
    return new Promise<void>((resolve) => setTimeout(resolve, 200)).then(() => {
      expect(isAlive(pid)).toBe(false);
      expect(() => assertUnderCap()).not.toThrow();
      expect(listInstances().some((r) => r.pid === pid)).toBe(false); // pruned
    });
  });

  it('sweepAll kills every registered instance and clears the registry', async () => {
    const pidA = spawnFake();
    const pidB = spawnFake();
    registerInstance(pidA, '/tmp/vscode-e2e-fake-marker');
    registerInstance(pidB, '/tmp/vscode-e2e-fake-marker');

    await sweepAll();
    await new Promise<void>((resolve) => setTimeout(resolve, 200));

    expect(isAlive(pidA)).toBe(false);
    expect(isAlive(pidB)).toBe(false);
    expect(listInstances()).toHaveLength(0);
  });
});
