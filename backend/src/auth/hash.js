import bcrypt from 'bcryptjs';

// bcryptjs (pure JS) instead of native bcrypt/argon2 on purpose: this project
// needs to `npm install` cleanly on whatever machine a non-technical
// staff member runs it on, including inside a minimal Docker image, with zero
// native build tools required. The tradeoff
// (slightly slower than native bcrypt; irrelevant at login-only
// volumes — a few hundred logins/day at most).
const SALT_ROUNDS = 12;

export async function hashPassword(plain) {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}
