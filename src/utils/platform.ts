/**
 * Returns a platform/arch string matching the vendor naming convention, e.g. "darwin-arm64".
 * Used for diagnostics. The claude binary itself is resolved + downloaded by
 * `src/process/ClaudeBinary.ts` (the bundled-binary path was retired).
 */
export function getPlatformString(): string {
  return `${process.platform}-${process.arch}`;
}
