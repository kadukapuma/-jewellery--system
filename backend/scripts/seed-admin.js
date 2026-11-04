// Creates the first "admin" user (Admin role) with ADMIN_PASSWORD from .env.
// The admin must change the password on first login.
import bcrypt from 'bcryptjs';
import { pool } from '../src/config/db.js';

const password = process.env.ADMIN_PASSWORD;
if (!password) {
  console.error('Set ADMIN_PASSWORD in backend/.env first');
  process.exit(1);
}

try {
  const [existing] = await pool.query('SELECT id FROM users WHERE username = ?', ['admin']);
  if (existing.length) {
    console.log('User "admin" already exists - nothing to do');
  } else {
    const [[role]] = await pool.query('SELECT id FROM roles WHERE is_super_admin = 1 ORDER BY id LIMIT 1');
    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      `INSERT INTO users (name, username, password_hash, role_id, must_change_password)
       VALUES ('Administrator', 'admin', ?, ?, 1)`,
      [hash, role.id],
    );
    console.log('User "admin" created (password from ADMIN_PASSWORD in .env)');
  }
} finally {
  await pool.end();
}
