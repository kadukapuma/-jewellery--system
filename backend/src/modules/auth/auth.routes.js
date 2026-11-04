import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { pool } from '../../config/db.js';
import { env } from '../../config/env.js';
import { authenticate } from '../../middleware/auth.js';
import { HttpError } from '../../utils/httpError.js';
import { passwordSchema } from '../../utils/validation.js';
import { getSetting } from '../../utils/settings.js';
import { writeAudit } from '../../utils/audit.js';
import { getUserProfile } from './auth.service.js';

const router = Router();

const loginSchema = z.object({
  username: z.string().trim().min(1, 'Enter your username'),
  password: z.string().min(1, 'Enter your password'),
});

const changePasswordSchema = z.object({
  current_password: z.string().min(1, 'Enter your current password'),
  new_password: passwordSchema,
});

router.post('/login', async (req, res) => {
  const { username, password } = loginSchema.parse(req.body);

  const [rows] = await pool.query(
    `SELECT u.id, u.password_hash, u.is_active, u.failed_login_count, u.locked_until,
            (u.locked_until IS NOT NULL AND u.locked_until > NOW()) AS is_locked,
            r.is_active AS role_active
     FROM users u JOIN roles r ON r.id = u.role_id
     WHERE u.username = ?`,
    [username],
  );
  const user = rows[0];

  const logAttempt = (success) =>
    pool.query(
      'INSERT INTO login_logs (user_id, username_tried, success, ip_address, user_agent) VALUES (?, ?, ?, ?, ?)',
      [user?.id ?? null, username, success ? 1 : 0, req.ip, (req.get('user-agent') || '').slice(0, 255)],
    );

  if (user?.is_locked) {
    await logAttempt(false);
    throw new HttpError(423, `Account is locked until ${user.locked_until}. Ask an admin to unlock it.`);
  }

  const passwordOk = user ? await bcrypt.compare(password, user.password_hash) : false;
  if (!passwordOk) {
    await logAttempt(false);
    if (user) {
      const maxFails = Number(await getSetting('max_failed_logins', 5));
      const lockMinutes = Number(await getSetting('lock_minutes', 15));
      const fails = user.failed_login_count + 1;
      if (fails >= maxFails) {
        await pool.query(
          'UPDATE users SET failed_login_count = 0, locked_until = NOW() + INTERVAL ? MINUTE WHERE id = ?',
          [lockMinutes, user.id],
        );
      } else {
        await pool.query('UPDATE users SET failed_login_count = ? WHERE id = ?', [fails, user.id]);
      }
    }
    throw new HttpError(401, 'Wrong username or password');
  }

  if (!user.is_active || !user.role_active) {
    await logAttempt(false);
    throw new HttpError(403, 'This account is disabled');
  }

  await pool.query(
    'UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = NOW() WHERE id = ?',
    [user.id],
  );
  await logAttempt(true);

  const token = jwt.sign({ sub: user.id }, env.jwtSecret, { expiresIn: env.jwtExpiresIn });
  res.json({ token, user: await getUserProfile(user.id) });
});

router.get('/me', authenticate, async (req, res) => {
  res.json({ user: await getUserProfile(req.user.id) });
});

router.post('/change-password', authenticate, async (req, res) => {
  const { current_password, new_password } = changePasswordSchema.parse(req.body);

  const [[row]] = await pool.query('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
  if (!(await bcrypt.compare(current_password, row.password_hash))) {
    throw new HttpError(400, 'Current password is wrong');
  }
  if (current_password === new_password) {
    throw new HttpError(400, 'New password must be different from the current one');
  }

  const hash = await bcrypt.hash(new_password, 10);
  await pool.query('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?', [hash, req.user.id]);
  await writeAudit(pool, req, { action: 'change_password', table: 'users', recordId: req.user.id });
  res.json({ user: await getUserProfile(req.user.id) });
});

export default router;
