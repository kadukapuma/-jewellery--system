import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../config/db.js';
import { requirePermission } from '../../middleware/auth.js';

const router = Router();

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(200),
  user_id: z.coerce.number().int().positive().optional(),
});

router.get('/login-logs', requirePermission('audit_logs.view'), async (req, res) => {
  const { limit, user_id } = querySchema.parse(req.query);
  const [rows] = await pool.query(
    `SELECT l.id, l.user_id, u.name AS user_name, l.username_tried, l.success, l.ip_address, l.user_agent, l.created_at
     FROM login_logs l LEFT JOIN users u ON u.id = l.user_id
     WHERE (? IS NULL OR l.user_id = ?)
     ORDER BY l.id DESC LIMIT ?`,
    [user_id ?? null, user_id ?? null, limit],
  );
  res.json(rows.map((r) => ({ ...r, success: !!r.success })));
});

router.get('/audit-logs', requirePermission('audit_logs.view'), async (req, res) => {
  const { limit, user_id } = querySchema.parse(req.query);
  const [rows] = await pool.query(
    `SELECT a.id, a.user_id, u.name AS user_name, a.action, a.table_name, a.record_id,
            a.old_values, a.new_values, a.ip_address, a.created_at
     FROM audit_logs a JOIN users u ON u.id = a.user_id
     WHERE (? IS NULL OR a.user_id = ?)
     ORDER BY a.id DESC LIMIT ?`,
    [user_id ?? null, user_id ?? null, limit],
  );
  res.json(rows);
});

export default router;
