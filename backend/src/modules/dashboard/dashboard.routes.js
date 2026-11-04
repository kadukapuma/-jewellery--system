import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../config/db.js';
import { requirePermission } from '../../middleware/auth.js';
import { getCurrentPrices, getGramsPerPound } from '../gold-prices/gold-prices.service.js';

const router = Router();

const querySchema = z.object({ days: z.coerce.number().int().refine((d) => [7, 14, 30].includes(d)).default(14) });

const has = (req, code) => req.user.is_super_admin || req.user.permissionSet.has(code);

// Local YYYY-MM-DD (matches MySQL DATE() on the same machine).
function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Each section is only included when the user may see that data.
router.get('/', requirePermission('dashboard.view'), async (req, res) => {
  const { days } = querySchema.parse(req.query);
  const result = { gold_prices: null, sales: null, users: null, logins: null, recent_activity: null };

  if (has(req, 'gold_prices.view')) {
    result.gold_prices = { grams_per_pound: await getGramsPerPound(), prices: await getCurrentPrices() };
  }

  if (has(req, 'sales.view')) {
    const [[today]] = await pool.query(
      `SELECT COUNT(*) AS bills, COALESCE(SUM(total), 0) AS amount, COALESCE(SUM(paid_amount), 0) AS paid
       FROM sales WHERE status = 'completed' AND sale_date >= CURDATE()`,
    );
    const [[owed]] = await pool.query(
      `SELECT COALESCE(SUM(balance), 0) AS amount, COUNT(*) AS bills,
              COALESCE(SUM(CASE WHEN due_date < CURDATE() THEN balance ELSE 0 END), 0) AS overdue
       FROM sales WHERE status = 'completed' AND balance > 0`,
    );
    result.sales = {
      today_bills: today.bills,
      today_amount: Number(today.amount),
      today_paid: Number(today.paid),
      owed_amount: Number(owed.amount),
      owed_bills: owed.bills,
      overdue_amount: Number(owed.overdue),
    };
  }

  if (has(req, 'users.view')) {
    const [[counts]] = await pool.query('SELECT COUNT(*) AS total, SUM(is_active) AS active FROM users');
    const [byRole] = await pool.query(
      `SELECT r.name AS role, COUNT(u.id) AS count
       FROM roles r LEFT JOIN users u ON u.role_id = r.id AND u.is_active = 1
       WHERE r.is_active = 1 GROUP BY r.id ORDER BY r.id`,
    );
    result.users = { total: counts.total, active: Number(counts.active || 0), by_role: byRole };
  }

  if (has(req, 'audit_logs.view')) {
    const [rows] = await pool.query(
      `SELECT DATE(created_at) AS day, SUM(success) AS success, SUM(1 - success) AS failed
       FROM login_logs WHERE created_at >= CURDATE() - INTERVAL ? DAY
       GROUP BY DATE(created_at)`,
      [days - 1],
    );
    const byDay = new Map(rows.map((r) => [r.day, r]));
    const daily = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = ymd(d);
      const row = byDay.get(key);
      daily.push({ date: key, success: Number(row?.success || 0), failed: Number(row?.failed || 0) });
    }
    const today = daily[daily.length - 1];
    result.logins = { days, today_success: today.success, today_failed: today.failed, daily };

    const [recent] = await pool.query(
      `SELECT a.id, u.name AS user_name, a.action, a.table_name, a.record_id, a.created_at
       FROM audit_logs a JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT 6`,
    );
    result.recent_activity = recent;
  }

  res.json(result);
});

export default router;
