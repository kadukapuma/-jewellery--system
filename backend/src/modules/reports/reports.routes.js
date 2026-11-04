import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../config/db.js';
import { hasPermission, requirePermission } from '../../middleware/auth.js';
import { dateSchema } from '../../utils/validation.js';

const router = Router();

const round2 = (n) => Math.round(Number(n) * 100) / 100;
const round3 = (n) => Math.round(Number(n) * 1000) / 1000;

const rangeSchema = z
  .object({ from: dateSchema, to: dateSchema })
  .refine((r) => r.from <= r.to, { message: '"From" must be before "To"', path: ['to'] });

// Sales whose date falls inside [from, to] (whole days).
const IN_RANGE = 's.sale_date >= ? AND s.sale_date < DATE_ADD(?, INTERVAL 1 DAY)';

router.get('/sales', requirePermission('reports.sales'), async (req, res) => {
  const { from, to } = rangeSchema.parse(req.query);
  const range = [from, to];

  const [[totals]] = await pool.query(
    `SELECT COUNT(*) AS bills, COALESCE(SUM(s.subtotal), 0) AS subtotal, COALESCE(SUM(s.discount), 0) AS discount,
            COALESCE(SUM(s.total), 0) AS total, COALESCE(SUM(s.balance), 0) AS on_credit,
            (SELECT COUNT(*) FROM sales c WHERE c.status = 'cancelled' AND c.sale_date >= ? AND c.sale_date < DATE_ADD(?, INTERVAL 1 DAY)) AS cancelled
     FROM sales s WHERE s.status = 'completed' AND ${IN_RANGE}`,
    [...range, ...range],
  );
  const [[weights]] = await pool.query(
    `SELECT COALESCE(SUM(sl.qty), 0) AS pieces, COALESCE(SUM(sl.net_weight_g), 0) AS net_g,
            COALESCE(SUM(sl.wastage_g), 0) AS wastage_g, COALESCE(SUM(sl.billed_weight_g), 0) AS billed_g,
            COALESCE(SUM(sl.gold_value), 0) AS gold_value, COALESCE(SUM(sl.making_charge), 0) AS making
     FROM sale_lines sl JOIN sales s ON s.id = sl.sale_id WHERE s.status = 'completed' AND ${IN_RANGE}`,
    range,
  );
  const [byDay] = await pool.query(
    `SELECT DATE(s.sale_date) AS day, COUNT(*) AS bills, SUM(s.total) AS total
     FROM sales s WHERE s.status = 'completed' AND ${IN_RANGE} GROUP BY DATE(s.sale_date) ORDER BY day`,
    range,
  );
  const [byKarat] = await pool.query(
    `SELECT k.name AS label, SUM(sl.qty) AS pieces, SUM(sl.billed_weight_g) AS weight_g, SUM(sl.line_total) AS amount
     FROM sale_lines sl JOIN sales s ON s.id = sl.sale_id JOIN karats k ON k.id = sl.karat_id
     WHERE s.status = 'completed' AND ${IN_RANGE} GROUP BY k.id ORDER BY amount DESC`,
    range,
  );
  const [byCategory] = await pool.query(
    `SELECT c.name AS label, SUM(sl.qty) AS pieces, SUM(sl.billed_weight_g) AS weight_g, SUM(sl.line_total) AS amount
     FROM sale_lines sl JOIN sales s ON s.id = sl.sale_id JOIN items i ON i.id = sl.item_id JOIN categories c ON c.id = i.category_id
     WHERE s.status = 'completed' AND ${IN_RANGE} GROUP BY c.id ORDER BY amount DESC`,
    range,
  );
  const [byCashier] = await pool.query(
    `SELECT u.name AS label, COUNT(*) AS bills, SUM(s.total) AS amount
     FROM sales s JOIN users u ON u.id = s.created_by
     WHERE s.status = 'completed' AND ${IN_RANGE} GROUP BY u.id ORDER BY amount DESC`,
    range,
  );
  // Money actually received in the period (counter + later receipts), by method.
  const [byMethod] = await pool.query(
    `SELECT p.method AS label, COUNT(*) AS receipts, SUM(p.amount) AS amount
     FROM customer_payments p
     WHERE p.status = 'active' AND p.payment_date >= ? AND p.payment_date < DATE_ADD(?, INTERVAL 1 DAY)
     GROUP BY p.method ORDER BY amount DESC`,
    range,
  );

  const num = (rows, keys) => rows.map((r) => ({ ...r, ...Object.fromEntries(keys.map((k) => [k, Number(r[k])])) }));
  res.json({
    from, to,
    totals: {
      bills: totals.bills, cancelled: totals.cancelled, subtotal: round2(totals.subtotal), discount: round2(totals.discount),
      total: round2(totals.total), on_credit: round2(totals.on_credit),
      pieces: Number(weights.pieces), net_g: round3(weights.net_g), wastage_g: round3(weights.wastage_g), billed_g: round3(weights.billed_g),
      gold_value: round2(weights.gold_value), making: round2(weights.making),
    },
    by_day: num(byDay, ['total']),
    by_karat: num(byKarat, ['pieces', 'weight_g', 'amount']),
    by_category: num(byCategory, ['pieces', 'weight_g', 'amount']),
    by_cashier: num(byCashier, ['amount']),
    by_method: num(byMethod, ['amount']),
  });
});

// Profit per line = what the customer paid for it (after any discount) - its cost.
router.get('/profit', requirePermission('reports.profit'), async (req, res) => {
  const { from, to } = rangeSchema.parse(req.query);
  const [lines] = await pool.query(
    `SELECT s.id AS sale_id, s.invoice_no, s.sale_date, i.item_code, i.name AS item_name, c.name AS category,
            sl.qty, sl.billed_weight_g, sl.line_total, sl.unit_cost,
            -- line_total already has its own discount; only a whole-bill discount is shared across the lines
            sl.line_total * s.total / NULLIF((SELECT SUM(x.line_total) FROM sale_lines x WHERE x.sale_id = s.id), 0) AS revenue,
            sl.unit_cost * sl.qty AS cost
     FROM sale_lines sl
     JOIN sales s ON s.id = sl.sale_id
     JOIN items i ON i.id = sl.item_id
     JOIN categories c ON c.id = i.category_id
     WHERE s.status = 'completed' AND ${IN_RANGE}
     ORDER BY s.sale_date, s.id, sl.id`,
    [from, to],
  );
  const rows = lines.map((l) => {
    const revenue = round2(l.revenue);
    const cost = round2(l.cost);
    return { ...l, revenue, cost, profit: round2(revenue - cost), no_cost: cost <= 0 };
  });
  const byCategory = new Map();
  for (const r of rows) {
    const c = byCategory.get(r.category) || { label: r.category, revenue: 0, cost: 0, profit: 0, pieces: 0 };
    c.revenue = round2(c.revenue + r.revenue);
    c.cost = round2(c.cost + r.cost);
    c.profit = round2(c.profit + r.profit);
    c.pieces += r.qty;
    byCategory.set(r.category, c);
  }
  const revenue = round2(rows.reduce((s, r) => s + r.revenue, 0));
  const cost = round2(rows.reduce((s, r) => s + r.cost, 0));
  res.json({
    from, to,
    totals: { revenue, cost, profit: round2(revenue - cost), margin_percent: revenue > 0 ? round2(((revenue - cost) / revenue) * 100) : null,
      lines_without_cost: rows.filter((r) => r.no_cost).length },
    by_category: [...byCategory.values()].sort((a, b) => b.profit - a.profit),
    lines: rows,
  });
});

// Everything in stock now, valued at today's gold price.
router.get('/stock', requirePermission('reports.stock'), async (req, res) => {
  const showCost = hasPermission(req, 'items.view_cost');
  const [byGroup] = await pool.query(
    `SELECT c.name AS category, k.name AS karat, COUNT(*) AS item_lines, SUM(i.stock_qty) AS pieces,
            SUM(i.net_weight_g * i.stock_qty) AS net_g,
            SUM(((i.net_weight_g + i.wastage_g) * cp.gram_price + i.making_charge) * i.stock_qty) AS value_now,
            SUM(cp.gram_price IS NULL) AS without_price,
            SUM(i.cost_price * i.stock_qty) AS cost
     FROM items i
     JOIN categories c ON c.id = i.category_id
     JOIN karats k ON k.id = i.karat_id
     LEFT JOIN v_current_gold_prices cp ON cp.karat_id = i.karat_id
     WHERE i.status = 'in_stock' AND i.stock_qty > 0
     GROUP BY c.id, k.id ORDER BY c.name, k.sort_order`,
  );
  const [old] = await pool.query(
    `SELECT i.id, i.item_code, i.name, c.name AS category, k.name AS karat, i.net_weight_g, i.stock_qty,
            DATEDIFF(CURDATE(), DATE(i.created_at)) AS days_in_stock, i.tag_print_count
     FROM items i JOIN categories c ON c.id = i.category_id JOIN karats k ON k.id = i.karat_id
     WHERE i.status = 'in_stock' AND i.stock_qty > 0 AND (i.created_at < CURDATE() - INTERVAL 90 DAY OR i.tag_print_count = 0)
     ORDER BY i.created_at LIMIT 500`,
  );
  const [[withCraftsmen]] = await pool.query("SELECT COALESCE(SUM(gold_held_g), 0) AS g FROM v_craftsman_balances");
  const groups = byGroup.map((g) => ({
    category: g.category, karat: g.karat, item_lines: g.item_lines, pieces: Number(g.pieces), net_g: round3(g.net_g),
    value_now: round2(g.value_now || 0), without_price: Number(g.without_price), ...(showCost ? { cost: round2(g.cost) } : {}),
  }));
  const sum = (k) => groups.reduce((s, g) => s + (g[k] || 0), 0);
  res.json({
    totals: {
      pieces: sum('pieces'), net_g: round3(sum('net_g')), value_now: round2(sum('value_now')),
      ...(showCost ? { cost: round2(sum('cost')) } : {}), gold_with_craftsmen_g: round3(withCraftsmen.g),
    },
    groups,
    slow_or_untagged: old.map((o) => ({ ...o, slow: o.days_in_stock > 90, untagged: o.tag_print_count === 0 })),
  });
});

router.get('/wastage', requirePermission('reports.wastage'), async (req, res) => {
  const { from, to } = rangeSchema.parse(req.query);
  const [byCraftsman] = await pool.query(
    `SELECT c.id, c.name, COUNT(*) AS jobs, SUM(j.issued_weight_g) AS issued_g, SUM(j.returned_weight_g) AS returned_g,
            SUM(j.wastage_g) AS wastage_g, SUM(j.craftsman_fee) AS fees, AVG(DATEDIFF(j.completed_date, j.issue_date)) AS avg_days
     FROM craft_jobs j JOIN craftsmen c ON c.id = j.craftsman_id
     WHERE j.status = 'completed' AND j.completed_date BETWEEN ? AND ?
     GROUP BY c.id ORDER BY wastage_g DESC`,
    [from, to],
  );
  const [jobs] = await pool.query(
    `SELECT j.id, j.job_no, j.completed_date, c.name AS craftsman, cat.name AS category, k.name AS karat, j.description,
            j.issued_weight_g, j.returned_weight_g, j.wastage_g, j.craftsman_fee
     FROM craft_jobs j JOIN craftsmen c ON c.id = j.craftsman_id JOIN categories cat ON cat.id = j.category_id JOIN karats k ON k.id = j.karat_id
     WHERE j.status = 'completed' AND j.completed_date BETWEEN ? AND ?
     ORDER BY j.completed_date, j.id`,
    [from, to],
  );
  const pct = (w, i) => (Number(i) > 0 ? round2((Number(w) / Number(i)) * 100) : null);
  const rows = byCraftsman.map((r) => ({
    ...r, issued_g: round3(r.issued_g), returned_g: round3(r.returned_g), wastage_g: round3(r.wastage_g), fees: round2(r.fees),
    wastage_percent: pct(r.wastage_g, r.issued_g), avg_days: r.avg_days === null ? null : Math.round(Number(r.avg_days) * 10) / 10,
  }));
  const issued = rows.reduce((s, r) => s + r.issued_g, 0);
  const wastage = rows.reduce((s, r) => s + r.wastage_g, 0);
  res.json({
    from, to,
    totals: { jobs: jobs.length, issued_g: round3(issued), wastage_g: round3(wastage), wastage_percent: pct(wastage, issued) },
    by_craftsman: rows,
    jobs: jobs.map((j) => ({ ...j, wastage_percent: pct(j.wastage_g, j.issued_weight_g) })),
  });
});

// Who owes the shop, who the shop owes, and what craftsmen hold. Ageing uses days past the due date.
router.get('/balances', requirePermission('reports.customer_balances', 'reports.supplier_balances', 'reports.craftsman_balances'), async (req, res) => {
  const result = {};
  const ageing = (table, who) => `
    SELECT ${who} AS id,
           SUM(CASE WHEN t.due_date IS NULL OR t.due_date >= CURDATE() THEN t.balance ELSE 0 END) AS not_due,
           SUM(CASE WHEN DATEDIFF(CURDATE(), t.due_date) BETWEEN 1 AND 30 THEN t.balance ELSE 0 END) AS d1_30,
           SUM(CASE WHEN DATEDIFF(CURDATE(), t.due_date) BETWEEN 31 AND 60 THEN t.balance ELSE 0 END) AS d31_60,
           SUM(CASE WHEN DATEDIFF(CURDATE(), t.due_date) BETWEEN 61 AND 90 THEN t.balance ELSE 0 END) AS d61_90,
           SUM(CASE WHEN DATEDIFF(CURDATE(), t.due_date) > 90 THEN t.balance ELSE 0 END) AS d90_plus
    FROM ${table} t WHERE t.balance > 0 ${table === 'sales' ? "AND t.status = 'completed'" : ''} GROUP BY ${who}`;
  const toNumbers = (r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, ['name', 'phone'].includes(k) ? v : Number(v || 0)]));

  if (hasPermission(req, 'reports.customer_balances')) {
    const [rows] = await pool.query(
      `SELECT c.id, c.name, c.phone, b.balance, a.not_due, a.d1_30, a.d31_60, a.d61_90, a.d90_plus
       FROM customers c JOIN v_customer_balances b ON b.customer_id = c.id
       LEFT JOIN (${ageing('sales', 't.customer_id')}) a ON a.id = c.id
       WHERE b.balance <> 0 ORDER BY b.balance DESC`,
    );
    result.customers = rows.map(toNumbers);
  }
  if (hasPermission(req, 'reports.supplier_balances')) {
    const [rows] = await pool.query(
      `SELECT s.id, s.name, s.phone, b.balance, a.not_due, a.d1_30, a.d31_60, a.d61_90, a.d90_plus
       FROM suppliers s JOIN v_supplier_balances b ON b.supplier_id = s.id
       LEFT JOIN (${ageing('purchases', 't.supplier_id')}) a ON a.id = s.id
       WHERE b.balance <> 0 ORDER BY b.balance DESC`,
    );
    result.suppliers = rows.map(toNumbers);
  }
  if (hasPermission(req, 'reports.craftsman_balances')) {
    const [rows] = await pool.query(
      `SELECT c.id, c.name, c.phone, b.gold_held_g, b.cash_due,
              (SELECT COUNT(*) FROM craft_jobs j WHERE j.craftsman_id = c.id AND j.status = 'issued') AS open_jobs
       FROM craftsmen c JOIN v_craftsman_balances b ON b.craftsman_id = c.id
       WHERE b.gold_held_g <> 0 OR b.cash_due <> 0 ORDER BY b.gold_held_g DESC`,
    );
    result.craftsmen = rows.map(toNumbers);
  }
  res.json(result);
});

export default router;
