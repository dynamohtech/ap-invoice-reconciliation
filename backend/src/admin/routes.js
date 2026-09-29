import express from 'express';
import crypto from 'node:crypto';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { query, withTransaction } from '../db.js';
import { hashPassword } from '../auth/hash.js';

export const adminRouter = express.Router();
adminRouter.use(requireAuth);

const VALID_ROLES = ['reviewer', 'approver', 'vendor_tolerance_admin', 'auditor', 'system_admin'];

adminRouter.get('/users', requireRole('system_admin', 'auditor'), async (req, res, next) => {
  try {
    const { rows } = await query('SELECT id, name, username, role, created_at FROM users ORDER BY name');
    res.json(rows);
  } catch (err) { next(err); }
});

// The frontend's current contract has no "set your own password" flow, so a
// new user needs an initial credential from somewhere. This generates a
// one-time temporary password and returns it in the response ONLY on
// creation (never again, never logged) — the system_admin relays it to the
// new user directly. A proper first-login reset or SSO flow is listed as an
// open item rather than assumed here.
adminRouter.post('/users', requireRole('system_admin'), async (req, res, next) => {
  try {
    const { name, username, role } = req.body || {};
    if (!name || !username || !role) {
      return res.status(400).json({ error: 'name, username, and role are required.' });
    }
    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(', ')}.` });
    }

    const tempPassword = crypto.randomBytes(9).toString('base64url'); // 12 chars, URL-safe
    const passwordHash = await hashPassword(tempPassword);

    const { rows } = await query(
      'INSERT INTO users (name, username, role, password_hash) VALUES ($1, $2, $3, $4) RETURNING id, name, username, role, created_at',
      [name, username, role, passwordHash]
    );
    res.status(201).json({ ...rows[0], temporary_password: tempPassword });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'That username is already taken.' });
    next(err);
  }
});

adminRouter.patch('/users/:id', requireRole('system_admin'), async (req, res, next) => {
  try {
    const { role, name } = req.body || {};
    if (role === undefined && name === undefined) {
      return res.status(400).json({ error: 'Nothing to update — send role and/or name.' });
    }
    if (role !== undefined && !VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(', ')}.` });
    }

    // Guard rail beyond the original mock: never allow the last system_admin
    // to be demoted, or the app becomes unrecoverable without direct DB
    // access. Flagged here as a deliberate addition, not part of the
    // documented contract.
    if (role !== undefined && role !== 'system_admin') {
      const { rows: admins } = await query("SELECT id FROM users WHERE role = 'system_admin'");
      if (admins.length === 1 && admins[0].id === req.params.id) {
        return res.status(400).json({ error: 'Cannot demote the last remaining system_admin.' });
      }
    }

    const sets = [];
    const params = [];
    let i = 1;
    if (role !== undefined) { sets.push(`role = $${i++}`); params.push(role); }
    if (name !== undefined) { sets.push(`name = $${i++}`); params.push(name); }
    params.push(req.params.id);

    const { rows } = await query(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $${i} RETURNING id, name, username, role, created_at`,
      params
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found.' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

adminRouter.get('/subsidiary-erp-map', requireRole('system_admin', 'auditor'), async (req, res, next) => {
  try {
    const { rows } = await query('SELECT subsidiary, erp, confirmed, updated_at FROM subsidiary_erp_map ORDER BY subsidiary');
    res.json(rows);
  } catch (err) { next(err); }
});

adminRouter.put('/subsidiary-erp-map', requireRole('system_admin'), async (req, res, next) => {
  try {
    const { subsidiary, erp, confirmed } = req.body || {};
    if (!subsidiary) return res.status(400).json({ error: 'subsidiary is required.' });
    if (erp !== null && erp !== undefined && !['odoo', 'd365'].includes(erp)) {
      return res.status(400).json({ error: "erp must be 'odoo', 'd365', or null." });
    }

    const { rows } = await withTransaction((client) =>
      client.query(
        `INSERT INTO subsidiary_erp_map (subsidiary, erp, confirmed, updated_by, updated_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (subsidiary) DO UPDATE SET erp = $2, confirmed = $3, updated_by = $4, updated_at = now()
         RETURNING subsidiary, erp, confirmed, updated_at`,
        [subsidiary, erp ?? null, Boolean(confirmed), req.user.id]
      )
    );
    res.json(rows[0]);
  } catch (err) { next(err); }
});
