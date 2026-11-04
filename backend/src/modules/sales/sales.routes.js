import { Router } from 'express';
import { z } from 'zod';
import { pool, withTransaction } from '../../config/db.js';
import { hasPermission, requirePermission } from '../../middleware/auth.js';
import { HttpError, parseId } from '../../utils/httpError.js';
import { PAYMENT_METHODS, dateSchema, idSchema, optionalText } from '../../utils/validation.js';
import { writeAudit } from '../../utils/audit.js';
import { nextDocumentNumber } from '../../utils/sequences.js';
import { calcItemPrice } from '../../services/pricing.js';
import { getCurrentPrice } from '../gold-prices/gold-prices.service.js';
import { findCustomer } from '../customers/customers.routes.js';
import {
  allocateCustomerPayment, applyCustomerAdvances, buildSchedule, recomputeSale,
} from '../customer-payments/customer-payments.service.js';

const router = Router();

const round2 = (n) => Math.round(n * 100) / 100;
const round3 = (n) => Math.round(n * 1000) / 1000;

const createSchema = z.object({
  customer_id: z.coerce.number().int().positive().optional().nullable(),
  lines: z
    .array(z.object({ item_id: idSchema, qty: z.coerce.number().int('Whole number only').min(1).max(100000).default(1) }))
    .min(1, 'Add at least one item')
    .max(100),
  discount: z.coerce.number().min(0, 'Cannot be negative').max(1e12).default(0),
  payments: z
    .array(z.object({
      method: z.enum(PAYMENT_METHODS),
      amount: z.coerce.number().positive('Amount must be above 0').max(1e12),
      reference_no: optionalText(50),
    }))
    .max(5)
    .default([]),
  due_date: dateSchema.optional().nullable(),
  instalments: z
    .object({
      count: z.coerce.number().int().min(2, 'At least 2 instalments').max(60),
      frequency: z.enum(['weekly', 'monthly']),
      start_date: dateSchema,
    })
    .optional()
    .nullable(),
  notes: optionalText(255),
  // Total the counter showed. If the gold price changed since, the bill is not saved.
  expected_total: z.coerce.number().optional().nullable(),
});

const listSchema = z.object({
  search: z.string().trim().max(50).default(''),
  customer_id: z.coerce.number().int().positive().optional(),
  status: z.enum(['completed', 'cancelled', 'all']).default('completed'),
  payment_status: z.enum(['unpaid', 'partial', 'paid', 'all']).default('all'),
  from: dateSchema.optional(),
  to: dateSchema.optional(),
  page: z.coerce.number().int().min(0).default(0),
  page_size: z.coerce.number().int().min(1).max(200).default(25),
});

export async function findSale(db, id) {
  const [[sale]] = await db.query(
    `SELECT s.*, c.name AS customer_name, c.phone AS customer_phone, c.address AS customer_address, c.nic AS customer_nic,
            u.name AS created_by_name
     FROM sales s LEFT JOIN customers c ON c.id = s.customer_id JOIN users u ON u.id = s.created_by
     WHERE s.id = ?`,
    [id],
  );
  if (!sale) throw new HttpError(404, 'Bill not found');
  const [lines] = await db.query(
    `SELECT sl.*, i.item_code, i.barcode, i.name AS item_name, k.name AS karat_name, cat.name AS category_name
     FROM sale_lines sl JOIN items i ON i.id = sl.item_id JOIN karats k ON k.id = sl.karat_id
     JOIN categories cat ON cat.id = i.category_id
     WHERE sl.sale_id = ? ORDER BY sl.id`,
    [id],
  );
  const [payments] = await db.query(
    `SELECT a.amount, p.id AS payment_id, p.receipt_no, p.payment_date, p.method, p.reference_no, p.sale_id = ? AS at_counter
     FROM customer_payment_allocations a JOIN customer_payments p ON p.id = a.payment_id
     WHERE a.sale_id = ? AND p.status = 'active' ORDER BY p.payment_date, p.id`,
    [id, id],
  );
  const [[plan]] = await db.query('SELECT * FROM instalment_plans WHERE sale_id = ?', [id]);
  let schedule = [];
  if (plan) {
    [schedule] = await db.query(
      `SELECT *, status <> 'paid' AND due_date < CURDATE() AS is_overdue FROM instalment_schedule WHERE plan_id = ? ORDER BY instalment_no`,
      [plan.id],
    );
  }
  return {
    ...sale,
    lines,
    payments: payments.map((p) => ({ ...p, at_counter: !!p.at_counter })),
    instalment_plan: plan ? { ...plan, schedule: schedule.map((r) => ({ ...r, is_overdue: !!r.is_overdue })) } : null,
  };
}

router.get('/', requirePermission('sales.view'), async (req, res) => {
  const q = listSchema.parse(req.query);
  const where = [];
  const params = [];
  if (q.search) { where.push('(s.invoice_no LIKE ? OR c.name LIKE ? OR c.phone LIKE ?)'); params.push(`%${q.search}%`, `%${q.search}%`, `%${q.search}%`); }
  if (q.customer_id) { where.push('s.customer_id = ?'); params.push(q.customer_id); }
  if (q.status !== 'all') { where.push('s.status = ?'); params.push(q.status); }
  if (q.payment_status !== 'all') { where.push('s.payment_status = ?'); params.push(q.payment_status); }
  if (q.from) { where.push('s.sale_date >= ?'); params.push(q.from); }
  if (q.to) { where.push('s.sale_date < DATE_ADD(?, INTERVAL 1 DAY)'); params.push(q.to); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const from = 'FROM sales s LEFT JOIN customers c ON c.id = s.customer_id';
  const [[sums]] = await pool.query(
    `SELECT COUNT(*) AS total, COALESCE(SUM(s.total), 0) AS amount, COALESCE(SUM(s.balance), 0) AS balance ${from} ${whereSql}`,
    params,
  );
  const [rows] = await pool.query(
    `SELECT s.*, c.name AS customer_name, c.phone AS customer_phone,
            (SELECT COUNT(*) FROM sale_lines sl WHERE sl.sale_id = s.id) AS line_count,
            s.status = 'completed' AND s.balance > 0 AND s.due_date < CURDATE() AS is_overdue
     ${from} ${whereSql} ORDER BY s.sale_date DESC, s.id DESC LIMIT ? OFFSET ?`,
    [...params, q.page_size, q.page * q.page_size],
  );
  res.json({
    total: sums.total,
    sums: { amount: Number(sums.amount), balance: Number(sums.balance) },
    sales: rows.map((r) => ({ ...r, is_overdue: !!r.is_overdue })),
  });
});

// Cost is only for people allowed to see what the shop paid.
function presentSale(sale, req) {
  if (hasPermission(req, 'items.view_cost')) return sale;
  return { ...sale, lines: sale.lines.map(({ unit_cost, ...line }) => line) };
}

router.get('/:id', requirePermission('sales.view', 'sales.reprint'), async (req, res) => {
  res.json(presentSale(await findSale(pool, parseId(req.params.id)), req));
});

// Make a bill. Every line is priced at the gold price in force right now, and that price
// is stored on the line so the bill never changes when the price is updated later.
router.post('/', requirePermission('sales.create'), async (req, res) => {
  const data = createSchema.parse(req.body);
  if (data.discount > 0 && !hasPermission(req, 'sales.discount')) throw new HttpError(403, 'You do not have permission to give discounts');
  const ids = data.lines.map((l) => l.item_id);
  if (new Set(ids).size !== ids.length) throw new HttpError(400, 'The same item is on the bill twice');

  const result = await withTransaction(async (conn) => {
    let customer = null;
    if (data.customer_id) customer = await findCustomer(conn, data.customer_id);

    // 1. Price every line.
    const priceByKarat = new Map();
    const lines = [];
    for (const [index, line] of data.lines.entries()) {
      const [[item]] = await conn.query(
        'SELECT i.*, k.name AS karat_name FROM items i JOIN karats k ON k.id = i.karat_id WHERE i.id = ? FOR UPDATE',
        [line.item_id],
      );
      if (!item) throw new HttpError(400, `Line ${index + 1}: item not found`);
      if (item.status !== 'in_stock' || item.stock_qty < line.qty) {
        throw new HttpError(400, `${item.item_code} is not in stock${item.stock_qty > 0 ? ` (only ${item.stock_qty} left)` : ''}`);
      }
      if (!priceByKarat.has(item.karat_id)) priceByKarat.set(item.karat_id, await getCurrentPrice(conn, item.karat_id));
      const price = priceByKarat.get(item.karat_id);
      if (!price) throw new HttpError(400, `No gold price entered for ${item.karat_name}. Update gold prices first.`);

      const unit = calcItemPrice(item, Number(price.gram_price));
      lines.push({
        item,
        qty: line.qty,
        gold_price_id: price.id,
        pound_price_used: Number(price.pound_price),
        gram_price_used: Number(price.gram_price),
        net_weight_g: round3(Number(item.net_weight_g) * line.qty),
        wastage_g: round3(Number(item.wastage_g) * line.qty),
        billed_weight_g: round3(unit.billed_weight_g * line.qty),
        gold_value: round2(unit.gold_value * line.qty),
        making_charge: round2(unit.making_charge * line.qty),
        line_total: round2(unit.line_total * line.qty),
      });
    }

    // 2. Totals.
    const subtotal = round2(lines.reduce((s, l) => s + l.line_total, 0));
    if (data.discount > subtotal) throw new HttpError(400, 'Discount cannot be more than the bill');
    const total = round2(subtotal - data.discount);
    if (data.expected_total !== null && data.expected_total !== undefined && Math.abs(data.expected_total - total) > 0.009) {
      throw new HttpError(409, `The gold price changed while you were billing. New total is ${total.toFixed(2)} — please check and save again.`, 'PRICE_CHANGED');
    }

    // 3. Payments: anything over the total is change, given back from the cash.
    const payments = data.payments.map((p) => ({ ...p }));
    const received = round2(payments.reduce((s, p) => s + p.amount, 0));
    let change = 0;
    if (received > total) {
      change = round2(received - total);
      const cash = payments.find((p) => p.method === 'cash');
      if (!cash || cash.amount < change) throw new HttpError(400, 'Card, bank or cheque payments cannot be more than the bill');
      cash.amount = round2(cash.amount - change);
    }
    const paid = round2(Math.min(received, total));
    const balance = round2(total - paid);

    // 4. Credit rules.
    if (balance > 0) {
      if (!customer) throw new HttpError(400, 'Choose a customer to give credit (the bill is not fully paid)');
      if (!hasPermission(req, 'sales.credit')) throw new HttpError(403, 'You do not have permission to give credit. Take the full amount.');
      const newBalance = round2(customer.balance + balance);
      if (Number(customer.credit_limit) <= 0) {
        throw new HttpError(400, `${customer.name} has no credit limit. Set one on the customer to allow credit.`);
      }
      if (newBalance > Number(customer.credit_limit)) {
        throw new HttpError(400, `Over ${customer.name}'s credit limit of ${Number(customer.credit_limit).toFixed(2)} (would owe ${newBalance.toFixed(2)}).`);
      }
      if (data.instalments && !hasPermission(req, 'instalments.create')) throw new HttpError(403, 'You do not have permission to set up instalments');
    }

    // 5. Save the bill.
    const invoiceNo = await nextDocumentNumber(conn, 'INV');
    const [saleResult] = await conn.query(
      `INSERT INTO sales (invoice_no, customer_id, sale_date, subtotal, discount, total, paid_amount, balance, payment_status, due_date, status, created_by)
       VALUES (?, ?, NOW(), ?, ?, ?, 0, ?, 'unpaid', ?, 'completed', ?)`,
      [invoiceNo, customer?.id ?? null, subtotal, data.discount, total, total, balance > 0 ? data.due_date ?? null : null, req.user.id],
    );
    const saleId = saleResult.insertId;

    for (const l of lines) {
      await conn.query(
        `INSERT INTO sale_lines (sale_id, item_id, karat_id, gold_price_id, qty, net_weight_g, wastage_g, billed_weight_g,
                                 pound_price_used, gram_price_used, gold_value, making_charge, line_total, unit_cost)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [saleId, l.item.id, l.item.karat_id, l.gold_price_id, l.qty, l.net_weight_g, l.wastage_g, l.billed_weight_g,
          l.pound_price_used, l.gram_price_used, l.gold_value, l.making_charge, l.line_total, Number(l.item.cost_price)],
      );
      await conn.query(
        "UPDATE items SET stock_qty = stock_qty - ?, status = IF(stock_qty = 0, 'sold', status) WHERE id = ?",
        [l.qty, l.item.id],
      );
      await conn.query(
        `INSERT INTO stock_movements (item_id, movement_type, qty_change, weight_change_g, ref_table, ref_id, created_by)
         VALUES (?, 'sale', ?, ?, 'sales', ?, ?)`,
        [l.item.id, -l.qty, -l.net_weight_g, saleId, req.user.id],
      );
    }

    for (const p of payments.filter((x) => x.amount > 0)) {
      const receiptNo = await nextDocumentNumber(conn, 'RCP');
      const [pay] = await conn.query(
        `INSERT INTO customer_payments (receipt_no, customer_id, sale_id, payment_date, amount, method, reference_no, created_by)
         VALUES (?, ?, ?, NOW(), ?, ?, ?, ?)`,
        [receiptNo, customer?.id ?? null, saleId, p.amount, p.method, p.reference_no, req.user.id],
      );
      await conn.query('INSERT INTO customer_payment_allocations (payment_id, sale_id, amount) VALUES (?, ?, ?)', [pay.insertId, saleId, p.amount]);
    }

    if (balance > 0 && data.instalments) {
      const [plan] = await conn.query(
        `INSERT INTO instalment_plans (sale_id, customer_id, financed_amount, number_of_instalments, frequency, start_date, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [saleId, customer.id, balance, data.instalments.count, data.instalments.frequency, data.instalments.start_date, req.user.id],
      );
      const schedule = buildSchedule(balance, data.instalments.count, data.instalments.frequency, data.instalments.start_date);
      await conn.query('INSERT INTO instalment_schedule (plan_id, instalment_no, due_date, amount_due) VALUES ?', [
        schedule.map((r) => [plan.insertId, r.instalment_no, r.due_date, r.amount_due]),
      ]);
      const last = schedule[schedule.length - 1].due_date;
      await conn.query('UPDATE sales SET due_date = ? WHERE id = ?', [last, saleId]);
    }

    await recomputeSale(conn, saleId);
    // Money the customer left with the shop earlier now pays this bill.
    await applyCustomerAdvances(conn, customer?.id);

    await writeAudit(conn, req, {
      action: 'create',
      table: 'sales',
      recordId: saleId,
      newValues: { invoice_no: invoiceNo, customer_id: customer?.id ?? null, total, discount: data.discount, paid, change, lines: lines.length },
    });
    return { saleId, change };
  });

  res.status(201).json({ ...presentSale(await findSale(pool, result.saleId), req), change: result.change });
});

// Cancel a bill: items go back into stock, money taken with this bill is refunded (cancelled),
// later payments that were put on it become the customer's advance again.
router.post('/:id/cancel', requirePermission('sales.cancel'), async (req, res) => {
  const id = parseId(req.params.id);
  const reason = z.string().trim().min(1, 'Give a reason').max(255).parse(req.body?.reason ?? '');
  await withTransaction(async (conn) => {
    const sale = await findSale(conn, id);
    if (sale.status === 'cancelled') throw new HttpError(400, 'This bill is already cancelled');

    for (const l of sale.lines) {
      await conn.query("UPDATE items SET stock_qty = stock_qty + ?, status = 'in_stock' WHERE id = ?", [l.qty, l.item_id]);
      await conn.query(
        `INSERT INTO stock_movements (item_id, movement_type, qty_change, weight_change_g, ref_table, ref_id, created_by)
         VALUES (?, 'adjustment', ?, ?, 'sales', ?, ?)`,
        [l.item_id, l.qty, l.net_weight_g, id, req.user.id],
      );
    }
    await conn.query(
      "UPDATE customer_payments SET status = 'cancelled', notes = CONCAT_WS(' · ', notes, ?) WHERE sale_id = ? AND status = 'active'",
      [`Refunded: bill ${sale.invoice_no} cancelled`, id],
    );
    await conn.query('DELETE FROM customer_payment_allocations WHERE sale_id = ?', [id]);
    await conn.query("UPDATE instalment_plans SET status = 'cancelled' WHERE sale_id = ?", [id]);
    await conn.query("UPDATE sales SET status = 'cancelled' WHERE id = ?", [id]);
    await recomputeSale(conn, id);
    await applyCustomerAdvances(conn, sale.customer_id);
    await writeAudit(conn, req, { action: 'cancel', table: 'sales', recordId: id, oldValues: { invoice_no: sale.invoice_no, total: sale.total }, newValues: { reason } });
  });
  res.json(presentSale(await findSale(pool, id), req));
});

export default router;
