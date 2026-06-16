import { sweepAll } from './helpers/registry';

/**
 * Playwright globalSetup: pre-flight sweep. Kills any VS Code instances left
 * over from a prior crashed or Ctrl-C'd run and clears the registry, so every
 * run starts from zero rather than stacking on top of orphans.
 */
export default async function globalSetup(): Promise<void> {
  await sweepAll();
}
