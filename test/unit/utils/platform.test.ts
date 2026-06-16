import { describe, it, expect } from 'vitest';
import { getPlatformString } from '../../../src/utils/platform';

describe('getPlatformString', () => {
  it('returns a non-empty string containing a dash', () => {
    const platform = getPlatformString();
    expect(platform).toContain('-');
    expect(platform.length).toBeGreaterThan(3);
  });
});
