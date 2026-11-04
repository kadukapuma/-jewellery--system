import { Router } from 'express';
import { pool } from '../../config/db.js';
import { requirePermission } from '../../middleware/auth.js';

const router = Router();

router.get('/', requirePermission('roles.view', 'users.view'), async (req, res) => {
  const [rows] = await pool.query(
    'SELECT id, code, module, action, description FROM permissions ORDER BY sort_order, id',
  );
  res.json(rows);
});

export default router;
