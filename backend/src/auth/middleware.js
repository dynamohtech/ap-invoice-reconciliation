import { query } from '../db.js';
import { hashToken } from './tokens.js';

/**
 * Verifies the Bearer token against the sessions table (hashed, not raw —
 * see tokens.js), rejects if missing/expired, and attaches the full user
 * row to req.user. Every route below this in index.js needs a valid session.
 */
export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const rawToken = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!rawToken) return res.status(401).json({ error: 'Not authenticated.' });

    const tokenHash = hashToken(rawToken);
    const { rows } = await query(
      `SELECT u.id, u.name, u.username, u.role
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1 AND s.expires_at > now()`,
      [tokenHash]
    );
    if (rows.length === 0) return res.status(401).json({ error: 'Not authenticated.' });

    req.user = rows[0];
    req.tokenHash = tokenHash;
    next();
  } catch (err) {
    next(err);
  }
}

/** Allows only the listed roles. */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: `Requires one of: ${roles.join(', ')}.` });
    }
    next();
  };
}

/**
 * Blocks one role, allows everyone else.
 *
 * NOTE on where this is applied: the frontend's own reference-server only
 * forbids 'auditor' on the upload route. But the reference server's code
 * comments (and README) describe Auditor as "read-only everywhere" — which
 * the reference server doesn't actually enforce on approve/reject/
 * request-info/comments (no forbidRole there). This backend implements the
 * STATED intent — forbidRole('auditor') on all five write actions on an
 * invoice — rather than reproducing what looks like an oversight in the
 * quick reference implementation. If Auditor being able to approve/reject
 * was actually intentional, remove forbidRole('auditor') from those routes
 * in src/invoices/routes.js.
 */
export function forbidRole(role) {
  return (req, res, next) => {
    if (req.user.role === role) {
      return res.status(403).json({ error: `${role} is read-only and can't do this.` });
    }
    next();
  };
}
