import { Router } from 'express';
import { z } from 'zod';
import { pool, withTransaction } from '../../config/db.js';
import { requirePermission } from '../../middleware/auth.js';
import { HttpError, parseId } from '../../utils/httpError.js';
import { idSchema, optionalText } from '../../utils/validation.js';
import { writeAudit } from '../../utils/audit.js';

const router = Router();

const roleSchema = z.object({
  name: z.string().trim().min(1, 'Role name is required').max(50),
  description: optionalText(255),
  is_active: z.boolean(),
  permission_ids: z.array(idSchema),
});

function toRole(row) {
  return { ...row, is_super_admin: !!row.is_super_admin, is_system: !!row.is_system, is_active: !!row.is_active };
}

async function findRole(db, id) {
  const [rows] = await db.query('SELECT * FROM roles WHERE id = ?', [id]);
  if (!rows.length) throw new HttpError(404, 'Role not found');
  return toRole(rows[0]);
}

async function setRolePermissions(conn, roleId, permissionIds) {
  await conn.query('DELETE FROM role_permissions WHERE role_id = ?', [roleId]);
  if (permissionIds.length) {
    // Only ids that really exist in the permissions table are saved.
    await conn.query(
      'INSERT INTO role_permissions (role_id, permission_id) SELECT ?, id FROM permissions WHERE id IN (?)',
      [roleId, permissionIds],
    );
  }
}

// Stops a non-Admin from widening their own access through their role.
function guardOwnRole(req, roleId) {
  if (!req.user.is_super_admin && req.user.role_id === roleId) {
    throw new HttpError(403, 'You cannot change the role you belong to');
  }
}

// The user form needs the role list, so users.* permissions can read it too.
router.get('/', requirePermission('roles.view', 'users.view', 'users.create', 'users.edit'), async (req, res) => {
  const [rows] = await pool.query(
    `SELECT r.*,
            (SELECT COUNT(*) FROM users u WHERE u.role_id = r.id) AS users_count,
            (SELECT COUNT(*) FROM role_permissions rp WHERE rp.role_id = r.id) AS permissions_count
     FROM roles r ORDER BY r.id`,
  );
  res.json(rows.map(toRole));
});

router.get('/:id', requirePermission('roles.view'), async (req, res) => {
  const role = await findRole(pool, parseId(req.params.id));
  const [perms] = await pool.query('SELECT permission_id FROM role_permissions WHERE role_id = ?', [role.id]);
  res.json({ ...role, permission_ids: perms.map((p) => p.permission_id) });
});

router.post('/', requirePermission('roles.create'), async (req, res) => {
  const data = roleSchema.parse(req.body);
  const id = await withTransaction(async (conn) => {
    const [result] = await conn.query('INSERT INTO roles (name, description, is_active) VALUES (?, ?, ?)', [
      data.name, data.description, data.is_active ? 1 : 0,
    ]);
    await setRolePermissions(conn, result.insertId, data.permission_ids);
    await writeAudit(conn, req, { action: 'create', table: 'roles', recordId: result.insertId, newValues: data });
    return result.insertId;
  });
  res.status(201).json(await findRole(pool, id));
});

router.put('/:id', requirePermission('roles.edit'), async (req, res) => {
  const id = parseId(req.params.id);
  const data = roleSchema.parse(req.body);
  guardOwnRole(req, id);

  await withTransaction(async (conn) => {
    const before = await findRole(conn, id);
    if (before.is_super_admin) {
      // Admin always has everything: only the description can change.
      await conn.query('UPDATE roles SET description = ? WHERE id = ?', [data.description, id]);
    } else {
      if (before.is_system && data.name !== before.name) {
        throw new HttpError(400, 'Built-in roles cannot be renamed');
      }
      await conn.query('UPDATE roles SET name = ?, description = ?, is_active = ? WHERE id = ?', [
        data.name, data.description, data.is_active ? 1 : 0, id,
      ]);
      await setRolePermissions(conn, id, data.permission_ids);
    }
    await writeAudit(conn, req, { action: 'update', table: 'roles', recordId: id, oldValues: before, newValues: data });
  });
  res.json(await findRole(pool, id));
});

router.delete('/:id', requirePermission('roles.delete'), async (req, res) => {
  const id = parseId(req.params.id);
  await withTransaction(async (conn) => {
    const role = await findRole(conn, id);
    if (role.is_system) throw new HttpError(400, 'Built-in roles cannot be deleted');
    const [[{ n }]] = await conn.query('SELECT COUNT(*) AS n FROM users WHERE role_id = ?', [id]);
    if (n > 0) throw new HttpError(400, `${n} user(s) still have this role. Move them to another role first.`);
    await conn.query('DELETE FROM roles WHERE id = ?', [id]);
    await writeAudit(conn, req, { action: 'delete', table: 'roles', recordId: id, oldValues: role });
  });
  res.status(204).end();
});

export default router;
