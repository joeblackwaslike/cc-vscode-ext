import { join } from 'path';

/**
 * Resolves the absolute path to the bundled claude CLI binary.
 *
 * The binary is vendored at `resources/native-binary/claude` relative to the extension root.
 * If `claudeProcessWrapper` is set in settings, that path is used instead (e.g. for proxying
 * through a custom launcher or testing harness).
 */
export function resolveBinaryPath(extensionPath: string, wrapper?: string): string {
  if (wrapper) return wrapper;
  return join(extensionPath, 'resources', 'native-binary', 'claude');
}

/**
 * Returns a platform/arch string matching the vendor naming convention, e.g. "darwin-arm64".
 * Used for diagnostics and platform-specific binary selection.
 */
export function getPlatformString(): string {
  return `${process.platform}-${process.arch}`;
}
