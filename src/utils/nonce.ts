import { randomBytes } from 'crypto';

/** Generates a cryptographically random 32-character hex nonce for use in CSP headers. */
export function generateNonce(): string {
  return randomBytes(16).toString('hex');
}
