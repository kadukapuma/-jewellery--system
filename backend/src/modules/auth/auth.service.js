import { pool } from '../../config/db.js';

// Logged-in user's profile plus effective permission codes.
export async function getUserProfile(userId) {
  const [rows] = await pool.query(
    `SELECT u.id, u.name, u.username, u.email, u.phone, u.role_id, u.is_active,
            u.must_change_password, r.name AS role_name, r.is_super_admin, r.is_active AS role_active
     FROM users u JOIN roles r ON r.id = u.role_id
     WHERE u.id = ?`,
    [userId],
  );
  const user = rows[0];
  if (!user) return null;

  const [perms] = await pool.query('SELECT code FROM v_user_permissions WHERE user_id = ? ORDER BY code', [userId]);
  return {
    ...user,
    is_active: !!user.is_active,
    role_active: !!user.role_active,
    is_super_admin: !!user.is_super_admin,
    must_change_password: !!user.must_change_password,
    permissions: perms.map((p) => p.code),
  };
}
