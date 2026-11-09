import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../config/db.js';
import { requireAdmin, requirePermission } from '../../middleware/auth.js';
import { HttpError } from '../../utils/httpError.js';
import { writeAudit } from '../../utils/audit.js';

const router = Router();

// Only these can be changed from the app. grams_per_pound is fixed: changing it would change every price.
const EDITABLE = {
  shop_name: z.string().trim().min(1, 'Shop name is required').max(60),
  shop_address: z.string().trim().max(200),
  shop_phone: z.string().trim().max(60),
  invoice_footer: z.string().trim().max(200),
  max_failed_logins: z.coerce.number().int().min(3).max(20).transform(String),
  lock_minutes: z.coerce.number().int().min(1).max(1440).transform(String),
};

// Shop details printed on bills - any logged-in user needs these.
router.get('/shop', async (req, res) => {
  const [rows] = await pool.query(
    "SELECT setting_key, setting_value FROM settings WHERE setting_key IN ('shop_name', 'shop_address', 'shop_phone', 'invoice_footer')",
  );
  res.json(Object.fromEntries(rows.map((r) => [r.setting_key, r.setting_value])));
});

router.get('/', requirePermission('settings.edit'), async (req, res) => {
  const [rows] = await pool.query('SELECT setting_key, setting_value FROM settings');
  res.json(Object.fromEntries(rows.map((r) => [r.setting_key, r.setting_value])));
});

router.put('/:key', requireAdmin, requirePermission('settings.edit'), async (req, res) => {
  const schema = EDITABLE[req.params.key];
  if (!schema) throw new HttpError(400, 'This setting cannot be changed here');
  const value = schema.parse(req.body.value);
  const [[before]] = await pool.query('SELECT setting_value FROM settings WHERE setting_key = ?', [req.params.key]);
  await pool.query(
    'INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)',
    [req.params.key, value],
  );
  await writeAudit(pool, req, {
    action: 'update',
    table: 'settings',
    oldValues: { [req.params.key]: before?.setting_value ?? null },
    newValues: { [req.params.key]: value },
  });
  res.json({ key: req.params.key, value });
});

export default router;
