import { Router } from 'express';
import { z } from 'zod';
import { pool, withTransaction } from '../../config/db.js';
import { hasPermission, requireAdmin, requirePermission } from '../../middleware/auth.js';
import { HttpError, parseId } from '../../utils/httpError.js';
import { dateSchema, optionalText } from '../../utils/validation.js';
import { writeAudit } from '../../utils/audit.js';
import { dbToday, prettyDate } from '../../utils/dayLock.js';
import { buildDaySummary } from './day-end.service.js';

const router = Router();

const round2 = (n) => Math.round(Number(n) * 100) / 100;

const CLOSING_SELECT = `
  SELECT dc.*, cu.name AS closed_by_name, ru.name AS reopened_by_name
  FROM day_closings dc
  JOIN users cu ON cu.id = dc.closed_by
  LEFT JOIN users ru ON ru.id = dc.reopened_by`;

const parseSummary = (v) => (typeof v === 'string' ? JSON.parse(v) : v);

// Cost and profit are only shown to users who may see them (same rule as the Profit report).
function hideCost(summary) {
  if (!summary) return summary;
  return {
    ...summary,
    profit: null,
    headline: { ...summary.headline, net_profit: null },
    stock: summary.stock && {
      ...summary.stock,
      items_added: (summary.stock.items_added || []).map(({ cost_price, ...r }) => r),
    },
  };
}

function presentClosing(row, req) {
  if (!row) return null;
  const { summary, ...rest } = row;
  const snap = parseSummary(summary);
  return { ...rest, snapshot: hasPermission(req, 'reports.profit') ? snap : hideCost(snap) };
}

async function findClosing(db, where, params) {
  const [[row]] = await db.query(`${CLOSING_SELECT} WHERE ${where}`, params);
  return row || null;
}

// The day's summary (live numbers) and its closing, if the day end has been done.
router.get('/', requirePermission('day_end.view'), async (req, res) => {
  const today = await dbToday(pool);
  const date = req.query.date ? dateSchema.parse(req.query.date) : today;
  const showCost = hasPermission(req, 'reports.profit');
  const summary = await buildDaySummary(pool, date, { showCost });
  const closing = await findClosing(pool, 'dc.close_date = ?', [date]);
  // Earlier days that had activity but were never closed (last 30 days), so they are not forgotten.
  const [unclosed] = await pool.query(
    `SELECT d.day FROM (
       SELECT DATE(sale_date) AS day FROM sales WHERE sale_date >= ? - INTERVAL 30 DAY AND sale_date < ?
       UNION SELECT DATE(payment_date) FROM customer_payments WHERE payment_date >= ? - INTERVAL 30 DAY AND payment_date < ?
       UNION SELECT expense_date FROM expenses WHERE expense_date >= ? - INTERVAL 30 DAY AND expense_date < ?
       UNION SELECT purchase_date FROM purchases WHERE purchase_date >= ? - INTERVAL 30 DAY AND purchase_date < ?
     ) d
     WHERE NOT EXISTS (SELECT 1 FROM day_closings dc WHERE dc.close_date = d.day AND dc.status = 'closed')
     ORDER BY d.day DESC LIMIT 10`,
    Array(8).fill(today),
  );
  res.json({
    date,
    today,
    is_future: date > today,
    summary,
    closing: presentClosing(closing, req),
    unclosed_days: unclosed.map((r) => String(r.day).slice(0, 10)),
  });
});

const historySchema = z.object({
  page: z.coerce.number().int().min(0).default(0),
  page_size: z.coerce.number().int().min(1).max(200).default(25),
});

router.get('/history', requirePermission('day_end.view'), async (req, res) => {
  const q = historySchema.parse(req.query);
  const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM day_closings');
  const [rows] = await pool.query(
    `SELECT dc.id, dc.close_date, dc.opening_cash, dc.expected_cash, dc.counted_cash, dc.cash_difference, dc.expected_bank,
            dc.notes, dc.status, dc.closed_at, dc.reopened_at, dc.reopen_reason,
            cu.name AS closed_by_name, ru.name AS reopened_by_name,
            JSON_EXTRACT(dc.summary, '$.headline.sales') AS sales,
            JSON_EXTRACT(dc.summary, '$.headline.bills') AS bills,
            JSON_EXTRACT(dc.summary, '$.headline.money_in') AS money_in,
            JSON_EXTRACT(dc.summary, '$.headline.money_out') AS money_out,
            JSON_EXTRACT(dc.summary, '$.headline.net_profit') AS net_profit
     FROM day_closings dc JOIN users cu ON cu.id = dc.closed_by LEFT JOIN users ru ON ru.id = dc.reopened_by
     ORDER BY dc.close_date DESC LIMIT ? OFFSET ?`,
    [q.page_size, q.page * q.page_size],
  );
  const showCost = hasPermission(req, 'reports.profit');
  res.json({
    total,
    closings: rows.map((r) => ({
      ...r,
      sales: Number(r.sales || 0), bills: Number(r.bills || 0), money_in: Number(r.money_in || 0), money_out: Number(r.money_out || 0),
      net_profit: showCost && r.net_profit !== null && r.net_profit !== 'null' ? Number(r.net_profit) : null,
    })),
  });
});

const closeSchema = z.object({
  date: dateSchema,
  counted_cash: z.coerce.number({ error: 'Enter the cash you counted' }).min(0, 'Counted cash cannot be below 0').max(1e12),
  notes: optionalText(255),
});

// Count the cash and close the day. From now on nothing can be saved or cancelled on this date.
router.post('/close', requirePermission('day_end.close'), async (req, res) => {
  const data = closeSchema.parse(req.body);
  const id = await withTransaction(async (conn) => {
    const today = await dbToday(conn);
    if (data.date > today) throw new HttpError(400, 'A day in the future cannot be closed');

    const [[existing]] = await conn.query('SELECT id, status FROM day_closings WHERE close_date = ? FOR UPDATE', [data.date]);
    if (existing?.status === 'closed') throw new HttpError(400, `${prettyDate(data.date)} is already closed`);

    // The snapshot always holds the full numbers (cost and profit included); they are hidden on reading.
    const summary = await buildDaySummary(conn, data.date, { showCost: true });
    const cash = summary.cash.accounts.cash;
    const difference = round2(data.counted_cash - cash.closing);
    const values = [cash.opening, cash.closing, data.counted_cash, difference, summary.cash.accounts.bank.closing, JSON.stringify(summary), data.notes];

    let closingId;
    if (existing) {
      // Closing again after an Admin re-opened it: refresh the same row.
      await conn.query(
        `UPDATE day_closings SET opening_cash = ?, expected_cash = ?, counted_cash = ?, cash_difference = ?, expected_bank = ?,
                                 summary = ?, notes = ?, status = 'closed', closed_by = ?, closed_at = NOW()
         WHERE id = ?`,
        [...values, req.user.id, existing.id],
      );
      closingId = existing.id;
    } else {
      const [result] = await conn.query(
        `INSERT INTO day_closings (close_date, opening_cash, expected_cash, counted_cash, cash_difference, expected_bank, summary, notes, closed_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [data.date, ...values, req.user.id],
      );
      closingId = result.insertId;
    }
    await writeAudit(conn, req, {
      action: 'close',
      table: 'day_closings',
      recordId: closingId,
      newValues: {
        close_date: data.date, expected_cash: cash.closing, counted_cash: data.counted_cash, cash_difference: difference,
        sales: summary.headline.sales, net_profit: summary.headline.net_profit, notes: data.notes,
      },
    });
    return closingId;
  });
  res.status(201).json(presentClosing(await findClosing(pool, 'dc.id = ?', [id]), req));
});

// Admin opens a closed day again so it can be corrected; it can then be closed again.
router.post('/:id/reopen', requireAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  const reason = z.string({ error: 'Give a reason' }).trim().min(1, 'Give a reason').max(255).parse(req.body?.reason ?? '');
  await withTransaction(async (conn) => {
    const [[row]] = await conn.query('SELECT id, close_date, status FROM day_closings WHERE id = ? FOR UPDATE', [id]);
    if (!row) throw new HttpError(404, 'Day closing not found');
    if (row.status !== 'closed') throw new HttpError(400, 'This day is not closed');
    await conn.query(
      "UPDATE day_closings SET status = 'reopened', reopened_by = ?, reopened_at = NOW(), reopen_reason = ? WHERE id = ?",
      [req.user.id, reason, id],
    );
    await writeAudit(conn, req, { action: 'reopen', table: 'day_closings', recordId: id, oldValues: { close_date: row.close_date }, newValues: { reason } });
  });
  res.json(presentClosing(await findClosing(pool, 'dc.id = ?', [id]), req));
});

export default router;
