import express from 'express';
import rateLimit from 'express-rate-limit';
import { query } from '../db.js';
import { verifyPassword } from './hash.js';
import { generateSessionToken, hashToken, SESSION_TTL_HOURS } from './tokens.js';
import { requireAuth } from './middleware.js';

export const authRouter = express.Router();

// Login is the one endpoint an attacker can hit without any credentials at
// all, so it gets its own stricter limit on top of the global one in
// index.js — 10 attempts per 15 minutes per IP. Tune via LOGIN_RATE_LIMIT_MAX.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.LOGIN_RATE_LIMIT_MAX || 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again in a few minutes.' },
});

authRouter.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'username and password are required.' });
    }

    const { rows } = await query('SELECT id, name, username, role, password_hash FROM users WHERE username = $1', [username]);
    const user = rows[0];
    // Same error for "no such user" and "wrong password" — never reveal
    // which one it was.
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    const token = generateSessionToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000);
    await query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [
      hashToken(token),
      user.id,
      expiresAt,
    ]);

    res.json({
      token,
      user: { id: user.id, name: user.name, username: user.username, role: user.role },
    });
  } catch (err) {
    next(err);
  }
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

authRouter.post('/logout', requireAuth, async (req, res, next) => {
  try {
    await query('DELETE FROM sessions WHERE token_hash = $1', [req.tokenHash]);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
