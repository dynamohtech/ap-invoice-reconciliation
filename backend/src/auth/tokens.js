import crypto from 'node:crypto';

// The raw token is what the client holds (in the Authorization header). Only
// its SHA-256 hash is ever stored in the sessions table — a stolen database
// backup then can't be replayed as a live session, mirroring how passwords
// are never stored in plaintext either.
export function generateSessionToken() {
  return crypto.randomBytes(32).toString('hex'); // 256 bits of entropy
}

export function hashToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

export const SESSION_TTL_HOURS = Number(process.env.SESSION_TTL_HOURS || 12);
