import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { pool, withTransaction } from '../../config/db.js';
import { requirePermission } from '../../middleware/auth.js';
import { HttpError, parseId } from '../../utils/httpError.js';
import { idSchema, optionalEmail, optionalText, passwordSchema } from '../../utils/validation.js';import { writeAudit } from '../../utils/audit.js';

const router = Router();

const baseFields = {
  name: z.string().trim().min(1, 'Name is required').max(100),
  email: optionalEmail,
  phone: optionalText(30),
  role_id: z.coerce.number({ error: 'Select a role' }).int().positive('Select a role'),
};

const createSchema = z.object({
  ...baseFields,
  username: z
    .string()
    .trim()
    .min(3, 'At least 3 characters')
    .max(50)
    .regex(/^[a-zA-Z0-9._-]+$/, 'Use letters, numbers, dot, dash or underscore only'),
  password: passwordSchema,
});

const updateSchema = z.object({ ...baseFields, is_active: z.boolean() });

const resetPasswordSchema = z.object({ password: passwordSchema });

const overridesSchema = z.object({
  overrides: z.array(z.object({ permission_id: idSchema, is_granted: z.boolean() })),
});

const USER_COLUMNS = `
  u.id, u.name, u.username, u.email, u.phone, u.role_id, r.name AS role_name, r.is_super_admin,
  u.is_active, u.must_change_password, u.last_login_at, u.locked_until,
  (u.locked_until IS NOT NULL AND u.locked_until > NOW()) AS is_locked, u.created_at`;

function toUser(row) {
  return {
    ...row,
    is_super_admin: !!row.is_super_admin,
    is_active: !!row.is_active,
    must_change_password: !!row.must_change_password,
    is_locked: !!row.is_locked,
  };
}

async function findUser(db, id) {
  const [rows] = await db.query(`SELECT ${USER_COLUMNS} FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`, [id]);
  if (!rows.length) throw new HttpError(404, 'User not found');
  return toUser(rows[0]);
}

async function findRole(db, roleId) {
  const [rows] = await db.query('SELECT id, name, is_super_admin, is_active FROM roles WHERE id = ?', [roleId]);
  if (!rows.length) throw new HttpError(400, 'Selected role does not exist');
  return rows[0];
}

// Only an Admin can create, change or hand out the Admin role.
function guardSuperAdmin(req, ...isSuperAdminFlags) {
  if (!req.user.is_super_admin && isSuperAdminFlags.some(Boolean)) {
    throw new HttpError(403, 'Only an Admin can manage Admin users');
  }
}

async function ensureAnAdminRemains(conn) {
  const [[{ n }]] = await conn.query(
    `SELECT COUNT(*) AS n FROM users u JOIN roles r ON r.id = u.role_id
     WHERE u.is_active = 1 AND r.is_active = 1 AND r.is_super_admin = 1`,
  );
  if (n === 0) throw new HttpError(400, 'At least one active Admin user must remain');
}

router.get('/', requirePermission('users.view'), async (req, res) => {
  const [rows] = await pool.query(`SELECT ${USER_COLUMNS} FROM users u JOIN roles r ON r.id = u.role_id ORDER BY u.name`);
  res.json(rows.map(toUser));
});

router.get('/:id', requirePermission('users.view'), async (req, res) => {
  res.json(await findUser(pool, parseId(req.params.id)));
});

router.post('/', requirePermission('users.create'), async (req, res) => {
  const data = createSchema.parse(req.body);
  const role = await findRole(pool, data.role_id);
  guardSuperAdmin(req, role.is_super_admin);

  const hash = await bcrypt.hash(data.password, 10);
  const id = await withTransaction(async (conn) => {
    const [result] = await conn.query(
      `INSERT INTO users (name, username, email, phone, password_hash, role_id, must_change_password, created_by)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
      [data.name, data.username, data.email, data.phone, hash, data.role_id, req.user.id],
    );
    const { password, ...logged } = data;
    await writeAudit(conn, req, { action: 'create', table: 'users', recordId: result.insertId, newValues: logged });
    return result.insertId;
  });
  res.status(201).json(await findUser(pool, id));
});

router.put('/:id', requirePermission('users.edit'), async (req, res) => {
  const id = parseId(req.params.id);
  const data = updateSchema.parse(req.body);

  await withTransaction(async (conn) => {
    const before = await findUser(conn, id);
    const newRole = await findRole(conn, data.role_id);
    guardSuperAdmin(req, before.is_super_admin, newRole.is_super_admin);

    if (id === req.user.id && !data.is_active) throw new HttpError(400, 'You cannot disable your own account');
    if (id === req.user.id && data.role_id !== before.role_id) throw new HttpError(400, 'You cannot change your own role');

    await conn.query('UPDATE users SET name = ?, email = ?, phone = ?, role_id = ?, is_active = ? WHERE id = ?', [
      data.name, data.email, data.phone, data.role_id, data.is_active ? 1 : 0, id,
    ]);
    await ensureAnAdminRemains(conn);
    await writeAudit(conn, req, {
      action: 'update',
      table: 'users',
      recordId: id,
      oldValues: { name: before.name, email: before.email, phone: before.phone, role_id: before.role_id, is_active: before.is_active },
      newValues: data,
    });
  });
  res.json(await findUser(pool, id));
});

// "Delete" disables the user so their history (bills, prices) stays linked.
router.delete('/:id', requirePermission('users.delete'), async (req, res) => {
  const id = parseId(req.params.id);
  if (id === req.user.id) throw new HttpError(400, 'You cannot disable your own account');

  await withTransaction(async (conn) => {
    const before = await findUser(conn, id);
    guardSuperAdmin(req, before.is_super_admin);
    await conn.query('UPDATE users SET is_active = 0 WHERE id = ?', [id]);
    await ensureAnAdminRemains(conn);
    await writeAudit(conn, req, { action: 'disable', table: 'users', recordId: id });
  });
  res.json(await findUser(pool, id));
});

router.post('/:id/reset-password', requirePermission('users.edit'), async (req, res) => {
  const id = parseId(req.params.id);
  const { password } = resetPasswordSchema.parse(req.body);
  const before = await findUser(pool, id);
  guardSuperAdmin(req, before.is_super_admin);

  const hash = await bcrypt.hash(password, 10);
  await pool.query(
    `UPDATE users SET password_hash = ?, must_change_password = 1, failed_login_count = 0, locked_until = NULL
     WHERE id = ?`,
    [hash, id],
  );
  await writeAudit(pool, req, { action: 'reset_password', table: 'users', recordId: id });
  res.json(await findUser(pool, id));
});

router.post('/:id/unlock', requirePermission('users.edit'), async (req, res) => {
  const id = parseId(req.params.id);
  await findUser(pool, id);
  await pool.query('UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE id = ?', [id]);
  await writeAudit(pool, req, { action: 'unlock', table: 'users', recordId: id });
  res.json(await findUser(pool, id));
});

router.get('/:id/permissions', requirePermission('users.view'), async (req, res) => {
  const id = parseId(req.params.id);
  const user = await findUser(pool, id);
  const [rolePerms] = await pool.query('SELECT permission_id FROM role_permissions WHERE role_id = ?', [user.role_id]);
  const [overrides] = await pool.query('SELECT permission_id, is_granted FROM user_permissions WHERE user_id = ?', [id]);
  res.json({
    is_super_admin: user.is_super_admin,
    role_permission_ids: rolePerms.map((r) => r.permission_id),
    overrides: overrides.map((o) => ({ permission_id: o.permission_id, is_granted: !!o.is_granted })),
  });
});

router.put('/:id/permissions', requirePermission('users.edit'), async (req, res) => {
  const id = parseId(req.params.id);
  const { overrides } = overridesSchema.parse(req.body);
  const user = await findUser(pool, id);
  if (user.is_super_admin) throw new HttpError(400, 'Admin users already have every permission');
  if (id === req.user.id && !req.user.is_super_admin) {
    throw new HttpError(400, 'You cannot change your own permissions');
  }

  await withTransaction(async (conn) => {
    const [oldRows] = await conn.query('SELECT permission_id, is_granted FROM user_permissions WHERE user_id = ?', [id]);
    await conn.query('DELETE FROM user_permissions WHERE user_id = ?', [id]);
    if (overrides.length) {
      await conn.query('INSERT INTO user_permissions (user_id, permission_id, is_granted) VALUES ?', [
        overrides.map((o) => [id, o.permission_id, o.is_granted ? 1 : 0]),
      ]);
    }
    await writeAudit(conn, req, {
      action: 'update_permissions',
      table: 'users',
      recordId: id,
      oldValues: oldRows,
      newValues: overrides,
    });
  });
  res.json({ ok: true });
});

export default router;
