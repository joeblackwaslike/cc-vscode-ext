import { sweepAll } from './helpers/registry';

/**
 * Playwright globalTeardown: final backstop. Kills any instances still alive
 * after the suite finishes — covers tests that errored out before their
 * `finally { closeVSCode() }` could run.
 */
export default async function globalTeardown(): Promise<void> {
  await sweepAll();
}
