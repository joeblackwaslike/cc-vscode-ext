import { describe, it, expect } from 'vitest';
import { resolveBinaryPath, getPlatformString } from '../../../src/utils/platform';
import { join } from 'path';

describe('resolveBinaryPath', () => {
  it('returns the vendored binary path when no wrapper is set', () => {
    const path = resolveBinaryPath('/ext/root');
    expect(path).toBe(join('/ext/root', 'resources', 'native-binary', 'claude'));
  });

  it('returns the wrapper path when provided', () => {
    expect(resolveBinaryPath('/ext/root', '/usr/local/bin/my-claude')).toBe('/usr/local/bin/my-claude');
  });

  it('ignores undefined wrapper', () => {
    expect(resolveBinaryPath('/ext/root', undefined)).toBe(
      join('/ext/root', 'resources', 'native-binary', 'claude')
    );
  });
});

describe('getPlatformString', () => {
  it('returns a non-empty string containing a dash', () => {
    const platform = getPlatformString();
    expect(platform).toContain('-');
    expect(platform.length).toBeGreaterThan(3);
  });
});
