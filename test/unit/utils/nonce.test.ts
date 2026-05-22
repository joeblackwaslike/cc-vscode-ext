import { describe, it, expect } from 'vitest';
import { generateNonce } from '../../../src/utils/nonce';

describe('generateNonce', () => {
  it('returns a 32-character string', () => {
    expect(generateNonce()).toHaveLength(32);
  });

  it('contains only alphanumeric characters', () => {
    expect(generateNonce()).toMatch(/^[a-zA-Z0-9]{32}$/);
  });

  it('returns a different value on each call', () => {
    const a = generateNonce();
    const b = generateNonce();
    expect(a).not.toBe(b);
  });
});
