/**
 * Admin User Management Routes
 *
 * GET    /:appId/users                         — List users (paginated, searchable)
 * POST   /:appId/users                         — Create a user
 * GET    /:appId/users/:userId                  — Get user detail + session count
 * PUT    /:appId/users/:userId                  — Update user fields
 * DELETE /:appId/users/:userId                  — Delete user (cascading)
 * GET    /:appId/users/:userId/sessions         — List active sessions
 * DELETE /:appId/users/:userId/sessions         — Revoke all sessions
 * POST   /:appId/users/:userId/reset-password   — Reset password
 */

import { Hono } from 'hono';
import type { Env } from '../../types/env';
import { authenticateAdmin, isAdminAuthError, type AdminContext } from '../../lib/admin-auth';
import { escapeLikePattern } from '../../lib/sql-utils';
import { executeD1Query, executeD1DDL, generateAuthDDL } from '@exepad/deploy-utils';
import type { DeploymentConfig } from '@exepad/deploy-utils';
// The rows this route writes live in the APP's own `_auth_users` table and are
// verified by the app-backend at `auth_signin`. Reuse the app-backend's hashing
// helper rather than re-implementing it here, so the stored format
// (`pbkdf2:<iters>:<salt_hex>:<hash_hex>`) and the work factor can never drift
// apart. (`worker/src/lib/password.ts` is a DIFFERENT hash — the platform
// OPERATOR account in meta.sqlite, stored as `pbkdf2$<iters>$<b64>$<b64>` — and
// is deliberately not used here.) Verification always reads the iteration count
// back out of the stored string, so hashes written by older builds at a lower
// work factor keep verifying and are re-hashed on next login (needsRehash).
import { hashPassword } from '@exepad/app-backend/auth/utils';

export const users = new Hono<{ Bindings: Env }>();

const USER_COLUMNS = 'id, email, name, avatar_url, roles, email_verified, created_at, updated_at';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isValidEmail(email: string): boolean {
  return EMAIL_REGEX.test(email) && email.length <= 254;
}

// ── Helpers ──────────────────────────────────────────────────

async function ensureAuthTables(config: DeploymentConfig, dbId: string): Promise<void> {
  const authDDL = generateAuthDDL();
  for (const sql of authDDL) {
    await executeD1DDL(config, dbId, sql);
  }
}

interface UserInsertData {
  id: string;
  email: string;
  passwordHash: string;
  name: string | null;
  roles: string;
  timestamp: string;
}

interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
  roles: string;
  email_verified: number;
  created_at: string;
  updated_at: string;
}

async function insertUser(
  config: DeploymentConfig, dbId: string, data: UserInsertData
): Promise<AdminUser> {
  const { id, email, passwordHash, name, roles, timestamp } = data;

  await executeD1Query(
    config, dbId,
    `INSERT INTO _auth_users (id, email, password_hash, email_verified, name, roles, created_at, updated_at)
     VALUES (?, ?, ?, 0, ?, ?, ?, ?)`,
    [id, email, passwordHash, name, roles, timestamp, timestamp]
  );

  const accountId = crypto.randomUUID();
  await executeD1Query(
    config, dbId,
    `INSERT INTO _auth_accounts (id, user_id, provider, provider_account_id)
     VALUES (?, ?, 'email', ?)`,
    [accountId, id, email]
  );

  return {
    id, email, name, avatar_url: null, roles,
    email_verified: 0, created_at: timestamp, updated_at: timestamp,
  };
}

// ── GET / — List users ───────────────────────────────────────

users.get('/', async (c) => {
  const appId = c.req.param('appId')!;
  const mode = c.req.query('mode') || 'published';
  // Read-only: never provision a DB just to list users (write-on-read).
  const auth = await authenticateAdmin(c.req.raw, c.env, appId, mode, { createIfMissing: false });
  if (isAdminAuthError(auth)) return c.json({ success: false, error: auth.message }, auth.status);
  if (auth.dbMissing) {
    const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(c.req.query('pageSize') || '20', 10)));
    return c.json({ success: true, data: [], pagination: { page, pageSize, total: 0, totalPages: 0 } });
  }

  const { config, dbId } = auth;

  try {
    const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(c.req.query('pageSize') || '20', 10)));
    const search = c.req.query('search')?.trim() || '';
    const offset = (page - 1) * pageSize;

    let countSql: string;
    let countParams: (string | number | null)[] = [];
    let selectSql: string;
    let selectParams: (string | number | null)[] = [];

    if (search) {
      const likeTerm = `%${escapeLikePattern(search)}%`;
      countSql = `SELECT COUNT(*) as total FROM _auth_users WHERE email LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\'`;
      countParams = [likeTerm, likeTerm];
      selectSql = `SELECT ${USER_COLUMNS} FROM _auth_users WHERE email LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\' ORDER BY created_at DESC LIMIT ? OFFSET ?`;
      selectParams = [likeTerm, likeTerm, pageSize, offset];
    } else {
      countSql = `SELECT COUNT(*) as total FROM _auth_users`;
      selectSql = `SELECT ${USER_COLUMNS} FROM _auth_users ORDER BY created_at DESC LIMIT ? OFFSET ?`;
      selectParams = [pageSize, offset];
    }

    const [countResult, selectResult] = await Promise.all([
      executeD1Query(config, dbId, countSql, countParams),
      executeD1Query(config, dbId, selectSql, selectParams),
    ]);

    const total = (countResult.results[0] as { total: number })?.total ?? 0;

    return c.json({
      success: true,
      data: selectResult.results,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('no such table')) {
      // Table hasn't been created yet — return empty result instead of error
      console.warn(`[Users] Auth table not found for app, returning empty list`);
      return c.json({
        success: true,
        data: [],
        pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
      });
    }
    return c.json({ success: false, error: message }, 500);
  }
});

// ── POST / — Create user ────────────────────────────────────

users.post('/', async (c) => {
  const appId = c.req.param('appId')!;
  const mode = c.req.query('mode') || 'published';
  const auth = await authenticateAdmin(c.req.raw, c.env, appId, mode);
  if (isAdminAuthError(auth)) return c.json({ success: false, error: auth.message }, auth.status);

  const { config, dbId } = auth;

  try {
    const body = await c.req.json<{
      email?: string; password?: string; name?: string; roles?: string;
    }>();
    const { email, password, name, roles } = body;

    if (!email || !password) {
      return c.json({ success: false, error: 'email and password are required' }, 400);
    }
    if (!isValidEmail(email)) {
      return c.json({ success: false, error: 'Invalid email format' }, 400);
    }
    if (password.length < 8) {
      return c.json({ success: false, error: 'Password must be at least 8 characters' }, 400);
    }

    const passwordHash = await hashPassword(password);
    const id = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    const userRoles = roles || 'user';
    const userData: UserInsertData = { id, email, passwordHash, name: name || null, roles: userRoles, timestamp };

    let needsTableInit = false;
    try {
      const existing = await executeD1Query(
        config, dbId,
        `SELECT id FROM _auth_users WHERE LOWER(email) = LOWER(?)`,
        [email]
      );
      if (existing.results.length > 0) {
        return c.json({ success: false, error: 'A user with this email already exists' }, 409);
      }
    } catch (checkError) {
      const msg = checkError instanceof Error ? checkError.message : String(checkError);
      if (msg.includes('no such table: _auth_users')) {
        needsTableInit = true;
      } else {
        throw checkError;
      }
    }

    if (needsTableInit) {
      await ensureAuthTables(config, dbId);
    }

    const createdUser = await insertUser(config, dbId, userData);
    return c.json({ success: true, data: createdUser }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ success: false, error: message }, 500);
  }
});

// ── GET /:userId — Get user detail ──────────────────────────

users.get('/:userId', async (c) => {
  const appId = c.req.param('appId')!;
  const userId = c.req.param('userId')!;
  const mode = c.req.query('mode') || 'published';
  // Read-only: never provision a DB just to read a user detail.
  const auth = await authenticateAdmin(c.req.raw, c.env, appId, mode, { createIfMissing: false });
  if (isAdminAuthError(auth)) return c.json({ success: false, error: auth.message }, auth.status);
  if (auth.dbMissing) return c.json({ success: false, error: 'User not found' }, 404);

  const { config, dbId } = auth;

  try {
    const [userResult, sessionResult] = await Promise.all([
      executeD1Query(config, dbId, `SELECT ${USER_COLUMNS} FROM _auth_users WHERE id = ?`, [userId]),
      executeD1Query(config, dbId, `SELECT COUNT(*) as count FROM _auth_sessions WHERE user_id = ? AND expires_at > datetime('now')`, [userId]),
    ]);

    if (userResult.results.length === 0) {
      return c.json({ success: false, error: 'User not found' }, 404);
    }

    const user = userResult.results[0] as AdminUser;
    const sessions = (sessionResult.results[0] as { count: number })?.count ?? 0;

    return c.json({ success: true, data: { ...user, sessions } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('no such table: _auth_users') || message.includes('no such table: _auth_sessions')) {
      return c.json({ success: false, error: 'User not found' }, 404);
    }
    return c.json({ success: false, error: message }, 500);
  }
});

// ── PUT /:userId — Update user ──────────────────────────────

users.put('/:userId', async (c) => {
  const appId = c.req.param('appId')!;
  const userId = c.req.param('userId')!;
  const mode = c.req.query('mode') || 'published';
  const auth = await authenticateAdmin(c.req.raw, c.env, appId, mode);
  if (isAdminAuthError(auth)) return c.json({ success: false, error: auth.message }, auth.status);

  const { config, dbId } = auth;

  try {
    const body = await c.req.json<Record<string, unknown>>();
    const allowedFields = ['name', 'email', 'roles', 'email_verified', 'avatar_url'] as const;
    type AllowedField = (typeof allowedFields)[number];

    const setClauses: string[] = [];
    const setParams: (string | number | null)[] = [];

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        if (field === 'email') {
          if (!isValidEmail(body.email as string)) {
            return c.json({ success: false, error: 'Invalid email format' }, 400);
          }
          const existing = await executeD1Query(
            config, dbId,
            `SELECT id FROM _auth_users WHERE LOWER(email) = LOWER(?) AND id != ?`,
            [body.email as string, userId]
          );
          if (existing.results.length > 0) {
            return c.json({ success: false, error: 'A user with this email already exists' }, 409);
          }
        }

        setClauses.push(`${field} = ?`);
        const value = field === 'email_verified'
          ? (body[field] ? 1 : 0)
          : body[field as AllowedField];
        setParams.push(value as string | number | null);
      }
    }

    if (setClauses.length === 0) {
      return c.json({ success: false, error: 'No valid fields to update' }, 400);
    }

    setClauses.push('updated_at = ?');
    setParams.push(new Date().toISOString());
    setParams.push(userId);

    const result = await executeD1Query(
      config, dbId,
      `UPDATE _auth_users SET ${setClauses.join(', ')} WHERE id = ?`,
      setParams
    );

    const changes = (result.meta as { changes?: number })?.changes ?? 0;
    if (changes === 0) {
      return c.json({ success: false, error: 'User not found' }, 404);
    }

    return c.json({ success: true, data: { message: 'User updated', changes } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('no such table: _auth_users')) {
      return c.json({ success: false, error: 'User not found' }, 404);
    }
    return c.json({ success: false, error: message }, 500);
  }
});

// ── DELETE /:userId — Delete user ───────────────────────────

users.delete('/:userId', async (c) => {
  const appId = c.req.param('appId')!;
  const userId = c.req.param('userId')!;
  const mode = c.req.query('mode') || 'published';
  const auth = await authenticateAdmin(c.req.raw, c.env, appId, mode);
  if (isAdminAuthError(auth)) return c.json({ success: false, error: auth.message }, auth.status);

  const { config, dbId } = auth;

  try {
    await executeD1Query(config, dbId, `DELETE FROM _auth_sessions WHERE user_id = ?`, [userId]);
    await executeD1Query(config, dbId, `DELETE FROM _auth_accounts WHERE user_id = ?`, [userId]);
    await executeD1Query(config, dbId, `DELETE FROM _auth_users WHERE id = ?`, [userId]);

    return c.json({ success: true, data: { message: 'User deleted' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('no such table: _auth_sessions') || message.includes('no such table: _auth_accounts') || message.includes('no such table: _auth_users')) {
      return c.json({ success: true, data: { message: 'User deleted' } });
    }
    return c.json({ success: false, error: message }, 500);
  }
});

// ── GET /:userId/sessions — List active sessions ────────────

users.get('/:userId/sessions', async (c) => {
  const appId = c.req.param('appId')!;
  const userId = c.req.param('userId')!;
  const mode = c.req.query('mode') || 'published';
  // Read-only: never provision a DB just to list a user's sessions.
  const auth = await authenticateAdmin(c.req.raw, c.env, appId, mode, { createIfMissing: false });
  if (isAdminAuthError(auth)) return c.json({ success: false, error: auth.message }, auth.status);
  if (auth.dbMissing) return c.json({ success: true, data: [] });

  const { config, dbId } = auth;

  try {
    const result = await executeD1Query(
      config, dbId,
      `SELECT id, created_at, expires_at FROM _auth_sessions WHERE user_id = ? AND expires_at > datetime('now') ORDER BY created_at DESC`,
      [userId]
    );
    return c.json({ success: true, data: result.results });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('no such table: _auth_sessions')) {
      return c.json({ success: true, data: [] });
    }
    return c.json({ success: false, error: message }, 500);
  }
});

// ── DELETE /:userId/sessions — Revoke all sessions ──────────

users.delete('/:userId/sessions', async (c) => {
  const appId = c.req.param('appId')!;
  const userId = c.req.param('userId')!;
  const mode = c.req.query('mode') || 'published';
  const auth = await authenticateAdmin(c.req.raw, c.env, appId, mode);
  if (isAdminAuthError(auth)) return c.json({ success: false, error: auth.message }, auth.status);

  const { config, dbId } = auth;

  try {
    const result = await executeD1Query(
      config, dbId,
      `DELETE FROM _auth_sessions WHERE user_id = ?`,
      [userId]
    );
    const changes = (result.meta as { changes?: number })?.changes ?? 0;
    return c.json({ success: true, data: { message: 'All sessions revoked', changes } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('no such table: _auth_sessions')) {
      return c.json({ success: true, data: { message: 'All sessions revoked', changes: 0 } });
    }
    return c.json({ success: false, error: message }, 500);
  }
});

// ── POST /:userId/reset-password — Reset password ───────────

users.post('/:userId/reset-password', async (c) => {
  const appId = c.req.param('appId')!;
  const userId = c.req.param('userId')!;
  const mode = c.req.query('mode') || 'published';
  const auth = await authenticateAdmin(c.req.raw, c.env, appId, mode);
  if (isAdminAuthError(auth)) return c.json({ success: false, error: auth.message }, auth.status);

  const { config, dbId } = auth;

  try {
    const body = await c.req.json<{ newPassword?: string }>();
    const { newPassword } = body;

    if (!newPassword) {
      return c.json({ success: false, error: 'newPassword is required' }, 400);
    }
    if (newPassword.length < 8) {
      return c.json({ success: false, error: 'Password must be at least 8 characters' }, 400);
    }

    const passwordHash = await hashPassword(newPassword);
    const timestamp = new Date().toISOString();

    const result = await executeD1Query(
      config, dbId,
      `UPDATE _auth_users SET password_hash = ?, updated_at = ? WHERE id = ?`,
      [passwordHash, timestamp, userId]
    );

    const changes = (result.meta as { changes?: number })?.changes ?? 0;
    if (changes === 0) {
      return c.json({ success: false, error: 'User not found' }, 404);
    }

    // Session revocation for the APP end-user. These are per-app `_auth_users`
    // sessions rows in the app's OWN SQLite — a different auth domain from the
    // platform operator's `meta.sqlite` `session_generation` (which governs the
    // builder cookie). Deleting `_auth_sessions` is the app-user analog of the
    // operator logout-all bump: it invalidates every one of this user's sessions.
    //
    // The password change above is already committed. If revoking the user's
    // existing sessions fails, do NOT return 500 — that would imply the reset
    // itself failed while the new password is in fact live. Log it and report
    // success with a flag so the caller can see revocation didn't complete.
    let sessionsRevoked = true;
    try {
      await executeD1Query(config, dbId, `DELETE FROM _auth_sessions WHERE user_id = ?`, [userId]);
    } catch (revokeErr) {
      sessionsRevoked = false;
      console.error(
        '[admin/users] password reset succeeded but session revocation failed:',
        revokeErr,
      );
    }

    return c.json({
      success: true,
      data: { message: 'Password reset successfully', sessionsRevoked },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('no such table: _auth_users') || message.includes('no such table: _auth_sessions')) {
      return c.json({ success: false, error: 'User not found' }, 404);
    }
    return c.json({ success: false, error: message }, 500);
  }
});
